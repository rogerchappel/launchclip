// The e2e setup is also a ready demo setup: it serves the static app and the
// tests answer the API (see e2e/orders.spec.ts).
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://localhost:4320" },
  webServer: {
    command: "node server.js --port 4320",
    url: "http://localhost:4320",
    reuseExistingServer: true
  }
});
