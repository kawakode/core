/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Remplace le module BuiltInThemes de Firefox, que about:addons importe
// depuis resource:///modules/. Core n'embarque aucun thème.

export const BuiltInThemes = {
  async ensureBuiltInThemes() {},

  previewForBuiltInThemeId() {
    return null;
  },
};
