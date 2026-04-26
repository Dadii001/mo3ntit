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
