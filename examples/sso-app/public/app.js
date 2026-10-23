// Orderdesk client. Configuration a real build would read from env
// (PUBLIC_API_URL, PUBLIC_ANALYTICS_KEY in .env.example).
const API = "http://localhost:4321/api";
const SSO = "https://auth.orderdesk-idp.example/oauth2/authorize?client_id=orderdesk-web";
const ANALYTICS = "https://events.orderdesk-analytics.example/capture";

const main = document.getElementById("main");
const token = localStorage.getItem("auth_token");
const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);
const money = (cents) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

// The app only decodes the token to check it hasn't expired; the API checks it.
function claims(value) {
  try { return JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return null; }
}

function signIn() {
  location.href = `${SSO}&redirect_uri=${encodeURIComponent(location.origin)}`;
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
  if (response.status === 401) { signIn(); throw new Error("signed out"); }
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path} answered ${response.status}`);
  return response.json();
}

function track(event) {
  fetch(ANALYTICS, { method: "POST", mode: "no-cors", body: JSON.stringify({ event, at: Date.now() }) }).catch(() => {});
}

function onboarding(me) {
  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Welcome">
    <h2>Welcome to Orderdesk, ${esc(me.name.split(" ")[0])}</h2>
    <p class="muted">Take a two-minute tour of orders, customers and shipping.</p>
    <div class="row"><button class="primary">Take the tour</button><button class="ghost" id="skip">Skip tour</button></div>
  </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector("#skip").addEventListener("click", async () => {
    await api("/me/onboarding", { method: "PUT", body: JSON.stringify({ onboarding_completed: true }) });
    backdrop.remove();
  });
}

async function orders(status = "open") {
  const rows = await api(`/orders?status=${status}`);
  main.innerHTML = `
    <h1>Orders</h1><p class="muted">Everything waiting to ship, in one list.</p>
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected="${status === "open"}" data-status="open">Open</button>
      <button role="tab" aria-selected="${status === "shipped"}" data-status="shipped">Shipped</button>
    </div>
    <table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th></tr></thead><tbody>
      ${rows.map((order) => `<tr data-order="${order.id}"><td>#${order.id}</td><td>${esc(order.customer)}</td><td>${order.items}</td><td>${money(order.total)}</td><td><span class="pill ${order.status}">${order.status === "shipped" ? "Shipped" : "Open"}</span></td></tr>`).join("") || `<tr><td colspan="5" class="muted">Nothing here.</td></tr>`}
    </tbody></table>`;
  main.querySelectorAll("[role=tab]").forEach((tab) => tab.addEventListener("click", () => orders(tab.dataset.status)));
  main.querySelectorAll("tr[data-order]").forEach((row) => row.addEventListener("click", () => detail(Number(row.dataset.order), status)));
}

async function detail(id, status) {
  const order = await api(`/orders/${id}`);
  document.querySelector(".drawer")?.remove();
  const drawer = document.createElement("div");
  drawer.className = "drawer";
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-label", `Order ${id}`);
  drawer.innerHTML = `<h2>Order #${order.id}</h2>
    <p><strong>${esc(order.customer)}</strong><br><span class="muted">${esc(order.address)}</span></p>
    <p>${order.items} item(s), ${money(order.total)}</p>
    <div class="row">${order.status === "shipped" ? `<span class="pill shipped">Shipped</span>` : `<button class="primary" id="ship">Mark as shipped</button>`}<button class="ghost" id="close">Close</button></div>`;
  document.body.appendChild(drawer);
  drawer.querySelector("#close").addEventListener("click", () => drawer.remove());
  drawer.querySelector("#ship")?.addEventListener("click", async () => {
    await api(`/orders/${id}/ship`, { method: "PUT" });
    drawer.remove();
    await orders(status);
  });
}

async function customers() {
  const rows = await api("/customers");
  main.innerHTML = `<h1>Customers</h1><table><thead><tr><th>Name</th><th>Orders</th></tr></thead><tbody>
    ${rows.map((customer) => `<tr><td>${esc(customer.name)}</td><td>${customer.orders}</td></tr>`).join("")}</tbody></table>`;
}

async function render() {
  const page = location.hash.replace(/^#/, "") || "orders";
  document.querySelectorAll(".nav a").forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `/#${page}`));
  track(`view ${page}`);
  if (page === "customers") await customers(); else await orders();
}

async function boot() {
  const exp = token && claims(token)?.exp;
  if (!exp || exp * 1000 < Date.now()) return signIn();
  const me = await api("/me");
  document.getElementById("who").textContent = `${me.name} · ${me.team}`;
  if (!me.onboarding_completed) onboarding(me);
  addEventListener("hashchange", render);
  await render();
}

boot();
