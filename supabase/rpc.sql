-- ============================================================
-- RPC Functions for game creation and joining
-- Paste this AFTER schema.sql in Supabase SQL Editor
-- ============================================================

-- Create a new game and add the creator as the first player (host)
create or replace function create_game(p_display_name text, p_role player_role default 'hider')
returns jsonb
language plpgsql
security definer
as $$
declare
    v_game_id uuid;
    v_room_code text;
    v_player_id uuid;
    v_user_id uuid;
begin
    v_user_id := auth.uid();
    if v_user_id is null then
        raise exception 'Not authenticated';
    end if;

    -- Validate display name
    if char_length(trim(p_display_name)) < 1 or char_length(trim(p_display_name)) > 20 then
        raise exception 'Display name must be 1-20 characters';
    end if;

    -- Generate unique room code
    v_room_code := generate_room_code();

    -- Create game
    insert into games (room_code, host_id)
    values (v_room_code, v_user_id)
    returning id into v_game_id;

    -- Add host as player
    insert into players (user_id, game_id, display_name, role)
    values (v_user_id, v_game_id, trim(p_display_name), p_role)
    returning id into v_player_id;

    -- Create empty geo data row
    insert into game_geo_data (game_id) values (v_game_id);

    -- If hider, create hider_location placeholder
    if p_role = 'hider' then
        insert into hider_location (game_id, set_by)
        values (v_game_id, v_player_id);
    end if;

    return jsonb_build_object(
        'game_id', v_game_id,
        'room_code', v_room_code,
        'player_id', v_player_id
    );
end;
$$;

-- Join an existing game by room code
create or replace function join_game(p_room_code text, p_display_name text, p_role player_role default 'seeker')
returns jsonb
language plpgsql
security definer
as $$
declare
    v_game_id uuid;
    v_player_id uuid;
    v_user_id uuid;
    v_phase game_phase;
begin
    v_user_id := auth.uid();
    if v_user_id is null then
        raise exception 'Not authenticated';
    end if;

    -- Validate display name
    if char_length(trim(p_display_name)) < 1 or char_length(trim(p_display_name)) > 20 then
        raise exception 'Display name must be 1-20 characters';
    end if;

    -- Look up game by room code (case-insensitive)
    select id, phase into v_game_id, v_phase
    from games
    where room_code = upper(trim(p_room_code));

    if v_game_id is null then
        raise exception 'Game not found. Check the room code and try again.';
    end if;

    if v_phase != 'setup' then
        raise exception 'This game has already started.';
    end if;

    -- Check if this user is already in the game
    select id into v_player_id
    from players
    where game_id = v_game_id and user_id = v_user_id;

    if v_player_id is not null then
        return jsonb_build_object(
            'game_id', v_game_id,
            'room_code', upper(trim(p_room_code)),
            'player_id', v_player_id,
            'already_joined', true
        );
    end if;

    -- Add player
    insert into players (user_id, game_id, display_name, role)
    values (v_user_id, v_game_id, trim(p_display_name), p_role)
    returning id into v_player_id;

    -- If hider and no hider_location exists yet, create one
    if p_role = 'hider' and not exists (select 1 from hider_location where game_id = v_game_id) then
        insert into hider_location (game_id, set_by)
        values (v_game_id, v_player_id);
    end if;

    return jsonb_build_object(
        'game_id', v_game_id,
        'room_code', upper(trim(p_room_code)),
        'player_id', v_player_id,
        'already_joined', false
    );
end;
$$;
