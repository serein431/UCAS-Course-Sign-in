// 兼容原项目的默认值，不代表学校当前的时钟差。
export const SIGN_TIMESTAMP_BUFFER_MS = 3000;

export function normalizeCourseSchedId(value) {
 if (typeof value !== 'string') return null;
 const compact = value.trim();
 return /^\d{7}$/.test(compact) ? compact : null;
}

export function normalizeCourseDate(value) {
 if (typeof value !== 'string') return null;
 const raw = value.trim();
 if (!/^(?:\d{8}|\d{4}-\d{2}-\d{2})$/.test(raw)) return null;
 const compact = raw.replaceAll('-', '');
 const year = Number(compact.slice(0, 4));
 const month = Number(compact.slice(4, 6));
 const day = Number(compact.slice(6, 8));
 if (year < 2000 || year > 2100) return null;
 const date = new Date(Date.UTC(year, month - 1, day));
 return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? compact : null;
}

export function correctedSignTimestamp(serverTime) {
 if (!Number.isSafeInteger(serverTime) || serverTime < 1e12) throw new Error('学校时间接口返回了无效时间');
 return serverTime - SIGN_TIMESTAMP_BUFFER_MS;
}

export function isSameOrigin(origin, requestUrl) {
 if (!origin) return true; // 允许本机命令行调用；不等于身份认证。
 try { return new URL(origin).origin === new URL(requestUrl).origin; } catch { return false; }
}
