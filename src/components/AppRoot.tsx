import { useStore } from "@nanostores/react";
import { useEffect, useRef, useState } from "react";

import { enterGame, exitGame } from "@/lib/multiplayer-sync";
import { appView, gameSession, initFromHash } from "@/lib/multiplayer";

import { GameEndedOverlay } from "./GameEndedOverlay";
import { GameLobby } from "./GameLobby";
import { LandingPage } from "./LandingPage";

/**
 * Top-level view router. Renders either:
 * - LandingPage (create/join)
 * - GameLobby (setup phase)
 * - null (game phase — falls through to the Astro-rendered map UI)
 */
export function AppRoot() {
    const view = useStore(appView);
    const session = useStore(gameSession);
    const [initialRoomCode, setInitialRoomCode] = useState<string | undefined>();
    const [ready, setReady] = useState(false);
    const syncStarted = useRef(false);

    useEffect(() => {
        // Check URL hash on mount.
        // We do not auto-rejoin from hash anymore; opening the app/home should
        // always land on the default menu. If a code exists in hash, prefill it
        // in the Join flow and clear the hash from the URL.
        const code = initFromHash();

        gameSession.set(null);
        appView.set("landing");

        if (code) {
            setInitialRoomCode(code);
            window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
        }

        setReady(true);
    }, []);

    // Start sync when entering game view
    useEffect(() => {
        if ((view === "game" || view === "ended") && session?.gameId && !syncStarted.current) {
            syncStarted.current = true;
            enterGame(session.gameId);
        }
        if (view !== "game" && view !== "ended" && syncStarted.current) {
            syncStarted.current = false;
            exitGame();
        }
    }, [view, session?.gameId]);

    if (!ready) return null;

    if (view === "landing") {
        return <LandingPage initialRoomCode={initialRoomCode} />;
    }

    if (view === "lobby") {
        return <GameLobby />;
    }

    if (view === "ended") {
        return <GameEndedOverlay />;
    }

    // view === "game" → return null, let the map UI render beneath
    return null;
}
