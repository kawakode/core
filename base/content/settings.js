/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Fenêtre de réglages : sandbox des processus de contenu et réponse par
// défaut aux certificats invalides.

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

window.addEventListener(
  "load",
  () => {
    gSandbox.init();
    gCertError.init();
    document.getElementById("restart").addEventListener("click", () => {
      Services.startup.quit(
        Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart
      );
    });
  },
  { once: true }
);
