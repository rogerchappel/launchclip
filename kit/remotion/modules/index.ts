// Merged Remotion module registry: editorial kinds (registry-a, registry-b)
// plus catalogue modules (../catalog/registry-a, registry-b, registry-c, registry-d).
// Each component takes {model} (kit/core/modules.mjs resolveModule) and draws
// at absolute canvas coordinates inside a full-canvas AbsoluteFill.
import type React from "react";
import { COMPONENTS as EDITORIAL_A } from "./registry-a";
import { COMPONENTS as EDITORIAL_B } from "./registry-b";
import { COMPONENTS as CATALOG_A } from "../catalog/registry-a";
import { COMPONENTS as CATALOG_B } from "../catalog/registry-b";
import { COMPONENTS as CATALOG_C } from "../catalog/registry-c";
import { COMPONENTS as CATALOG_D } from "../catalog/registry-d";

export type ModuleComponent = React.FC<{ model: any }>;

export const MODULE_COMPONENTS: Record<string, ModuleComponent> = {
  ...(CATALOG_A as Record<string, ModuleComponent>),
  ...(CATALOG_B as Record<string, ModuleComponent>),
  ...(CATALOG_C as Record<string, ModuleComponent>),
  ...(CATALOG_D as Record<string, ModuleComponent>),
  ...(EDITORIAL_A as Record<string, ModuleComponent>),
  ...(EDITORIAL_B as Record<string, ModuleComponent>)
};

export function moduleComponent(id: string): ModuleComponent | null {
  return Object.prototype.hasOwnProperty.call(MODULE_COMPONENTS, id) ? MODULE_COMPONENTS[id] : null;
}
