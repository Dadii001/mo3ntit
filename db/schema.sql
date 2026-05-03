-- Run this once in your Supabase SQL editor.
-- Mirrors what we save to Monday plus richer analytical fields (full transcripts, raw analyses).

create table if not exists public.artists (
  id uuid primary key default gen_random_uuid(),
  account text unique not null,
  nickname text not null,
  tiktok_profile text not null,
  avatar_url text,
  followers integer,
  total_likes bigint,
  video_count integer,
  region text,
  bio text,
  verified boolean default false,

  song_name text,
  song_author text,
  song_link text,
  song_video_url text,
  song_music_id text,
  song_brief text,
  song_transcript text,
  song_language text,
  song_duration_sec integer,
  song_is_original boolean,
  song_use_count integer,

  artist_brief text,
  custom_dm text,

  image_analysis jsonb,
  bio_analysis jsonb,

  monday_id text,
  status text default 'new',
  sent_date date,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists artists_created_at_idx on public.artists(created_at desc);
create index if not exists artists_account_lower_idx on public.artists(lower(account));

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists artists_set_updated_at on public.artists;
create trigger artists_set_updated_at
  before update on public.artists
  for each row execute function public.set_updated_at();

-- Mo3ntitin: TikTok creators on our roster who DM the artists.
-- Their description is generated from frame screenshots of their last few videos.
create table if not exists public.mo3ntitin (
  id uuid primary key default gen_random_uuid(),
  handle text unique not null,
  nickname text,
  profile_url text not null,
  avatar_url text,
  followers integer,
  total_likes bigint,
  video_count integer,
  region text,
  bio text,
  verified boolean default false,

  description text,
  gender text,
  style_tags text[],
  vibe text,
  content_language text,

  videos_analyzed integer,
  last_analyzed_at timestamptz,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists mo3ntitin_handle_lower_idx on public.mo3ntitin(lower(handle));

drop trigger if exists mo3ntitin_set_updated_at on public.mo3ntitin;
create trigger mo3ntitin_set_updated_at
  before update on public.mo3ntitin
  for each row execute function public.set_updated_at();

-- DM prompt "angles" — each one is a different style/approach.
-- Toggle is_active on multiple to A/B (system picks randomly between active ones).
create table if not exists public.dm_prompts (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  template text not null,
  is_active boolean default true,
  uses integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists dm_prompts_set_updated_at on public.dm_prompts;
create trigger dm_prompts_set_updated_at
  before update on public.dm_prompts
  for each row execute function public.set_updated_at();

-- Per-artist conversation log: outbound DMs we generated/sent + inbound replies we read from screenshots.
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  mo3ntit_id uuid references public.mo3ntitin(id) on delete set null,
  direction text not null check (direction in ('out', 'in')),
  body text not null,
  prompt_id uuid references public.dm_prompts(id) on delete set null,
  source text default 'manual',
  created_at timestamptz default now()
);

create index if not exists conversations_artist_idx
  on public.conversations(artist_id, created_at desc);

-- Artist columns: which mo3ntit we picked, when first DM was sent, which prompt produced it.
alter table public.artists
  add column if not exists selected_mo3ntit_id uuid references public.mo3ntitin(id) on delete set null,
  add column if not exists first_dm_sent_at timestamptz,
  add column if not exists last_prompt_id uuid references public.dm_prompts(id) on delete set null,
  add column if not exists current_dm text;

create index if not exists artists_first_dm_sent_at_idx
  on public.artists(first_dm_sent_at);
