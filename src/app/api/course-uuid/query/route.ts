import { normalizeCourseSchedule } from "@/lib/course-policy.mjs";
import { authenticateRequest, AuthenticationError, clearSessionCookie, expiredSessionError, isSameOriginRequest, isUpstreamSessionExpired, API_UA } from "@/lib/school-auth.mjs";
import { normalizeCourseDate } from "@/lib/sign-policy.mjs";
import { NextRequest, NextResponse } from "next/server";

const SCHEDULE_URL = "https://iclass.ucas.edu.cn:8181/app/course/get_stu_course_sched.action";

type ScheduleResponse = {
	STATUS?: string | number;
	result?: unknown[];
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
	"Cache-Control": "no-store",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer",
	"X-Frame-Options": "DENY"
};
const REQUEST_TIMEOUT_MS = 10000;

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MAX = toPositiveInt(process.env.RATE_LIMIT_5M_MAX, 10);
const RATE_LIMIT_DAILY_MAX = toPositiveInt(process.env.RATE_LIMIT_DAILY_MAX, 20);
const RATE_LIMIT_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

type RateLimitState = {
	windowHits: number[];
	dailyCount: number;
	dailyResetAt: number;
};

const ipRateLimitStore = new Map<string, RateLimitState>();
let lastRateLimitSweepAt = 0;

class ApiError extends Error {
	status: number;
	code: string;
	stage: "login" | "schedule" | "request";

	constructor(status: number, code: string, message: string, stage: "login" | "schedule" | "request") {
		super(message);
		this.status = status;
		this.code = code;
		this.stage = stage;
	}
}

