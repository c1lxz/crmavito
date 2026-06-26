import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.avito.ru" },
      { protocol: "https", hostname: "**.avito.st" },
    ],
  },
  serverExternalPackages: ["@prisma/client"],
  outputFileTracingIncludes: {
    "/api/**": [
      "./node_modules/.prisma/client/libquery_engine-*",
      "./node_modules/@prisma/client/**",
      "./prisma/schema.prisma",
    ],
  },
};

export default nextConfig;
