// 在内存中编译现有 TypeScript 路由，并替换 fetch；不会访问学校。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { NextRequest } from 'next/server.js';

const root = new URL('../', import.meta.url);
const encodeModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function loadRoute(name) {
 const timeSource = await readFile(new URL('src/lib/server-time.ts', root), 'utf8');
 const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
 }).outputText;
 let source = compile(await readFile(new URL(`src/app/api/course-uuid/${name}/route.ts`, root), 'utf8'));
 source = source.replaceAll('"next/server"', JSON.stringify(import.meta.resolve('next/server.js')))
  .replaceAll('"@/lib/school-auth.mjs"', JSON.stringify(new URL('src/lib/school-auth.mjs', root).href))
  .replaceAll('"@/lib/session-store.mjs"', JSON.stringify(new URL('src/lib/session-store.mjs', root).href))
  .replaceAll('"@/lib/course-policy.mjs"', JSON.stringify(new URL('src/lib/course-policy.mjs', root).href))
  .replaceAll('"@/lib/login-policy.mjs"', JSON.stringify(new URL('src/lib/login-policy.mjs', root).href))
  .replaceAll('"@/lib/sign-policy.mjs"', JSON.stringify(new URL('src/lib/sign-policy.mjs', root).href))
  .replaceAll('"@/lib/server-time"', JSON.stringify(encodeModule(compile(timeSource))));
 return import(`${encodeModule(source)}#${crypto.randomUUID()}`);
}
function request(body, headers = {}) {
 return new NextRequest('http://localhost:3000/api/test', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
 });
}
const credentials = { username: 'mock-student', password: 'mock-password' };
const login = { STATUS: '0', result: { id: 'mock-id', sessionId: 'mock-session' } };
async function withMock(t, fn) {
 const calls = [];
 t.mock.method(globalThis, 'fetch', async (url, options) => {
  calls.push({ url: String(url), options });
  throw new Error('测试禁止任何真实网络请求');
 });
 await fn(calls);
}

