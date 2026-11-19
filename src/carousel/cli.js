// launchclip carousel <action>: one module per stage (docs/CAROUSELS_RFC.md §11).
// Each stage module exports run(target, flags, io) and returns its report.

const STAGES = {
  make: "./make.js",
  render: "./render.js",
  check: "./check.js",
  export: "./export.js"
};

export async function runCarouselCommand(action, target, flags, io) {
  if (!STAGES[action]) throw new Error(`launchclip carousel needs an action: launchclip carousel make "<brief>" | render|check|export <project>${action ? ` (got ${action})` : ""}`);
  if (!target) throw new Error(`launchclip carousel ${action} needs ${action === "make" ? 'a brief: launchclip carousel make "<brief>"' : "a project path"}`);
  const { run } = await import(STAGES[action]);
  return run(target, flags, io);
}
