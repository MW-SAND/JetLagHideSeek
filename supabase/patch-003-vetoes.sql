-- ============================================================
-- PATCH 003: Hider question vetoes
-- Run in Supabase SQL Editor AFTER schema.sql, rpc.sql, patch-001, patch-002
-- ============================================================
-- Lets hiders reject (veto) a seeker's committed question instead of
-- answering it. Vetoed questions leave the hider's answer queue and show a
-- distinct "Vetoed" status to the seeker. Vetoes are unlimited.

-- ─── Table ───────────────────────────────────────────────────
create table if not exists question_vetoes (
    id uuid primary key default gen_random_uuid(),
    question_id uuid not null references questions(id) on delete cascade unique,
    game_id uuid not null references games(id) on delete cascade,
    vetoed_by uuid not null references players(id),
    reason text check (reason is null or char_length(reason) <= 200),
    created_at timestamptz not null default now()
);

create index if not exists idx_question_vetoes_game_id on question_vetoes(game_id);
create index if not exists idx_question_vetoes_question_id on question_vetoes(question_id);

-- ─── Row level security ──────────────────────────────────────
alter table question_vetoes enable row level security;

-- All players in the game can read vetoes
drop policy if exists "question_vetoes_select" on question_vetoes;
create policy "question_vetoes_select" on question_vetoes for select
    using (is_player_in_game(game_id));

-- Only hiders can veto
drop policy if exists "question_vetoes_insert" on question_vetoes;
create policy "question_vetoes_insert" on question_vetoes for insert
    with check (is_hider_in_game(game_id));

-- The vetoing hider can remove their own veto
drop policy if exists "question_vetoes_delete" on question_vetoes;
create policy "question_vetoes_delete" on question_vetoes for delete
    using (
        vetoed_by in (select id from players where user_id = auth.uid())
    );

-- ─── Realtime ────────────────────────────────────────────────
alter publication supabase_realtime add table question_vetoes;
