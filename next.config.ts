// next.config.ts
import type { NextConfig } from "next";

const nextConfig = {
  eslint: {
    // ✅ This tells Next.js to not block builds if ESLint finds errors
    ignoreDuringBuilds: true,
  },
  typescript: {
    // ✅ This tells Next.js to not block builds if TypeScript finds errors
    // (your code will still run, but errors will be shown in dev)
    ignoreBuildErrors: true,
  },
};

export default nextConfig as unknown as NextConfig;
