import type { NextConfig } from "next";

// 通常の SSR ビルド（Vercel）。
const nextConfig: NextConfig = {
  // 共通UIパッケージは TSX をそのまま配布しているためトランスパイルする
  transpilePackages: ["@paloma-pf/ui"],
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // Excel/CSVの一括取込は Server Action の本文としてまとめて送るため、既定の1MBでは足りない
    // （初品測定は1件あたり約110バイト。2万行でおよそ2MB）。
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
