// Hardware capacity (docs/COLLECTIONS_RFC.md §5.2): what this machine has and
// how many jobs of each kind it should run at once.
//
//   plan         script, storyboard, critic and repair calls (network-bound)
//   local-model  Ollama planning, Kokoro voice, subject matting (RAM, GPU)
//   render       Chromium frames + encode (cores, RAM, disk)
//   io           copying to finals or archive (disk bandwidth)
//
// Overrides, strongest first: LAUNCHCLIP_SLOTS=render:1,plan:6, then the
// library file's slots (passed in as options.librarySlots once
// launchclip.library.json lands), then the measured rule.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GB = 1024 ** 3;

export const SLOT_KINDS = Object.freeze(["plan", "local-model", "render", "io"]);

// The §5.2 starting rule. RENDER_CORES and RENDER_GB are what one render
// needs; BASE_GB is left for the system and the other slots.
// benchmarks/RENDER_CAPACITY.md has the measurements behind them.
export const RULE = Object.freeze({ PLAN: 4, RENDER_CORES: 5, RENDER_GB: 7, BASE_GB: 4, LOCAL_MODEL_TWO_AT_GB: 32 });

/**
 * The machine as Node sees it, inside a container's limits: a Linux container
 * reports the host's cores and RAM, so a cgroup CPU quota or memory limit
 * lower than those wins. No GPU probe (detectGpu does that).
 */
export function measureMachine({ platform = process.platform, arch = process.arch, limits = platform === "linux" ? containerLimits() : {} } = {}) {
  const cpus = os.cpus();
  const hostCores = typeof os.availableParallelism === "function" ? os.availableParallelism() : cpus.length;
  const hostGb = os.totalmem() / GB;
  return {
    platform,
    arch,
    cores: limits.cores ? Math.max(1, Math.min(hostCores, Math.floor(limits.cores))) : hostCores,
    cpu_model: cpus[0]?.model?.trim() ?? null,
    ram_gb: round1(limits.ram_gb ? Math.min(hostGb, limits.ram_gb) : hostGb),
    ...(limits.cores || limits.ram_gb ? { container: { cores: limits.cores ?? null, ram_gb: limits.ram_gb ? round1(limits.ram_gb) : null } } : {})
  };
}

/**
 * The cgroup CPU quota (in cores) and memory limit (GB), v2 then v1; a field
 * is missing when there is no limit or nothing can be read.
 * read(file) → text; it throws when the file is not there.
 */
