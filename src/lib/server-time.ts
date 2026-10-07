const TIMESTAMP_URL = "https://iclass.ucas.edu.cn:8181/app/common/get_timestamp.do";
const API_UA = "student_5.0.1.2_android_12_20_100000000000000_110000";

export async function fetchSchoolTimestamp(): Promise<number> {
 const controller = new AbortController();
 const timeout = setTimeout(() => controller.abort(), 6000);
 try {
  const res = await fetch(`${TIMESTAMP_URL}?id=${Math.floor(Math.random() * 1000000)}`, {
   method: "POST", headers: { "User-Agent": API_UA }, cache: "no-store", signal: controller.signal,
  });
  if (!res.ok) throw new Error(`学校时间接口 HTTP ${res.status}`);
  const data = await res.json();
  if (data.STATUS !== "0" || !Number.isSafeInteger(data.timestamp) || data.timestamp < 1e12) {
   throw new Error("学校时间接口返回了无效时间");
  }
  return data.timestamp;
 } finally { clearTimeout(timeout); }
}
