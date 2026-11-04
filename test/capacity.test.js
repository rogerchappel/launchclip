import assert from "node:assert/strict";
import test from "node:test";
import { containerLimits, detectGpu, diagnoseCapacity, measureMachine, formatCapacity, parseSlotOverrides, recommendSlots, renderBudget, renderShare, resolveSlots } from "../src/capacity.js";
import { runCli } from "../src/cli.js";

const MAC = { platform: "darwin", arch: "arm64", cores: 10, cpu_model: "Apple M4", ram_gb: 24 };

test("the starting rule gives a 10-core 24 GB Mac 2 renders, 1 local model and 4 planning calls", () => {
  assert.deepEqual(recommendSlots(MAC), { plan: 4, "local-model": 1, render: 2, io: 1 });
});

test("RAM caps renders, 32 GB allows two local models, and a small machine still renders", () => {
  assert.equal(recommendSlots({ cores: 16, ram_gb: 16 }).render, 1);
  assert.equal(recommendSlots({ cores: 32, ram_gb: 64 }).render, 6);
  assert.equal(recommendSlots({ cores: 12, ram_gb: 36 })["local-model"], 2);
  assert.equal(recommendSlots({ cores: 2, ram_gb: 4 }).render, 1);
});

test("LAUNCHCLIP_SLOTS overrides library slots, which override the rule", () => {
  const resolved = resolveSlots({ machine: MAC, env: { LAUNCHCLIP_SLOTS: "render:1, plan:6" }, librarySlots: { render: 3, io: 2 } });
  assert.deepEqual(resolved.slots, { plan: 6, "local-model": 1, render: 1, io: 2 });
  assert.deepEqual(resolved.sources, { plan: "LAUNCHCLIP_SLOTS", "local-model": "rule", render: "LAUNCHCLIP_SLOTS", io: "library" });
  assert.equal(resolved.recommended.render, 2);
});

test("bad overrides name the problem", () => {
  assert.throws(() => parseSlotOverrides("renders:1"), /unknown slot "renders"/);
  assert.throws(() => parseSlotOverrides("render:0"), /at least 1/);
  assert.throws(() => parseSlotOverrides("render:two"), /whole number/);
  assert.deepEqual(parseSlotOverrides(""), {});
});

test("each render gets the cores split across render slots", () => {
  assert.equal(renderShare({ machine: MAC, env: {} }), 5);
  assert.equal(renderShare({ machine: MAC, env: { LAUNCHCLIP_SLOTS: "render:1" } }), 10);
  assert.equal(renderShare({ machine: { cores: 2, ram_gb: 8 }, env: { LAUNCHCLIP_SLOTS: "render:4" } }), 1);
});

test("GPU detection reads system_profiler on macOS and nvidia-smi elsewhere, and never throws", async () => {
  const mac = await detectGpu({ platform: "darwin", run: async () => ({ stdout: JSON.stringify({ SPDisplaysDataType: [{ sppci_model: "Apple M4", sppci_cores: "10" }] }) }) });
  assert.deepEqual(mac, { name: "Apple M4", cores: 10, memory: "unified" });
  const linux = await detectGpu({ platform: "linux", run: async () => ({ stdout: "NVIDIA RTX 4090, 24564\n" }) });
  assert.deepEqual(linux, { name: "NVIDIA RTX 4090", memory_gb: 24 });
  assert.equal(await detectGpu({ platform: "linux", run: async () => { throw Object.assign(new Error("not found"), { code: "ENOENT" }); } }), null);
});

test("doctor --capacity prints the slots, and --json the report", async () => {
  const report = await diagnoseCapacity({ machine: MAC, env: { LAUNCHCLIP_SLOTS: "render:1" }, gpu: null });
  assert.equal(report.render_concurrency, 10);
  assert.match(formatCapacity(report), /render\s+1 {2}\(LAUNCHCLIP_SLOTS; rule says 2\)/);
  const output = [];
  await runCli(["doctor", "--json", "--capacity"], { stdout: { write: (value) => output.push(value) }, productionAdapters: { capacity: async () => report } });
  assert.equal(JSON.parse(output.join("")).slots.render, 1);
  output.length = 0;
  await runCli(["doctor", "--capacity"], { stdout: { write: (value) => output.push(value) }, productionAdapters: { capacity: async () => report } });
  assert.match(output.join(""), /^machine: 10 cores, 24 GB RAM, GPU not detected/);
});

test("a container's cgroup quota and memory limit beat the host's cores and RAM", () => {
  const files = (map) => (file) => { if (!(file in map)) throw new Error("ENOENT"); return map[file]; };
  assert.deepEqual(containerLimits(files({ "/sys/fs/cgroup/cpu.max": "800000 100000\n", "/sys/fs/cgroup/memory.max": `${16 * 1024 ** 3}\n` })), { cores: 8, ram_gb: 16 });
  assert.deepEqual(containerLimits(files({ "/sys/fs/cgroup/cpu.max": "max 100000", "/sys/fs/cgroup/memory.max": "max" })), {});
  assert.deepEqual(containerLimits(files({ "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "200000", "/sys/fs/cgroup/cpu/cpu.cfs_period_us": "100000", "/sys/fs/cgroup/memory/memory.limit_in_bytes": "9223372036854771712" })), { cores: 2 });
  assert.deepEqual(containerLimits(files({})), {});
  const machine = measureMachine({ platform: "linux", limits: { cores: 0.5, ram_gb: 0.25 } });
  assert.equal(machine.cores, 1, "a fraction of a core still renders");
  assert.equal(machine.ram_gb, 0.3);
  assert.deepEqual(machine.container, { cores: 0.5, ram_gb: 0.3 });
  assert.equal(measureMachine({ platform: "linux", limits: {} }).container, undefined);
});

test("a 7.5 GB, 8-core container renders with 4 tabs and a 1.1 GB video cache, not one tab per core", () => {
  // A large host, so the container's limits are what count (CI runners can have fewer cores).
  const machine = measureMachine({ platform: "linux", limits: { cores: 8, ram_gb: 7.5 }, host: { cores: 32, ram_gb: 128 } });
  const budget = renderBudget({ machine, env: {} });
  assert.equal(budget.tabs, 4);
  assert.equal(budget.video_cache_bytes, Math.round(1.125 * 1024 ** 3));
  assert.equal(renderShare({ machine, env: {} }), 4);
  assert.equal(renderShare({ machine, env: { LAUNCHCLIP_SLOTS: "render:2" } }), 1, "two renders split the memory too");
});

test("a 16 GB, 8-core container gets a tab per core and the 2 GB cache cap", () => {
  const budget = renderBudget({ machine: { cores: 8, ram_gb: 16 }, env: {} });
  assert.deepEqual(budget, { tabs: 8, ram_gb: 16, video_cache_bytes: 2 * 1024 ** 3 });
});

test("with no cgroup limit the budget comes from the host's RAM and the cache stays capped", () => {
  const host = { cores: 16, ram_gb: 64 };
  assert.deepEqual(renderBudget({ machine: host, env: { LAUNCHCLIP_SLOTS: "render:1" } }), { tabs: 16, ram_gb: 64, video_cache_bytes: 2 * 1024 ** 3 });
  const measured = renderBudget({ machine: measureMachine({ platform: "linux", limits: {} }), env: {} });
  assert.ok(measured.tabs >= 1);
  assert.ok(measured.video_cache_bytes >= 0.5 * 1024 ** 3 && measured.video_cache_bytes <= 2 * 1024 ** 3);
  assert.equal(renderBudget({ machine: { cores: 4, ram_gb: 2 }, env: {} }).tabs, 1, "a tiny machine still renders");
});
