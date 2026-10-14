/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { MirrorSystem } from './mirror-system.js';
import { installAgent } from './agent.js';
import { startBeacon } from './beacon.js';
import { session } from './session.js';
import { setupScreen } from './setup.js';

// Handle for teammates and agents: `mirrorCoach.agent.help()` in the console (see agent.ts).
(window as unknown as { mirrorCoach: typeof session }).mirrorCoach = session;
installAgent();
startBeacon();

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(MirrorSystem);
  setupScreen(world);
});
