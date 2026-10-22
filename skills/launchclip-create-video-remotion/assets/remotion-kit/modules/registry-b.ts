// Remotion components for the batch B editorial kinds
// (docs/KIT_CONTRACTS.md, "Emitters and components").
import type React from "react";
import { AudienceGrid } from "./AudienceGrid";
import { CodeSnippet } from "./CodeSnippet";
import { DateCard } from "./DateCard";
import { ExcerptWindow } from "./ExcerptWindow";
import { FocusFlow } from "./FocusFlow";
import { MediaWindow } from "./MediaWindow";
import { StatusRack } from "./StatusRack";

export const COMPONENTS: Record<string, React.FC<{ model: any }>> = {
  "media-window": MediaWindow,
  "code-snippet": CodeSnippet,
  "excerpt-window": ExcerptWindow,
  "focus-flow": FocusFlow,
  "date-card": DateCard,
  "status-rack": StatusRack,
  "audience-grid": AudienceGrid
};
