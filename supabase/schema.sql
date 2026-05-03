-- ============================================================
-- Jet Lag Hide and Seek — Multiplayer Database Schema
-- Paste this ENTIRE file into Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================

-- 0. Enable required extensions
-- (uuid-ossp is enabled by default on Supabase, but just in case)

-- 1. Custom types
create type game_phase as enum ('setup', 'playing', 'ended');
create type player_role as enum ('hider', 'seeker');

-- 2. Games table (small, frequently updated)
create table games (
    id uuid primary key default gen_random_uuid(),
    room_code text not null unique,
    phase game_phase not null default 'setup',
    host_id uuid not null references auth.users(id),
    hiding_radius numeric,
    hiding_radius_units text,
    display_hiding_zones_options jsonb,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '30 days')
);

create index idx_games_room_code on games(room_code);
create index idx_games_expires_at on games(expires_at);

-- 3. Game geo data (large, rarely updated — separate to avoid bloating Realtime events)
create table game_geo_data (
    game_id uuid primary key references games(id) on delete cascade,
    map_geo_location jsonb,
    poly_geo_json jsonb,
    custom_stations jsonb,
    permanent_overlay jsonb
);

-- 4. Players
create table players (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id),
    game_id uuid not null references games(id) on delete cascade,
    display_name text not null check (char_length(display_name) between 1 and 20),
    role player_role not null default 'seeker',
    joined_at timestamptz not null default now(),
    unique (game_id, display_name)  -- no duplicate names within a game
);

create index idx_players_game_id on players(game_id);
create index idx_players_user_id on players(user_id);

-- 5. Hider location (one per game — team shares it)
create table hider_location (
    game_id uuid primary key references games(id) on delete cascade,
    lat numeric,
    lng numeric,
    set_by uuid references players(id),
    confirmed boolean not null default false,
    updated_at timestamptz not null default now()
);

-- 6. Questions (committed, sent by seekers)
create table questions (
    id uuid primary key default gen_random_uuid(),
    game_id uuid not null references games(id) on delete cascade,
    question_order serial,
    asked_by uuid not null references players(id),
    question_type text not null,
    question_data jsonb not null,
    created_at timestamptz not null default now()
);

create index idx_questions_game_id on questions(game_id);

-- 7. Answers (one per question)
create table answers (
    id uuid primary key default gen_random_uuid(),
    question_id uuid not null references questions(id) on delete cascade unique,
    game_id uuid not null references games(id) on delete cascade,
    answered_by uuid not null references players(id),
    answer_data jsonb not null,
    answered_at timestamptz not null default now(),
    undo_deadline timestamptz not null default (now() + interval '30 seconds')
);

create index idx_answers_game_id on answers(game_id);
create index idx_answers_question_id on answers(question_id);

-- 8. Room code generator function
create or replace function generate_room_code()
returns text
language plpgsql
as $$
declare
    chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    code text := '';
    i integer;
begin
    for attempt in 1..10 loop
        code := '';
        for i in 1..6 loop
            code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
        end loop;
        -- Check uniqueness
        if not exists (select 1 from games where room_code = code) then
            return code;
        end if;
    end loop;
    raise exception 'Failed to generate unique room code after 10 attempts';
end;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table games enable row level security;
alter table game_geo_data enable row level security;
alter table players enable row level security;
alter table hider_location enable row level security;
alter table questions enable row level security;
alter table answers enable row level security;

-- Helper: check if current user is a player in a game
create or replace function is_player_in_game(gid uuid)
returns boolean
language sql
security definer
stable
as $$
    select exists (
        select 1 from players
        where game_id = gid and user_id = auth.uid()
    );
$$;

-- Helper: check if current user is a hider in a game
create or replace function is_hider_in_game(gid uuid)
returns boolean
language sql
security definer
stable
as $$
    select exists (
        select 1 from players
        where game_id = gid and user_id = auth.uid() and role = 'hider'
    );
$$;

-- Helper: check if current user is the host of a game
create or replace function is_host_of_game(gid uuid)
returns boolean
language sql
security definer
stable
as $$
    select exists (
        select 1 from games
        where id = gid and host_id = auth.uid()
    );
$$;

-- === GAMES ===
-- Anyone can read games they're a player in (or by room_code for joining)
create policy "games_select" on games for select
    using (is_player_in_game(id) or true);
    -- Note: room_code lookup needs to work before player row exists.
    -- Security is via room code obscurity + rate limiting on join.

-- Only host can update game settings during setup
create policy "games_update" on games for update
    using (host_id = auth.uid())
    with check (host_id = auth.uid());

-- Insert handled by Edge Function (service_role), not client directly
create policy "games_insert" on games for insert
    with check (host_id = auth.uid());

-- === GAME_GEO_DATA ===
create policy "geo_select" on game_geo_data for select
    using (is_player_in_game(game_id));

-- Only host can update during setup
create policy "geo_update" on game_geo_data for update
    using (is_host_of_game(game_id));

create policy "geo_insert" on game_geo_data for insert
    with check (is_host_of_game(game_id));

-- === PLAYERS ===
-- Players in a game can see each other
create policy "players_select" on players for select
    using (is_player_in_game(game_id));

-- Anyone can insert themselves
create policy "players_insert" on players for insert
    with check (user_id = auth.uid());

-- Players can update their own row (role, display_name)
create policy "players_update" on players for update
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

-- === HIDER_LOCATION ===
-- CRITICAL: Only hiders in the game can read/write the hider location
create policy "hider_location_select" on hider_location for select
    using (is_hider_in_game(game_id));

create policy "hider_location_insert" on hider_location for insert
    with check (is_hider_in_game(game_id));

create policy "hider_location_update" on hider_location for update
    using (is_hider_in_game(game_id));

-- === QUESTIONS ===
-- All players in the game can read questions
create policy "questions_select" on questions for select
    using (is_player_in_game(game_id));

-- Seekers can insert questions (during playing phase)
create policy "questions_insert" on questions for insert
    with check (
        is_player_in_game(game_id)
        and exists (
            select 1 from games
            where id = game_id and phase = 'playing'
        )
    );

-- === ANSWERS ===
-- All players can read answers
create policy "answers_select" on answers for select
    using (is_player_in_game(game_id));

-- Hiders can insert answers
create policy "answers_insert" on answers for insert
    with check (is_hider_in_game(game_id));

-- Answering hider can delete their own answer before undo deadline
create policy "answers_delete" on answers for delete
    using (
        answered_by in (select id from players where user_id = auth.uid())
        and undo_deadline > now()
    );

-- ============================================================
-- REALTIME: Enable Realtime for the tables clients subscribe to
-- ============================================================
alter publication supabase_realtime add table games;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table questions;
alter publication supabase_realtime add table answers;
-- NOTE: game_geo_data and hider_location are NOT added to realtime
-- game_geo_data: large payloads, fetched on demand
-- hider_location: RLS-protected, hiders poll or subscribe separately

-- ============================================================
-- CLEANUP: Auto-delete expired games (run via pg_cron or Supabase scheduled function)
-- For now, a simple function that can be called periodically:
-- ============================================================
create or replace function cleanup_expired_games()
returns void
language sql
as $$
    delete from games where expires_at < now();
$$;
