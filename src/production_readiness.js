export const CINEMATIC_READINESS_VERSION = "launchclip.cinematic-readiness.v1";

const STRUCTURAL_MOTION_CATEGORIES = new Set(["duration", "dimensions", "frames"]);

export function assessCinematicReadiness({ plan, verification, motion, audio, critique, assembly } = {}, options = {}) {
  const blockers = [];
  const repairFindings = [];
  const verificationOk = Boolean(verification && new Set(["ready", "passed"]).has(verification.status));
  if (!verification) blockers.push(blocker("verification-missing", "verification", "Native verification receipt is missing."));
  else if (!verificationOk) blockers.push(blocker("verification-failed", "verification", `Native verification is ${verification.status ?? "unknown"}: ${(verification.failed ?? []).join(", ") || "unspecified failure"}.`));

  const motionFindings = Array.isArray(motion?.quality?.findings) ? motion.quality.findings : [];
  const motionOk = motion?.quality?.ok === true;
  if (!motion?.quality) blockers.push(blocker("motion-missing", "motion", "Rendered motion analysis is missing."));
  for (const [index, finding] of motionFindings.entries()) {
    const category = String(finding.category ?? "motion");
    if (STRUCTURAL_MOTION_CATEGORIES.has(category)) {
      blockers.push(blocker(`motion-${category}-${index + 1}`, "motion", String(finding.message ?? `Structural motion gate failed: ${category}.`)));
      continue;
    }
    repairFindings.push(qualityFinding({
      id: `readiness-motion-${index + 1}`,
      severity: finding.severity,
      category: category === "editing" ? "timing" : "motion",
      repairScope: "plan",
      evidence: String(finding.message ?? `Motion gate failed: ${category}.`),
      instruction: motionInstruction(category, finding.message)
    }));
  }
  if (motion?.quality && !motionOk && !motionFindings.length) blockers.push(blocker("motion-unexplained", "motion", "Rendered motion analysis failed without actionable findings."));

  const audioFindings = Array.isArray(audio?.quality?.findings) ? audio.quality.findings : [];
  const audioOk = audio?.quality?.ok === true;
  if (!audio?.quality) blockers.push(blocker("audio-missing", "audio", "Rendered audio analysis is missing."));
  for (const [index, finding] of audioFindings.entries()) {
    repairFindings.push(qualityFinding({
      id: `readiness-audio-${index + 1}`,
      severity: finding.severity,
      category: "audio",
      repairScope: "audio",
      evidence: String(finding.message ?? `Audio gate failed: ${finding.category ?? "audio"}.`),
      instruction: `Repair the ${finding.category ?? "audio"} mix failure, regenerate the affected audio assets or mix, and verify the rendered master again.`
    }));
  }
  if (audio?.quality && !audioOk && !audioFindings.length) blockers.push(blocker("audio-unexplained", "audio", "Rendered audio analysis failed without actionable findings."));

  const criticOk = critique?.verdict === "ship";
  if (!critique) blockers.push(blocker("critic-missing", "critic", "Independent visual critique is missing."));
  else if (!criticOk && !new Set(["repair", "replan"]).has(critique.verdict)) blockers.push(blocker("critic-unavailable", "critic", `Independent visual critique is ${critique.verdict ?? "unavailable"}.`));

  const fallbackCount = Number(assembly?.fallback_count ?? assembly?.fallbacks?.length ?? 0);
  const fallbackOk = options.zeroFallbacks === false || fallbackCount === 0;
  if (!fallbackOk) {
    const shotIds = [...new Set((assembly?.fallbacks ?? []).map((entry) => entry.shot_id).filter(Boolean))];
    repairFindings.push(qualityFinding({
      id: "readiness-fallbacks",
      severity: "blocking",
      category: "mount",
      repairScope: "frames",
      shotIds,
      evidence: `${fallbackCount} deterministic frame fallback${fallbackCount === 1 ? "" : "s"} remain in the assembled film.`,
      instruction: "Replace every deterministic fallback with a verified model-authored scene, then rebuild both adjacent boundaries."
    }));
  }
  if (!plan) blockers.push(blocker("plan-missing", "plan", "Production plan is missing."));

  const gates = {
    plan: gate(Boolean(plan), plan ? "present" : "missing", 0),
    verification: gate(verificationOk, verification?.status ?? "missing", verification?.failed?.length ?? 0),
    motion: gate(motionOk, motion?.quality ? motionOk ? "passed" : "failed" : "missing", motionFindings.length),
    audio: gate(audioOk, audio?.quality ? audioOk ? "passed" : "failed" : "missing", audioFindings.length),
    critic: gate(criticOk, critique?.verdict ?? "missing", Array.isArray(critique?.findings) ? critique.findings.length : Number(critique?.findings ?? 0)),
    fallbacks: gate(fallbackOk, fallbackOk ? "passed" : "failed", fallbackCount)
  };
  const ok = Object.values(gates).every((entry) => entry.ok) && blockers.length === 0 && repairFindings.length === 0;
  return {
    schema_version: CINEMATIC_READINESS_VERSION,
    status: ok ? "ready" : "needs-repair",
    ok,
    gates,
    repair_findings: repairFindings,
    blockers
  };
}

function qualityFinding({ id, severity, category, repairScope, shotIds = [], evidence, instruction }) {
  return {
    id,
    severity: new Set(["blocking", "major", "minor"]).has(severity) ? severity : "major",
    category,
    shot_ids: shotIds,
    start_seconds: null,
    end_seconds: null,
    evidence,
    repair_scope: repairScope,
    instruction,
    preserve: ["approved narration", "grounded factual claims", "verified neighboring sequences"]
  };
}

function motionInstruction(category, message) {
  if (category === "hook") return "Replan the opening so multiple meaningful visual changes land inside the hook window and directly express the spoken promise.";
  if (category === "editing") return "Replan sequence boundaries and internal developments to remove inactive gaps without turning the film into a slideshow.";
  return `Replan material object, camera, and transition developments to resolve this measured motion failure: ${message ?? category}.`;
}

function blocker(id, gateName, message) {
  return { id, gate: gateName, message };
}

function gate(ok, status, findings) {
  return { ok: Boolean(ok), status, findings: Number(findings ?? 0) };
}
