import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.avito.ru" },
      { protocol: "https", hostname: "**.avito.st" },
    ],
  },
};

export default nextConfig;
