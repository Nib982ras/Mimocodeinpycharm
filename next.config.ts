import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // Security headers
  headers: async () => [
    {
      source: "/api/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
      ],
    },
  ],

  // Disable x-powered-by header
  poweredByHeader: false,

  // Strict mode for better error detection in development
  reactStrictMode: true,

  // TypeScript strict mode — enforce type safety
  typescript: {
    ignoreBuildErrors: false,
  },

  // Body size limit: 100MB for file uploads (matches body-size-limit.ts)
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
};

export default nextConfig;