function toPositiveInt(value: string | undefined, fallback: number): number {
	if (!value) {
		return fallback;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function jsonWithHeaders(body: unknown, init: { status: number; headers?: Record<string, string> }) {
	return NextResponse.json(body, {
		status: init.status,
		headers: {
			...RESPONSE_HEADERS,
			...(init.headers ?? {})
		}
	});
}

function getClientIp(req: NextRequest): string {
	if (process.env.TRUST_PROXY_HEADERS !== "true") return "local";
	const xff = req.headers.get("x-forwarded-for");
	if (xff) {
		return xff.split(",")[0]?.trim() || "unknown";
	}
	return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function sweepRateLimitStore(now: number) {
	if (now - lastRateLimitSweepAt < RATE_LIMIT_SWEEP_INTERVAL_MS) {
		return;
	}

	for (const [ip, state] of ipRateLimitStore.entries()) {
		state.windowHits = state.windowHits.filter((ts) => now - ts <= FIVE_MINUTES_MS);

		if (state.dailyResetAt <= now) {
			state.dailyCount = 0;
			state.dailyResetAt = now + ONE_DAY_MS;
		}

		if (state.windowHits.length === 0 && state.dailyCount === 0) {
			ipRateLimitStore.delete(ip);
		}
	}

	lastRateLimitSweepAt = now;
}

function consumeRateLimit(ip: string, now: number): { ok: true } | { ok: false; retryAfterSec: number } {
	sweepRateLimitStore(now);

	const state =
		ipRateLimitStore.get(ip) ??
		({
			windowHits: [],
			dailyCount: 0,
			dailyResetAt: now + ONE_DAY_MS
		} satisfies RateLimitState);

	if (state.dailyResetAt <= now) {
		state.dailyCount = 0;
		state.dailyResetAt = now + ONE_DAY_MS;
	}

	state.windowHits = state.windowHits.filter((ts) => now - ts <= FIVE_MINUTES_MS);

	if (state.windowHits.length >= RATE_LIMIT_WINDOW_MAX) {
		const oldestAllowed = state.windowHits[0] + FIVE_MINUTES_MS;
		const retryAfterSec = Math.max(1, Math.ceil((oldestAllowed - now) / 1000));
		ipRateLimitStore.set(ip, state);
		return { ok: false, retryAfterSec };
	}

	if (state.dailyCount >= RATE_LIMIT_DAILY_MAX) {
		const retryAfterSec = Math.max(1, Math.ceil((state.dailyResetAt - now) / 1000));
		ipRateLimitStore.set(ip, state);
		return { ok: false, retryAfterSec };
	}

	state.windowHits.push(now);
	state.dailyCount += 1;
	ipRateLimitStore.set(ip, state);

	return { ok: true };
}

export async function POST(req: NextRequest) {
	const startedAt = Date.now();
	const requestId = crypto.randomUUID();
	let stage: "login" | "schedule" | "request" = "request";

	try {
		if (!isSameOriginRequest(req)) {
			return jsonWithHeaders({ message: "非法来源请求" }, { status: 403 });
		}

		const contentType = req.headers.get("content-type") ?? "";
		if (!contentType.includes("application/json")) {
			return jsonWithHeaders({ message: "请求格式错误，请使用 application/json" }, { status: 415 });
		}

		const ip = getClientIp(req);
		const rateLimitResult = consumeRateLimit(ip, Date.now());
		if (!rateLimitResult.ok) {
			return jsonWithHeaders(
				{ message: "请求过于频繁，请稍后再试", code: "RATE_LIMITED" },
				{
					status: 429,
					headers: {
						"Retry-After": String(rateLimitResult.retryAfterSec)
					}
				}
			);
		}

		let body: unknown;
		try {
			body = await req.json();
		} catch {
			return jsonWithHeaders({ message: "请求体 JSON 格式错误" }, { status: 400 });
		}

		const bodyObject = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
		const dateInput = String(bodyObject.date ?? "").trim();

		const date = normalizeCourseDate(dateInput);
		if (!date) {
			return jsonWithHeaders({ message: "日期格式错误，请使用 yyyyMMdd 或 yyyy-MM-dd" }, { status: 400 });
		}

		stage = "login";
		const { sessionId, userId } = await authenticateRequest(req, bodyObject);

		stage = "schedule";
		const scheduleAbortController = new AbortController();
		const scheduleTimeout = setTimeout(() => scheduleAbortController.abort(), REQUEST_TIMEOUT_MS);

		let scheduleData: ScheduleResponse;
		try {
			const scheduleUrl = `${SCHEDULE_URL}?id=${encodeURIComponent(userId)}&dateStr=${encodeURIComponent(date)}`;
			const scheduleRes = await fetch(scheduleUrl, {
				method: "GET",
				headers: {
					sessionId,
					"User-Agent": API_UA
				},
				cache: "no-store",
				signal: scheduleAbortController.signal
			});

			if (isUpstreamSessionExpired(scheduleRes.status)) throw await expiredSessionError(req);
			if (!scheduleRes.ok) {
				throw new ApiError(
					502,
					"UPSTREAM_SCHEDULE_HTTP",
					`课表接口HTTP异常: ${scheduleRes.status}`,
					"schedule"
				);
			}

			try {
				scheduleData = (await scheduleRes.json()) as ScheduleResponse;
			} catch {
				throw new ApiError(502, "UPSTREAM_SCHEDULE_BAD_JSON", "课表接口返回非JSON", "schedule");
			}
		} catch (error) {
			if (error instanceof ApiError || error instanceof AuthenticationError) {
				throw error;
			}
			if (error instanceof Error && error.name === "AbortError") {
				throw new ApiError(504, "UPSTREAM_SCHEDULE_TIMEOUT", "课表接口请求超时", "schedule");
			}
			throw new ApiError(502, "UPSTREAM_SCHEDULE_NETWORK", "课表接口网络异常", "schedule");
		} finally {
			clearTimeout(scheduleTimeout);
		}

		if (isUpstreamSessionExpired(200, scheduleData)) throw await expiredSessionError(req);

		if (String(scheduleData?.STATUS) !== "0") {
			return jsonWithHeaders({ message: "课表查询失败，或当天无课程" }, { status: 502 });
		}

		let schedule;
		try { schedule = normalizeCourseSchedule(scheduleData.result ?? [], date); }
		catch { throw new ApiError(502, "UPSTREAM_SCHEDULE_BAD_SHAPE", "学校课表接口返回了无法识别的记录，请稍后重试", "schedule"); }

		return jsonWithHeaders(
			{
				date,
				...schedule
			},
			{ status: 200 }
		);
	} catch (error) {
		if (error instanceof AuthenticationError) {
			const response = jsonWithHeaders({ message: error.message, code: error.code, upstreamErrorCode: error.upstreamErrorCode, requestId }, { status: error.status });
			if (error.status === 401) clearSessionCookie(response, req);
			return response;
		}
		const durationMs = Date.now() - startedAt;
		const isApiError = error instanceof ApiError;
		const logPayload = {
			requestId,
			stage,
			durationMs,
			errorName: error instanceof Error ? error.name : "UnknownError",
			errorMessage: error instanceof Error ? error.message : "Unknown error",
			code: isApiError ? error.code : "UNEXPECTED_ERROR"
		};

		console.error("[course-uuid/query]", JSON.stringify(logPayload));

		if (isApiError) {
			return jsonWithHeaders({ message: error.message, code: error.code }, { status: error.status });
		}

		return jsonWithHeaders({ message: "服务暂时不可用，请稍后重试", code: "UNEXPECTED_ERROR" }, { status: 500 });
	}
}
