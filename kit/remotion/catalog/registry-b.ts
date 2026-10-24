// Catalogue B Remotion components, keyed by module id (docs/KIT_CONTRACTS.md, "Wave 2").
import type React from 'react';
import {LogoRow} from './LogoRow';
import {ArchiveCard} from './ArchiveCard';
import {ProcessSteps} from './ProcessSteps';
import {FlowCompare} from './FlowCompare';
import {GaugeCompare} from './GaugeCompare';
import {FunctionChart} from './FunctionChart';
import {BrandLockup} from './BrandLockup';

export const COMPONENTS: Record<string, React.FC<{model: any}>> = {
  'logo-row': LogoRow,
  'archive-card': ArchiveCard,
  'process-steps': ProcessSteps,
  'flow-compare': FlowCompare,
  'gauge-compare': GaugeCompare,
  'function-chart': FunctionChart,
  'brand-lockup': BrandLockup,
};
