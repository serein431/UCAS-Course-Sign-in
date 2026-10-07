import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import ts from 'typescript';
import { NextRequest } from 'next/server.js';
import { createSession, readSession, revokeSession, REMEMBER_TTL_SECONDS, TEMPORARY_TTL_SECONDS } from '../src/lib/session-store.mjs';
import { isUpstreamSessionExpired } from '../src/lib/school-auth.mjs';

let directory;
const original = { key: process.env.SESSION_KEY_FILE, store: process.env.SESSION_STORE_DIR };
before(async () => {
 directory = await mkdtemp(path.join(tmpdir(), 'ucas-session-test-'));
 process.env.SESSION_KEY_FILE = path.join(directory, 'key');
 process.env.SESSION_STORE_DIR = path.join(directory, 'sessions');
 await writeFile(process.env.SESSION_KEY_FILE, randomBytes(32), { mode: 0o600 });
});
after(async () => {
 for (const [env, old] of [['SESSION_KEY_FILE', original.key], ['SESSION_STORE_DIR', original.store]]) {
  if (old === undefined) delete process.env[env]; else process.env[env] = old;
 }
 await rm(directory, { recursive: true, force: true });
});

const auth = { username: 'fixture@example.edu.cn', userId: 'fictional-user-id', sessionId: 'fictional-school-session' };
const root = new URL('../', import.meta.url);
const encode = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function route(name) {
 const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
 }).outputText;
 let source = compile(await readFile(new URL(`src/app/api/course-uuid/${name}/route.ts`, root), 'utf8'));
 source = source.replaceAll('"next/server"', JSON.stringify(import.meta.resolve('next/server.js')))
  .replace(/"@\/lib\/([\w-]+\.mjs)"/g, (_match, file) => JSON.stringify(new URL(`src/lib/${file}`, root).href))
  .replaceAll('"@/lib/server-time"', JSON.stringify(encode(compile(await readFile(new URL('src/lib/server-time.ts', root), 'utf8')))));
 return import(`${encode(source)}#${crypto.randomUUID()}`);
}
function req(body, token, method = 'POST', headers = {}) {
 return new NextRequest('http://localhost:3000/api/course-uuid/test', {
  method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Cookie: `ucas_session=${token}` } : {}), ...headers },
  ...(body === undefined || method === 'GET' ? {} : { body: JSON.stringify(body) }),
 });
}
function tokenOf(response) {
 return response.cookies.get('ucas_session')?.value;
}
function forbidNetwork(t) {
 const calls = [];
 t.mock.method(globalThis, 'fetch', async (url) => { calls.push(String(url)); throw new Error('禁止真实学校网络'); });
 return calls;
}

