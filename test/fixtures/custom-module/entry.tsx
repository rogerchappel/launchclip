// A project's Remotion entry with a custom module registered, as
// kit/remotion/Root.tsx describes (test/custom_module_parity.test.js).
import React from 'react';
import {registerRoot} from 'remotion';
import {LaunchclipCompositions} from '../../../kit/remotion/Root';
import SignalLabel from './project/remotion/SignalLabel';

registerRoot(() => <LaunchclipCompositions customModules={{SignalLabel}} />);
