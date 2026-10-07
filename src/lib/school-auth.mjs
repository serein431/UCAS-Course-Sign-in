import { analyzeSchoolLogin } from './login-policy.mjs';
import { readSession, revokeSession, REMEMBER_TTL_SECONDS } from './session-store.mjs';
import { isSameOrigin } from './sign-policy.mjs';

export const API_UA = 'student_5.0.1.2_android_12_20_100000000000000_110000';
export class AuthenticationError extends Error {
 constructor(status, code, message, upstreamErrorCode = '') {
  super(message);
  this.status = status;
  this.code = code;
  this.upstreamErrorCode = upstreamErrorCode;
 }
}

function requestUrl(req) {
 const trustedHttps = process.env.TRUST_PROXY_HEADERS === 'true' && req.headers.get('x-forwarded-proto') === 'https';
 const protocol = trustedHttps ? 'https:' : new URL(req.url).protocol;
 const host = req.headers.get('host');
 return process.env.PUBLIC_ORIGIN || (host ? `${protocol}//${host}` : req.url);
}

export function isSameOriginRequest(req) {
 if (req.headers.get('sec-fetch-site') === 'cross-site') return false;
 return isSameOrigin(req.headers.get('origin'), requestUrl(req));
}

export function sessionCookieName(req) {
 return new URL(requestUrl(req)).protocol === 'https:' ? '__Secure-ucas_session' : 'ucas_session';
}

function cookieOptions(req) {
 return {
  httpOnly: true, secure: new URL(requestUrl(req)).protocol === 'https:',
  sameSite: 'strict', path: sessionCookiePath(req), priority: 'high',
 };
}

export function sessionCookiePath(req) {
 const value = process.env.SESSION_COOKIE_PATH || req.nextUrl?.basePath || process.env.NEXT_PUBLIC_BASE_PATH || '/';
 if (!/^\/[a-zA-Z0-9/_-]*$/.test(value)) throw new Error('会话Cookie路径配置错误');
 return value;
}

export function clearLegacyRootCookie(response, req) {
 if (sessionCookiePath(req) === '/') return;
 // 旧发布曾使用根路径Cookie。单独追加删除指令，不能用同名cookies.set覆盖当前路径的凭证。
 const secure = cookieOptions(req).secure ? '; Secure' : '';
 response.headers.append('Set-Cookie', `${sessionCookieName(req)}=; Path=/; Max-Age=0${secure}; HttpOnly; SameSite=Strict`);
}

export function setSessionCookie(response, req, token, remember) {
 response.cookies.set(sessionCookieName(req), token, {
  ...cookieOptions(req), ...(remember ? { maxAge: REMEMBER_TTL_SECONDS } : {}),
 });
 clearLegacyRootCookie(response, req);
}

export function clearSessionCookie(response, req) {
 response.cookies.set(sessionCookieName(req), '', { ...cookieOptions(req), maxAge: 0 });
 clearLegacyRootCookie(response, req);
}

export async function getSavedSession(req) {
 const token = req.cookies.get(sessionCookieName(req))?.value;
 const saved = await readSession(token);
 if (saved && (saved.cookiePath ?? '/') !== sessionCookiePath(req)) {
  await revokeSession(token);
  return null;
 }
 return saved;
}

export async function invalidateSession(req) {
 await revokeSession(req.cookies.get(sessionCookieName(req))?.value);
}

export async function loginSchool(username, password) {
 if (typeof username !== 'string' || !username.trim() || username.length > 254 || /\s/.test(username) ||
     typeof password !== 'string' || !password || password.length > 80) {
  throw new AuthenticationError(400, 'INVALID_CREDENTIALS', '账号或密码格式错误');
 }
 const controller = new AbortController();
 const timeout = setTimeout(() => controller.abort(), 10000);
 let data;
 try {
  const response = await fetch('https://iclass.ucas.edu.cn:8181/app/user/login.action', {
   method: 'POST',
   headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'student_5.0.1.2_android_12_20__110000' },
   body: new URLSearchParams({
    phone: username.trim(), password, verificationType: '1', userLevel: '1',
    verificationUrl: 'http://iclass.ucas.edu.cn:88/ve/webservices/mobileCheck.shtml?method=mobileLogin&username=${0}&password=${1}&lx=${2}',
   }).toString(),
   cache: 'no-store', signal: controller.signal,
  });
  if (!response.ok) throw new AuthenticationError(502, 'UPSTREAM_LOGIN_HTTP', '学校登录接口暂时不可用，请稍后重试');
  try { data = await response.json(); }
  catch { throw new AuthenticationError(502, 'UPSTREAM_LOGIN_BAD_JSON', '学校登录接口返回非JSON'); }
 } catch (error) {
  if (error instanceof AuthenticationError) throw error;
  const timedOut = error instanceof Error && error.name === 'AbortError';
  throw new AuthenticationError(timedOut ? 504 : 502, timedOut ? 'UPSTREAM_LOGIN_TIMEOUT' : 'UPSTREAM_LOGIN_NETWORK',
   timedOut ? '学校登录接口请求超时' : '学校登录接口网络异常');
 } finally { clearTimeout(timeout); }
 const result = analyzeSchoolLogin(data);
 if (!result.ok) throw new AuthenticationError(result.status ?? 502, result.code, result.message, result.upstreamErrorCode);
 return { username: username.trim(), userId: result.userId, sessionId: result.sessionId };
}

export async function authenticateRequest(req, body) {
 // 保留命令行接口兼容性。网页只在首次登录时发送密码，后续只带Cookie。
 if (body.username !== undefined || body.password !== undefined) {
  return loginSchool(String(body.username ?? '').trim(), String(body.password ?? ''));
 }
 const saved = await getSavedSession(req);
 if (!saved) throw new AuthenticationError(401, 'AUTH_REQUIRED', '请先登录学校账号');
 return saved;
}

export function isUpstreamSessionExpired(status, data) {
 if (status === 401 || status === 403) return true;
 if (String(data?.STATUS) === '0') return false;
 const message = String(data?.ERRMSG ?? data?.msg ?? data?.message ?? '');
 // 不猜测学校未公开的错误编号，只有明确的登录失效说明才自动清除会话。
 return /(?:未|没有|尚未|重新|请先|请)登录|登录(?:状态|信息|会话)?.{0,8}(?:过期|失效|超时)|会话.{0,8}(?:过期|失效)|session.{0,12}(?:expired|invalid)|(?:not\s+logged\s+in|login\s+required)/i.test(message);
}

export async function expiredSessionError(req) {
 await invalidateSession(req);
 return new AuthenticationError(401, 'SESSION_EXPIRED', '学校登录状态已失效，请重新登录');
}
