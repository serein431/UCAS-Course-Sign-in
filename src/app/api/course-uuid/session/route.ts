import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/session-store.mjs";
import { AuthenticationError, clearSessionCookie, clearLegacyRootCookie, getSavedSession, invalidateSession, isSameOriginRequest, loginSchool, sessionCookiePath, setSessionCookie } from "@/lib/school-auth.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
	"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
};
const loginAttempts = new Map<string, number[]>();

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
	return NextResponse.json(body, { status, headers: { ...headers, ...extraHeaders } });
}

export async function GET(req: NextRequest) {
	if (!isSameOriginRequest(req)) return json({ message: "非法来源请求" }, 403);
	try {
		const session = await getSavedSession(req);
		const response = session
			? json({ authenticated: true, username: session.username, expiresAt: session.expiresAt })
			: json({ authenticated: false });
		// 不修改当前/ucas凭证，只清除旧根路径Cookie。
		clearLegacyRootCookie(response, req);
		return response;
	} catch {
		return json({ message: "暂时无法读取登录状态，请稍后重试" }, 503);
	}
}

export async function POST(req: NextRequest) {
	const requestId = crypto.randomUUID();
	if (!isSameOriginRequest(req)) return json({ message: "非法来源请求" }, 403);
	if (!req.headers.get("content-type")?.includes("application/json")) return json({ message: "请求格式错误，请使用 application/json" }, 415);
	const ip = process.env.TRUST_PROXY_HEADERS === "true"
		? (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown") : "local";
	const now = Date.now();
	for (const [key, attempts] of loginAttempts) {
		if (!attempts.some(time => now - time < 24 * 60 * 60 * 1000)) loginAttempts.delete(key);
	}
	const attempts = (loginAttempts.get(ip) ?? []).filter(time => now - time < 24 * 60 * 60 * 1000);
	const recent = attempts.filter(time => now - time < 5 * 60 * 1000);
	if (recent.length >= 10 || attempts.length >= 20) {
		const until = recent.length >= 10 ? recent[0] + 5 * 60 * 1000 : attempts[0] + 24 * 60 * 60 * 1000;
		return json({ message: "登录尝试过于频繁，请稍后再试", code: "RATE_LIMITED" }, 429, { "Retry-After": String(Math.max(1, Math.ceil((until - now) / 1000))) });
	}
	attempts.push(now);
	loginAttempts.set(ip, attempts);
	let body: unknown;
	try { body = await req.json(); }
	catch { return json({ message: "请求体 JSON 格式错误" }, 400); }
	if (!body || typeof body !== "object" || Array.isArray(body)) return json({ message: "账号或密码格式错误" }, 400);
	const input = body as Record<string, unknown>;
	if (input.remember !== undefined && typeof input.remember !== "boolean") return json({ message: "保存登录状态的选项格式错误" }, 400);
	try {
		const auth = await loginSchool(String(input.username ?? "").trim(), String(input.password ?? ""));
		const remember = input.remember !== false;
		const saved = await createSession({ ...auth, cookiePath: sessionCookiePath(req) }, remember);
		try { await invalidateSession(req); }
		catch (error) {
			// 撤销旧会话失败时不留下另一个可用的新会话。
			const { revokeSession } = await import("@/lib/session-store.mjs");
			await revokeSession(saved.token);
			throw error;
		}
		const response = json({ authenticated: true, username: auth.username, expiresAt: saved.session.expiresAt });
		setSessionCookie(response, req, saved.token, remember);
		return response;
	} catch (error) {
		if (error instanceof AuthenticationError) return json({
			message: error.message, code: error.code, upstreamErrorCode: error.upstreamErrorCode, requestId,
		}, error.status);
		// 不记录账号、密码、Cookie、学校会话或文件内容。
		console.error("[course-uuid/session]", JSON.stringify({ requestId, code: "SESSION_STORE_UNAVAILABLE" }));
		return json({ message: "无法保存登录状态，请稍后重试", code: "SESSION_STORE_UNAVAILABLE", requestId }, 503);
	}
}

export async function DELETE(req: NextRequest) {
	if (!isSameOriginRequest(req)) return json({ message: "非法来源请求" }, 403);
	try {
		await invalidateSession(req);
		const response = json({ authenticated: false });
		clearSessionCookie(response, req);
		return response;
	} catch {
		return json({ message: "退出登录失败，请稍后重试" }, 503);
	}
}
