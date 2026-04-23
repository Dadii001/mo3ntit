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
      "Sends the opening DM to new artists in the Monday board and manages the reply thread until a qualified lead emerges.",
    status: "coming-soon",
    tools: ["tiktok.dm", "claude.text", "monday.update"],
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
