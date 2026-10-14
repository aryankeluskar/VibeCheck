/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { defineAssets } from '@iwsdk/core';

// The mirror coach builds its panels procedurally (canvas + video textures)
// in src/panels.ts, so no authored assets are registered yet.
export default defineAssets({});
