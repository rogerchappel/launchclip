// Pulseboard demo fixtures: LaunchClip's recorder answers the app's API from
// here (app.fixtures in DEMO-PLAN.json), so a recording needs no seed data,
// no database and no sign-in. Each flow loads this module afresh, so every
// flow starts from the same projects. Everything here is made up.
const projects = [
  { id: "p1", name: "Orbit beta", goal: "Signups", status: "Live", visitors: 24310, conversion: 7.1, created: "yesterday" },
  { id: "p2", name: "Spring launch", goal: "Signups", status: "Live", visitors: 18420, conversion: 6.2, created: "2 days ago" },
  { id: "p3", name: "Pricing page test", goal: "Upgrades", status: "Live", visitors: 9310, conversion: 4.8, created: "5 days ago" },
  { id: "p4", name: "Onboarding emails", goal: "Activation", status: "Paused", visitors: 4120, conversion: 11.4, created: "1 week ago" }
];

/**
 * Answer one request: {status?, json} to fulfill it, undefined to let it
 * through to the app server (pages, scripts, styles).
 */
export function route({ url, method, body }) {
  if (url.pathname === "/api/projects" && method === "GET") return { json: projects };
  if (url.pathname === "/api/projects" && method === "POST") {
    const name = String(body?.name ?? "").trim().slice(0, 60);
    if (!name) return { status: 400, json: { error: "Name your project" } };
    const project = { id: `p${projects.length + 1}`, name, goal: body.goal ?? "Signups", status: "Live", visitors: 0, conversion: 0, created: "just now" };
    projects.unshift(project);
    return { status: 201, json: project };
  }
  return undefined;
}
