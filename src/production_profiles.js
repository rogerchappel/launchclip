export const PRODUCTION_PROFILE_VERSION = "launchclip.production-profile.v1";

const PROFILE_IDS = new Set(["standard", "cinematic"]);

// YouTube normalizes playback to roughly -14 LUFS; a -1 dBTP ceiling leaves
// headroom for inter-sample peaks introduced by the platform's AAC/Opus encode.
export const PLATFORM_LOUDNESS = Object.freeze({ integrated_lufs: -14, tolerance_lu: 1.5, true_peak_dbtp: -1 });

// Fractions of a 9:16 frame covered by the Shorts player chrome: title, channel,
// and audio row along the bottom; like/comment/share rail on the right.
export const SHORTS_SAFE_ZONE = Object.freeze({ top: 0.09, right: 0.13, bottom: 0.22, left: 0.05 });

export function resolveDeliveryProfile({ aspect, durationSeconds = 60 } = {}) {
  const orientation = String(aspect?.orientation ?? "landscape");
  const portraitShort = orientation === "portrait" && Number(durationSeconds) <= 60;
  return {
    platform: portraitShort ? "youtube-shorts" : "youtube",
    loudness: PLATFORM_LOUDNESS,
    captions: portraitShort ? { mode: "word-highlight", default: true, words_per_chunk: [1, 3], zone: "upper-lower-third" } : { mode: "requested-only", default: false },
    safe_zone: portraitShort ? SHORTS_SAFE_ZONE : { top: 0.05, right: 0.05, bottom: 0.1, left: 0.05 },
    loop_ending: portraitShort,
    recommended_duration_seconds: portraitShort ? [25, 35] : null,
    upload: portraitShort ? { width: 1440, height: 2560, minimum_fps: 30, preferred_fps_for_kinetic_type: 60 } : null
  };
}

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
      delivery: resolveDeliveryProfile({ aspect, durationSeconds }),
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
    delivery: resolveDeliveryProfile({ aspect, durationSeconds }),
    readiness: {
      maximum_repair_passes: 3,
      required_receipts: ["concepts", "story", "narration", "plan", "frames", "motion", "audio", "verification", "critic"]
    }
  };
}
