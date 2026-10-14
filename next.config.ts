import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // The IWSDK mirror app (xr/) is built into public/xr by `pnpm build:xr`.
  async rewrites() {
    return [{ source: "/xr", destination: "/xr/index.html" }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Permissions-Policy", value: "xr-spatial-tracking=(self), camera=(self), microphone=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
