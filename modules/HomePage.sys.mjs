/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Remplace le module HomePage de Firefox, que toolkit/ attend à cette
// adresse (resource:///modules/HomePage.sys.mjs). Seul ce qui est appelé
// depuis toolkit/ est fourni.

const HOMEPAGE_PREF = "core.homepage";

export const HomePage = {
  get() {
    return Services.prefs.getStringPref(HOMEPAGE_PREF, "about:blank");
  },

  // Page de repli du bouton « Retour » d'une page d'erreur de certificat
  // quand l'onglet n'a pas d'historique (toolkit/actors/NetErrorParent).
  getForErrorPage() {
    return this.get();
  },
};
