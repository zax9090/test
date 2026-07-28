import { defineConfig } from "@playwright/test";

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
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        launchOptions: { executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" },
      },
    },
  ],
});
