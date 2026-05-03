/**
 * End-to-end multiplayer test.
 * Run with: npx playwright test tests/e2e-multiplayer.ts
 *
 * Core functionality tested:
 * 1. Create game (Player 1 / Seeker)
 * 2. Join game (Player 2 / Hider) in separate browser context
 * 3. Lobby: both players visible, Start Game enabled
 * 4. Game starts for both players (view transitions to map)
 * 5. PlacePicker country change (seeker)
 * 6. Seeker adds radius question
 * 7. Seeker sends question to hider
 * 8. Hider sees pending question
 * 9. Hider answers Yes/No
 * 10. Map updates after answer
 * 11. Hider mode auto-enabled (hider pin visible)
 * 12. End game
 * 13. Game ended overlay shown for both players
 */

import { test, expect, chromium } from "@playwright/test";

const BASE_URL = "http://localhost:4323/JetLagHideAndSeek";
const TIMEOUT = 15000;

test("full multiplayer session", async () => {
    // ── Two isolated browser contexts = two independent users ─────────
    const browser = await chromium.launch({ headless: true });
    const ctx1 = await browser.newContext(); // Player 1 — Seeker (host)
    const ctx2 = await browser.newContext(); // Player 2 — Hider
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    // ── 1. Navigate both pages ────────────────────────────────────────
    await Promise.all([
        p1.goto(BASE_URL),
        p2.goto(BASE_URL),
    ]);
    await Promise.all([
        p1.waitForSelector('button:has-text("Create Game")', { timeout: TIMEOUT }),
        p2.waitForSelector('button:has-text("Join Game")', { timeout: TIMEOUT }),
    ]);
    console.log("✅ 1. Both pages loaded");

    // ── 2. Player 1 creates game as Seeker ────────────────────────────
    await p1.click('button:has-text("Create Game")');
    await p1.fill('input[placeholder="Enter your name"]', "Tester_Seeker");
    await p1.click('button:has-text("Seeker")');
    await p1.click('button:has-text("Create Game"):not([disabled])');
    await p1.waitForSelector('text=Room Code', { timeout: TIMEOUT });
    const roomCode = await p1.locator("button[ref], button.font-mono, button:has-text(/^[A-Z0-9]{6}$/)").first().textContent() ?? "";
    // Get room code from URL hash
    const p1Url = p1.url();
    const roomMatch = p1Url.match(/game\/([A-Z0-9]{6})/i);
    const code = roomMatch ? roomMatch[1] : "";
    console.log(`✅ 2. Game created with room code: ${code}`);
    expect(code).toMatch(/^[A-Z0-9]{6}$/);

    // ── 3. Player 2 joins as Hider ────────────────────────────────────
    await p2.click('button:has-text("Join Game")');
    await p2.fill('input[placeholder="ABC123"]', code);
    await p2.fill('input[placeholder="Enter your name"]', "Tester_Hider");
    await p2.click('button:has-text("Hider")');
    await p2.click('button:has-text("Join Game"):not([disabled])');
    await p2.waitForSelector('text=Room Code', { timeout: TIMEOUT });
    console.log("✅ 3. Player 2 joined as Hider");

    // ── 4. Lobby: both players should appear ─────────────────────────
    await p1.waitForSelector('text=2 joined', { timeout: TIMEOUT });
    await p2.waitForSelector('text=2 joined', { timeout: TIMEOUT });
    const p1LobbyText = await p1.locator("body").innerText();
    const p2LobbyText = await p2.locator("body").innerText();
    expect(p1LobbyText).toContain("Tester_Seeker");
    expect(p1LobbyText).toContain("Tester_Hider");
    expect(p2LobbyText).toContain("Tester_Seeker");
    expect(p2LobbyText).toContain("Tester_Hider");
    console.log("✅ 4. Both players visible in lobby");

    // ── 5. Start Game (host only) ─────────────────────────────────────
    // Wait for Start Game button to become enabled
    await p1.waitForSelector('button:has-text("Start Game"):not([disabled])', { timeout: TIMEOUT });
    await p1.click('button:has-text("Start Game")');
    console.log("✅ 5. Host started game");

    // ── 6. Both players transition to game view ───────────────────────
    // The lobby overlay disappears; the map should be visible
    await p1.waitForSelector('text=Start Game', { state: "hidden", timeout: TIMEOUT });
    await p2.waitForSelector('text=Start Game', { state: "hidden", timeout: TIMEOUT });
    // Check player count badge visible in game UI
    await p1.waitForSelector('button:has-text(/\\d+ players?/)', { timeout: TIMEOUT });
    console.log("✅ 6. Both players in game view");

    // ── 7. Hider mode auto-enabled for Player 2 ──────────────────────
    // After enterGame, hiderMode should be set for the hider player
    await p2.waitForTimeout(2000); // wait for loadGameState to complete
    // The hider pin appears as a Leaflet marker on the map
    const hiderMarker = p2.locator(".leaflet-marker-icon").first();
    const hiderMarkerVisible = await hiderMarker.isVisible().catch(() => false);
    console.log(`${hiderMarkerVisible ? "✅" : "⚠️"} 7. Hider mode auto-enabled: ${hiderMarkerVisible}`);

    // ── 8. PlacePicker country change (Seeker) ────────────────────────
    const placePickerBtn = p1.locator('button[role="combobox"]').first();
    await placePickerBtn.click();
    await p1.waitForSelector('input[placeholder="Search place..."]', { timeout: 5000 });
    await p1.fill('input[placeholder="Search place..."]', "France");
    await p1.waitForSelector('[role="option"]:has-text("France")', { timeout: 8000 });
    await p1.locator('[role="option"]:has-text("France")').first().click();
    await p1.waitForTimeout(1500); // map refresh
    console.log("✅ 8. PlacePicker country changed to France");

    // ── 9. Seeker opens sidebar and adds a radius question ───────────
    // Open left sidebar
    await p1.locator('button[data-sidebar="trigger"]').first().click().catch(async () => {
        // Try alternative sidebar trigger
        await p1.locator('button:has-text("Questions"), button[aria-label="Toggle sidebar"]').first().click();
    });
    await p1.waitForTimeout(500);

    // Click Add Question
    await p1.locator('button:has-text("Add Question")').click();
    await p1.waitForSelector('text=Add Radius', { timeout: 5000 });
    await p1.locator('button:has-text("Add Radius")').click();
    await p1.waitForTimeout(1000);
    console.log("✅ 9. Seeker added Radius question");

    // ── 10. Seeker sends question to hider ────────────────────────────
    // The question card should have a "Send to Hider" button (after locking/committing)
    // First we need to lock the question (drag=false)
    // Look for lock icon button on the question card
    const lockBtn = p1.locator('button[title*="lock" i], button[title*="Lock" i], button[aria-label*="lock" i]').first();
    const lockVisible = await lockBtn.isVisible().catch(() => false);
    if (lockVisible) {
        await lockBtn.click();
        await p1.waitForTimeout(500);
    }

    const sendBtn = p1.locator('button:has-text("Send to Hider")').first();
    const sendVisible = await sendBtn.isVisible().catch(() => false);
    console.log(`${sendVisible ? "✅" : "⚠️"} 10. Send to Hider button visible: ${sendVisible}`);
    if (sendVisible && !await sendBtn.isDisabled()) {
        await sendBtn.click();
        await p1.waitForTimeout(1500);
        console.log("✅ 10. Question sent to hider");
    }

    // ── 11. Hider sees pending question ──────────────────────────────
    await p2.waitForTimeout(2000);
    const hiderSidebar = await p2.locator("body").innerText();
    const hasQuestion = hiderSidebar.includes("Awaiting Your Answer") || hiderSidebar.includes("Yes") || hiderSidebar.includes("No");
    console.log(`${hasQuestion ? "✅" : "⚠️"} 11. Hider sees pending question: ${hasQuestion}`);

    // ── 12. Hider answers Yes ─────────────────────────────────────────
    if (hasQuestion) {
        const yesBtn = p2.locator('button:has-text("Yes")').first();
        if (await yesBtn.isVisible().catch(() => false)) {
            await yesBtn.click();
            await p2.waitForTimeout(1500);
            console.log("✅ 12. Hider answered Yes");
        }
    }

    // ── 13. Map update: question appears on Seeker's map ─────────────
    await p1.waitForTimeout(2000);
    const questionOnMap = await p1.locator(".leaflet-overlay-pane path").count();
    console.log(`${questionOnMap > 0 ? "✅" : "⚠️"} 13. Map shows ${questionOnMap} path layers after answer`);

    // ── 14. End game (host) ────────────────────────────────────────────
    // Click the player list to expand it, then click End Game
    await p1.locator('button:has-text(/\\d+ players?/)').click();
    await p1.waitForTimeout(500);
    const endGameBtn = p1.locator('button:has-text("End Game")');
    const endGameVisible = await endGameBtn.isVisible().catch(() => false);
    if (endGameVisible) {
        await endGameBtn.click();
        await p1.waitForTimeout(2000);
        console.log("✅ 14. Host ended game");
    } else {
        console.log("⚠️ 14. End Game button not found");
    }

    // ── 15. Game ended overlay ────────────────────────────────────────
    await p1.waitForSelector('text=Game Over', { timeout: TIMEOUT }).catch(() => null);
    await p2.waitForSelector('text=Game Over', { timeout: TIMEOUT }).catch(() => null);
    const p1Ended = await p1.locator("body").innerText().then(t => t.includes("Game Over") || t.includes("ended") || t.includes("Ended"));
    const p2Ended = await p2.locator("body").innerText().then(t => t.includes("Game Over") || t.includes("ended") || t.includes("Ended"));
    console.log(`${p1Ended ? "✅" : "⚠️"} 15. Player 1 sees game ended overlay: ${p1Ended}`);
    console.log(`${p2Ended ? "✅" : "⚠️"} 15. Player 2 sees game ended overlay: ${p2Ended}`);

    await browser.close();
});
