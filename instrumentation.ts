export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.AGENT_LOOP_DISABLED === "1") return;
  // On Vercel (or any serverless deploy) the function instance doesn't run
  // forever — the discovery agent is driven by the cron at /api/agents/tick
  // (configured in vercel.json) instead. Skip the in-process loop there.
  if (process.env.VERCEL) return;
  const { startAgentLoop } = await import("./lib/agents/loop");
  startAgentLoop();
}
