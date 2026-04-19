import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow fetching from postgresql.org and git.postgresql.org
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ]
  },
};

export default nextConfig;
