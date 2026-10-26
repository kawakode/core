/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Gestionnaire de téléchargements de la fenêtre principale. Toolkit
// (toolkit/components/downloads) fait le travail : enregistrement, reprise,
// liste gardée entre deux sessions. Core n'en affiche que la liste, au choix
// de l'utilisateur :
// - "panel" : un bouton dans la barre d'outils, visible seulement quand la
//   liste n'est pas vide, qui ouvre un panneau sous lui (design.md) ;
// - "bar" : une barre en bas de la fenêtre, qui apparaît à chaque nouveau
//   téléchargement et qu'on ferme d'un clic.
// La même liste d'éléments passe de l'un à l'autre quand le réglage change.

const DOWNLOADS_DISPLAY_PREF = "core.downloads.display";

var gDownloads = {
  list: null,
  // Download de toolkit -> élément de la liste.
  items: new Map(),
  // Vrai une fois la liste de la session précédente chargée : seuls les
  // téléchargements ajoutés ensuite ouvrent le panneau ou la barre.
  ready: false,

  get mode() {
    return Services.prefs.getStringPref(DOWNLOADS_DISPLAY_PREF, "panel") == "bar"
      ? "bar"
      : "panel";
  },

  get container() {
    return document.getElementById("downloads-list");
  },

  async init() {
    let button = document.getElementById("downloads-button");
    button.addEventListener("mousedown", event => {
      if (event.button == 0) {
        this.togglePanel();
      }
    });
    button.addEventListener("keydown", event => {
      if (event.key == "Enter" || event.key == " ") {
        event.preventDefault();
        this.togglePanel();
      }
    });
    let panel = document.getElementById("downloads-panel");
    panel.addEventListener("popupshown", () => button.setAttribute("open", "true"));
    panel.addEventListener("popuphidden", () => {
      button.removeAttribute("open");
      // Ouvert par Ctrl+Maj+Y ou le menu ≡ sur une liste vide : le bouton
      // affiché pour l'occasion disparaît avec le panneau.
      this.updateButton();
    });
    document.getElementById("downloads-bar-close").addEventListener("click", () => {
      document.getElementById("downloads-bar").hidden = true;
    });
    for (let id of ["downloads-panel-clear", "downloads-bar-clear"]) {
      document.getElementById(id).addEventListener("click", () => this.list.removeFinished());
    }
    this.initContextMenu();

    this.place();
    Services.prefs.addObserver(DOWNLOADS_DISPLAY_PREF, this);
    window.addEventListener("unload", () => {
      Services.prefs.removeObserver(DOWNLOADS_DISPLAY_PREF, this);
      this.list?.removeView(this);
    });

    let { Downloads } = ChromeUtils.importESModule(
      "resource://gre/modules/Downloads.sys.mjs"
    );
    this.list = await Downloads.getList(Downloads.ALL);
    await this.list.addView(this);
    this.ready = true;
  },

  // Réglage modifié : la liste change de place.
  observe() {
    document.getElementById("downloads-panel").hidePopup();
    let wasShown = !document.getElementById("downloads-bar").hidden;
    this.place();
    if (wasShown && this.mode == "panel") {
      document.getElementById("downloads-bar").hidden = true;
    }
  },

  place() {
    let parent =
      this.mode == "bar"
        ? document.getElementById("downloads-bar")
        : document.getElementById("downloads-panel");
    parent.prepend(this.container);
    this.updateButton();
  },

  // Panneau ouvert, ou barre affichée, selon le réglage (menu ≡, Ctrl+Maj+Y).
  show() {
    // Un fichier terminé a pu être supprimé ou déplacé depuis.
    for (let download of this.items.keys()) {
      if (download.succeeded) {
        download.refresh().catch(console.error);
      }
    }
    if (this.mode == "bar") {
      document.getElementById("downloads-bar").hidden = false;
      return;
    }
    let button = document.getElementById("downloads-button");
    button.hidden = false;
    button.removeAttribute("attention");
    document.getElementById("downloads-panel").openPopup(button, "bottomright topright");
  },

  togglePanel() {
    let panel = document.getElementById("downloads-panel");
    if (panel.state == "open" || panel.state == "showing") {
      panel.hidePopup();
    } else {
      this.show();
    }
  },

  // Vue de la DownloadList de toolkit.

  onDownloadAdded(download) {
    let item = this.createItem(download);
    this.items.set(download, item);
    this.container.prepend(item);
    this.update(download);
    // Seule la dernière fenêtre utilisée montre le nouveau téléchargement.
    if (
      this.ready &&
      download.openDownloadsListOnStart &&
      Services.wm.getMostRecentWindow("navigator:browser") == window
    ) {
      this.show();
    }
  },

  onDownloadChanged(download) {
    this.update(download);
  },

  onDownloadRemoved(download) {
    this.items.get(download)?.remove();
    this.items.delete(download);
    this.updateButton();
    if (!this.items.size) {
      document.getElementById("downloads-panel").hidePopup();
      document.getElementById("downloads-bar").hidden = true;
    }
  },

  createItem(download) {
    let item = document.createElement("div");
    item.className = "download";
    item.download = download;
    item.tabIndex = 0;
    let icon = document.createElement("img");
    icon.className = "download-icon";
    icon.alt = "";
    let text = document.createElement("div");
    text.className = "download-text";
    let name = document.createElement("span");
    name.className = "download-name";
    let status = document.createElement("span");
    status.className = "download-status";
    let progress = document.createElement("div");
    progress.className = "download-progress";
    text.append(name, status, progress);
    let action = document.createElement("button");
    action.className = "download-action icon-button";
    action.addEventListener("click", event => {
      event.stopPropagation();
      this.doAction(download);
    });
    item.append(icon, text, action);

    item.addEventListener("click", () => this.open(download));
    item.addEventListener("keydown", event => {
      if (event.key == "Enter") {
        this.open(download);
      } else if (event.key == "Delete") {
        this.remove(download);
      }
    });
    item.addEventListener("contextmenu", event => {
      event.preventDefault();
      let menu = document.getElementById("download-menu");
      menu.download = download;
      menu.openPopupAtScreen(event.screenX, event.screenY, true, event);
    });
    return item;
  },

  state(download) {
    if (download.succeeded) {
      return download.target.exists ? "done" : "deleted";
    }
    if (download.error) {
      return "failed";
    }
    if (download.canceled) {
      return download.hasPartialData ? "paused" : "canceled";
    }
    return "downloading";
  },

  update(download) {
    let item = this.items.get(download);
    if (!item) {
      return;
    }
    let state = this.state(download);
    let fileName = PathUtils.filename(download.target.path ?? "") || download.source.url;
    item.setAttribute("state", state);
    // Infobulle : chemin du fichier, ou la raison de l'échec.
    item.title =
      state == "failed" && download.error.message
        ? download.error.message
        : download.target.path ?? download.source.url;
    item.querySelector(".download-name").textContent = fileName;
    item.querySelector(".download-status").textContent = this.statusText(download, state);
    let extension = fileName.includes(".") ? fileName.split(".").pop() : "";
    let src = `moz-icon://.${extension}?size=16`;
    let icon = item.querySelector(".download-icon");
    if (icon.getAttribute("src") != src) {
      icon.setAttribute("src", src);
    }
    item.style.setProperty(
      "--download-progress",
      (state == "downloading" || state == "paused") && download.hasProgress
        ? download.progress / 100
        : 0
    );

    let action = item.querySelector(".download-action");
    let [label, kind] = {
      downloading: ["Annuler", "cancel"],
      paused: ["Reprendre", "retry"],
      failed: ["Réessayer", "retry"],
      canceled: ["Réessayer", "retry"],
      done: ["Afficher dans le dossier", "folder"],
      deleted: ["Retirer de la liste", "cancel"],
    }[state];
    action.title = label;
    action.setAttribute("aria-label", label);
    action.setAttribute("kind", kind);
    this.updateButton();
  },

  statusText(download, state) {
    switch (state) {
      case "done":
        return `Terminé — ${this.formatBytes(download.target.size || download.totalBytes)}`;
      case "deleted":
        return "Fichier supprimé";
      case "failed":
        return download.error.becauseBlocked ? "Bloqué" : "Échec";
      case "canceled":
        return "Annulé";
      case "paused":
        return `En pause — ${this.formatBytes(download.currentBytes)}`;
    }
    if (!download.currentBytes) {
      return "Démarrage…";
    }
    let parts = [];
    if (download.hasProgress) {
      parts.push(`${this.formatBytes(download.currentBytes)} sur ${this.formatBytes(download.totalBytes)}`);
      if (download.speed > 0) {
        let seconds = (download.totalBytes - download.currentBytes) / download.speed;
        parts.push(this.formatTimeLeft(seconds));
      }
    } else {
      parts.push(this.formatBytes(download.currentBytes));
    }
    if (download.speed > 0) {
      parts.push(`${this.formatBytes(download.speed)}/s`);
    }
    return parts.join(" — ");
  },

  formatBytes(bytes) {
    let units = ["byte", "kilobyte", "megabyte", "gigabyte"];
    let i = 0;
    while (bytes >= 1000 && i < units.length - 1) {
      bytes /= 1000;
      i++;
    }
    return new Intl.NumberFormat("fr", {
      style: "unit",
      unit: units[i],
      maximumFractionDigits: i < 2 ? 0 : 1,
    }).format(bytes);
  },

  formatTimeLeft(seconds) {
    if (seconds < 60) {
      return `encore ${Math.max(1, Math.round(seconds))} s`;
    }
    let minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return `encore ${minutes} min`;
    }
    return `encore ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  },

  // Bouton de la barre d'outils : seulement en mode panneau et quand la
  // liste n'est pas vide. Un trait sous l'icône montre l'avancement global ;
  // l'icône prend la couleur d'accent quand tout est fini, jusqu'à
  // l'ouverture du panneau.
  updateButton() {
    let button = document.getElementById("downloads-button");
    button.hidden = this.mode != "panel" || !this.items.size;
    let current = 0;
    let total = 0;
    let running = false;
    for (let download of this.items.keys()) {
      if (this.state(download) == "downloading") {
        running = true;
        if (download.hasProgress) {
          current += download.currentBytes;
          total += download.totalBytes;
        }
      }
    }
    if (button.hasAttribute("downloading") && !running) {
      let panel = document.getElementById("downloads-panel");
      button.toggleAttribute("attention", panel.state != "open");
    }
    button.toggleAttribute("downloading", running);
    button.style.setProperty("--download-progress", total ? current / total : 0);
  },

  // Actions

  open(download) {
    if (download.succeeded) {
      download.launch().catch(console.error);
    }
  },

  showInFolder(download) {
    download.showContainingDirectory().catch(console.error);
  },

  doAction(download) {
    switch (this.state(download)) {
      case "downloading":
        download.cancel().catch(console.error);
        // Pas de reprise possible d'un téléchargement annulé par l'utilisateur.
        download.removePartialData().catch(console.error);
        break;
      case "paused":
      case "failed":
      case "canceled":
        download.start().catch(() => {});
        break;
      case "done":
        this.showInFolder(download);
        break;
      default:
        this.remove(download);
    }
  },

  async remove(download) {
    await this.list.remove(download);
    await download.finalize(true).catch(console.error);
  },

  initContextMenu() {
    let menu = document.getElementById("download-menu");
    menu.addEventListener("popupshowing", () => {
      let state = this.state(menu.download);
      let show = (id, visible) => (document.getElementById(id).hidden = !visible);
      show("download-menu-open", state == "done");
      show("download-menu-folder", state == "done" || state == "downloading" || state == "paused");
      show("download-menu-cancel", state == "downloading" || state == "paused");
      show("download-menu-retry", state == "failed" || state == "canceled" || state == "paused");
    });
    let commands = {
      "download-menu-open": d => this.open(d),
      "download-menu-folder": d => this.showInFolder(d),
      "download-menu-cancel": d => {
        d.cancel().catch(console.error);
        d.removePartialData().catch(console.error);
      },
      "download-menu-retry": d => d.start().catch(() => {}),
      "download-menu-copy": d => {
        Cc["@mozilla.org/widget/clipboardhelper;1"]
          .getService(Ci.nsIClipboardHelper)
          .copyString(d.source.originalUrl ?? d.source.url);
      },
      "download-menu-remove": d => this.remove(d),
    };
    menu.addEventListener("command", event => commands[event.target.id]?.(menu.download));
  },
};
