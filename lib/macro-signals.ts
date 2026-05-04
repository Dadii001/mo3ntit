// Color signal protocol for Macro Commander integration.
//
// The dashboard renders a solid-colored swatch (#macro-signal). Macro Commander
// samples the center pixel; each color is a different command. The colors are
// chosen to be far apart in RGB space so pixel-color matching is robust to
// anti-aliasing or display profile drift.
//
// The agent paints these signals as side effects of the funnel state machine:
// load next artist → "send_dm", inbox 0 unread → "close_next", inbox 1+ unread
// → "open_thread", reply drafted → "send_reply", and so on.

export const MACRO_SIGNALS = {
  idle: {
    color: "#1c1c1f",
    label: "Idle",
    hint: "Waiting — nothing to do.",
  },
  send_dm: {
    color: "#00ff00",
    label: "Send DM + check inbox",
    hint: "Copy DM box → send in TikTok → take inbox screenshot → paste back to dashboard.",
  },
  open_thread: {
    color: "#ff8800",
    label: "Open unread thread",
    hint: "Open the top unread DM → take conversation screenshot → paste back.",
  },
  send_reply: {
    color: "#00ffff",
    label: "Send drafted reply",
    hint: "Copy DM box → send the reply in TikTok.",
  },
  close_next: {
    color: "#ff00ff",
    label: "Close + load next",
    hint: "No replies. Close the DM panel — dashboard will advance to next artist.",
  },
} as const;

export type MacroSignal = keyof typeof MACRO_SIGNALS;

export const MACRO_SIGNAL_VALUES = Object.keys(MACRO_SIGNALS) as MacroSignal[];
