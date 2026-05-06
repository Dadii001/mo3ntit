import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL } from "./claude";
import { detectImageType } from "./claude-agent";
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

// ---- Tool definitions sent to Claude ----

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "display_message",
    description:
      "Put a draft message in the DM textarea on the dashboard. The human's macro will copy and send it when paint_signal triggers them. Use this to draft any outbound DM.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string", description: "The exact message text to display." } },
      required: ["text"],
    },
  },
  {
    name: "paint_signal",
    description:
      "Set the macro color swatch. Triggers Macro Commander to do the matching TikTok action. Choose: 'send_dm' (send the displayed DM and take inbox screenshot), 'open_thread' (open top unread thread, take conversation screenshot), 'send_reply' (send the displayed message as a reply), 'close_next' (close DM panel, advance to next artist), 'idle' (no-op).",
    input_schema: {
      type: "object",
      properties: { signal: { type: "string", enum: [...MACRO_SIGNAL_VALUES] } },
      required: ["signal"],
    },
  },
  {
    name: "mark_first_dm_sent",
    description:
      "Confirm the first DM was actually sent (call this when an inbox screenshot has confirmed the macro executed send_dm). Sets status to 'sent', funnel stage to 'rapport', logs the body to conversations, and syncs to Monday.",
    input_schema: {
      type: "object",
      properties: {
        body: {
          type: "string",
          description: "The exact text of the first DM that was sent (matches what was displayed).",
        },
      },
      required: ["body"],
    },
  },
  {
    name: "log_outbound",
    description:
      "Log an outbound reply that was just sent (use after the macro sends a reply, NOT for the first DM — that uses mark_first_dm_sent).",
    input_schema: {
      type: "object",
      properties: { body: { type: "string" } },
      required: ["body"],
    },
  },
  {
    name: "advance_stage",
    description:
      "Move the artist's funnel stage. Use when the artist's last reply signals they're ready for the next stage's move.",
    input_schema: {
      type: "object",
      properties: {
        stage: {
          type: "string",
          enum: ["hook", "rapport", "qualify", "pitch", "closing"],
        },
        reason: { type: "string", description: "Why you're advancing." },
      },
      required: ["stage", "reason"],
    },
  },
  {
    name: "mark_needs_offer",
    description:
      "SUCCESS terminal action. Call when the artist has shown clear interest — asks 'tell me more', 'how much', 'send me details', or otherwise signals they want to do a promo. Sets status to 'needs_offer' (the human will manually send the offer link). Stops the agent for this artist.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
  {
    name: "mark_lost",
    description:
      "FAILURE terminal action. Use sparingly — only when artist explicitly declines, says 'not interested', insults, or is clearly a wrong-fit. Stops the agent for this artist.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
  {
    name: "done",
    description:
      "Yield this turn — you've done all you can given the current input. Use after queuing the next macro action (e.g. you displayed the first DM and painted send_dm; now you wait for the inbox screenshot).",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
];

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

You decide ONE step at a time. Each turn, you receive the current state + (optionally) a screenshot the macro just took. You call tools to do your action and end with "done" (or a terminal tool: mark_needs_offer / mark_lost).

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
- After display_message + paint_signal(send_dm | send_reply), call done — wait for the next screenshot.
- When you receive an inbox screenshot: if 0 unread (no red dots), call mark_first_dm_sent (if status is still 'new') + paint_signal(close_next) + done. If 1+ unread, paint_signal(open_thread) + done.
- When you receive a conversation screenshot: read the artist's reply, draft your next message via display_message, paint_signal(send_reply), advance_stage if appropriate, log_outbound for what you just drafted, then done.
- Reaching closing + clear interest → mark_needs_offer.
- Be conservative on mark_lost — only on clear rejection.`;
}

// ---- Tool execution ----

type ToolContext = {
  artistId: string;
  emit: (a: AgentAction) => void;
};

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ ok: boolean; result?: unknown; error?: string; terminal?: AgentTickResult["stopReason"] }> {
  try {
    switch (name) {
      case "display_message": {
        const text = String(input.text ?? "").trim();
        if (!text) return { ok: false, error: "empty text" };
        ctx.emit({ type: "display_message", text });
        return { ok: true, result: { displayed: true } };
      }

      case "paint_signal": {
        const signal = input.signal as MacroSignal;
        if (!MACRO_SIGNAL_VALUES.includes(signal))
          return { ok: false, error: `unknown signal '${signal}'` };
        ctx.emit({ type: "paint_signal", signal });
        return { ok: true, result: { painted: signal } };
      }

      case "mark_first_dm_sent": {
        const artist = await getArtistById(ctx.artistId);
        if (!artist) return { ok: false, error: "artist not found" };
        if (artist.first_dm_sent_at) {
          return { ok: true, result: { alreadySent: true } };
        }
        if (!artist.selected_mo3ntit_id || !artist.last_prompt_id) {
          return { ok: false, error: "artist missing mo3ntit or prompt — cannot mark sent" };
        }
        const body = String(input.body ?? "").trim() || (artist.current_dm ?? "");
        await markFirstDmSent({
          artistId: artist.id,
          mo3ntitId: artist.selected_mo3ntit_id,
          promptId: artist.last_prompt_id,
          body,
        });
        await updateArtistFunnelStage(artist.id, "rapport");
        if (artist.monday_id) {
          try {
            await updateMondayStatus(artist.monday_id, STATUS_LABELS.sent);
          } catch {
            /* best-effort */
          }
        }
        return { ok: true, result: { status: "sent", stage: "rapport" } };
      }

      case "log_outbound": {
        const artist = await getArtistById(ctx.artistId);
        if (!artist) return { ok: false, error: "artist not found" };
        const body = String(input.body ?? "").trim();
        if (!body) return { ok: false, error: "empty body" };
        // Dedupe with last outbound
        const existing = await listConversation(ctx.artistId);
        const last = existing.at(-1);
        if (last && last.direction === "out" && last.body.trim() === body) {
          return { ok: true, result: { dedupedNoOp: true } };
        }
        await logConversation({
          artistId: ctx.artistId,
          mo3ntitId: artist.selected_mo3ntit_id,
          direction: "out",
          body,
          promptId: artist.last_prompt_id ?? null,
          source: "agent",
        });
        return { ok: true, result: { logged: true } };
      }

      case "advance_stage": {
        const stage = input.stage as FunnelStage;
        if (!FUNNEL_STAGES.includes(stage))
          return { ok: false, error: `unknown stage '${stage}'` };
        await updateArtistFunnelStage(ctx.artistId, stage);
        return { ok: true, result: { stage } };
      }

      case "mark_needs_offer": {
        const artist = await getArtistById(ctx.artistId);
        if (!artist) return { ok: false, error: "artist not found" };
        await updateArtistStatus(ctx.artistId, "needs_offer");
        await updateArtistFunnelStage(ctx.artistId, "closing");
        if (artist.monday_id) {
          try {
            await updateMondayStatus(artist.monday_id, STATUS_LABELS.needs_offer);
          } catch {
            /* best-effort */
          }
        }
        return { ok: true, result: { status: "needs_offer" }, terminal: "needs_offer" };
      }

      case "mark_lost": {
        const artist = await getArtistById(ctx.artistId);
        if (!artist) return { ok: false, error: "artist not found" };
        await updateArtistStatus(ctx.artistId, "lost");
        if (artist.monday_id) {
          try {
            await updateMondayStatus(artist.monday_id, STATUS_LABELS.lost);
          } catch {
            /* best-effort */
          }
        }
        return { ok: true, result: { status: "lost" }, terminal: "lost" };
      }

      case "done": {
        return { ok: true, result: { yielded: true }, terminal: "done" };
      }

      default:
        return { ok: false, error: `unknown tool '${name}'` };
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---- Build the user message for this turn ----

function buildTurnUserMessage(args: {
  trigger: "start" | "inbox" | "conversation" | "message_sent";
  history: ConversationRow[];
  artistStage: string;
  artistStatus: string;
  currentDm: string | null;
  imageBase64?: string;
  extraNote?: string;
  mo3ntitHandle?: string | null;
}): Anthropic.MessageParam {
  const {
    trigger,
    history,
    artistStage,
    artistStatus,
    currentDm,
    imageBase64,
    extraNote,
    mo3ntitHandle,
  } = args;

  const transcript =
    history.length === 0
      ? "(no messages yet)"
      : history
          .map((m) => `${m.direction === "out" ? "US" : "ARTIST"}: ${m.body}`)
          .join("\n");

  const stageLabel = FUNNEL_STAGE_LABELS[artistStage as FunnelStage] ?? artistStage;
  const statusLabel = STATUS_LABELS[artistStatus as ArtistStatus] ?? artistStatus;

  const text = `TRIGGER: ${trigger}
SENDER (mo3ntit): ${mo3ntitHandle ? "@" + mo3ntitHandle : "(unset)"}
ARTIST STATUS: ${statusLabel} (${artistStatus})
FUNNEL STAGE: ${stageLabel} (${artistStage})
CURRENT DM IN BOX: ${currentDm ? `"${currentDm}"` : "(empty)"}

CONVERSATION SO FAR:
${transcript}

${extraNote ? `NOTE: ${extraNote}\n\n` : ""}What's the next action?`;

  const content: Anthropic.ContentBlockParam[] = [{ type: "text", text }];
  if (imageBase64) {
    content.unshift({
      type: "image",
      source: { type: "base64", media_type: detectImageType(imageBase64), data: imageBase64 },
    });
  }
  return { role: "user", content };
}

// ---- The agent loop ----

const MAX_ITERATIONS = 8;

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

  const system = buildSystemPrompt({
    account: artist.account,
    nickname: artist.nickname,
    artist_brief: artist.artist_brief,
    song_brief: artist.song_brief,
  });

  const messages: Anthropic.MessageParam[] = [
    buildTurnUserMessage({
      trigger,
      history,
      artistStage: stage,
      artistStatus: status,
      currentDm: artist.current_dm,
      imageBase64,
      extraNote,
      mo3ntitHandle: mo3ntit?.handle ?? null,
    }),
  ];

  let agentText = "";
  let stopReason: AgentTickResult["stopReason"] = "max_iterations";
  let terminal = false;

  for (let i = 0; i < MAX_ITERATIONS && !terminal; i++) {
    const resp = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools: TOOLS,
      messages,
    });

    // Capture any text the agent emitted (its "thinking")
    for (const block of resp.content) {
      if (block.type === "text" && block.text.trim()) {
        agentText += block.text + "\n";
        emit({ type: "thinking", text: block.text });
      }
    }

    if (resp.stop_reason === "end_turn") {
      stopReason = "done";
      break;
    }

    if (resp.stop_reason !== "tool_use") {
      stopReason = "done";
      break;
    }

    const toolUses = resp.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    const toolResultsContent: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      emit({ type: "tool_called", name: tu.name, input: tu.input });
      const exec = await executeTool(
        tu.name,
        tu.input as Record<string, unknown>,
        { artistId, emit },
      );
      emit({ type: "tool_result", name: tu.name, result: exec });
      toolResultsContent.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(exec),
        is_error: !exec.ok,
      });
      if (exec.terminal) {
        stopReason = exec.terminal;
        if (exec.terminal !== "done") {
          // mark_needs_offer or mark_lost — fully terminate
          terminal = true;
        } else {
          // 'done' just yields this turn
          terminal = true;
        }
      }
    }

    messages.push({ role: "assistant", content: resp.content });
    messages.push({ role: "user", content: toolResultsContent });
  }

  // Re-read final state
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
