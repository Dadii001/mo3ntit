import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["ffmpeg-static", "@anthropic-ai/claude-agent-sdk"],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  // Make sure the native CLI binary that the Agent SDK spawns is traced into
  // every serverless function bundle. Without this Vercel ships the JS but
  // not the binary, and the SDK errors with "Native CLI binary not found".
  outputFileTracingIncludes: {
    "/**/*": [
      "./node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**",
      "./node_modules/@anthropic-ai/claude-agent-sdk/**",
    ],
  },
};

export default config;
