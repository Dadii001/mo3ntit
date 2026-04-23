export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.AGENT_LOOP_DISABLED === "1") return;
  const { startAgentLoop } = await import("./lib/agents/loop");
  startAgentLoop();
}
