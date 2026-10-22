// ArchiveCard (archive-card): Paper archive plate or quote card with source line and stamp slam.
// Frame-pure; see CatalogB.tsx for the shared tree renderer and evaluator.
import React from 'react';
import {CatalogBModule} from './CatalogB';

export const ArchiveCard: React.FC<{model: any}> = ({model}) => {
  if (model.module !== 'archive-card') throw new Error(`ArchiveCard expects a archive-card model, got ${model.module}`);
  return <CatalogBModule model={model} />;
};
