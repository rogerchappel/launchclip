// A footage-led explainer the way a production run planned one, for a brand
// whose captions sit in the middle of the frame (kinetic-hierarchy, three
// words a line, position "middle", size 1.15, on 1080×1920; the layout check
// reports that band as 65,826 853×269). Its scenes put a title, a card and a
// label in that band:
//
//   open      a full-frame clip with a label in its bottom slot
//   boards    a diagram card in the middle of the frame
//   hardwood  a full-frame clip with a label at the top (clear of the band)
//   pine      footage over a text panel, the title at the seam
//   ask       a card with a question and a line under it
//   mix       a picture-in-picture with a list (a fixed layout)
//   wide      a photo with a line low in the frame (clear of the band)
//   stat      a figure beside its footage (a fixed layout)
//   end       a call to action
//
// Settled the way PR 573 did (captions hidden under each card) the captions
// were hidden for most of the narration.
import { DEFAULT_BRAND } from "@launchclip/core/planning-prompt.mjs";
import { STYLE_SCHEMA } from "@launchclip/core/style.mjs";

const CLIP = "assets/deck.mp4";
export const BAND_DURATION = 27;

/** The style pack a host application passes: captions in the middle of the frame by default. */
export function bandStyle({ position = "middle", size = 1.15 } = {}) {
  return { schema: STYLE_SCHEMA, name: "brand-look", captions: { preset: "kinetic-hierarchy", max_words: 3, position, size } };
}

/** The storyboard; change(scenes) → the scenes to use instead. */
export function bandStory(change = (scenes) => scenes) {
  const scene = (id, module, start, params) => ({ id, module, start, end: start + 3, energy: 1, params });
  return {
    schema: "launchclip.story.v1", title: "Three deck boards", lane: "motion", style: "brand-look",
    format: { width: 1080, height: 1920, fps: 30, duration: BAND_DURATION }, brand: DEFAULT_BRAND, grammar: "editorial",
    scenes: change([
      scene("open", "clip", 0, { media: CLIP, callouts: [{ text: "Three deck boards" }] }),
      scene("boards", "process-steps", 3, { title: "Three deck boards", steps: ["Hardwood", "Treated pine", "Composite"] }),
      scene("hardwood", "clip", 6, { media: CLIP, callouts: [{ text: "Hardwood" }], position: "top" }),
      scene("pine", "split-screen", 9, { media: CLIP, title: "Treated pine", body: "Protective treatment" }),
      scene("ask", "concept-card", 12, { text: "Suitable for decking?", sub: "Check with the supplier." }),
      scene("mix", "picture-in-picture", 15, { media: CLIP, title: "Composite can mix", items: ["Wood fibres", "Plastics"] }),
      scene("wide", "photo-scene", 18, { media: "assets/deck.jpg", lines: [{ text: "When to reapply?" }] }),
      scene("stat", "media-stat", 21, { media: CLIP, value: "25 yrs", label: "Hardwood life" }),
      scene("end", "cta", 24, { action: "Save this for later", handle: "example.com/decks" })
    ])
  };
}

/** A narration spoken evenly from start to end: three words a second. */
export const BAND_WORDS = Array.from({ length: BAND_DURATION * 3 }, (_, index) => ({ text: `word${index}`, start: Math.round((index / 3) * 1000) / 1000, end: Math.round((index / 3 + 0.3) * 1000) / 1000 }));