test('持久会话只保存白名单字段，不保存密码，文件及Cookie不含明文学校会话', async () => {
 const saved = await createSession({ ...auth, password: 'must-never-be-stored' }, true);
 assert.match(saved.token, /^[A-Za-z0-9_-]{43}$/);
 const value = await readSession(saved.token);
 assert.equal(value.username, auth.username);
 assert.equal(value.sessionId, auth.sessionId);
 assert.equal('password' in value, false);
 assert.equal(value.expiresAt - value.issuedAt, REMEMBER_TTL_SECONDS * 1000);
 const file = path.join(process.env.SESSION_STORE_DIR, `${createHash('sha256').update(saved.token).digest('hex')}.session`);
 const blob = await readFile(file);
 for (const secret of [auth.username, auth.sessionId, 'must-never-be-stored', saved.token]) assert.equal(blob.includes(Buffer.from(secret)), false);
 assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('不保持登录时服务端只保留12小时会话', async () => {
 const saved = await createSession(auth, false);
 assert.equal(saved.session.expiresAt - saved.session.issuedAt, TEMPORARY_TTL_SECONDS * 1000);
});

test('刷新或重新加载服务模块仍能恢复有效会话', async () => {
 const saved = await createSession(auth);
 const reloaded = await import(`../src/lib/session-store.mjs?fresh=${crypto.randomUUID()}`);
 assert.equal((await reloaded.readSession(saved.token)).userId, auth.userId);
});

test('过期和退出后的旧Cookie不能继续使用', async () => {
 const saved = await createSession(auth);
 assert.equal(await readSession(saved.token, saved.session.expiresAt), null);
 const second = await createSession(auth);
 await revokeSession(second.token);
 assert.equal(await readSession(second.token), null);
});

test('伪造token、路径和篡改文件不能恢复会话', async () => {
 for (const value of ['../key', 'A'.repeat(42), 'A'.repeat(5000), 'A'.repeat(43)]) assert.equal(await readSession(value), null);
 const saved = await createSession(auth);
 const file = path.join(process.env.SESSION_STORE_DIR, `${createHash('sha256').update(saved.token).digest('hex')}.session`);
 const blob = await readFile(file); blob[blob.length - 1] ^= 1;
 await writeFile(file, blob);
 assert.equal(await readSession(saved.token), null);
});

test('不猜测学校错误编号，网络失败和普通课程错误不当成会话过期', () => {
 assert.equal(isUpstreamSessionExpired(401), true);
 assert.equal(isUpstreamSessionExpired(403), true);
 assert.equal(isUpstreamSessionExpired(200, { STATUS: '1', ERRMSG: '请先登录' }), true);
 assert.equal(isUpstreamSessionExpired(200, { STATUS: '1', ERRMSG: '登录状态已失效' }), true);
 assert.equal(isUpstreamSessionExpired(502, { STATUS: '1', ERRMSG: '当天没有课程' }), false);
 assert.equal(isUpstreamSessionExpired(200, { STATUS: '1', ERRCODE: '9999' }), false);
});

test('未登录状态读取和退出不访问学校，接口不可跨站调用', async (t) => {
 const calls = forbidNetwork(t);
 const session = await route('session');
 assert.deepEqual(await (await session.GET(req(undefined, undefined, 'GET'))).json(), { authenticated: false });
 assert.equal((await session.DELETE(req(undefined, undefined, 'DELETE'))).status, 200);
 for (const method of ['GET', 'POST', 'DELETE']) {
  assert.equal((await session[method](req({}, undefined, method, { Origin: 'https://foreign.example' }))).status, 403);
  assert.equal((await session[method](req({}, undefined, method, { 'Sec-Fetch-Site': 'cross-site' }))).status, 403);
 }
 assert.equal(calls.length, 0);
});

test('首次登录设置HttpOnly持久Cookie；刷新只读取会话，不再登录学校', async (t) => {
 let count = 0;
 const session = await route('session');
 // 学校登录使用id字段，不使用前端自选的用户标识。
 t.mock.method(globalThis, 'fetch', async () => { count++; return Response.json({ STATUS: '0', result: { id: auth.userId, sessionId: auth.sessionId } }); });
 const response = await session.POST(req({ username: auth.username, password: 'fictional-password', remember: true }));
 assert.equal(response.status, 200);
 const cookie = response.headers.get('set-cookie');
 assert.match(cookie, /HttpOnly/i);
 assert.match(cookie, /SameSite=strict/i);
 assert.match(cookie, /Max-Age=604800/i);
 assert.equal(cookie.includes(auth.sessionId), false);
 const token = tokenOf(response);
 const restored = await session.GET(req(undefined, token, 'GET'));
 assert.equal((await restored.json()).username, auth.username);
 assert.equal(count, 1);
 assert.equal(JSON.stringify(await response.json()).includes(auth.sessionId), false);
});

test('未勾选保持登录时Cookie没有Max-Age', async (t) => {
 t.mock.method(globalThis, 'fetch', async () => Response.json({ STATUS: '0', result: { id: auth.userId, sessionId: auth.sessionId } }));
 const session = await route('session');
 const response = await session.POST(req({ username: auth.username, password: 'fictional-password', remember: false }));
 assert.equal(response.status, 200);
 assert.doesNotMatch(response.headers.get('set-cookie'), /Max-Age=/i);
});

test('重新登录更换凭证并撤销旧会话，错误选项不访问学校', async (t) => {
 let count = 0;
 t.mock.method(globalThis, 'fetch', async () => {
  count++;
  return Response.json({ STATUS: '0', result: { id: auth.userId, sessionId: auth.sessionId } });
 });
 const session = await route('session');
 assert.equal((await session.POST(req({ username: auth.username, password: 'fictional-password', remember: 'true' }))).status, 400);
 assert.equal(count, 0);
 const first = await session.POST(req({ username: auth.username, password: 'fictional-password' }));
 const oldToken = tokenOf(first);
 const second = await session.POST(req({ username: auth.username, password: 'fictional-password' }, oldToken));
 const newToken = tokenOf(second);
 assert.notEqual(newToken, oldToken);
 assert.equal(await readSession(oldToken), null);
 assert.ok(await readSession(newToken));
 assert.equal(count, 2);
});

test('服务器使用HTTPS安全前缀及/ucas路径，退出用同样路径删除Cookie', async (t) => {
 const origin = process.env.PUBLIC_ORIGIN, base = process.env.NEXT_PUBLIC_BASE_PATH;
 process.env.PUBLIC_ORIGIN = 'https://app.example';
 process.env.NEXT_PUBLIC_BASE_PATH = '/ucas';
 try {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ STATUS: '0', result: { id: auth.userId, sessionId: auth.sessionId } }));
  const session = await route('session');
  const response = await session.POST(req({ username: auth.username, password: 'fictional-password' }, undefined, 'POST', { Origin: 'https://app.example' }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^__Secure-ucas_session=/);
  assert.match(cookie, /; Secure/i);
  assert.match(cookie, /Path=\/ucas/);
  const token = response.cookies.get('__Secure-ucas_session').value;
  const loggedOut = await session.DELETE(req(undefined, undefined, 'DELETE', { Origin: 'https://app.example', Cookie: `__Secure-ucas_session=${token}` }));
  assert.match(loggedOut.headers.get('set-cookie'), /Path=\/ucas/);
  assert.match(loggedOut.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(await readSession(token), null);
 } finally {
  if (origin === undefined) delete process.env.PUBLIC_ORIGIN; else process.env.PUBLIC_ORIGIN = origin;
  if (base === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH; else process.env.NEXT_PUBLIC_BASE_PATH = base;
 }
});

test('已登录查询只发一次课表请求，不重新发送密码', async (t) => {
 const saved = await createSession(auth);
 const calls = [];
 t.mock.method(globalThis, 'fetch', async (url, options) => {
  calls.push(String(url));
  assert.equal(options.headers.sessionId, auth.sessionId);
  assert.equal(options.body, undefined);
  return Response.json({ STATUS: '0', result: [{ id: '1234567', courseName: '模拟课程' }] });
 });
 const query = await route('query');
 const response = await query.POST(req({ date: '20261015' }, saved.token));
 assert.equal(response.status, 200);
 assert.equal(calls.length, 1);
 assert.match(calls[0], /get_stu_course_sched/);
});

test('已登录的模拟签到不再登录学校，只取时间再使用原会话', async (t) => {
 const saved = await createSession(auth);
 const calls = [];
 t.mock.method(globalThis, 'fetch', async (url, options) => {
  calls.push(String(url));
  if (calls.length === 1) return Response.json({ STATUS: '0', timestamp: 1791356400000 });
  assert.equal(options.headers.sessionId, auth.sessionId);
  return Response.json({ STATUS: '0', result: { stuSignStatus: '1', stuSignId: 'fictional-sign' } });
 });
 const sign = await route('sign');
 assert.equal((await sign.POST(req({ courseSchedId: '1234567' }, saved.token))).status, 200);
 assert.equal(calls.length, 2);
 assert.equal(calls.some(url => url.includes('/login.action')), false);
});

test('缺少登录会话时不请求学校；学校明确会话失效后撤销记录', async (t) => {
 const calls = forbidNetwork(t);
 const query = await route('query'), sign = await route('sign');
 assert.equal((await query.POST(req({ date: '20261015' }))).status, 401);
 assert.equal((await sign.POST(req({ courseSchedId: '1234567' }))).status, 401);
 assert.equal(calls.length, 0);
 const saved = await createSession(auth);
 t.mock.method(globalThis, 'fetch', async () => Response.json({ STATUS: '1', ERRMSG: '请先登录' }));
 const expired = await query.POST(req({ date: '20261015' }, saved.token));
 assert.equal(expired.status, 401);
 assert.equal((await expired.json()).code, 'SESSION_EXPIRED');
 assert.match(expired.headers.get('set-cookie'), /Max-Age=0/);
 assert.equal(await readSession(saved.token), null);
});

test('学校网络异常不清除会话，退出后复制旧Cookie仍不可使用', async (t) => {
 const saved = await createSession(auth);
 forbidNetwork(t);
 t.mock.method(console, 'error', () => {});
 const query = await route('query');
 const response = await query.POST(req({ date: '20261015' }, saved.token));
 assert.equal(response.status, 502);
 assert.ok(await readSession(saved.token));
 const session = await route('session');
 assert.equal((await session.DELETE(req(undefined, saved.token, 'DELETE'))).status, 200);
 assert.equal((await query.POST(req({ date: '20261015' }, saved.token))).status, 401);
});

test('登录失败不创建Cookie，登录次数受限', async (t) => {
 const filesBefore = await readdir(process.env.SESSION_STORE_DIR);
 let count = 0;
 t.mock.method(globalThis, 'fetch', async () => { count++; return Response.json({ STATUS: '1', ERRCODE: '106' }); });
 const session = await route('session');
 for (let i = 0; i < 10; i++) {
  const response = await session.POST(req({ username: auth.username, password: 'fictional-password' }));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('set-cookie'), null);
 }
 assert.equal((await session.POST(req({ username: auth.username, password: 'fictional-password' }))).status, 429);
 assert.equal(count, 10);
 assert.deepEqual(await readdir(process.env.SESSION_STORE_DIR), filesBefore);
});
