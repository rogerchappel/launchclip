// Pulseboard client: a few pages rendered from location.pathname.
const main = document.getElementById("main");
const shell = document.getElementById("shell");
const auth = document.getElementById("auth");
const toast = document.getElementById("toast");
let fresh = null;

const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);
const number = (value) => value.toLocaleString("en-US");

function notify(text) {
  toast.textContent = text;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

function go(path) {
  history.pushState({}, "", path);
  render();
}

async function dashboard() {
  const projects = await (await fetch("/api/projects")).json();
  const visitors = projects.reduce((sum, p) => sum + p.visitors, 0);
  const live = projects.filter((p) => p.status === "Live").length;
  main.innerHTML = `
    <header class="page"><div><h1>Dashboard</h1><p class="muted">Every launch, one place.</p></div>
      <a class="button primary" href="/projects/new" data-nav>New project</a></header>
    <div class="stats">
      <div class="card stat"><div class="label">Visitors this week</div><div class="value">${number(visitors)}</div><div class="delta">+18% vs last week</div></div>
      <div class="card stat"><div class="label">Live projects</div><div class="value">${live}</div><div class="delta">+1 this week</div></div>
      <div class="card stat"><div class="label">Avg. conversion</div><div class="value">6.4%</div><div class="delta">+0.9 pts</div></div>
    </div>
    <div class="card"><table id="projects"><thead><tr><th>Project</th><th>Goal</th><th>Status</th><th>Visitors</th><th>Conversion</th><th>Created</th></tr></thead><tbody>
      ${projects.map((p) => `<tr class="${p.id === fresh ? "fresh" : ""}"><td><strong>${esc(p.name)}</strong></td><td>${esc(p.goal)}</td><td><span class="pill ${p.status}">${p.status}</span></td><td>${number(p.visitors)}</td><td>${p.conversion}%</td><td class="muted">${esc(p.created)}</td></tr>`).join("")}
    </tbody></table></div>`;
  fresh = null;
}

function newProject() {
  main.innerHTML = `
    <header class="page"><div><h1>New project</h1><p class="muted">Track a launch in under a minute.</p></div></header>
    <form class="card project" id="project-form">
      <label for="project-name">Project name</label>
      <input id="project-name" name="name" placeholder="e.g. Summer launch" autocomplete="off">
      <label>Goal</label>
      <div class="goals">${["Signups", "Upgrades", "Activation"].map((goal, i) => `<button type="button" class="goal${i === 0 ? " selected" : ""}" data-goal="${goal}">${goal}</button>`).join("")}</div>
      <button type="submit" class="primary">Create project</button>
    </form>`;
  let goal = "Signups";
  main.querySelectorAll("[data-goal]").forEach((button) => button.addEventListener("click", () => {
    goal = button.dataset.goal;
    main.querySelectorAll("[data-goal]").forEach((other) => other.classList.toggle("selected", other === button));
  }));
  document.getElementById("project-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.getElementById("project-name").value;
    const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, goal }) });
    if (!response.ok) return notify((await response.json()).error);
    fresh = (await response.json()).id;
    notify("Project created");
    go("/dashboard");
  });
}

function analytics() {
  const days = [["Mon", 42], ["Tue", 58], ["Wed", 51], ["Thu", 74], ["Fri", 88], ["Sat", 63], ["Sun", 96]];
  main.innerHTML = `
    <header class="page"><div><h1>Analytics</h1><p class="muted">Signups per day, all projects.</p></div></header>
    <div class="split">
      <div class="card"><div class="chart">${days.map(([day, value], i) => `<div class="bar" style="height:${value}%;animation-delay:${i * 0.08}s"><span>${day}</span></div>`).join("")}</div><div style="height:28px"></div></div>
      <div class="card insight">Best day<strong>Sunday: 96 signups</strong><span class="muted">Your Product Hunt post drove 41% of this week's signups.</span></div>
    </div>`;
}

async function render() {
  const path = location.pathname;
  const signedIn = sessionStorage.getItem("pulseboard-user");
  if (path === "/login" || (!signedIn && path === "/")) {
    shell.hidden = true;
    auth.hidden = false;
    return;
  }
  auth.hidden = true;
  shell.hidden = false;
  document.querySelectorAll("nav a").forEach((link) => link.classList.toggle("active", link.getAttribute("href") === path));
  if (path === "/projects/new") newProject();
  else if (path === "/analytics") analytics();
  else await dashboard();
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-nav]");
  if (!link) return;
  event.preventDefault();
  go(link.getAttribute("href"));
});

document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: document.getElementById("email").value, password: document.getElementById("password").value }) });
  if (!response.ok) {
    document.getElementById("login-error").textContent = (await response.json()).error;
    return;
  }
  const user = await response.json();
  sessionStorage.setItem("pulseboard-user", user.name);
  document.getElementById("team").textContent = user.team;
  go("/dashboard");
});

window.addEventListener("popstate", render);
render();
