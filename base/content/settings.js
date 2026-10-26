/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Fenêtre de réglages : sandbox des processus de contenu, barre de titre,
// historique et réponse par défaut aux certificats invalides.

const SANDBOX_PREF = "security.sandbox.content.level";

const gSandbox = {
  init() {
    let { AppConstants } = ChromeUtils.importESModule(
      "resource://gre/modules/AppConstants.sys.mjs"
    );
    let checkbox = document.getElementById("sandbox");

    if (!AppConstants.MOZ_SANDBOX) {
      checkbox.checked = false;
      checkbox.disabled = true;
      this.note("Cette version de Core a été compilée sans sandbox.");
      return;
    }

    // Gecko impose un niveau minimum sous Windows : on ne peut pas la couper.
    if (AppConstants.platform == "win") {
      checkbox.checked = true;
      checkbox.disabled = true;
      this.note("Toujours active sous Windows.");
      return;
    }
    if (AppConstants.platform == "macosx") {
      this.note("Désactivée, une protection réduite reste en place sous macOS.");
    }

    // Activée = niveau par défaut de core.js ; désactivée = valeur utilisateur 0.
    checkbox.checked = Services.prefs.getIntPref(SANDBOX_PREF, 0) > 0;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        Services.prefs.clearUserPref(SANDBOX_PREF);
      } else {
        Services.prefs.setIntPref(SANDBOX_PREF, 0);
      }
      document.getElementById("restart-needed").hidden = false;
    });
  },

  note(text) {
    let platform = document.getElementById("sandbox-platform");
    platform.textContent = text;
    platform.hidden = false;
  },
};

// Réponse par défaut à un certificat invalide (CoreCertErrorChild).
const gCertError = {
  PREF: "core.certerrors.default",

  init() {
    let value = Services.prefs.getStringPref(this.PREF, "ask");
    for (let radio of document.querySelectorAll("input[name=certerror]")) {
      radio.checked = radio.value == value;
      radio.addEventListener("change", () => {
        if (radio.value == "ask") {
          Services.prefs.clearUserPref(this.PREF);
        } else {
          Services.prefs.setStringPref(this.PREF, radio.value);
        }
      });
    }
  },
};

// Enregistrement de l'historique (Places).
const gHistory = {
  PREF: "places.history.enabled",

  init() {
    let checkbox = document.getElementById("history");
    checkbox.checked = Services.prefs.getBoolPref(this.PREF, true);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        Services.prefs.clearUserPref(this.PREF);
      } else {
        Services.prefs.setBoolPref(this.PREF, false);
      }
    });
  },
};

// Barre de titre du système plutôt que celle de Core (onglets dans la barre
// de titre). Décoché, on revient au choix par défaut du système.
const gTitlebar = {
  PREF: "browser.tabs.inTitlebar",

  init() {
    let checkbox = document.getElementById("system-titlebar");
    checkbox.checked = !Services.appinfo.drawInTitlebar;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        Services.prefs.setIntPref(this.PREF, 0);
      } else {
        Services.prefs.clearUserPref(this.PREF);
        if (!Services.appinfo.drawInTitlebar) {
          Services.prefs.setIntPref(this.PREF, 1);
        }
      }
    });
  },
};

window.addEventListener(
  "load",
  () => {
    gSandbox.init();
    gTitlebar.init();
    gCertError.init();
    gHistory.init();
    document.getElementById("restart").addEventListener("click", () => {
      Services.startup.quit(
        Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart
      );
    });
  },
  { once: true }
);
