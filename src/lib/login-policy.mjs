// 只返回预设说明与非敏感错误码，不转发学校响应中的账号、密码或会话。
export function analyzeSchoolLogin(data) {
 const status = data && typeof data === 'object' ? String(data.STATUS ?? '') : '';
 if (status === '0') {
  const id = data?.result?.id;
  const session = data?.result?.sessionId;
  if ((typeof id === 'string' || typeof id === 'number') && String(id) && typeof session === 'string' && session) {
   return { ok: true, userId: String(id), sessionId: session };
  }
  return { ok: false, status: 502, code: 'UPSTREAM_LOGIN_INCOMPLETE', message: '学校返回了登录成功，但缺少用户或会话信息；这不是密码错误，请稍后重试', upstreamErrorCode: '' };
 }
 const rawCode = String(data?.ERRCODE ?? '');
 const upstreamErrorCode = /^[a-zA-Z0-9_-]{1,32}$/.test(rawCode) ? rawCode : '';
 const rawMessage = String(data?.ERRMSG ?? data?.msg ?? data?.message ?? '');
 if (!status && !upstreamErrorCode) {
  return { ok: false, status: 502, code: 'UPSTREAM_LOGIN_INVALID_RESPONSE', message: '学校登录接口返回了无法识别的响应，请稍后重试', upstreamErrorCode: '' };
 }
 let code = 'UPSTREAM_LOGIN_REJECTED';
 let message = '学校登录接口拒绝了登录，请先确认同一账号能否登录学校课堂教学 App';
 if (upstreamErrorCode === '106' || /用户不存在|账号不存在|帐号不存在/.test(rawMessage)) {
  code = 'UPSTREAM_LOGIN_USER_NOT_FOUND';
  message = '学校课堂教学系统未找到该账号，请核对学号，并确认此账号能登录学校课堂教学 App';
 } else if (/密码.{0,8}(错误|不正确)|口令.{0,8}错误/.test(rawMessage)) {
  code = 'UPSTREAM_LOGIN_PASSWORD_REJECTED';
  message = '学校课堂教学系统提示密码错误，请确认密码与学校课堂教学 App 中使用的一致';
 } else if (/锁定|冻结|停用|禁用/.test(rawMessage)) {
  code = 'UPSTREAM_LOGIN_ACCOUNT_RESTRICTED';
  message = '学校课堂教学系统提示账号受限，请停止重复尝试，并联系学校处理';
 } else if (/验证码/.test(rawMessage)) {
  code = 'UPSTREAM_LOGIN_VERIFICATION_REQUIRED';
  message = '学校要求额外验证，请先在官方 App 完成验证；本工具不支持此验证步骤';
 }
 return { ok: false, status: 401, code, message: upstreamErrorCode ? `${message}（学校错误码 ${upstreamErrorCode}）` : message, upstreamErrorCode };
}