export function containerLimits(read = (file) => readFileSync(file, "utf8")) {
  const text = (file) => { try { return read(file).trim(); } catch { return null; } };
  const out = {};
  const cpuMax = text("/sys/fs/cgroup/cpu.max");
  if (cpuMax) {
    const [quota, period] = cpuMax.split(/\s+/);
    if (quota !== "max" && Number(quota) > 0 && Number(period) > 0) out.cores = Number(quota) / Number(period);
  } else {
    const quota = Number(text("/sys/fs/cgroup/cpu/cpu.cfs_quota_us"));
    const period = Number(text("/sys/fs/cgroup/cpu/cpu.cfs_period_us"));
    if (quota > 0 && period > 0) out.cores = quota / period;
  }
  const memory = text("/sys/fs/cgroup/memory.max") ?? text("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  // v1 reports "no limit" as a number near 2^63.
  if (memory && memory !== "max" && Number(memory) > 0 && Number(memory) < 2 ** 60) out.ram_gb = Number(memory) / GB;
  return out;
}

/** Slot counts from cores and RAM by the starting rule. */
export function recommendSlots({ cores, ram_gb: ramGb }) {
  const byCores = Math.floor(cores / RULE.RENDER_CORES);
  const byRam = Math.floor((ramGb - RULE.BASE_GB) / RULE.RENDER_GB);
  return {
    plan: RULE.PLAN,
    "local-model": ramGb >= RULE.LOCAL_MODEL_TWO_AT_GB ? 2 : 1,
    render: Math.max(1, Math.min(byCores, byRam)),
    io: 1
  };
}

/** "render:1,plan:6" → {render: 1, plan: 6}. Throws on an unknown slot or a bad count. */
export function parseSlotOverrides(text) {
  const out = {};
  for (const part of String(text ?? "").split(",").map((entry) => entry.trim()).filter(Boolean)) {
    const [name, value] = part.split(":").map((entry) => entry.trim());
    if (!SLOT_KINDS.includes(name)) throw new Error(`LAUNCHCLIP_SLOTS: unknown slot "${name}"; use ${SLOT_KINDS.join(", ")}`);
    const count = Number(value);
    if (!Number.isInteger(count) || count < 1) throw new Error(`LAUNCHCLIP_SLOTS: ${name} needs a whole number of at least 1; got "${value}"`);
    out[name] = count;
  }
  return out;
}

/**
 * The slots in force: the rule, then library slots, then LAUNCHCLIP_SLOTS.
 * → {slots, sources: {<kind>: "rule" | "library" | "LAUNCHCLIP_SLOTS"}, recommended}
 */
export function resolveSlots({ machine = measureMachine(), env = process.env, librarySlots = null } = {}) {
  const recommended = recommendSlots(machine);
  const layers = [["library", librarySlots ?? {}], ["LAUNCHCLIP_SLOTS", parseSlotOverrides(env.LAUNCHCLIP_SLOTS)]];
  const slots = { ...recommended };
  const sources = Object.fromEntries(SLOT_KINDS.map((kind) => [kind, "rule"]));
  for (const [source, values] of layers) {
    for (const kind of SLOT_KINDS) {
      if (values[kind] == null) continue;
      slots[kind] = values[kind];
      sources[kind] = source;
    }
  }
  return { slots, sources, recommended };
}

/**
 * Cores for one render: the machine's cores split across the render slots,
 * at least 1. Passed to Remotion as --concurrency and HyperFrames as --workers.
 */
export function renderShare({ machine = measureMachine(), env = process.env, librarySlots = null } = {}) {
  const { slots } = resolveSlots({ machine, env, librarySlots });
  return Math.max(1, Math.floor(machine.cores / slots.render));
}

/** Best effort: Apple silicon GPU cores, or NVIDIA name and memory. null when nothing is found. */
export async function detectGpu({ platform = process.platform, run = execFileAsync } = {}) {
  try {
    if (platform === "darwin") {
      const { stdout } = await run("system_profiler", ["SPDisplaysDataType", "-json"], { timeout: 8000 });
      const display = JSON.parse(stdout)?.SPDisplaysDataType?.[0];
      if (!display) return null;
      const cores = Number(display.sppci_cores);
      return { name: display.sppci_model ?? display._name ?? "unknown", ...(Number.isFinite(cores) ? { cores } : {}), memory: "unified" };
    }
    const { stdout } = await run("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], { timeout: 8000 });
    const [name, memory] = String(stdout).split("\n")[0].split(",").map((entry) => entry.trim());
    return name ? { name, memory_gb: round1(Number(memory) / 1024) } : null;
  } catch {
    return null;
  }
}

/** launchclip doctor --capacity. */
export async function diagnoseCapacity({ env = process.env, librarySlots = null, machine = measureMachine(), gpu } = {}) {
  const detected = gpu === undefined ? await detectGpu({ platform: machine.platform }) : gpu;
  const { slots, sources, recommended } = resolveSlots({ machine, env, librarySlots });
  return {
    stage: "capacity",
    machine: { ...machine, gpu: detected },
    slots,
    sources,
    recommended,
    render_concurrency: Math.max(1, Math.floor(machine.cores / slots.render)),
    rule: `render = min(cores ÷ ${RULE.RENDER_CORES}, (RAM − ${RULE.BASE_GB} GB) ÷ ${RULE.RENDER_GB} GB), at least 1; local-model = 1, or 2 with ${RULE.LOCAL_MODEL_TWO_AT_GB} GB+; plan = ${RULE.PLAN}; io = 1 per disk`
  };
}

export function formatCapacity(report) {
  const { machine } = report;
  const gpu = machine.gpu ? `${machine.gpu.name}${machine.gpu.cores ? ` (${machine.gpu.cores} GPU cores)` : ""}${machine.gpu.memory_gb ? ` (${machine.gpu.memory_gb} GB)` : ""}` : "not detected";
  const lines = [
    `machine: ${machine.cores} cores, ${machine.ram_gb} GB RAM, GPU ${gpu}`,
    ...SLOT_KINDS.map((kind) => `  ${kind.padEnd(12)}${String(report.slots[kind]).padStart(2)}${report.sources[kind] === "rule" ? "" : `  (${report.sources[kind]}; rule says ${report.recommended[kind]})`}`),
    `each render uses ${report.render_concurrency} core${report.render_concurrency === 1 ? "" : "s"} (--concurrency overrides)`,
    `rule: ${report.rule}`
  ];
  return `${lines.join("\n")}\n`;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}
