import { atom, computed } from "nanostores";

import type { GamePhase, PlayerRole } from "./database.types";
import {
    answerDraftSelections,
    fetchCommittedQuestions,
    subscribeToQuestions,
    unsubscribeFromQuestions,
    committedQuestions,
    draftQuestions,
} from "./question-store";
import { supabase, ensureAnonymousAuth } from "./supabase";
import { questions } from "./context";

// ─── Types ───────────────────────────────────────────────────
export interface GameSession {
    gameId: string;
    roomCode: string;
    playerId: string;
    phase: GamePhase;
    hostId: string;
}

export interface Player {
    id: string;
    user_id: string;
    display_name: string;
    role: PlayerRole;
    joined_at: string;
}

export type AppView = "landing" | "lobby" | "game" | "ended";

// ─── Stores ──────────────────────────────────────────────────
export const appView = atom<AppView>("landing");
export const gameSession = atom<GameSession | null>(null);
export const players = atom<Player[]>([]);
export const multiplayerError = atom<string | null>(null);
export const multiplayerLoading = atom<boolean>(false);

/** The current browser session's Supabase auth UID. Set once on sign-in. */
export const currentAuthUserId = atom<string | null>(null);

export const currentPlayer = computed(
    [gameSession, players],
    (session, allPlayers) => {
        if (!session) return null;
        return allPlayers.find((p) => p.id === session.playerId) ?? null;
    },
);

export const isHost = computed([gameSession, currentAuthUserId], (session, uid) => {
    if (!session || !uid) return false;
    return session.hostId === uid;
});

// ─── Actions ─────────────────────────────────────────────────

export async function createGame(displayName: string, role: PlayerRole) {
    multiplayerError.set(null);
    multiplayerLoading.set(true);
    try {
        await ensureAnonymousAuth();

        const { data, error } = await supabase.rpc("create_game", {
            p_display_name: displayName,
            p_role: role,
        });

        if (error) throw error;

        const result = data as unknown as {
            game_id: string;
            room_code: string;
            player_id: string;
        };

        const { data: { user } } = await supabase.auth.getUser();
        gameSession.set({
            gameId: result.game_id,
            roomCode: result.room_code,
            playerId: result.player_id,
            phase: "setup",
            hostId: user!.id,
        });
        currentAuthUserId.set(user!.id);

        // Update URL hash
        window.location.hash = `game/${result.room_code}`;

        await fetchPlayers(result.game_id);
        appView.set("lobby");
    } catch (err: any) {
        multiplayerError.set(err.message || "Failed to create game");
    } finally {
        multiplayerLoading.set(false);
    }
}

export async function joinGame(
    roomCode: string,
    displayName: string,
    role: PlayerRole,
) {
    multiplayerError.set(null);
    multiplayerLoading.set(true);
    try {
        await ensureAnonymousAuth();

        const { data, error } = await supabase.rpc("join_game", {
            p_room_code: roomCode,
            p_display_name: displayName,
            p_role: role,
        });

        if (error) throw error;

        const result = data as unknown as {
            game_id: string;
            room_code: string;
            player_id: string;
            already_joined?: boolean;
        };

        // Fetch the game to get host_id and phase
        const { data: game } = await supabase
            .from("games")
            .select("host_id, phase")
            .eq("id", result.game_id)
            .single();

        gameSession.set({
            gameId: result.game_id,
            roomCode: result.room_code,
            playerId: result.player_id,
            phase: (game?.phase as GamePhase) ?? "setup",
            hostId: game?.host_id ?? "",
        });

        const { data: { user } } = await supabase.auth.getUser();
        if (user) currentAuthUserId.set(user.id);

        window.location.hash = `game/${result.room_code}`;

        await fetchPlayers(result.game_id);
        appView.set("lobby");
    } catch (err: any) {
        multiplayerError.set(err.message || "Failed to join game");
    } finally {
        multiplayerLoading.set(false);
    }
}

export async function fetchPlayers(gameId: string) {
    const { data } = await supabase
        .from("players")
        .select("id, user_id, display_name, role, joined_at")
        .eq("game_id", gameId)
        .order("joined_at");

    if (data) {
        players.set(data as Player[]);
    }
}

/**
 * Attempt to rejoin a game that is already in progress (playing/ended).
 * Called automatically on page load when the URL hash has a room code
 * but gameSession is null (e.g. after a refresh mid-game).
 * Returns true if the rejoin succeeded, false otherwise.
 */
