import { NextResponse } from "next/server";
import { fetchSchoolTimestamp } from "@/lib/server-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
 "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
 "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
};

export async function GET() {
 try {
  return NextResponse.json({ success: true, timestamp: await fetchSchoolTimestamp() }, { headers });
 } catch (error) {
  const timedOut = error instanceof Error && error.name === "AbortError";
  return NextResponse.json({
   success: false,
   message: timedOut ? "学校时间接口超时，请稍后重试" : "无法获取学校时间，请稍后重试",
  }, { status: timedOut ? 504 : 502, headers });
 }
}
