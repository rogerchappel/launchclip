import { analyzeRenderMotion } from "../src/render_motion_analysis.js";
const m = await analyzeRenderMotion(process.argv[2]);
const mm = m.motion;
console.log(JSON.stringify({ still_share: mm.still_share, longest: mm.longest_still_seconds, camera_moves: mm.camera_moves, p50: mm.change_energy?.p50, per_second: mm.energy_per_second ?? m.stillness?.energy_per_second, spans: (mm.still_spans ?? []).slice(0, 12) }));
console.log(Object.keys(m), Object.keys(mm));
