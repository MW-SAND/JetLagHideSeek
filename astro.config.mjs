// @ts-check
import partytown from "@astrojs/partytown";
import react from "@astrojs/react";
import tailwind from "@astrojs/tailwind";
import AstroPWA from "@vite-pwa/astro";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
    integrations: [
        react(),
        tailwind({
            applyBaseStyles: false,
        }),
        partytown({
            config: {
                forward: ["dataLayer.push"],
            },
        }),
        AstroPWA({
            // Disable the service worker in development — it intercepts Vite HMR
            // requests and causes laggy reloads. The SW only activates in production.
            devOptions: {
                enabled: false,
            },
            workbox: {
                // Limit pre-cache to small assets; skip the 3.8 MB coastline GeoJSON
                // (it's fetched on-demand and cached at runtime instead).
                maximumFileSizeToCacheInBytes: 1_500_000, // 1.5 MB
                globIgnores: ["**/*.geojson"],
                // Use NetworkFirst for page navigations so the app always reflects
                // the latest deployment rather than serving a stale shell.
                navigationPreload: true,
                runtimeCaching: [
                    {
                        // Cache the large GeoJSON at runtime with a network-first policy
                        urlPattern: /\.geojson$/,
                        handler: "NetworkFirst",
                        options: {
                            cacheName: "geojson-cache",
                            expiration: { maxEntries: 5, maxAgeSeconds: 7 * 24 * 60 * 60 },
                        },
                    },
                ],
            },
            manifest: {
                name: "Jet Lag Hide and Seek Map Generator",
                short_name: "Map Generator",
                description:
                    "Automatically generate maps for Jet Lag The Game: Hide and Seek with ease! Simply name the questions and watch the map eliminate hundreds of possibilities in seconds.",
                icons: [
                    {
                        src: "/JetLagHideSeek/JLIcon.png",
                        sizes: "1080x1080",
                        type: "image/png",
                    },
                    {
                        src: "/JetLagHideSeek/android-chrome-192x192.png",
                        sizes: "192x192",
                        type: "image/png",
                    },
                    {
                        src: "/JetLagHideSeek/android-chrome-512x512.png",
                        sizes: "512x512",
                        type: "image/png",
                    },
                ],
                theme_color: "#1F2F3F",
            },
        }),
    ],
    devToolbar: {
        enabled: false,
    },
    site: "https://mw-sand.github.io",
    base: "JetLagHideSeek",
});
