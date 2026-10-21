/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// API côté processus des extensions (pages d'arrière-plan, popups, options).
extensions.registerModules({
  // Nom différent des deux espaces de noms, à cause des permissions (comme
  // dans Firefox).
  menusInternal: {
    url: "chrome://core/content/extensions/child/ext-menus.js",
    scopes: ["addon_child"],
    paths: [["contextMenus"], ["menus"]],
  },
  tabs: {
    url: "chrome://core/content/extensions/child/ext-tabs.js",
    scopes: ["addon_child"],
    paths: [["tabs"]],
  },
});
