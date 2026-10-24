// Catalogue E Remotion components (product moments around the presenter),
// keyed by module id (docs/KIT_CONTRACTS.md, "Catalogue E").
import type React from 'react';
import {AppStage, BackdropSwap, FeedFrame, PhoneStage, PullBack} from './CatalogE';

export const COMPONENTS: Record<string, React.FC<{model: any}>> = {
  'feed-frame': FeedFrame,
  'pull-back': PullBack,
  'backdrop-swap': BackdropSwap,
  'app-stage': AppStage,
  'phone-stage': PhoneStage,
};
