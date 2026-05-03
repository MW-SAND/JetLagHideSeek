-- ============================================================
-- PATCH 001: Security hardening + player departure
-- Run in Supabase SQL Editor AFTER schema.sql and rpc.sql
-- ============================================================

-- ─── E2: Validate question is locked before insert ───────────
-- Drop and recreate the questions_insert policy with a drag check.
-- The question_data JSONB must have drag = false (or drag absent).

drop policy if exists "questions_insert" on questions;

create policy "questions_insert" on questions for insert
    with check (
        is_player_in_game(game_id)
        and exists (
            select 1 from games
            where id = game_id and phase = 'playing'
        )
        -- E2: Reject questions that are still in drag/editing state
        and coalesce((question_data->>'drag')::boolean, false) = false
    );

-- ─── D5/D6: Allow players to delete their own row (for leave_game RPC) ──
create policy "players_delete" on players for delete
    using (user_id = auth.uid());

-- ─── D5/D6: leave_game RPC ───────────────────────────────────
-- Deletes the caller's player row. The Realtime DELETE event then
-- propagates to all other clients, who re-fetch the player list.

create or replace function leave_game(p_player_id uuid)
returns void
language plpgsql
security definer
as $$
begin
    delete from players
    where id = p_player_id
      and user_id = auth.uid();
end;
$$;

-- ─── Reconnect: rejoin an in-progress game ───────────────────
-- Returns the caller's existing player row for a game that is already
-- in 'playing' or 'ended' phase (join_game blocks those phases).
-- Returns null if the caller is not a player in the game.

create or replace function rejoin_game(p_room_code text)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_game_id uuid;
    v_player_id uuid;
    v_phase game_phase;
    v_host_id uuid;
begin
    if auth.uid() is null then
        raise exception 'Not authenticated';
    end if;

    select g.id, g.phase, g.host_id
    into v_game_id, v_phase, v_host_id
    from games g
    where g.room_code = upper(trim(p_room_code));

    if v_game_id is null then
        raise exception 'Game not found';
    end if;

    select id into v_player_id
    from players
    where game_id = v_game_id and user_id = auth.uid();

    if v_player_id is null then
        raise exception 'You are not a player in this game';
    end if;

    return jsonb_build_object(
        'game_id', v_game_id,
        'room_code', upper(trim(p_room_code)),
        'player_id', v_player_id,
        'phase', v_phase,
        'host_id', v_host_id
    );
end;
$$;
