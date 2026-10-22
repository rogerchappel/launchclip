// LogoRow (logo-row): Local logos with labels that pop in on a stagger.
// Frame-pure; see CatalogB.tsx for the shared tree renderer and evaluator.
import React from 'react';
import {CatalogBModule} from './CatalogB';

export const LogoRow: React.FC<{model: any}> = ({model}) => {
  if (model.module !== 'logo-row') throw new Error(`LogoRow expects a logo-row model, got ${model.module}`);
  return <CatalogBModule model={model} />;
};
