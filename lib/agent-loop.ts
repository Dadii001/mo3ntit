import { z } from "zod/v4";
import {
  createSdkMcpServer,
  query,
  tool,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { MODEL } from "./claude-agent";
import { FUNNEL_STAGE_LABELS, FUNNEL_STAGES, type FunnelStage } from "./dm-agent";
import { updateMondayStatus } from "./monday";
import {
  ARTIST_STATUSES,
  STATUS_LABELS,
  getArtistById,
  getMo3ntitById,
  listConversation,
  logConversation,
  markFirstDmSent,
  updateArtistFunnelStage,
  updateArtistStatus,
  type ArtistStatus,
  type ConversationRow,
} from "./supabase";
import { MACRO_SIGNAL_VALUES, type MacroSignal } from "./macro-signals";

// ---- Action protocol returned to the client ----

export type AgentAction =
  | { type: "display_message"; text: string }
  | { type: "paint_signal"; signal: MacroSignal }
  | { type: "thinking"; text: string }
  | { type: "tool_called"; name: string; input: unknown }
  | { type: "tool_result"; name: string; result: unknown };

export type AgentTickResult = {
  actions: AgentAction[];
  agentText: string;
  done: boolean;
  finalStatus: string | null;
  finalStage: string | null;
  stopReason: "needs_offer" | "lost" | "done" | "max_iterations" | "error";
};

// ---- System prompt ----

function buildSystemPrompt(artist: {
  account: string;
  nickname: string;
  artist_brief: string | null;
  song_brief: string | null;
}): string {
  return `You are the autonomous DM agent for an indie music label called Mo3ntit. Your goal is to convert TikTok artists into 'needs offer' status by guiding them through a 5-stage funnel. The human closes the deal — you do not send offer links.

YOU CANNOT SEND DMs DIRECTLY. To send a message you must:
1. Call display_message(text) to put it in the dashboard's DM textarea.
2. Call paint_signal(...) — the human's Macro Commander watches a color swatch and runs the matching keystroke macro in TikTok.

Macro signals:
- send_dm: macro copies DM textarea → sends it in TikTok → screenshots inbox → pastes it back to you next turn
- open_thread: macro opens top unread DM thread → screenshots conversation → pastes back next turn
- send_reply: macro copies DM textarea → sends it as a reply in the open thread
- close_next: macro closes the DM panel; the dashboard will then load the next artist
- idle: do nothing

You decide ONE step at a time. Each turn, you receive the current state + (optionally) a screenshot the macro just took. You call tools to do your action. Stop when you've queued the next macro action — no need to keep going.

==== THE FUNNEL ====

Stage 1 — HOOK: the first DM. Single message. Always one message, never two. Riff on one specific detail of their song or vibe. Don't pitch. Don't compliment generically. Don't mention the song title. Max 25 words.

Stage 2 — RAPPORT: vibe-check. React warmly to what they shared. Drop a specific genuine compliment about their music. No promo talk. The artist must feel SEEN.

Stage 3 — QUALIFY: peer-y casual question — "btw have you ever had your stuff pushed by creators?" / "ever done any promo with tiktokers before?". Don't survey them.

Stage 4 — PITCH: tell them their song could go viral; offer ONE specific TikTok trend angle they could ride (a transition, a recurring visual gag, a hook moment). Make them feel chosen. Don't mention price/terms.

Stage 5 — CLOSING: when they're showing interest, get a yes — "want me to put something together for you?". When they say yes / "tell me more" / "how does that work" → call mark_needs_offer.

Voice: human, peer-to-peer, casual, never corporate. Plain text only. No emojis unless they used one first. No "love your stuff" / "big fan" / "saw your video". Match their energy.

The artist must feel: TALENTED, special, real potential to go viral — they just need the right promo.

==== ARTIST CONTEXT ====
@${artist.account} — ${artist.nickname}
Artist brief: ${artist.artist_brief ?? "(none)"}
Song brief: ${artist.song_brief ?? "(none)"}

==== TURN PROTOCOL ====
- Do exactly one user-visible action per turn (display + paint, OR a terminal tool).
- After display_message + paint_signal(send_dm | send_reply), STOP — wait for the next screenshot.
- When you receive an inbox screenshot: if 0 unread (no red dots), call mark_first_dm_sent (if status is still 'new') + paint_signal(close_next). If 1+ unread, paint_signal(open_thread).
- When you receive a conversation screenshot: read the artist's reply, draft your next message via display_message, paint_signal(send_reply), advance_stage if appropriate, log_outbound for what you just drafted.
- Reaching closing + clear interest → mark_needs_offer.
- Be conservative on mark_lost — only on clear rejection.`;
}

// ---- Build the user prompt for this turn ----

function buildTurnPrompt(args: {
  trigger: "start" | "inbox" | "conversation" | "message_sent";
  history: ConversationRow[];
  artistStage: string;
  artistStatus: string;
  currentDm: string | null;
  extraNote?: string;
  mo3ntitHandle?: string | null;
}): string {
  const transcript =
    args.history.length === 0
      ? "(no messages yet)"
      : args.history
          .map((m) => `${m.direction === "out" ? "US" : "ARTIST"}: ${m.body}`)
          .join("\n");

  const stageLabel =
    FUNNEL_STAGE_LABELS[args.artistStage as FunnelStage] ?? args.artistStage;
  const statusLabel =
    STATUS_LABELS[args.artistStatus as ArtistStatus] ?? args.artistStatus;

  return `TRIGGER: ${args.trigger}
SENDER (mo3ntit): ${args.mo3ntitHandle ? "@" + args.mo3ntitHandle : "(unset)"}
ARTIST STATUS: ${statusLabel} (${args.artistStatus})
FUNNEL STAGE: ${stageLabel} (${args.artistStage})
CURRENT DM IN BOX: ${args.currentDm ? `"${args.currentDm}"` : "(empty)"}

CONVERSATION SO FAR:
${transcript}

${args.extraNote ? `NOTE: ${args.extraNote}\n\n` : ""}What's the next action?`;
}

// ---- The agent loop ----

const MAX_TURNS = 6;

export async function runAgentTick(args: {
  artistId: string;
  trigger: "start" | "inbox" | "conversation" | "message_sent";
  imageBase64?: string;
  extraNote?: string;
  emit?: (a: AgentAction) => void;
}): Promise<AgentTickResult> {
  const { artistId, trigger, imageBase64, extraNote } = args;
  const actions: AgentAction[] = [];
  const emit = (a: AgentAction) => {
    actions.push(a);
    args.emit?.(a);
  };

  const artist = await getArtistById(artistId);
  if (!artist) {
    return {
      actions,
      agentText: "",
      done: true,
      finalStatus: null,
      finalStage: null,
      stopReason: "error",
    };
  }

  const mo3ntit = artist.selected_mo3ntit_id
    ? await getMo3ntitById(artist.selected_mo3ntit_id)
    : null;
  const history = await listConversation(artist.id);
  const stage = (FUNNEL_STAGES as readonly string[]).includes(artist.funnel_stage ?? "")
    ? (artist.funnel_stage as string)
    : "hook";
  const status = (ARTIST_STATUSES as readonly string[]).includes(artist.status ?? "")
    ? (artist.status as string)
    : "new";

  // Mutable terminal flag — set by mark_needs_offer / mark_lost.
  let terminal: AgentTickResult["stopReason"] | null = null;
  const abortController = new AbortController();

  // ---- Tool definitions ----
  const okText = (s: string) => ({
    content: [{ type: "text" as const, text: s }],
  });

  const dashboardServer = createSdkMcpServer({
    name: "dm",
    tools: [
      tool(
        "display_message",
        "Put a draft message in the DM textarea on the dashboard. The human's macro will copy and send it when paint_signal triggers them.",
        { text: z.string() },
        async ({ text }) => {
          emit({ type: "tool_called", name: "display_message", input: { text } });
          emit({ type: "display_message", text });
          emit({ type: "tool_result", name: "display_message", result: { ok: true } });
          return okText("displayed");
        },
      ),
      tool(
        "paint_signal",
        "Set the macro color swatch. Triggers Macro Commander to do the matching TikTok action. send_dm | open_thread | send_reply | close_next | idle.",
        { signal: z.enum(MACRO_SIGNAL_VALUES as [MacroSignal, ...MacroSignal[]]) },
        async ({ signal }) => {
          emit({ type: "tool_called", name: "paint_signal", input: { signal } });
          emit({ type: "paint_signal", signal });
          emit({ type: "tool_result", name: "paint_signal", result: { ok: true } });
          return okText(`painted ${signal}`);
        },
      ),
      tool(
        "mark_first_dm_sent",
        "Confirm the first DM was actually sent (call this when an inbox screenshot has confirmed the macro executed send_dm). Sets status to 'sent', funnel stage to 'rapport', logs the body, syncs to Monday.",
        { body: z.string() },
        async ({ body }) => {
          emit({ type: "tool_called", name: "mark_first_dm_sent", input: { body } });
          const a = await getArtistById(artistId);
          if (!a) return okText("artist not found");
          if (a.first_dm_sent_at) {
            emit({ type: "tool_result", name: "mark_first_dm_sent", result: { alreadySent: true } });
            return okText("already sent");
          }
          if (!a.selected_mo3ntit_id || !a.last_prompt_id) {
            return okText("missing mo3ntit or prompt");
          }
          await markFirstDmSent({
            artistId: a.id,
            mo3ntitId: a.selected_mo3ntit_id,
            promptId: a.last_prompt_id,
            body: body || a.current_dm || "",
          });
          await updateArtistFunnelStage(a.id, "rapport");
          if (a.monday_id) {
            try { await updateMondayStatus(a.monday_id, STATUS_LABELS.sent); } catch {}
          }
          emit({ type: "tool_result", name: "mark_first_dm_sent", result: { ok: true } });
          return okText("first DM marked sent · funnel → rapport · monday synced");
        },
      ),
      tool(
        "log_outbound",
        "Log an outbound reply that was just sent. Use after a reply, NOT for the first DM (use mark_first_dm_sent for that).",
        { body: z.string() },
        async ({ body }) => {
          emit({ type: "tool_called", name: "log_outbound", input: { body } });
          const a = await getArtistById(artistId);
          if (!a) return okText("artist not found");
          const existing = await listConversation(artistId);
          const last = existing.at(-1);
          if (last && last.direction === "out" && last.body.trim() === body.trim()) {
            emit({ type: "tool_result", name: "log_outbound", result: { dedupedNoOp: true } });
            return okText("already logged (deduped)");
          }
          await logConversation({
            artistId,
            mo3ntitId: a.selected_mo3ntit_id,
            direction: "out",
            body,
            promptId: a.last_prompt_id ?? null,
            source: "agent",
          });
          emit({ type: "tool_result", name: "log_outbound", result: { ok: true } });
          return okText("logged");
        },
      ),
      tool(
        "advance_stage",
        "Move the artist's funnel stage. Use when their last reply signals readiness for the next stage's move.",
        {
          stage: z.enum(FUNNEL_STAGES as unknown as [FunnelStage, ...FunnelStage[]]),
          reason: z.string(),
        },
        async ({ stage: newStage }) => {
          emit({ type: "tool_called", name: "advance_stage", input: { stage: newStage } });
          await updateArtistFunnelStage(artistId, newStage);
          emit({ type: "tool_result", name: "advance_stage", result: { stage: newStage } });
          return okText(`stage → ${newStage}`);
        },
      ),
      tool(
        "mark_needs_offer",
        "SUCCESS terminal action. Call when the artist has shown clear interest (asks 'tell me more', 'how much', 'send details') or after closing-stage confirmation. Flips status to needs_offer, syncs Monday, ends the agent's work for this artist.",
        { reason: z.string() },
        async ({ reason }) => {
          emit({ type: "tool_called", name: "mark_needs_offer", input: { reason } });
          const a = await getArtistById(artistId);
          if (a) {
            await updateArtistStatus(artistId, "needs_offer");
            await updateArtistFunnelStage(artistId, "closing");
            if (a.monday_id) {
              try { await updateMondayStatus(a.monday_id, STATUS_LABELS.needs_offer); } catch {}
            }
          }
          terminal = "needs_offer";
          emit({ type: "tool_result", name: "mark_needs_offer", result: { ok: true, reason } });
          // Abort the agent loop — we're done with this artist
          setTimeout(() => abortController.abort(), 0);
          return okText("marked needs_offer · agent stopping");
        },
      ),
      tool(
        "mark_lost",
        "FAILURE terminal action. Use sparingly — only on clear rejection ('not interested', insults, wrong-fit).",
        { reason: z.string() },
        async ({ reason }) => {
          emit({ type: "tool_called", name: "mark_lost", input: { reason } });
          const a = await getArtistById(artistId);
          if (a) {
            await updateArtistStatus(artistId, "lost");
            if (a.monday_id) {
              try { await updateMondayStatus(a.monday_id, STATUS_LABELS.lost); } catch {}
            }
          }
          terminal = "lost";
          emit({ type: "tool_result", name: "mark_lost", result: { ok: true, reason } });
          setTimeout(() => abortController.abort(), 0);
          return okText("marked lost · agent stopping");
        },
      ),
    ],
  });

  // ---- Build user prompt + optional image ----
  const userText = buildTurnPrompt({
    trigger,
    history,
    artistStage: stage,
    artistStatus: status,
    currentDm: artist.current_dm,
    extraNote,
    mo3ntitHandle: mo3ntit?.handle ?? null,
  });

  async function* userMessages(): AsyncIterable<SDKUserMessage> {
    if (imageBase64) {
      yield {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: imageBase64 },
            },
            { type: "text", text: userText },
          ],
        },
        parent_tool_use_id: null,
        session_id: "",
      };
    } else {
      yield {
        type: "user",
        message: { role: "user", content: userText },
        parent_tool_use_id: null,
        session_id: "",
      };
    }
  }

  // ---- Tools the agent is allowed to call (MCP-prefixed names) ----
  const toolNames = [
    "display_message",
    "paint_signal",
    "mark_first_dm_sent",
    "log_outbound",
    "advance_stage",
    "mark_needs_offer",
    "mark_lost",
  ].map((n) => `mcp__dm__${n}`);

  let agentText = "";
  let stopReason: AgentTickResult["stopReason"] = "done";

  try {
    for await (const msg of query({
      prompt: userMessages(),
      options: {
        model: MODEL,
        maxTurns: MAX_TURNS,
        systemPrompt: buildSystemPrompt({
          account: artist.account,
          nickname: artist.nickname,
          artist_brief: artist.artist_brief,
          song_brief: artist.song_brief,
        }),
        mcpServers: { dm: dashboardServer },
        allowedTools: toolNames,
        tools: [],
        abortController,
      },
    })) {
      // Capture assistant "thinking" text
      if (msg.type === "assistant" && "message" in msg) {
        const content = msg.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text.trim()) {
              agentText += block.text + "\n";
              emit({ type: "thinking", text: block.text });
            }
          }
        }
      }
      if (msg.type === "result") {
        if (terminal) stopReason = terminal;
        else stopReason = "done";
        break;
      }
    }
  } catch (e) {
    if (terminal) {
      stopReason = terminal;
    } else if ((e as Error).name === "AbortError") {
      stopReason = "done";
    } else {
      console.error("[agent-loop]", e);
      stopReason = "error";
    }
  }

  if (terminal && stopReason === "done") stopReason = terminal;

  const finalArtist = await getArtistById(artistId);

  return {
    actions,
    agentText: agentText.trim(),
    done: true,
    finalStatus: finalArtist?.status ?? null,
    finalStage: finalArtist?.funnel_stage ?? null,
    stopReason,
  };
}
