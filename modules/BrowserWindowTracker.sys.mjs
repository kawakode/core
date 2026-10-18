/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Remplace le BrowserWindowTracker de Firefox, que toolkit/ importe depuis
// resource:///modules/ (historique Places, gestionnaire de mots de passe,
// téléchargements, extensions). Seul le nécessaire est fourni.

const WINDOW_TYPE = "navigator:browser";

function* windows() {
  for (let win of Services.wm.getEnumerator(WINDOW_TYPE)) {
    if (!win.closed && win.gTabs) {
      yield win;
    }
  }
}

export const BrowserWindowTracker = {
  QueryInterface: ChromeUtils.generateQI(["nsIBrowserWindowTracker"]),

  // Core n'a pas de navigation privée : les options de Firefox
  // (private, allowPopups…) sont ignorées.
  getTopWindow() {
    return Services.wm.getMostRecentWindow(WINDOW_TYPE);
  },

  get orderedWindows() {
    return [...windows()];
  },

  getAllVisibleTabs() {
    let tabs = [];
    for (let win of windows()) {
      for (let entry of win.gTabs.list) {
        if (entry.browser) {
          tabs.push({
            QueryInterface: ChromeUtils.generateQI(["nsIVisibleTab"]),
            contentTitle: entry.browser.contentTitle,
            browserId: entry.browser.browserId,
          });
        }
      }
    }
    return tabs;
  },

  getBrowserById(browserId) {
    for (let win of windows()) {
      for (let entry of win.gTabs.list) {
        if (entry.browser?.browserId == browserId) {
          return entry.browser;
        }
      }
    }
    return null;
  },
};
