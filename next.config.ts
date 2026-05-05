import type { NextConfig } from "next";

const config: NextConfig = {
  // claude-agent-sdk is a devDependency loaded only on local dev (when
  // CLAUDE_CODE_OAUTH_TOKEN is set). Mark it external so Next.js doesn't
  // try to bundle the 238MB platform binary into the function.
  serverExternalPackages: ["ffmpeg-static", "@anthropic-ai/claude-agent-sdk"],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default config;
