/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Fenêtre de réglages : moteurs de recherche, sandbox des processus de
// contenu, barre de titre, historique, téléchargements, barre de
// marque-pages, menus clic droit, extensions installées depuis un fichier
// et réponse par défaut aux certificats invalides.

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
      this.chooseFolder().catch(console.error);
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

  async chooseFolder() {
    let { Downloads } = ChromeUtils.importESModule(
      "resource://gre/modules/Downloads.sys.mjs"
    );
    let picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    picker.init(window.browsingContext, "Dossier des téléchargements", Ci.nsIFilePicker.modeGetFolder);
    // Le sélecteur s'ouvre sur le dossier actuel, pas sur « Récents ».
    let dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    dir.initWithPath(await Downloads.getPreferredDownloadsDirectory());
    picker.displayDirectory = dir;
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

// Extensions installées depuis un fichier ou un dossier, vérifiées ou non
// (modules/LocalExtensions.sys.mjs).
const gExtensions = {
  init() {
    let { LocalExtensions } = ChromeUtils.importESModule(
      "resource:///modules/LocalExtensions.sys.mjs"
    );
    let added = document.getElementById("extension-added");
    let onDone = name => {
      added.textContent = `${name} est ajoutée.`;
      added.hidden = false;
    };
    for (let mode of ["file", "folder"]) {
      document.getElementById(`extension-${mode}`).addEventListener("click", () => {
        added.hidden = true;
        LocalExtensions.pick(window, mode, onDone);
      });
    }
  },
};

// Moteurs de recherche de la barre d'adresse (modules/CoreSearch.sys.mjs).
const gSearch = {
  init() {
    let { CoreSearch } = ChromeUtils.importESModule(
      "resource:///modules/CoreSearch.sys.mjs"
    );
    this.search = CoreSearch;

    let catalog = document.getElementById("search-catalog");
    for (let entry of CoreSearch.CATALOG) {
      catalog.append(new Option(entry.instance ? `${entry.name} (votre instance)` : entry.name, entry.id));
    }
    catalog.append(new Option("Autre moteur…", "custom"));
    catalog.addEventListener("change", () => this.updateForm());

    document.getElementById("search-default").addEventListener("change", event =>
      CoreSearch.setDefault(event.target.value)
    );
    document.getElementById("search-add").addEventListener("click", () => this.add());
    for (let id of ["search-instance", "search-name", "search-url", "search-keyword"]) {
      document.getElementById(id).addEventListener("keydown", event => {
        if (event.key == "Enter") {
          this.add();
        }
      });
    }

    let update = () => this.render();
    Services.prefs.addObserver("core.search.", update);
    window.addEventListener("unload", () => Services.prefs.removeObserver("core.search.", update));
    this.render();
  },

  render() {
    let engines = this.search.engines;
    let current = this.search.defaultEngine?.name ?? "";
    let select = document.getElementById("search-default");
    select.replaceChildren(new Option("Aucun : pas de recherche depuis la barre d'adresse", ""));
    for (let engine of engines) {
      select.append(new Option(`Rechercher avec ${engine.name}`, engine.name));
    }
    select.value = current;

    let list = document.getElementById("search-engines");
    list.replaceChildren();
    for (let engine of engines) {
      let item = document.createElement("li");
      let text = document.createElement("span");
      text.className = "engine-text";
      let name = document.createElement("span");
      name.textContent = engine.keyword ? `${engine.name} — ${engine.keyword}` : engine.name;
      let url = document.createElement("span");
      url.className = "engine-url";
      url.textContent = engine.url;
      url.title = engine.url;
      text.append(name, url);
      let remove = document.createElement("button");
      remove.textContent = "Retirer";
      remove.addEventListener("click", () => this.search.remove(engine.name));
      item.append(text, remove);
      list.append(item);
    }
    list.hidden = !engines.length;

    // Les moteurs de la liste déjà ajoutés n'y sont plus proposés.
    let names = new Set(engines.map(e => e.name));
    let catalog = document.getElementById("search-catalog");
    for (let option of catalog.options) {
      let entry = this.search.CATALOG.find(e => e.id == option.value);
      option.hidden = !!entry && !entry.instance && names.has(entry.name);
    }
    if (catalog.selectedOptions[0]?.hidden) {
      catalog.value = [...catalog.options].find(o => !o.hidden).value;
    }
    this.updateForm();
  },

  updateForm() {
    let id = document.getElementById("search-catalog").value;
    let entry = this.search.CATALOG.find(e => e.id == id);
    document.getElementById("search-instance-field").hidden = !entry?.instance;
    document.getElementById("search-custom-fields").hidden = !!entry;
    document.getElementById("search-keyword").placeholder = entry?.keyword
      ? `Mot-clé (facultatif, ex. ${entry.keyword})`
      : "Mot-clé (facultatif)";
    document.getElementById("search-error").hidden = true;
  },

  add() {
    let id = document.getElementById("search-catalog").value;
    let entry = this.search.CATALOG.find(e => e.id == id);
    let fields = ["search-instance", "search-name", "search-url", "search-keyword"].map(f =>
      document.getElementById(f)
    );
    let [instance, name, url, keyword] = fields.map(f => f.value);
    let error = document.getElementById("search-error");
    try {
      if (entry) {
        url = this.search.catalogURL(entry, instance);
        name = entry.name;
        // Deux instances SearXNG : le nom de la seconde dit laquelle.
        if (entry.instance && this.search.engines.some(e => e.name == name)) {
          name = `${entry.name} (${new URL(url).host})`;
        }
      }
      this.search.add({ name, url, keyword });
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
      return;
    }
    for (let field of fields) {
      field.value = "";
    }
    error.hidden = true;
  },
};

// Barre de marque-pages (base/content/bookmarks.js suit la préférence).
const gBookmarksToolbar = {
  PREF: "core.bookmarks.toolbar",

  init() {
    let checkbox = document.getElementById("bookmarks-toolbar");
    let update = () => (checkbox.checked = Services.prefs.getBoolPref(this.PREF, false));
    update();
    checkbox.addEventListener("change", () =>
      Services.prefs.setBoolPref(this.PREF, checkbox.checked)
    );
    Services.prefs.addObserver(this.PREF, update);
    window.addEventListener("unload", () => Services.prefs.removeObserver(this.PREF, update));
  },
};

// Menus clic droit : éditeur dans sa propre fenêtre (menu-editor.xhtml).
const gContextMenuEditor = {
  init() {
    document.getElementById("contextmenu-edit").addEventListener("click", () => {
      let win = Services.wm.getMostRecentWindow("core:menu-editor");
      if (win) {
        win.focus();
        return;
      }
      window.openDialog(
        "chrome://core/content/menu-editor.xhtml",
        "",
        "chrome,dialog=no,resizable,centerscreen"
      );
    });
  },
};

window.addEventListener(
  "load",
  () => {
    gSearch.init();
    gSandbox.init();
    gTitlebar.init();
    gDownloads.init();
    gCertError.init();
    gHistory.init();
    gBookmarksToolbar.init();
    gExtensions.init();
    gContextMenuEditor.init();
    document.getElementById("restart").addEventListener("click", () => {
      Services.startup.quit(
        Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart
      );
    });
  },
  { once: true }
);
