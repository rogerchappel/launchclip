// Seed Pulseboard with fictional demo data: one test account and a handful of
// projects. Writes data/db.json (gitignored), replacing what is there, so every
// recording starts from the same clean state.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const users = [
  { email: "demo@pulseboard.test", password: "demo-pass-123", name: "Avery Demo", team: "Lighthouse Labs" }
];

const projects = [
  { id: "p1", name: "Spring launch", goal: "Signups", status: "Live", visitors: 18420, conversion: 6.2, created: "2 days ago" },
  { id: "p2", name: "Pricing page test", goal: "Upgrades", status: "Live", visitors: 9310, conversion: 4.8, created: "5 days ago" },
  { id: "p3", name: "Onboarding emails", goal: "Activation", status: "Paused", visitors: 4120, conversion: 11.4, created: "1 week ago" },
  { id: "p4", name: "Referral program", goal: "Invites", status: "Draft", visitors: 0, conversion: 0, created: "2 weeks ago" }
];

await mkdir(path.join(ROOT, "data"), { recursive: true });
await writeFile(path.join(ROOT, "data", "db.json"), JSON.stringify({ users, projects }, null, 2));
console.log(`seeded ${users.length} demo user and ${projects.length} projects`);
