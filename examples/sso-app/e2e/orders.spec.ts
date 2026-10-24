// Orders e2e test: signs in by writing a test token before the app loads and
// answers the API with page.route mocks. LaunchClip's demo/fixtures.mjs is
// lifted from these mocks (docs/guide/demo-autopilot.md).
import { expect, test } from "@playwright/test";

const API = "http://localhost:4321/api";
const orders = [
  { id: 1042, customer: "Harbor & Pine", items: 3, total: 18450, status: "open", address: "12 Wharf Lane, Port Example" },
  { id: 1041, customer: "Fieldnote Studio", items: 1, total: 4200, status: "open", address: "88 Quill Street, Example City" }
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("auth_token", "test.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJleHAiOjE4OTM0NTYwMDB9.signature");
    localStorage.setItem("orderdesk-team", "team-test");
  });
  await page.route(`${API}/me`, (route) => route.fulfill({ json: { name: "Test Buyer", team: "Test team", onboarding_completed: true } }));
  await page.route(`${API}/orders?status=open`, (route) => route.fulfill({ json: orders }));
  await page.route(`${API}/orders/1042`, (route) => route.fulfill({ json: orders[0] }));
});

test("opens an order from the list", async ({ page }) => {
  await page.goto("/#orders");
  await page.getByText("Harbor & Pine").click();
  await expect(page.getByRole("dialog", { name: "Order 1042" })).toBeVisible();
});
