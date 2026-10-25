// World module Remotion component, keyed by module id
// (docs/KIT_CONTRACTS.md, "World module").
import type React from 'react';
import {World} from './CatalogWorld';

export const COMPONENTS: Record<string, React.FC<{model: any}>> = {
  'world': World,
};
