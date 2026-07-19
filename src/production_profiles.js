export const PRODUCTION_PROFILE_VERSION = "launchclip.production-profile.v1";

const PROFILE_IDS = new Set(["standard", "cinematic"]);

export function resolveProductionProfile(value = "standard", { aspect, durationSeconds = 60 } = {}) {
  const id = String(value ?? "standard").trim().toLowerCase();
  if (!PROFILE_IDS.has(id)) throw new Error(`Unsupported --profile: ${value}. Use standard or cinematic.`);

  const orientation = String(aspect?.orientation ?? "landscape");
  const shortForm = Number(durationSeconds) <= 60;
  const lane = shortForm ? `${orientation}-short` : `${orientation}-long`;

  if (id === "standard") {
    return {
      schema_version: PRODUCTION_PROFILE_VERSION,
      id,
      lane,
      one_shot: false,
      planning: {
        concept_candidates: 1,
        independent_concept_judge: false,
        separate_story_pass: false,
        narration_timing_before_edit: false,
        require_frame_blueprints: false
      },
      craft: null,
      readiness: {
        maximum_repair_passes: 2,
        required_receipts: []
      }
    };
  }

  const portraitShort = orientation === "portrait" && shortForm;
  const landscapeShort = orientation === "landscape" && shortForm;
  return {
    schema_version: PRODUCTION_PROFILE_VERSION,
    id,
    lane,
    one_shot: true,
    planning: {
      concept_candidates: 5,
      independent_concept_judge: true,
      separate_story_pass: true,
      narration_timing_before_edit: true,
      require_frame_blueprints: true
    },
    craft: {
      target_wpm_minimum: portraitShort ? 165 : landscapeShort ? 150 : 145,
      target_wpm_maximum: portraitShort ? 180 : landscapeShort ? 170 : 165,
      promise_by_seconds: portraitShort ? 1 : 2,
      proof_by_seconds: portraitShort ? 3 : landscapeShort ? 6 : 8,
      hook_window_seconds: 4,
      minimum_hook_material_changes: portraitShort ? 3 : 2,
      maximum_material_change_gap_seconds: portraitShort ? 2 : landscapeShort ? 3 : 4,
      maximum_visual_register_seconds: portraitShort ? 5 : landscapeShort ? 8 : 10,
      minimum_visual_registers: portraitShort ? 5 : 4,
      maximum_text_only_ratio: 0.1
    },
    readiness: {
      maximum_repair_passes: 3,
      required_receipts: ["plan", "frames", "motion", "audio", "verification", "critic"]
    }
  };
}
