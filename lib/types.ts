export type TikTokVideo = {
  id: string;
  desc: string;
  createTime: number;
  playUrl: string | null;
  musicTitle: string | null;
  musicAuthor: string | null;
  musicPlayUrl: string | null;
  stats: { plays: number; likes: number; comments: number; shares: number };
  author: TikTokAuthor;
};

export type TikTokAuthor = {
  uid: string;
  uniqueId: string;
  nickname: string;
  signature: string;
  avatarLarger: string;
  followerCount: number;
  followingCount: number;
  heartCount: number;
  videoCount: number;
  verified: boolean;
  region: string | null;
};

export type SongAnalysis = {
  musicId: string | null;
  url: string | null;
  title: string | null;
  author: string | null;
  bpm: number | null;
  durationSec: number | null;
  transcript: string | null;
  language: string | null;
  isOriginal: boolean;
  useCount: number;
  totalVideoPlays: number;
  brief: string;
};

export type ImageAnalysis = {
  visualStyle: string;
  mood: string;
  genreHints: string[];
  description: string;
};

export type BioAnalysis = {
  name: string | null;
  location: string | null;
  genres: string[];
  instruments: string[];
  contactLinks: string[];
  summary: string;
};

export type ArtistProfile = {
  username: string;
  nickname: string;
  profileUrl: string;
  avatarUrl: string;
  followers: number;
  totalLikes: number;
  videoCount: number;
  region: string | null;
  bio: string;
  verified: boolean;
  topVideo: TikTokVideo;
  image: ImageAnalysis;
  bioAnalysis: BioAnalysis;
  song: SongAnalysis;
  artistBrief: string;
  customDm: string;
};

export type DiscoveryEvent =
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "progress"; current: number; total: number; stage: string }
  | { type: "artist"; artist: Partial<ArtistProfile> & { username: string } }
  | { type: "saved"; username: string; mondayId: string }
  | { type: "skipped"; username: string; reason: string }
  | { type: "done"; saved: number; skipped: number }
  | { type: "error"; message: string };
