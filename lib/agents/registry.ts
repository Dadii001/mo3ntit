export type AgentId = "discovery" | "first-dm" | "offers";

export type AgentMeta = {
  id: AgentId;
  name: string;
  description: string;
  status: "live" | "coming-soon";
  tools: string[];
  tagline: string;
};

export const AGENTS: AgentMeta[] = [
  {
    id: "discovery",
    name: "Discovery Agent",
    description:
      "Scans TikTok hashtags for indie artists, analyzes their signature song (lyrics transcript), profile image, and bio with Claude, then pushes enriched profiles to Monday.",
    status: "live",
    tools: ["tiktok.search", "audio.transcribe", "claude.vision", "claude.text", "monday.create"],
    tagline: "Find and enrich",
  },
  {
    id: "first-dm",
    name: "First DM Agent",
    description:
      "Picks the best mo3ntit, drafts a human-feeling opener (A/B-tested across prompt angles), reads inbox + conversation screenshots, and drafts replies grounded in the artist's full history.",
    status: "live",
    tools: ["claude.match", "claude.text", "claude.vision", "supabase.conversations"],
    tagline: "Open the conversation",
  },
  {
    id: "offers",
    name: "Offers Agent",
    description: "Sends tailored offers to qualified leads and manages the order lifecycle.",
    status: "coming-soon",
    tools: ["tiktok.dm", "claude.text", "monday.update", "payments"],
    tagline: "Close and fulfill",
  },
];

export function getAgent(id: string): AgentMeta | undefined {
  return AGENTS.find((a) => a.id === id);
}
