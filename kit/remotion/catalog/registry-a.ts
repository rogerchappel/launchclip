// Catalogue A components keyed by module id (docs/KIT_CONTRACTS.md, "Wave 2").
// Each takes {model} from MODULES[id].resolve() in kit/core/catalog-a.mjs and
// draws at absolute canvas coordinates inside a full-canvas AbsoluteFill.
import type React from "react";
import { CountUp } from "./CountUp";
import { Cta } from "./Cta";
import { EquationLockup } from "./EquationLockup";
import { HookTitle } from "./HookTitle";
import { KineticWords } from "./KineticWords";

export const COMPONENTS: Record<string, React.FC<{ model: any }>> = {
  "hook-title": HookTitle,
  "kinetic-words": KineticWords,
  "count-up": CountUp,
  "equation-lockup": EquationLockup,
  cta: Cta
};
