import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export const REMEMBER_TTL_SECONDS = 7 * 24 * 60 * 60;
export const TEMPORARY_TTL_SECONDS = 12 * 60 * 60;
const AAD = Buffer.from('ucas-session-v1');
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function locations() {
 if (process.env.PUBLIC_ORIGIN && (!process.env.SESSION_KEY_FILE || !process.env.SESSION_STORE_DIR)) {
  throw new Error('公开服务必须配置会话密钥和会话目录');
 }
 return {
  keyFile: process.env.SESSION_KEY_FILE || path.resolve('.local/auth/session.key'),
  directory: process.env.SESSION_STORE_DIR || path.resolve('.local/auth/sessions'),
 };
}

async function loadKey() {
 const { keyFile } = locations();
 let key;
 // 密钥和会话属于运行时私有数据，不应让构建器复制进发布包。
 try { key = await readFile(/* turbopackIgnore: true */ keyFile); }
 catch (error) {
  if (error.code !== 'ENOENT' || process.env.SESSION_KEY_FILE) throw error;
  await mkdir(path.dirname(keyFile), { recursive: true, mode: 0o700 });
  try { await writeFile(keyFile, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
  catch (creationError) { if (creationError.code !== 'EEXIST') throw creationError; }
  key = await readFile(/* turbopackIgnore: true */ keyFile);
 }
 if (key.length !== 32) throw new Error('会话密钥格式错误');
 return key;
}

function filename(token) {
 if (!TOKEN_PATTERN.test(token || '')) return null;
 return path.join(locations().directory, `${createHash('sha256').update(token).digest('hex')}.session`);
}

function validSession(value, now) {
 return value && typeof value === 'object' && value.version === 1 &&
  typeof value.username === 'string' && value.username.length > 0 && value.username.length <= 254 &&
  typeof value.userId === 'string' && value.userId.length > 0 && value.userId.length <= 128 &&
  typeof value.sessionId === 'string' && value.sessionId.length > 0 && value.sessionId.length <= 1024 &&
  (value.cookiePath === undefined || (typeof value.cookiePath === 'string' && /^\/[a-zA-Z0-9/_-]*$/.test(value.cookiePath))) &&
  Number.isSafeInteger(value.issuedAt) && value.issuedAt <= now &&
  Number.isSafeInteger(value.expiresAt) && value.expiresAt > value.issuedAt &&
  value.expiresAt - value.issuedAt <= REMEMBER_TTL_SECONDS * 1000 &&
  typeof value.remember === 'boolean';
}

async function removeFile(file) {
 try { await unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function sweepOldFiles(directory, now) {
 // 不读取或记录其他人的会话内容，只清理超过最长有效期的文件。
 const files = await readdir(directory);
 for (const name of files.slice(0, 1000)) {
  if (!/^[a-f0-9]{64}\.session$/.test(name)) continue;
  const file = path.join(directory, name);
  try {
   const info = await stat(file);
   if (now - info.mtimeMs > REMEMBER_TTL_SECONDS * 1000) await removeFile(file);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
 }
}

export async function createSession(auth, remember = true, now = Date.now()) {
 const value = {
  version: 1, username: auth.username, userId: auth.userId, sessionId: auth.sessionId,
  cookiePath: auth.cookiePath ?? '/',
  issuedAt: now,
  expiresAt: now + (remember ? REMEMBER_TTL_SECONDS : TEMPORARY_TTL_SECONDS) * 1000,
  remember: Boolean(remember),
 };
 if (!validSession(value, now)) throw new Error('学校会话信息格式错误');
 const key = await loadKey();
 const { directory } = locations();
 await mkdir(directory, { recursive: true, mode: 0o700 });
 await sweepOldFiles(directory, now);
 const nonce = randomBytes(12);
 const cipher = createCipheriv('aes-256-gcm', key, nonce);
 cipher.setAAD(AAD);
 const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
 const blob = Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), encrypted]);
 const token = randomBytes(32).toString('base64url');
 await writeFile(filename(token), blob, { flag: 'wx', mode: 0o600 });
 return { token, session: value };
}

export async function readSession(token, now = Date.now()) {
 const file = filename(token);
 if (!file) return null;
 let blob;
 try { blob = await readFile(/* turbopackIgnore: true */ file); }
 catch (error) { if (error.code === 'ENOENT') return null; throw error; }
 const key = await loadKey();
 let value;
 try {
  if (blob.length < 30 || blob.length > 8192 || blob[0] !== 1) return null;
  const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(1, 13));
  decipher.setAAD(AAD);
  decipher.setAuthTag(blob.subarray(13, 29));
  value = JSON.parse(Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]).toString('utf8'));
 } catch { return null; }
 if (!validSession(value, now)) return null;
 if (value.expiresAt <= now) { await removeFile(file); return null; }
 return value;
}

export async function revokeSession(token) {
 const file = filename(token);
 if (file) await removeFile(file);
}
