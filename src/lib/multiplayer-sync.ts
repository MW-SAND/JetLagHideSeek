/**
 * Multiplayer Sync Layer
 *
 * Bridges local nanostores (context.ts) ↔ Supabase when in a multiplayer game.
 * Does NOT modify context.ts — wraps it with load/push/subscribe operations.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { atom } from "nanostores";

import {
    customStations,
    displayHidingZonesOptions,
    hiderMode,
    hidingRadius,
    hidingRadiusUnits,
    mapGeoLocation,
    permanentOverlay,
    polyGeoJSON,
    questions,
} from "./context";
import type { PlayerRole } from "./database.types";
import { gameSession, players } from "./multiplayer";
import {
    answerDraftSelections,
    applyAnswerToQuestionData,
} from "./question-store";
import { supabase } from "./supabase";

// ─── Connection status ──────────────────────────────────────
export type RealtimeStatus = "connected" | "connecting" | "disconnected";
export const realtimeStatus = atom<RealtimeStatus>("connecting");

// ─── Debounce util ───────────────────────────────────────────
let debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};
function debounced(key: string, fn: () => void, ms = 500) {
    clearTimeout(debounceTimers[key]);
    debounceTimers[key] = setTimeout(fn, ms);
}

// ─── Unsubscribe handles ────────────────────────────────────
let storeUnsubscribers: (() => void)[] = [];
let realtimeChannels: RealtimeChannel[] = [];

function stripLocalQuestionMeta(data: Record<string, unknown>) {
    const { drag: _drag, collapsed: _collapsed, _dbId: __dbId, ...rest } = data;
    return rest;
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b),
        );
        return `{${entries
            .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}

// ─── Guard: is multiplayer active? ──────────────────────────
function getGameId(): string | null {
    return gameSession.get()?.gameId ?? null;
}

function getMyRole(): PlayerRole | null {
    const session = gameSession.get();
    if (!session) return null;
    const me = players.get().find((p) => p.id === session.playerId);
    return me?.role ?? null;
}

// ═══════════════════════════════════════════════════════════════
// 1. LOAD — Pull game state from Supabase into local stores
// ═══════════════════════════════════════════════════════════════

export async function loadGameState(gameId: string) {
    // Load game settings
    const { data: game } = await supabase
        .from("games")
        .select("hiding_radius, hiding_radius_units, display_hiding_zones_options")
        .eq("id", gameId)
        .single();

    if (game) {
        if (game.hiding_radius != null) hidingRadius.set(game.hiding_radius);
        if (game.hiding_radius_units) hidingRadiusUnits.set(game.hiding_radius_units as any);
        if (game.display_hiding_zones_options) {
            displayHidingZonesOptions.set(game.display_hiding_zones_options as string[]);
        }
    }

    // Load geo data
    const { data: geo } = await supabase
        .from("game_geo_data")
        .select("map_geo_location, poly_geo_json, custom_stations, permanent_overlay")
        .eq("game_id", gameId)
        .single();

    if (geo) {
        if (geo.map_geo_location) mapGeoLocation.set(geo.map_geo_location as any);
        if (geo.poly_geo_json) polyGeoJSON.set(geo.poly_geo_json as any);
        if (geo.custom_stations) customStations.set(geo.custom_stations as any);
        if (geo.permanent_overlay) permanentOverlay.set(geo.permanent_overlay as any);
    }

    // Load hider location (only if I'm a hider — RLS enforced anyway)
    if (getMyRole() === "hider") {
        const { data: loc } = await supabase
            .from("hider_location")
            .select("lat, lng, confirmed")
            .eq("game_id", gameId)
            .single();

        if (loc && loc.lat != null && loc.lng != null) {
            hiderMode.set({ latitude: loc.lat, longitude: loc.lng });
        } else if (hiderMode.get() === false) {
            // No saved location yet — default to the map centre so the hider
            // pin appears immediately and the map hides questions correctly.
            const coords = mapGeoLocation.get().geometry.coordinates;
            // mapGeoLocation stores coordinates as [lat, lng] (Leaflet order)
            hiderMode.set({ latitude: coords[0], longitude: coords[1] });
        }
    }

    // Load questions + answers and reconstruct local question state
    const { data: dbQuestions } = await supabase
        .from("questions")
        .select("id, question_type, question_data, question_order")
        .eq("game_id", gameId)
        .order("question_order");

    const role = getMyRole();

    if (!dbQuestions || dbQuestions.length === 0) {
        if (role === "seeker") {
            const localDrafts = questions.get().filter((q) => !(q.data as any)._dbId);
            questions.set(localDrafts as any);
        } else {
            questions.set([]);
        }
        return;
    }

    const questionIds = dbQuestions.map((q) => q.id);
    const { data: dbAnswers } = await supabase
        .from("answers")
        .select("question_id, answer_data")
        .in("question_id", questionIds);

    const answersByQuestionId = new globalThis.Map<string, Record<string, unknown>>();
    for (const answer of dbAnswers ?? []) {
        const payload = answer.answer_data as Record<string, unknown>;
        if (payload && typeof payload === "object") {
            answersByQuestionId.set(answer.question_id, payload);
        }
    }

    const drafts = answerDraftSelections.get();

    const reconstructed = dbQuestions.map((q) => {
        const officialAnswerData = answersByQuestionId.get(q.id);
        const draftAnswerData = drafts[q.id];

        const effectiveAnswerData =
            officialAnswerData
                ? officialAnswerData
                : role === "hider" && draftAnswerData
                  ? draftAnswerData
                  : undefined;

        const baseData = q.question_data as Record<string, unknown>;
        const resolvedData =
            effectiveAnswerData
                ? applyAnswerToQuestionData(
                      q.question_type,
                      baseData,
                      effectiveAnswerData,
                  )
                : baseData;

        return {
            id: q.question_type,
            key: q.question_order,
            data: {
                ...resolvedData,
                drag: false,
                collapsed: true,
                _dbId: q.id,
            },
        };
    });

    if (role === "seeker") {
        const committedSignatures = new Set(
            dbQuestions.map((q) =>
                `${q.question_type}:${stableStringify(q.question_data as Record<string, unknown>)}`,
            ),
        );
        const localDrafts = questions.get().filter((q) => {
            if ((q.data as any)._dbId) return false;

            const signature = `${q.id}:${stableStringify(
                stripLocalQuestionMeta(q.data as Record<string, unknown>),
            )}`;

            return !committedSignatures.has(signature);
        });
        questions.set([...localDrafts, ...(reconstructed as any)]);
    } else {
        questions.set(reconstructed as any);
    }
}

// ═══════════════════════════════════════════════════════════════
// 2. PUSH — Watch local stores and push changes to Supabase
// ═══════════════════════════════════════════════════════════════

export function startPushingToSupabase() {
    // Clean up any existing subscriptions
    stopPushingToSupabase();

    // Host pushes game settings + geo data
    // Any player can push questions (seekers) or hider location (hiders)

    // ── Game settings (host only) ────────────────────────────
    storeUnsubscribers.push(
        hidingRadius.subscribe((value) => {
            const gameId = getGameId();
            if (!gameId) return;
            debounced("hidingRadius", () => {
                withSuppression(async () => {
                    const { error } = await supabase
                        .from("games")
                        .update({ hiding_radius: value })
                        .eq("id", gameId);
                    if (error) console.error("[sync] hidingRadius push failed:", error.message);
                });
            });
        }),
    );

    storeUnsubscribers.push(
        hidingRadiusUnits.subscribe((value) => {
            const gameId = getGameId();
            if (!gameId) return;
            debounced("hidingRadiusUnits", () => {
                withSuppression(async () => {
                    const { error } = await supabase
                        .from("games")
                        .update({ hiding_radius_units: value })
                        .eq("id", gameId);
                    if (error) console.error("[sync] hidingRadiusUnits push failed:", error.message);
                });
            });
        }),
    );

    storeUnsubscribers.push(
        displayHidingZonesOptions.subscribe((value) => {
            const gameId = getGameId();
            if (!gameId) return;
            debounced("displayHidingZonesOptions", () => {
                withSuppression(async () => {
                    const { error } = await supabase
                        .from("games")
                        .update({ display_hiding_zones_options: value as any })
                        .eq("id", gameId);
                    if (error) console.error("[sync] displayHidingZonesOptions push failed:", error.message);
                });
            });
        }),
    );

    // ── Geo data (host only during setup) ────────────────────
    storeUnsubscribers.push(
        mapGeoLocation.subscribe((value) => {
            const gameId = getGameId();
            if (!gameId) return;
            debounced("mapGeoLocation", () => {
                withSuppression(async () => {
                    const { error } = await supabase
                        .from("game_geo_data")
                        .update({ map_geo_location: value as any })
                        .eq("game_id", gameId);
                    if (error) console.error("[sync] mapGeoLocation push failed:", error.message);
                });
            }, 1000);
        }),
    );

    storeUnsubscribers.push(
        polyGeoJSON.subscribe((value) => {
            const gameId = getGameId();
            if (!gameId) return;
            debounced("polyGeoJSON", () => {
                withSuppression(async () => {
                    const { error } = await supabase
                        .from("game_geo_data")
                        .update({ poly_geo_json: value as any })
                        .eq("game_id", gameId);
                    if (error) console.error("[sync] polyGeoJSON push failed:", error.message);
                });
            }, 1000);
        }),
    );

    storeUnsubscribers.push(
        customStations.subscribe((value) => {
            const gameId = getGameId();
            if (!gameId) return;
            debounced("customStations", () => {
                withSuppression(async () => {
                    const { error } = await supabase
                        .from("game_geo_data")
                        .update({ custom_stations: value as any })
                        .eq("game_id", gameId);
                    if (error) console.error("[sync] customStations push failed:", error.message);
                });
            }, 1000);
        }),
    );

    storeUnsubscribers.push(
        permanentOverlay.subscribe((value) => {
            const gameId = getGameId();
            if (!gameId) return;
            debounced("permanentOverlay", () => {
                withSuppression(async () => {
                    const { error } = await supabase
                        .from("game_geo_data")
                        .update({ permanent_overlay: value as any })
                        .eq("game_id", gameId);
                    if (error) console.error("[sync] permanentOverlay push failed:", error.message);
                });
            }, 1000);
        }),
    );

    // ── Hider location (hiders only) ─────────────────────────
    storeUnsubscribers.push(
        hiderMode.subscribe((value) => {
            const gameId = getGameId();
            if (!gameId || getMyRole() !== "hider") return;
            debounced("hiderLocation", () => {
                if (value === false) return;
                const session = gameSession.get();
                withSuppression(async () => {
                    const { error } = await supabase
                        .from("hider_location")
                        .upsert({
                            game_id: gameId,
                            lat: value.latitude,
                            lng: value.longitude,
                            set_by: session?.playerId,
                            confirmed: true,
                            updated_at: new Date().toISOString(),
                        });
                    if (error) console.error("[sync] hiderLocation push failed:", error.message);
                });
            });
        }),
    );
}

export function stopPushingToSupabase() {
    storeUnsubscribers.forEach((unsub) => unsub());
    storeUnsubscribers = [];
    Object.values(debounceTimers).forEach(clearTimeout);
    debounceTimers = {};
}

// ═══════════════════════════════════════════════════════════════
// 3. SUBSCRIBE — Listen to Supabase Realtime for remote changes
// ═══════════════════════════════════════════════════════════════

/** Suppress local→remote→local echo. Incremented before local writes, decremented after. */
let suppressRemoteUpdateCount = 0;
function withSuppression(fn: () => Promise<void>): Promise<void> {
    suppressRemoteUpdateCount++;
    return fn().finally(() => {
        suppressRemoteUpdateCount--;
    });
}

