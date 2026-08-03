import type { NextConfig } from "next";
import { baseSecurityHeaders } from "@/lib/security-headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...baseSecurityHeaders],
      },
      {
        source: "/api/:path*",
        headers: [
          ...baseSecurityHeaders,
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
    ];
  },
};

export default nextConfig;
