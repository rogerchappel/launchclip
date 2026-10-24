// Orderdesk demo fixtures, lifted from the page.route mocks in
// e2e/orders.spec.ts and extended for what the demo flows do:
// - /me says onboarding is done, so no welcome tour covers the first frame;
// - marking an order shipped is remembered, and the status filter is applied
//   here because the real API applies it on the server;
// - endpoints the e2e tests never mocked (customers) are added.
// Everything here is made up. Each flow loads this module afresh.
const API = "http://localhost:4321/api";

const orders = [
  { id: 1042, customer: "Harbor & Pine", items: 3, total: 18450, status: "open", address: "12 Wharf Lane, Port Example" },
  { id: 1041, customer: "Fieldnote Studio", items: 1, total: 4200, status: "open", address: "88 Quill Street, Example City" },
  { id: 1040, customer: "Maple & Moss", items: 5, total: 26900, status: "open", address: "4 Fern Row, Sampleton" },
  { id: 1039, customer: "Northwind Ceramics", items: 2, total: 9800, status: "shipped", address: "301 Kiln Road, Example Bay" },
  { id: 1038, customer: "Lumen Supply Co.", items: 4, total: 15600, status: "shipped", address: "9 Lantern Court, Demoville" }
];
const shipped = new Set(orders.filter((order) => order.status === "shipped").map((order) => order.id));
const current = (order) => ({ ...order, status: shipped.has(order.id) ? "shipped" : "open" });

/** {json} answers a request; undefined lets it through. */
export function route({ url, method }) {
  if (!url.href.startsWith(`${API}/`)) return undefined;
  const path = url.pathname.replace(/^\/api/, "");
  if (path === "/me") return { json: { name: "Avery Demo", team: "Demo Goods Co.", onboarding_completed: true } };
  if (path === "/me/onboarding") return { json: { onboarding_completed: true } };
  if (path === "/orders") {
    const status = url.searchParams.get("status") ?? "open";
    return { json: orders.map(current).filter((order) => order.status === status) };
  }
  const ship = path.match(/^\/orders\/(\d+)\/ship$/);
  if (ship && method === "PUT") { shipped.add(Number(ship[1])); return { json: current(orders.find((order) => order.id === Number(ship[1]))) }; }
  const one = path.match(/^\/orders\/(\d+)$/);
  if (one) {
    const order = orders.find((entry) => entry.id === Number(one[1]));
    return order ? { json: current(order) } : { status: 404, json: { error: "No such order" } };
  }
  if (path === "/customers") return { json: [...new Set(orders.map((order) => order.customer))].map((name) => ({ name, orders: orders.filter((order) => order.customer === name).length })) };
  return { status: 404, json: { error: `no fixture for ${method} ${path}` } };
}