export function subscribeToGameData(gameId: string) {
    unsubscribeFromGameData();

    // Primary channel — tracks connection status for the UI indicator
    const questionsChannel = supabase
        .channel(`sync:questions:${gameId}`)
        .on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: "questions",
                filter: `game_id=eq.${gameId}`,
            },
            async () => {
                if (suppressRemoteUpdateCount > 0) return;
                // Re-fetch all questions (simpler than incremental merge)
                await loadGameState(gameId);
            },
        )
        .subscribe((status) => {
            if (status === "SUBSCRIBED") realtimeStatus.set("connected");
            else if (status === "CLOSED" || status === "CHANNEL_ERROR") realtimeStatus.set("disconnected");
            else realtimeStatus.set("connecting");
        });
    realtimeChannels.push(questionsChannel);

    // Answers channel
    const answersChannel = supabase
        .channel(`sync:answers:${gameId}`)
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "answers",
                filter: `game_id=eq.${gameId}`,
            },
            async () => {
                if (suppressRemoteUpdateCount > 0) return;
                await loadGameState(gameId);
            },
        )
        .subscribe();
    realtimeChannels.push(answersChannel);

    // Geo data channel (country/region changes by host)
    const geoChannel = supabase
        .channel(`sync:geo-data:${gameId}`)
        .on(
            "postgres_changes",
            {
                event: "UPDATE",
                schema: "public",
                table: "game_geo_data",
                filter: `game_id=eq.${gameId}`,
            },
            (payload) => {
                if (suppressRemoteUpdateCount > 0) return;
                const g = payload.new as any;
                if (g.map_geo_location) mapGeoLocation.set(g.map_geo_location);
                if (g.poly_geo_json) polyGeoJSON.set(g.poly_geo_json);
                if (g.custom_stations) customStations.set(g.custom_stations);
                if (g.permanent_overlay) permanentOverlay.set(g.permanent_overlay);
            },
        )
        .subscribe();
    realtimeChannels.push(geoChannel);

    // Game settings channel (for non-host players)
    const gameChannel = supabase
        .channel(`sync:game-settings:${gameId}`)
        .on(
            "postgres_changes",
            {
                event: "UPDATE",
                schema: "public",
                table: "games",
                filter: `id=eq.${gameId}`,
            },
            (payload) => {
                if (suppressRemoteUpdateCount > 0) return;
                const g = payload.new as any;
                if (g.hiding_radius != null) hidingRadius.set(g.hiding_radius);
                if (g.hiding_radius_units) hidingRadiusUnits.set(g.hiding_radius_units);
                if (g.display_hiding_zones_options) {
                    displayHidingZonesOptions.set(g.display_hiding_zones_options);
                }
            },
        )
        .subscribe();
    realtimeChannels.push(gameChannel);
}

export function unsubscribeFromGameData() {
    realtimeChannels.forEach((ch) => supabase.removeChannel(ch));
    realtimeChannels = [];
    realtimeStatus.set("connecting");
}

// ═══════════════════════════════════════════════════════════════
// 4. ORCHESTRATOR — Call from AppRoot when entering "game" view
// ═══════════════════════════════════════════════════════════════

export async function enterGame(gameId: string) {
    await loadGameState(gameId);
    startPushingToSupabase();
    subscribeToGameData(gameId);
}

export function exitGame() {
    stopPushingToSupabase();
    unsubscribeFromGameData();
}
