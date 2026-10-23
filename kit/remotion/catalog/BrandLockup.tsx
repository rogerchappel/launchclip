// BrandLockup (brand-lockup): title and end cards from the brand's logo mark,
// wordmark, badge and URL. Frame-pure; see CatalogB.tsx for the shared tree
// renderer and evaluator.
import React from 'react';
import {CatalogBModule} from './CatalogB';

export const BrandLockup: React.FC<{model: any}> = ({model}) => {
  if (model.module !== 'brand-lockup') throw new Error(`BrandLockup expects a brand-lockup model, got ${model.module}`);
  return <CatalogBModule model={model} />;
};
