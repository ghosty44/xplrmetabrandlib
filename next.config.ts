import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@google/generative-ai', 'garmin-connect'],
};

export default nextConfig;
