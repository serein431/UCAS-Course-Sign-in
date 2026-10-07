import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
if (basePath && !/^\/[a-zA-Z0-9/_-]+$/.test(basePath)) throw new Error("NEXT_PUBLIC_BASE_PATH 格式错误");
const nextConfig: NextConfig = {
  basePath,
  // 本机保留 next start；服务器构建时使用独立运行目录。
  ...(process.env.BUILD_STANDALONE === "true" ? { output: "standalone" as const } : {}),
  poweredByHeader: false,
};
export default nextConfig;
