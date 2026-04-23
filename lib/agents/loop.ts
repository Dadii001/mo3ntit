import type { DiscoveryEvent } from "../types";
import { loadState } from "./state";
import { runTick } from "./strategies";

const INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 10_000;
let started = false;
let running = false;

function log(level: "info" | "warn" | "error", msg: string) {
  const line = `[agent-loop] ${new Date().toISOString()} ${level}: ${msg}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

async function iteration() {
  if (running) {
    log("warn", "previous tick still running, skipping");
    return;
  }
  running = true;
  try {
    const state = await loadState();
    if (!state.continuous) return;
    log("info", "tick start");
    await runTick({ maxPerTick: 1 }, (e: DiscoveryEvent) => {
      if (e.type === "log") log(e.level, e.message);
      else if (e.type === "saved") log("info", `saved @${e.username} → #${e.mondayId}`);
      else if (e.type === "skipped") log("info", `skipped @${e.username}: ${e.reason}`);
      else if (e.type === "done") log("info", `tick done: ${e.saved} saved, ${e.skipped} skipped`);
    });
  } catch (e) {
    log("error", `tick failed: ${(e as Error).message}`);
  } finally {
    running = false;
  }
}

export function startAgentLoop() {
  if (started) return;
  started = true;
  log("info", `background loop registered (every ${INTERVAL_MS / 60_000} min)`);
  setTimeout(iteration, STARTUP_DELAY_MS);
  setInterval(iteration, INTERVAL_MS);
}
