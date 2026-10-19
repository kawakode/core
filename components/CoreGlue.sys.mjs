/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Initialisation de Core au démarrage, avant la première fenêtre.
// C'est l'équivalent, en très réduit, du BrowserGlue de Firefox.

export function CoreGlue() {}

CoreGlue.prototype = {
  QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),

  observe(subject, topic) {
    if (topic != "profile-after-change") {
      return;
    }
    // Importer ActorManagerParent enregistre les acteurs de toolkit/ :
    // pages d'erreur, listes déroulantes, autocomplétion de formulaires,
    // sélecteurs de date et de couleur, etc.
    ChromeUtils.importESModule(
      "resource://gre/modules/ActorManagerParent.sys.mjs"
    );
    // Présentation et réponse par défaut de la page de certificat invalide.
    ChromeUtils.registerWindowActor("CoreCertError", {
      child: {
        esModuleURI: "resource:///modules/CoreCertErrorChild.sys.mjs",
        events: {
          DOMDocElementInserted: {},
          AboutNetErrorLoad: { wantUntrusted: true },
        },
      },
      matches: ["about:certerror?*"],
    });
  },
};
