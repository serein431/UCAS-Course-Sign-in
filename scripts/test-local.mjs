import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCourseDate, normalizeCourseSchedId, correctedSignTimestamp, SIGN_TIMESTAMP_BUFFER_MS, isSameOrigin } from '../src/lib/sign-policy.mjs';

test('课程日期支持两种格式并拒绝不存在的日期', () => {
 for (const input of ['20261007', '2026-10-07', ' 2026-10-07 ']) assert.equal(normalizeCourseDate(input), '20261007');
 assert.equal(normalizeCourseDate('2024-02-29'), '20240229');
 for (const input of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '202610-07', '', null, 20261007]) assert.equal(normalizeCourseDate(input), null);
});
test('直接签到只接受7位数字课程ID', () => {
 assert.equal(normalizeCourseSchedId(' 1234567 '), '1234567');
 for (const input of ['123456', '12345678', 'A'.repeat(32), '1234abc', '', null, 1234567]) assert.equal(normalizeCourseSchedId(input), null);
});
test('所有签到请求共用时间修正方式', () => {
 assert.equal(correctedSignTimestamp(1791356400000), 1791356400000 - SIGN_TIMESTAMP_BUFFER_MS);
 for (const input of [NaN, Infinity, 0, '1791356400000', 1791356400000.5]) assert.throws(() => correctedSignTimestamp(input));
});
test('来源检查同时验证协议和端口', () => {
 assert.equal(isSameOrigin('http://localhost:3000', 'http://localhost:3000/api/test'), true);
 assert.equal(isSameOrigin('https://localhost:3000', 'http://localhost:3000/api/test'), false);
 assert.equal(isSameOrigin('http://localhost:3001', 'http://localhost:3000/api/test'), false);
 assert.equal(isSameOrigin('null', 'http://localhost:3000/api/test'), false);
 assert.equal(isSameOrigin(null, 'http://localhost:3000/api/test'), true);
});

import { analyzeSchoolLogin } from '../src/lib/login-policy.mjs';
test('登录响应支持数字状态，不误报密码错误', () => {
 assert.deepEqual(analyzeSchoolLogin({ STATUS: 0, result: { id: 123, sessionId: 'session' } }), { ok: true, userId: '123', sessionId: 'session' });
 const incomplete = analyzeSchoolLogin({ STATUS: '0', result: {} });
 assert.equal(incomplete.status, 502);
 assert.equal(incomplete.code, 'UPSTREAM_LOGIN_INCOMPLETE');
});
test('学校登录拒绝区分账号不存在、密码错误和账号受限', () => {
 assert.equal(analyzeSchoolLogin({ STATUS: '1', ERRCODE: '106', ERRMSG: '用户不存在！' }).code, 'UPSTREAM_LOGIN_USER_NOT_FOUND');
 assert.equal(analyzeSchoolLogin({ STATUS: '1', ERRMSG: '密码错误' }).code, 'UPSTREAM_LOGIN_PASSWORD_REJECTED');
 assert.equal(analyzeSchoolLogin({ STATUS: '1', ERRMSG: '账号被锁定' }).code, 'UPSTREAM_LOGIN_ACCOUNT_RESTRICTED');
 assert.equal(analyzeSchoolLogin({ STATUS: '1', ERRMSG: '需要验证码' }).code, 'UPSTREAM_LOGIN_VERIFICATION_REQUIRED');
 assert.equal(analyzeSchoolLogin(null).status, 502);
});
test('不把学校响应中的秘密或任意文字带给浏览器', () => {
 const result = analyzeSchoolLogin({ STATUS: '1', ERRCODE: '<script>', ERRMSG: 'mock-password mock-session 不明错误' });
 assert.equal(result.upstreamErrorCode, '');
 assert.equal(JSON.stringify(result).includes('mock-password'), false);
 assert.equal(JSON.stringify(result).includes('mock-session'), false);
});
