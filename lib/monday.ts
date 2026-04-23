import { env } from "./env";
import type { ArtistProfile } from "./types";

const ENDPOINT = "https://api.monday.com/v2";

export const MONDAY_COLUMNS = {
  name: "name",
  tiktokProfile: "text_mm2nma7h",
  songName: "text_mm2n7n5n",
  songLink: "text_mm2nzfqr",
  songBrief: "long_text_mm2n2btf",
  artistBrief: "long_text_mm2n416p",
  customDm: "long_text_mm2nf188",
  account: "text_mm2nveb0",
  status: "status",
  sentDate: "date_mm2n3hc",
  creationLog: "pulse_log_mm2n6ehz",
} as const;

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: env.mondayApiKey(),
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(`Monday GraphQL error: ${JSON.stringify(body.errors)}`);
  return body.data as T;
}

function slugifyTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

function tiktokMusicUrl(musicId: string | null, title: string | null): string | null {
  if (!musicId) return null;
  const slug = title ? slugifyTitle(title) : "";
  return slug
    ? `https://www.tiktok.com/music/${slug}-${musicId}`
    : `https://www.tiktok.com/music/${musicId}`;
}

export async function createArtistItem(
  artist: ArtistProfile,
): Promise<{ id: string; name: string }> {
  const songLink =
    tiktokMusicUrl(artist.song.musicId, artist.song.title) ??
    artist.song.url ??
    artist.topVideo.playUrl ??
    "";

  const columnValues = {
    [MONDAY_COLUMNS.tiktokProfile]: artist.profileUrl,
    [MONDAY_COLUMNS.songName]: artist.song.title ?? "",
    [MONDAY_COLUMNS.songLink]: songLink,
    [MONDAY_COLUMNS.songBrief]: artist.song.brief,
    [MONDAY_COLUMNS.artistBrief]: artist.artistBrief,
    [MONDAY_COLUMNS.customDm]: artist.customDm,
    [MONDAY_COLUMNS.sentDate]: { date: new Date().toISOString().split("T")[0] },
  };

  const query = `
    mutation ($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) {
      create_item(
        board_id: $boardId,
        group_id: $groupId,
        item_name: $itemName,
        column_values: $columnValues
      ) { id name }
    }
  `;
  const data = await gql<{ create_item: { id: string; name: string } }>(query, {
    boardId: env.mondayBoardId(),
    groupId: env.mondayGroupId(),
    itemName: artist.nickname || artist.username,
    columnValues: JSON.stringify(columnValues),
  });
  return data.create_item;
}

export async function listExistingArtists(): Promise<Set<string>> {
  const col = MONDAY_COLUMNS.tiktokProfile;
  const query = `
    query ($boardId: [ID!]) {
      boards(ids: $boardId) {
        items_page(limit: 500) {
          cursor
          items {
            id
            name
            column_values(ids: ["${col}"]) { id text }
          }
        }
      }
    }
  `;
  const data = await gql<{
    boards: Array<{
      items_page: {
        cursor: string | null;
        items: Array<{ id: string; name: string; column_values: Array<{ id: string; text: string }> }>;
      };
    }>;
  }>(query, { boardId: [env.mondayBoardId()] });

  const items = data.boards[0]?.items_page?.items ?? [];
  const set = new Set<string>();
  for (const item of items) {
    const url = item.column_values.find((c) => c.id === col)?.text ?? "";
    const match = url.match(/@([a-zA-Z0-9_.-]+)/);
    if (match) set.add(match[1].toLowerCase());
  }
  return set;
}

export type MondayArtistRow = {
  id: string;
  name: string;
  account: string;
  profileUrl: string;
  status: string;
  sentDate: string;
};

export async function listRecentArtists(limit = 50): Promise<MondayArtistRow[]> {
  const query = `
    query ($boardId: [ID!], $limit: Int!) {
      boards(ids: $boardId) {
        items_page(limit: $limit) {
          items {
            id
            name
            column_values(ids: ["${MONDAY_COLUMNS.account}","${MONDAY_COLUMNS.tiktokProfile}","${MONDAY_COLUMNS.status}","${MONDAY_COLUMNS.sentDate}"]) {
              id
              text
            }
          }
        }
      }
    }
  `;
  const data = await gql<{
    boards: Array<{
      items_page: {
        items: Array<{ id: string; name: string; column_values: Array<{ id: string; text: string }> }>;
      };
    }>;
  }>(query, { boardId: [env.mondayBoardId()], limit });

  const items = data.boards[0]?.items_page?.items ?? [];
  return items.map((item) => {
    const cv = Object.fromEntries(item.column_values.map((c) => [c.id, c.text]));
    const profileUrl = cv[MONDAY_COLUMNS.tiktokProfile] ?? "";
    const handle = profileUrl.match(/@([a-zA-Z0-9_.-]+)/)?.[1] ?? "";
    return {
      id: item.id,
      name: item.name,
      account: handle,
      profileUrl,
      status: cv[MONDAY_COLUMNS.status] ?? "",
      sentDate: cv[MONDAY_COLUMNS.sentDate] ?? "",
    };
  });
}
