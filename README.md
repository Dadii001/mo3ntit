# Indie Artist Finder

An agentic platform for scouting indie artists on TikTok, enriching them with Claude (vision + text + song analysis), and pushing the results to a Monday.com board so outreach agents can take over.

Three agents are planned. One is live today.

| Agent | Role | Status |
|---|---|---|
| **Discovery** | Search hashtags, temporarily download the signature song and transcribe lyrics, analyze profile image + bio. Save enriched profiles to Monday. | ✅ Live |
| **First DM** | Send the opening DM to new leads and manage the reply thread. | 🕘 Coming |
| **Offers** | Send tailored offers to qualified leads and run the order lifecycle. | 🕘 Coming |

---

## Stack

- **Next.js 16** (App Router, Node.js runtime for audio pipeline)
- **Claude** via `@anthropic-ai/sdk` — `claude-sonnet-4-6` for briefs/DMs, `claude-haiku-4-5` for vision + bio parsing
- **RapidAPI TikTok Scraper** — hashtags, posts, user info, song URLs
- **Monday.com GraphQL API** (v2024-10) — items, dedup, board view
- **ffmpeg-static** — extracts audio duration from temporarily-downloaded mp3 (file is deleted after transcription)
- **OpenAI Whisper** (optional) — song lyric transcription. Without it, everything else still works
- **Tailwind v4** — dashboard UI

## Project layout

```
app/
├── page.tsx              # Agent roster (home)
├── agents/[id]/page.tsx  # Agent control panel (Discovery runner)
├── board/page.tsx        # Live view of Monday items
├── api/
│   ├── agents/route.ts   # Agent registry (metadata)
│   ├── discovery/run     # SSE-streamed discovery run
│   └── monday/route.ts   # Monday board listing
lib/
├── agents/
│   ├── registry.ts       # Agent metadata (drives the home grid)
│   └── discovery.ts      # Discovery agent — orchestrates all tools
├── tiktok.ts             # RapidAPI client
├── monday.ts             # Monday GraphQL client + column mapping
├── claude.ts             # Anthropic client + model constants
├── vision.ts             # Claude image analysis
├── bio.ts                # Claude bio / brief / DM generation
├── audio.ts              # ffmpeg duration probe + Whisper transcription pipeline
└── types.ts
components/
└── discovery-runner.tsx  # Client component — streams SSE events, renders live log + found artists
```

## Monday board mapping

Board `18409593345`, group `topics`. The column ID map lives in [lib/monday.ts](lib/monday.ts).

| Column | Field | Source |
|---|---|---|
| Name | `name` | Artist nickname |
| Tiktok Profile | `text_mm2nma7h` | `https://tiktok.com/@<handle>` |
| Song name | `text_mm2n7n5n` | `music_info.title` (or video caption) |
| Song Link | `text_mm2nzfqr` | Direct song mp3 URL |
| Song brief | `long_text_mm2n2btf` | Claude summary from transcript + caption + signature usage |
| Artist brief | `long_text_mm2n416p` | Claude summary from bio + image + song |
| Custom DM | `long_text_mm2nf188` | Claude-drafted opener |
| Account | `text_mm2nveb0` | TikTok unique handle (used for dedup) |
| Status | `status` | Set to `New` at creation |
| Sent Date | `date_mm2n3hc` | Today |
| Creation log | `pulse_log_mm2n6ehz` | Monday auto-fills |

## Getting started

```bash
# 1. Install deps
npm install

# 2. Set up env
cp .env.example .env.local
# Edit .env.local — add ANTHROPIC_API_KEY (required) and OPENAI_API_KEY (optional, enables song transcription)
# RAPIDAPI_KEY, MONDAY_API_KEY, MONDAY_BOARD_ID are pre-filled for this deployment

# 3. Run
npm run dev
```

Open <http://localhost:3000>, click **Discovery Agent**, enter a hashtag (e.g. `indieartist`, `bedroompop`, `unsignedartist`), set filters, and hit **Run Discovery**.

## How the Discovery Agent works

For a given hashtag:

1. `tiktok.search` — fetch hashtag metadata and paginate `challenge/posts` to collect one top video per unique creator
2. `monday.dedup` — pull all `Account` values from the board and drop anyone already there
3. For each candidate (up to `maxArtists`):
   - `tiktok.user` — pull full profile (bio, follower count, avatar)
   - Filter by `minFollowers` / `maxFollowers`
   - `claude.vision` — analyze the profile image (style, mood, genre hints)
   - `claude.text` — parse the bio (real name, location, genres, contact links)
   - `audio.pipeline` — temporarily download the song mp3, transcribe with Whisper (if enabled), delete the file after
   - `claude.text` — synthesize a song brief, artist brief, and a custom DM draft
   - `monday.create` — push a row with all of the above

All steps stream live to the dashboard over SSE.

## Deploying to Vercel

```bash
vercel link
vercel env add ANTHROPIC_API_KEY    # paste key
vercel env add RAPIDAPI_KEY
vercel env add MONDAY_API_KEY
vercel env add MONDAY_BOARD_ID
vercel env add MONDAY_GROUP_ID
vercel env add OPENAI_API_KEY       # optional
vercel deploy
```

`ffmpeg-static` ships the binary for Vercel's Fluid Compute runtime. `maxDuration` is set to 300s on the discovery route.

## Extending

New agent? Add to `lib/agents/registry.ts` and drop a route under `app/agents/[id]/`. The home grid and router wire up automatically.

## Notes

- Monday API calls are serialized; large runs respect Monday's rate limits
- The discovery run uses `runtime = "nodejs"` — don't flip it to edge; ffmpeg won't run there
- Transcription uses Whisper `whisper-1`. For higher-quality lyric transcription on music, consider Whisper `large-v3` via a self-hosted endpoint
