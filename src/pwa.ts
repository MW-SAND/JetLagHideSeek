// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { registerSW } from "virtual:pwa-register";

registerSW({
    // Don't force-claim open tabs immediately — wait until the next page load.
    // immediate: true was causing mid-session SW takeovers that re-fetched all assets.
    onRegisteredSW(swScriptUrl) {
        console.log("SW registered: ", swScriptUrl);
    },
    onOfflineReady() {
        console.log("PWA application ready to work offline");
    },
});
