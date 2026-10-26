/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Fenêtre de réglages : sandbox des processus de contenu, barre de titre,
// téléchargements et réponse par défaut aux certificats invalides.

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

// Téléchargements : où la liste s'affiche (downloads.js) et où les fichiers
// sont enregistrés (préférences de toolkit/components/downloads).
const gDownloads = {
  DISPLAY_PREF: "core.downloads.display",
  USE_DIR_PREF: "browser.download.useDownloadDir",
  FOLDER_LIST_PREF: "browser.download.folderList",
  DIR_PREF: "browser.download.dir",

  init() {
    let display = Services.prefs.getStringPref(this.DISPLAY_PREF, "panel");
    for (let radio of document.querySelectorAll("input[name=downloads-display]")) {
      radio.checked = radio.value == display;
      radio.addEventListener("change", () => {
        if (radio.value == "panel") {
          Services.prefs.clearUserPref(this.DISPLAY_PREF);
        } else {
          Services.prefs.setStringPref(this.DISPLAY_PREF, radio.value);
        }
      });
    }

    let useDir = Services.prefs.getBoolPref(this.USE_DIR_PREF, true);
    for (let radio of document.querySelectorAll("input[name=downloads-dir]")) {
      radio.checked = (radio.value == "dir") == useDir;
      radio.addEventListener("change", () => {
        if (radio.value == "dir") {
          Services.prefs.clearUserPref(this.USE_DIR_PREF);
        } else {
          Services.prefs.setBoolPref(this.USE_DIR_PREF, false);
        }
      });
    }
    document.getElementById("downloads-dir-change").addEventListener("click", event => {
      event.preventDefault();
      this.chooseFolder();
    });
    this.showFolder();
  },

  async showFolder() {
    let { Downloads } = ChromeUtils.importESModule(
      "resource://gre/modules/Downloads.sys.mjs"
    );
    document.getElementById("downloads-dir-path").textContent =
      await Downloads.getPreferredDownloadsDirectory();
  },

  chooseFolder() {
    let picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    picker.init(window.browsingContext, "Dossier des téléchargements", Ci.nsIFilePicker.modeGetFolder);
    picker.open(result => {
      if (result != Ci.nsIFilePicker.returnOK) {
        return;
      }
      Services.prefs.setComplexValue(this.DIR_PREF, Ci.nsIFile, picker.file);
      Services.prefs.setIntPref(this.FOLDER_LIST_PREF, 2);
      Services.prefs.clearUserPref(this.USE_DIR_PREF);
      document.querySelector("input[name=downloads-dir][value=dir]").checked = true;
      this.showFolder();
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
    gDownloads.init();
    gCertError.init();
    document.getElementById("restart").addEventListener("click", () => {
      Services.startup.quit(
        Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart
      );
    });
  },
  { once: true }
);
