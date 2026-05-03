-- ============================================================
-- PATCH 002: Fix leave_game FK constraint
-- Run in Supabase SQL Editor AFTER patch-001
-- ============================================================

-- The questions.asked_by column references players.id.
-- When a player leaves after committing questions, the FK blocks deletion.
-- Fix: NULL out asked_by before deleting the player row.
-- This preserves question history while allowing the player to leave.

-- Make asked_by nullable (it defaults to NOT NULL from initial schema)
alter table questions
    alter column asked_by drop not null;

-- Update the FK to SET NULL on delete so future deletes are safe even
-- without the explicit NULL step in the RPC.
alter table questions
    drop constraint if exists questions_asked_by_fkey;

alter table questions
    add constraint questions_asked_by_fkey
    foreign key (asked_by)
    references players(id)
    on delete set null;

-- Update leave_game RPC to explicitly null out asked_by first
-- (belt-and-suspenders: works even if the FK migration above isn't applied)
create or replace function leave_game(p_player_id uuid)
returns void
language plpgsql
security definer
as $$
begin
    -- Detach this player's questions so the FK doesn't block deletion
    update questions
    set asked_by = null
    where asked_by = p_player_id;

    delete from players
    where id = p_player_id
      and user_id = auth.uid();
end;
$$;
