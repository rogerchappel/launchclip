// @launchclip/remotion: LaunchClip's Remotion kit for apps that render stories
// in their own Remotion bundle or @remotion/player. The kit reads only its
// props (a resolved launchclip.story.v1 story) and the app's asset resolver,
// never LaunchClip CLI state. README.md has the setup; docs/KIT_CONTRACTS.md
// ("The @launchclip/remotion package") the contract.
export { DEFAULT_STORY, LaunchclipCompositions } from "./compositions";
export {
  StoryComposition, ModuleReview, calculateStoryMetadata, calculateModuleReviewMetadata,
  loadStoryCaptions, resolveSceneElement
} from "./StoryComposition";
export type { CustomModuleProps, ModuleReviewProps, StoryProps } from "./StoryComposition";
export { SceneOverlay, calculateSceneOverlayMetadata, sceneOverlayWindow } from "./SceneOverlay";
export type { SceneOverlayProps } from "./SceneOverlay";
export { storyPlayerProps } from "./player";
export type { StoryPlayerProps } from "./player";
export { assetUrl, setAssetResolver } from "./media";
export type { AssetResolver } from "./media";
export { FONT_FACES, ensureFonts, registerFontFiles } from "./fonts";
export type { FontStacks } from "./fonts";
export { WEBGL_MODULES, moduleNeedsWebGL, storyWebGLModules } from "./webgl";
export { MODULE_COMPONENTS, moduleComponent } from "./modules";
export type { ModuleComponent } from "./modules";
export { WordCaptions } from "./captions/WordCaptions";
export type { CaptionChunk, CaptionWord, WordCaptionsProps } from "./captions/WordCaptions";
export { BrandFrame } from "./frame/BrandFrame";
export { SceneStartFrame, sceneSeconds, useSceneTime } from "./clock";

// The registries MODULE_COMPONENTS merges, one per catalogue (module id →
// component taking {model} from @launchclip/core resolveModule).
export { COMPONENTS as EDITORIAL_COMPONENTS_A } from "./modules/registry-a";
export { COMPONENTS as EDITORIAL_COMPONENTS_B } from "./modules/registry-b";
export { COMPONENTS as CATALOG_COMPONENTS_A } from "./catalog/registry-a";
export { COMPONENTS as CATALOG_COMPONENTS_B } from "./catalog/registry-b";
export { COMPONENTS as CATALOG_COMPONENTS_C } from "./catalog/registry-c";
export { COMPONENTS as CATALOG_COMPONENTS_D } from "./catalog/registry-d";
export { COMPONENTS as CATALOG_COMPONENTS_E } from "./catalog/registry-e";
export { COMPONENTS as CATALOG_COMPONENTS_F } from "./catalog/registry-f";
export { COMPONENTS as CATALOG_COMPONENTS_G } from "./catalog/registry-g";
export { COMPONENTS as CATALOG_COMPONENTS_H } from "./catalog/registry-h";
export { COMPONENTS as CHARACTER_COMPONENTS } from "./catalog/registry-characters";
export { COMPONENTS as WORLD_COMPONENTS } from "./catalog/registry-world";
