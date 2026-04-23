import type { DiscoveryEvent } from "../types";
import { loadState } from "./state";
import { runTick } from "./strategies";

const GAP_AFTER_TICK_MS = 3_000;
const POLL_WHEN_PAUSED_MS = 15_000;
const STARTUP_DELAY_MS = 5_000;
let started = false;

function log(level: "info" | "warn" | "error", msg: string) {
  const line = `[agent-loop] ${new Date().toISOString()} ${level}: ${msg}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tickOnce() {
  await runTick({ maxPerTick: 1 }, (e: DiscoveryEvent) => {
    if (e.type === "log") log(e.level, e.message);
    else if (e.type === "saved") log("info", `saved @${e.username} → #${e.mondayId}`);
    else if (e.type === "skipped") log("info", `skipped @${e.username}: ${e.reason}`);
    else if (e.type === "done") log("info", `tick done: ${e.saved} saved, ${e.skipped} skipped`);
  });
}

async function mainLoop() {
  log("info", "background loop started — runs back-to-back while continuous is ON");
  await sleep(STARTUP_DELAY_MS);

  while (true) {
    try {
      const state = await loadState();
      if (!state.continuous) {
        await sleep(POLL_WHEN_PAUSED_MS);
        continue;
      }
      await tickOnce();
      await sleep(GAP_AFTER_TICK_MS);
    } catch (e) {
      log("error", `tick failed: ${(e as Error).message}`);
      await sleep(10_000);
    }
  }
}

export function startAgentLoop() {
  if (started) return;
  started = true;
  mainLoop().catch((e) => log("error", `loop crashed: ${(e as Error).message}`));
}
