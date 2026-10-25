// Merged Remotion module registry: editorial kinds (registry-a, registry-b)
// plus catalogue modules (../catalog/registry-a, registry-b, registry-c, registry-d, registry-e, registry-f, registry-g, registry-h), the character modules (../catalog/registry-characters) and the world module (../catalog/registry-world).
// Each component takes {model} (kit/core/modules.mjs resolveModule) and draws
// at absolute canvas coordinates inside a full-canvas AbsoluteFill.
import type React from "react";
import { COMPONENTS as EDITORIAL_A } from "./registry-a";
import { COMPONENTS as EDITORIAL_B } from "./registry-b";
import { COMPONENTS as CATALOG_A } from "../catalog/registry-a";
import { COMPONENTS as CATALOG_B } from "../catalog/registry-b";
import { COMPONENTS as CATALOG_C } from "../catalog/registry-c";
import { COMPONENTS as CATALOG_D } from "../catalog/registry-d";
import { COMPONENTS as CATALOG_E } from "../catalog/registry-e";
import { COMPONENTS as CATALOG_F } from "../catalog/registry-f";
import { COMPONENTS as CATALOG_G } from "../catalog/registry-g";
import { COMPONENTS as CATALOG_H } from "../catalog/registry-h";
import { COMPONENTS as CHARACTERS } from "../catalog/registry-characters";
import { COMPONENTS as WORLD } from "../catalog/registry-world";

export type ModuleComponent = React.FC<{ model: any }>;

export const MODULE_COMPONENTS: Record<string, ModuleComponent> = {
  ...(CATALOG_A as Record<string, ModuleComponent>),
  ...(CATALOG_B as Record<string, ModuleComponent>),
  ...(CATALOG_C as Record<string, ModuleComponent>),
  ...(CATALOG_D as Record<string, ModuleComponent>),
  ...(CATALOG_E as Record<string, ModuleComponent>),
  ...(CATALOG_F as Record<string, ModuleComponent>),
  ...(CATALOG_G as Record<string, ModuleComponent>),
  ...(CATALOG_H as Record<string, ModuleComponent>),
  ...(CHARACTERS as Record<string, ModuleComponent>),
  ...(WORLD as Record<string, ModuleComponent>),
  ...(EDITORIAL_A as Record<string, ModuleComponent>),
  ...(EDITORIAL_B as Record<string, ModuleComponent>)
};

export function moduleComponent(id: string): ModuleComponent | null {
  return Object.prototype.hasOwnProperty.call(MODULE_COMPONENTS, id) ? MODULE_COMPONENTS[id] : null;
}