export async function rejoinGame(roomCode: string): Promise<boolean> {
    try {
        await ensureAnonymousAuth();

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return false;

        // Look up game by room code (games_select RLS allows public read)
        const { data: game, error: gameError } = await supabase
            .from("games")
            .select("id, phase, host_id, room_code")
            .eq("room_code", roomCode.toUpperCase())
            .single();

        if (gameError || !game) return false;

        // Look up the caller's player row (players_select RLS allows read if in game)
        const { data: player, error: playerError } = await supabase
            .from("players")
            .select("id")
            .eq("game_id", game.id)
            .eq("user_id", user.id)
            .maybeSingle();

        if (playerError || !player) return false;

        gameSession.set({
            gameId: game.id,
            roomCode: game.room_code,
            playerId: player.id,
            phase: game.phase as GamePhase,
            hostId: game.host_id,
        });
        currentAuthUserId.set(user.id);

        await fetchPlayers(game.id);

        if (game.phase === "playing") {
            appView.set("game");
            subscribeToQuestions(game.id);
            await fetchCommittedQuestions(game.id);
        } else if (game.phase === "ended") {
            appView.set("ended");
        } else {
            appView.set("lobby");
        }

        return true;
    } catch {
        return false;
    }
}

export async function startGame() {
    const session = gameSession.get();
    if (!session) return;

    const { data: updated, error } = await supabase
        .from("games")
        .update({ phase: "playing" as GamePhase })
        .eq("id", session.gameId)
        .select("id");

    if (error) {
        multiplayerError.set(error.message);
        return;
    }

    if (!updated || updated.length === 0) {
        multiplayerError.set("Failed to start game: permission denied or game not found");
        return;
    }

    gameSession.set({ ...session, phase: "playing" });
    appView.set("game");

    // Start Q&A subscriptions
    subscribeToQuestions(session.gameId);
    await fetchCommittedQuestions(session.gameId);
}

export async function endGame() {
    const session = gameSession.get();
    if (!session) return;

    const { data: updated, error } = await supabase
        .from("games")
        .update({ phase: "ended" as GamePhase })
        .eq("id", session.gameId)
        .select("id");

    if (error) {
        multiplayerError.set(error.message);
        return;
    }

    if (!updated || updated.length === 0) {
        multiplayerError.set("Failed to end game: permission denied or game not found");
        return;
    }

    gameSession.set({ ...session, phase: "ended" });
    appView.set("ended");
}

export async function leaveGame() {
    const session = gameSession.get();

    // D5/D6: Notify other players by deleting own player row.
    // The existing Realtime subscription on the players table will fire a DELETE
    // event for all other clients, triggering fetchPlayers() and updating their lists.
    if (session?.playerId) {
        void supabase
            .rpc("leave_game", { p_player_id: session.playerId })
            .then(({ error }) => { if (error) console.warn("leave_game RPC failed:", error.message); })
            .catch((err) => console.warn("leave_game RPC failed:", err));
    }

    // Cleanup subscriptions
    unsubscribeFromQuestions();
    supabase.removeAllChannels();

    gameSession.set(null);
    players.set([]);
    committedQuestions.set([]);
    draftQuestions.set([]);
    answerDraftSelections.set({});
    questions.set([]);
    multiplayerError.set(null);
    appView.set("landing");
    window.location.hash = "";
}

// ─── Realtime ────────────────────────────────────────────────

let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

export function subscribeToGame(gameId: string): Promise<void> {
    // If a channel for this exact gameId is already subscribed, return immediately
    if (realtimeChannel && (realtimeChannel as any).topic === `realtime:game:${gameId}`) {
        return Promise.resolve();
    }
    // Cleanup previous
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
    }

    return new Promise((resolve) => {
        realtimeChannel = supabase
            .channel(`game:${gameId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "players",
                    filter: `game_id=eq.${gameId}`,
                },
                () => {
                    fetchPlayers(gameId);
                },
            )
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "games",
                    filter: `id=eq.${gameId}`,
                },
                (payload) => {
                    const session = gameSession.get();
                    if (!session) return;
                    const newPhase = (payload.new as any).phase as GamePhase;
                    if (newPhase !== session.phase) {
                        gameSession.set({ ...session, phase: newPhase });
                        if (newPhase === "playing") {
                            appView.set("game");
                            // Non-host players: start Q&A subscriptions when game transitions
                            subscribeToQuestions(session.gameId);
                            fetchCommittedQuestions(session.gameId);
                        } else if (newPhase === "ended") {
                            appView.set("ended");
                        }
                    }
                },
            )
            .subscribe(async (status) => {
                if (status === "SUBSCRIBED") {
                    // Race condition guard: re-fetch current phase in case the host
                    // started the game while this subscription was being established.
                    const { data: game } = await supabase
                        .from("games")
                        .select("phase")
                        .eq("id", gameId)
                        .single();
                    if (game) {
                        const session = gameSession.get();
                        const phase = game.phase as GamePhase;
                        if (session && phase !== session.phase) {
                            gameSession.set({ ...session, phase });
                            if (phase === "playing") {
                                appView.set("game");
                                subscribeToQuestions(session.gameId);
                                fetchCommittedQuestions(session.gameId);
                            } else if (phase === "ended") {
                                appView.set("ended");
                            }
                        }
                    }
                    resolve();
                } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                    resolve(); // Don't block the UI indefinitely
                }
            });
    });
}

// ─── Hash routing ────────────────────────────────────────────

export function initFromHash() {
    const hash = window.location.hash;
    const match = hash.match(/^#game\/([A-Z0-9]{6})$/i);
    if (match) {
        return match[1].toUpperCase();
    }
    return null;
}
