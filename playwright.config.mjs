import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

/**
 * This sandbox ships a pre-installed Chromium at a fixed path and blocks
 * downloads; CI installs its own. Point at the local one only when it is
 * actually there, so both work without a flag.
 */
const PREINSTALLED = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const launchOptions = existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {};

export default defineConfig({
  testDir: "./test",
  testMatch: "**/*.spec.mjs",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:4321",
    // The widget sits in a host-owned iframe; this is roughly a chat column.
    viewport: { width: 720, height: 1000 },
  },
  webServer: {
    // Static server over the built harness. No app server involved — the widget
    // is a self-contained document by design.
    command: "npx http-server .harness -p 4321 -s --cors",
    url: "http://127.0.0.1:4321/host.html",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium", launchOptions } }],
});
