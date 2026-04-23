import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["ffmpeg-static"],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default config;
