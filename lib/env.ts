function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  anthropicApiKey: () => required("ANTHROPIC_API_KEY"),
  rapidApiKey: () => required("RAPIDAPI_KEY"),
  rapidApiHost: () => process.env.RAPIDAPI_HOST || "tiktok-scraper7.p.rapidapi.com",
  mondayApiKey: () => required("MONDAY_API_KEY"),
  mondayBoardId: () => required("MONDAY_BOARD_ID"),
  mondayGroupId: () => process.env.MONDAY_GROUP_ID || "topics",
  openaiApiKey: () => optional("OPENAI_API_KEY"),
};
