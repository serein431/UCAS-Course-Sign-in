export type SchoolLoginResult =
 | { ok: true; userId: string; sessionId: string }
 | { ok: false; status: number; code: string; message: string; upstreamErrorCode: string };
export function analyzeSchoolLogin(data: unknown): SchoolLoginResult;
