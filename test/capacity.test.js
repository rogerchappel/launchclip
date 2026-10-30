import assert from "node:assert/strict";
import test from "node:test";
import { containerLimits, detectGpu, diagnoseCapacity, measureMachine, formatCapacity, parseSlotOverrides, recommendSlots, renderShare, resolveSlots } from "../src/capacity.js";
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