test('错误请求在本机拒绝，不调用学校', async (t) => withMock(t, async (calls) => {
 for (const routeName of ['query', 'sign']) {
  const { POST } = await loadRoute(routeName);
  assert.equal((await POST(request({}, { Origin: 'https://evil.example' }))).status, 403);
  assert.equal((await POST(request('{}', { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await POST(request('{broken'))).status, 400);
  assert.equal((await POST(request({}))).status, 400);
 }
 const query = await loadRoute('query');
 assert.equal((await query.POST(request({ ...credentials, date: '2026-02-29' }))).status, 400);
 const sign = await loadRoute('sign');
 assert.equal((await sign.POST(request({ ...credentials, courseSchedId: 'A'.repeat(32) }))).status, 400);
 assert.equal(calls.length, 0);
}));

test('本机127.0.0.1请求不会被框架内部localhost地址误拒绝', async (t) => withMock(t, async (calls) => {
 const { POST } = await loadRoute('query');
 const response = await POST(request({}, { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000' }));
 assert.equal(response.status, 400);
 assert.equal(calls.length, 0);
}));

test('查询只返回课程字段，不返回会话或密码', async (t) => {
 const calls = [];
 t.mock.method(globalThis, 'fetch', async (url) => {
  calls.push(String(url));
  return Response.json(calls.length === 1 ? login : {
   STATUS: '0', result: [{ id: '1234567', courseName: '模拟课程', secret: 'hidden' }],
  });
 });
 const { POST } = await loadRoute('query');
 const response = await POST(request({ ...credentials, date: '2026-10-07' }));
 assert.equal(response.status, 200);
 const data = await response.json();
 assert.equal(data.total, 1);
 assert.equal(data.courses[0].courseName, '模拟课程');
 assert.equal('secret' in data.courses[0], false);
 assert.equal(JSON.stringify(data).includes('mock-session'), false);
 assert.match(calls[1], /dateStr=20261007/);
});

test('查询保留三个同名同UUID课次并支持较长学校邮箱', async (t) => {
 const email = `${'a'.repeat(45)}@example.edu.cn`;
 let count = 0;
 t.mock.method(globalThis, 'fetch', async (_url, options) => {
  count++;
  if (count === 1) {
   assert.equal(new URLSearchParams(options.body).get('phone'), email);
   return Response.json(login);
  }
  return Response.json({
   STATUS: 0,
   result: ['1234567', '1234568', '1234569'].map(id => ({
    id, uuid: 'A'.repeat(32), courseName: '操作系统', roomName: '测试教室',
    classBeginTime: '2026-10-15 08:30:00', privateData: 'do-not-return',
   })),
  });
 });
 const { POST } = await loadRoute('query');
 const response = await POST(request({ ...credentials, username: email, date: '2026-10-15' }));
 assert.equal(response.status, 200);
 const data = await response.json();
 assert.equal(data.date, '20261015');
 assert.equal(data.total, 3);
 assert.equal(data.sameNameGroups, 1);
 assert.equal(new Set(data.courses.map(course => course.key)).size, 3);
 assert.deepEqual(data.courses.map(course => course.id), ['1234567', '1234568', '1234569']);
 assert.equal(JSON.stringify(data).includes('do-not-return'), false);
 assert.equal(count, 2);
});

test('课表格式异常不会伪装成无课', async (t) => {
 let count = 0;
 t.mock.method(globalThis, 'fetch', async () => Response.json(++count === 1 ? login : { STATUS: '0', result: {} }));
 t.mock.method(console, 'info', () => {});
 const { POST } = await loadRoute('query');
 const response = await POST(request({ ...credentials, date: '20261015' }));
 assert.equal(response.status, 502);
 assert.equal((await response.json()).code, 'UPSTREAM_SCHEDULE_BAD_SHAPE');
});

test('直接签到先登录再取学校时间，不采用客户端过期时间', async (t) => {
 const calls = [];
 t.mock.method(globalThis, 'fetch', async (url) => {
  calls.push(String(url));
  if (calls.length === 1) return Response.json(login);
  if (calls.length === 2) return Response.json({ STATUS: '0', timestamp: 1791356400000 });
  return Response.json({ STATUS: '0', result: { stuSignStatus: '1', stuSignId: 'mock-sign' } });
 });
 const { POST } = await loadRoute('sign');
 const response = await POST(request({ ...credentials, courseSchedId: '1234567', timestamp: 1 }));
 assert.equal(response.status, 200);
 assert.equal((await response.json()).success, true);
 assert.match(calls[1], /get_timestamp/);
 assert.match(new URL(calls[1]).searchParams.get('id'), /^\d+$/);
 assert.equal(new URL(calls[2]).searchParams.get('timestamp'), '1791356397000');
});

test('请求收到但未完成签到，不显示成功', async (t) => {
 let count = 0;
 t.mock.method(globalThis, 'fetch', async () => Response.json([
  login, { STATUS: '0', timestamp: 1791356400000 },
  { STATUS: '0', result: { stuSignStatus: '0' } },
 ][count++]));
 const { POST } = await loadRoute('sign');
 const response = await POST(request({ ...credentials, courseSchedId: '1234567' }));
 assert.equal(response.status, 409);
 assert.equal((await response.json()).success, false);
});

test('登录失败不会继续请求学校时间或签到', async (t) => {
 let count = 0;
 t.mock.method(globalThis, 'fetch', async () => { count++; return Response.json({ STATUS: '1' }); });
 const { POST } = await loadRoute('sign');
 assert.equal((await POST(request({ ...credentials, courseSchedId: '1234567' }))).status, 401);
 assert.equal(count, 1);
});

test('学校时间不可用时停止提交签到', async (t) => {
 let count = 0;
 t.mock.method(globalThis, 'fetch', async () => {
  count++;
  return Response.json(count === 1 ? login : { STATUS: '0', timestamp: 0 });
 });
 t.mock.method(console, 'error', () => {});
 const { POST } = await loadRoute('sign');
 assert.equal((await POST(request({ ...credentials, courseSchedId: '1234567' }))).status, 502);
 assert.equal(count, 2);
});

test('伪造IP不能绕过默认本机请求限制', async (t) => withMock(t, async (calls) => {
 const { POST } = await loadRoute('query');
 for (let i = 0; i < 10; i++) {
  assert.equal((await POST(request({}, { 'X-Forwarded-For': `10.0.0.${i}` }))).status, 400);
 }
 const response = await POST(request({}, { 'X-Forwarded-For': '192.0.2.1' }));
 assert.equal(response.status, 429);
 assert.ok(response.headers.get('Retry-After'));
 assert.equal(calls.length, 0);
}));

test('真实代理的HTTPS来源通过，非可信代理不能伪造协议', async (t) => withMock(t, async () => {
 const original = process.env.TRUST_PROXY_HEADERS;
 process.env.TRUST_PROXY_HEADERS = 'true';
 try {
  const { POST } = await loadRoute('query');
  const headers = { Host: 'app.example', Origin: 'https://app.example', 'X-Forwarded-Proto': 'https' };
  assert.equal((await POST(request({}, headers))).status, 400);
  delete process.env.TRUST_PROXY_HEADERS;
  assert.equal((await POST(request({}, headers))).status, 403);
 } finally {
  if (original === undefined) delete process.env.TRUST_PROXY_HEADERS;
  else process.env.TRUST_PROXY_HEADERS = original;
 }
}));

test('登录错误保留安全原因和请求编号，不再笼统报密码错误', async (t) => {
 t.mock.method(globalThis, 'fetch', async () => Response.json({ STATUS: '1', ERRCODE: '106', ERRMSG: '用户不存在！' }));
 t.mock.method(console, 'info', () => {});
 const { POST } = await loadRoute('query');
 const response = await POST(request({ ...credentials, date: '2026-10-07' }));
 const data = await response.json();
 assert.equal(response.status, 401);
 assert.equal(data.code, 'UPSTREAM_LOGIN_USER_NOT_FOUND');
 assert.equal(data.upstreamErrorCode, '106');
 assert.ok(data.requestId);
 assert.equal(JSON.stringify(data).includes('mock-password'), false);
});

test('部署时使用固定公开来源，不依赖代理改写后的Host', async (t) => withMock(t, async () => {
 const original = process.env.PUBLIC_ORIGIN;
 process.env.PUBLIC_ORIGIN = 'https://app.example';
 try {
  const { POST } = await loadRoute('query');
  assert.equal((await POST(request({}, { Host: '127.0.0.1:19300', Origin: 'https://app.example' }))).status, 400);
  assert.equal((await POST(request({}, { Host: 'evil.example', Origin: 'https://evil.example' }))).status, 403);
 } finally {
  if (original === undefined) delete process.env.PUBLIC_ORIGIN;
  else process.env.PUBLIC_ORIGIN = original;
 }
}));
