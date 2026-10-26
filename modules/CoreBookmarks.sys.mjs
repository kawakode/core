/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Marque-pages : ce qui sert à la fois à la fenêtre principale
// (base/content/bookmarks.js) et au gestionnaire about:bookmarks, plus les
// sauvegardes automatiques que Firefox fait dans
// browser/components/places/PlacesBrowserStartup.sys.mjs. Les données sont
// celles de Places (toolkit/components/places).

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BookmarkJSONUtils: "resource://gre/modules/BookmarkJSONUtils.sys.mjs",
  PlacesBackups: "resource://gre/modules/PlacesBackups.sys.mjs",
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
});

// Sauvegarde JSON (dossier bookmarkbackups du profil) au plus une fois par
// jour, après 8 minutes d'inactivité de l'utilisateur, comme Firefox.
const BACKUP_IDLE_SECONDS = 8 * 60;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Les dossiers racines de Places portent un nom technique en base.
const ROOT_TITLES = {
  menu________: "Menu des marque-pages",
  toolbar_____: "Barre de marque-pages",
  unfiled_____: "Autres marque-pages",
  mobile______: "Marque-pages mobiles",
};

let initialized = false;

const backupObserver = {
  observe(subject, topic) {
    if (topic == "idle") {
      CoreBookmarks.backup().catch(console.error);
    }
  },
};

export const CoreBookmarks = {
  // Événements Places à suivre pour rafraîchir un affichage.
  EVENTS: [
    "bookmark-added",
    "bookmark-removed",
    "bookmark-moved",
    "bookmark-title-changed",
    "bookmark-url-changed",
  ],

  // Dossiers proposés par l'étoile et le gestionnaire, dans cet ordre.
  ROOTS: ["menu________", "toolbar_____", "unfiled_____"],

  // Dossier d'un nouveau marque-page : le menu, pour qu'il apparaisse
  // tout de suite dans ≡ › Marque-pages (Core n'affiche pas de barre de
  // marque-pages par défaut).
  get defaultFolder() {
    return lazy.PlacesUtils.bookmarks.menuGuid;
  },

  title(item) {
    return ROOT_TITLES[item.guid] ?? item.title ?? "";
  },

  // Un marque-page n'a de titre que s'il a été donné : on montre l'adresse
  // à défaut.
  label(item) {
    let url = item.url?.href ?? item.uri ?? item.url;
    return this.title(item) || url || "";
  },

  // Tous les dossiers, à plat et dans l'ordre d'affichage, avec leur
  // profondeur : [{ guid, title, depth }].
  async listFolders() {
    // Pas de dossier des étiquettes, ni des marque-pages mobiles (ils ne
    // viennent que de Firefox Sync).
    let { TYPE_FOLDER, tagsGuid, mobileGuid } = lazy.PlacesUtils.bookmarks;
    let tree = await lazy.PlacesUtils.promiseBookmarksTree(
      lazy.PlacesUtils.bookmarks.rootGuid,
      {
        excludeItemsCallback: item =>
          item.typeCode != TYPE_FOLDER ||
          item.guid == tagsGuid ||
          item.guid == mobileGuid,
      }
    );
    let folders = [];
    let walk = (node, depth) => {
      folders.push({ guid: node.guid, title: this.title(node), depth });
      for (let child of node.children ?? []) {
        walk(child, depth + 1);
      }
    };
    let roots = tree.children ?? [];
    roots.sort((a, b) => this.ROOTS.indexOf(a.guid) - this.ROOTS.indexOf(b.guid));
    roots.forEach(root => walk(root, 0));
    return folders;
  },

  // Ouvre un marque-page dans la fenêtre win, dans l'onglet affiché
  // (where = "current") ou dans un nouvel onglet ("tab", "background").
  // Mêmes règles que PlacesUIUtils de Firefox : un bookmarklet
  // (javascript:) s'exécute dans la page affichée, le reste ne peut pas
  // hériter du principal du système.
  open(win, url, where = "current") {
    let isJavaScript = url.startsWith("javascript:");
    if (where == "current" || isJavaScript) {
      let browser = win.gTabs.selected.browser;
      let { LOAD_FLAGS_DISALLOW_INHERIT_PRINCIPAL, LOAD_FLAGS_ALLOW_POPUPS } =
        Ci.nsIWebNavigation;
      browser.fixupAndLoadURIString(url, {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        loadFlags: isJavaScript
          ? LOAD_FLAGS_ALLOW_POPUPS
          : LOAD_FLAGS_DISALLOW_INHERIT_PRINCIPAL,
      });
      browser.focus();
      return;
    }
    win.gTabs.open(url, { select: where == "tab" });
  },

  // Où ouvrir d'après le clic : clic du milieu ou Ctrl/⌘ = onglet en
  // arrière-plan, Maj en plus = onglet au premier plan.
  whereToOpen(event) {
    let accel = Services.appinfo.OS == "Darwin" ? event.metaKey : event.ctrlKey;
    if (event.button == 1 || accel) {
      return event.shiftKey ? "tab" : "background";
    }
    return "current";
  },

  // Appelé une fois le démarrage terminé : restauration de la dernière
  // sauvegarde si la base est corrompue ou a disparu, puis sauvegardes
  // pendant l'inactivité.
  async init() {
    if (initialized) {
      return;
    }
    initialized = true;
    let { history } = lazy.PlacesUtils;
    if (
      history.databaseStatus == history.DATABASE_STATUS_CORRUPT ||
      history.databaseStatus == history.DATABASE_STATUS_CREATE
    ) {
      let last = await lazy.PlacesBackups.getMostRecentBackup();
      if (last) {
        await lazy.BookmarkJSONUtils.importFromFile(last, {
          replace: true,
          source: lazy.PlacesUtils.bookmarks.SOURCES.RESTORE_ON_STARTUP,
        });
      }
    }
    let idle = Cc["@mozilla.org/widget/useridleservice;1"].getService(
      Ci.nsIUserIdleService
    );
    idle.addIdleObserver(backupObserver, BACKUP_IDLE_SECONDS);
    Services.obs.addObserver(function onShutdown() {
      Services.obs.removeObserver(onShutdown, "profile-before-change");
      idle.removeIdleObserver(backupObserver, BACKUP_IDLE_SECONDS);
    }, "profile-before-change");
  },

  async backup() {
    let last = await lazy.PlacesBackups.getMostRecentBackup();
    if (
      !last ||
      Date.now() - lazy.PlacesBackups.getDateForFile(last).getTime() > BACKUP_INTERVAL_MS
    ) {
      await lazy.PlacesBackups.create(
        Services.prefs.getIntPref("browser.bookmarks.max_backups", 15)
      );
    }
  },
};
