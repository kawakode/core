/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Marque-pages dans la fenêtre principale : étoile de la barre d'adresse
// (Ctrl+D), menu ≡ › Marque-pages, barre de marque-pages facultative
// (Ctrl+Maj+B) et gestionnaire about:bookmarks (Ctrl+B, Ctrl+Maj+O). Les
// données sont celles de Places, partagées avec l'API d'extensions
// bookmarks. Les modifications passent par PlacesTransactions, donc Ctrl+Z
// dans le gestionnaire les annule.

ChromeUtils.defineESModuleGetters(this, {
  CoreBookmarks: "resource:///modules/CoreBookmarks.sys.mjs",
  PlacesTransactions: "resource://gre/modules/PlacesTransactions.sys.mjs",
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
});

var gBookmarks = {
  BAR_PREF: "core.bookmarks.toolbar",
  MANAGER_URL: "about:bookmarks",

  // Numéro de la dernière demande d'état de l'étoile : une réponse de
  // Places arrivée après un changement de page est ignorée.
  _starRequest: 0,
  // Marque-page ouvert dans le panneau d'édition :
  // { item, cancelled, removed }.
  _editing: null,
  _barQueued: false,

  get star() {
    return document.getElementById("bookmark-star");
  },

  get panel() {
    return document.getElementById("bookmark-panel");
  },

  get bar() {
    return document.getElementById("bookmarks-bar");
  },

  init() {
    this.star.addEventListener("click", () => this.editCurrentPage());
    window.addEventListener("TabSelect", () => this.updateStar());
    gTabs.addTabsProgressListener({
      onLocationChange: (browser, webProgress) => {
        if (webProgress.isTopLevel && browser == gTabs.selected?.browser) {
          this.updateStar();
        }
      },
    });

    // Menus de marque-pages (≡ › Marque-pages, dossiers de la barre) :
    // remplis à chaque ouverture, depuis Places.
    document.addEventListener("popupshowing", event => this.onPopupShowing(event));
    document.addEventListener("command", event => this.onCommand(event));
    document.addEventListener("click", event => {
      if (event.button == 1 && event.target.bookmarkUrl && event.target.localName == "menuitem") {
        CoreBookmarks.open(window, event.target.bookmarkUrl, "background");
        this.closeMenus(event.target);
      }
    });

    this.initPanel();
    this.initBar();

    // Places n'est chargé qu'une fois le démarrage terminé, ou dès qu'une
    // page web s'affiche (étoile).
    Services.tm.idleDispatchToMainThread(() => {
      this._onPlacesEvents = () => this.onPlacesChanged();
      PlacesUtils.observers.addListener(CoreBookmarks.EVENTS, this._onPlacesEvents);
      CoreBookmarks.init().catch(console.error);
    });
    window.addEventListener("unload", () => {
      if (this._onPlacesEvents) {
        PlacesUtils.observers.removeListener(CoreBookmarks.EVENTS, this._onPlacesEvents);
      }
      Services.prefs.removeObserver(this.BAR_PREF, this);
    });
  },

  openManager() {
    switchToTabHavingURI(this.MANAGER_URL);
  },

  // Une page qu'on peut marquer : web, fichier local ou page about:.
  canBookmark(uri) {
    return (
      !!uri &&
      (["http", "https", "file", "ftp"].includes(uri.scheme) ||
        (uri.scheme == "about" && uri.spec != "about:blank"))
    );
  },

  // Étoile : masquée sur un onglet vide, pleine si la page est marquée.
  async updateStar() {
    let browser = gTabs.selected?.browser;
    let uri = browser?.currentURI;
    let request = ++this._starRequest;
    let bookmarkable = this.canBookmark(uri);
    this.star.hidden = !bookmarkable;
    let starred = false;
    if (bookmarkable) {
      try {
        starred = !!(await PlacesUtils.bookmarks.fetch({ url: uri }));
      } catch (e) {
        // Adresse que Places refuse (trop longue, par exemple).
      }
    }
    if (request != this._starRequest) {
      return;
    }
    this.star.toggleAttribute("starred", starred);
    this.star.title = starred
      ? "Modifier ce marque-page (Ctrl+D)"
      : "Marquer cette page (Ctrl+D)";
    this.star.setAttribute("aria-label", starred ? "Modifier ce marque-page" : "Marquer cette page");
  },

  // Ctrl+D et l'étoile : marque la page si elle ne l'est pas, puis ouvre le
  // panneau pour changer le nom ou le dossier.
  async editCurrentPage() {
    // Ctrl+D une seconde fois referme le panneau.
    if (["open", "showing"].includes(this.panel.state)) {
      this.panel.hidePopup();
      return;
    }
    let browser = gTabs.selected.browser;
    let uri = browser.currentURI;
    if (!this.canBookmark(uri)) {
      return;
    }
    let item = await PlacesUtils.bookmarks.fetch({ url: uri });
    let created = !item;
    if (created) {
      let guid = await PlacesTransactions.NewBookmark({
        parentGuid: CoreBookmarks.defaultFolder,
        url: uri,
        title: browser.contentTitle || uri.spec,
      }).transact();
      item = await PlacesUtils.bookmarks.fetch(guid);
      this.updateStar();
    }
    this.openPanel(item, this.star, { created });
  },

  // Changements dans Places (étoile, extension, gestionnaire, import) :
  // étoile et barre mises à jour au plus une fois par image.
  onPlacesChanged() {
    if (this._barQueued) {
      return;
    }
    this._barQueued = true;
    window.requestAnimationFrame(() => {
      this._barQueued = false;
      this.updateStar();
      this.refreshBar();
    });
  },

  /* Panneau d'édition */

  initPanel() {
    let panel = this.panel;
    let done = () => panel.hidePopup();
    document.getElementById("bookmark-done").addEventListener("click", done);
    document.getElementById("bookmark-remove").addEventListener("click", () => {
      this._editing.removed = true;
      PlacesTransactions.Remove({ guids: [this._editing.item.guid] })
        .transact()
        .catch(console.error);
      panel.hidePopup();
    });
    panel.addEventListener("keydown", event => {
      if (event.key == "Enter" && event.target.localName == "input") {
        done();
      } else if (event.key == "Escape" && !document.getElementById("bookmark-folder").open) {
        // Échap annule les changements ; le marque-page reste.
        this._editing.cancelled = true;
      }
    });
    panel.addEventListener("popupshown", event => {
      if (event.target != panel) {
        return;
      }
      let name = document.getElementById("bookmark-name");
      name.focus();
      name.select();
    });
    panel.addEventListener("popuphidden", event => {
      if (event.target == panel) {
        this.saveEdits().catch(console.error);
      }
    });
  },

  async openPanel(item, anchor, { created = false } = {}) {
    this._editing = { item, cancelled: false, removed: false };
    document.getElementById("bookmark-panel-title").textContent = created
      ? "Marque-page ajouté"
      : "Modifier le marque-page";
    document.getElementById("bookmark-name").value = item.title ?? "";
    document.getElementById("bookmark-url").value = item.url.href;
    await this.fillFolderList(document.getElementById("bookmark-folder"), item.parentGuid);
    this.panel.openPopup(anchor, anchor == this.star ? "after_end" : "after_start");
  },

  async fillFolderList(menulist, selectedGuid) {
    let popup = menulist.menupopup;
    popup.replaceChildren();
    for (let folder of await CoreBookmarks.listFolders()) {
      let item = document.createXULElement("menuitem");
      item.setAttribute("label", folder.title);
      item.setAttribute("value", folder.guid);
      item.style.paddingInlineStart = `${8 + folder.depth * 16}px`;
      popup.append(item);
    }
    menulist.value = selectedGuid;
  },

  async saveEdits() {
    let { item, cancelled, removed } = this._editing;
    this._editing = null;
    if (cancelled || removed) {
      return;
    }
    let title = document.getElementById("bookmark-name").value.trim();
    let url = document.getElementById("bookmark-url").value.trim();
    let parentGuid = document.getElementById("bookmark-folder").value;
    if (title != (item.title ?? "")) {
      await PlacesTransactions.EditTitle({ guid: item.guid, title }).transact();
    }
    if (url && url != item.url.href && URL.canParse(url)) {
      await PlacesTransactions.EditUrl({ guid: item.guid, url }).transact();
    }
    if (parentGuid && parentGuid != item.parentGuid) {
      await PlacesTransactions.Move({ guids: [item.guid], newParentGuid: parentGuid }).transact();
    }
  },

  /* Menus */

  onPopupShowing(event) {
    let popup = event.target;
    if (popup.id == "bookmarks-menu-popup") {
      this.fillMainMenu(popup);
    } else if (popup.folderGuid) {
      popup.replaceChildren();
      this.fillPopup(popup, popup.folderGuid);
    }
  },

  // ≡ › Marque-pages : les commandes, le contenu du dossier « Menu des
  // marque-pages », puis la barre et les autres marque-pages en sous-menus.
  fillMainMenu(popup) {
    let start = document.getElementById("bookmarks-menu-start");
    while (start.nextSibling) {
      start.nextSibling.remove();
    }
    let starred = this.star.hasAttribute("starred");
    let page = document.getElementById("menu-bookmark-page");
    page.setAttribute("label", starred ? "Modifier ce marque-page" : "Marquer cette page");
    page.disabled = this.star.hidden;
    document
      .getElementById("menu-bookmarks-toolbar")
      .setAttribute("checked", this.barVisible);

    let { menuGuid, toolbarGuid, unfiledGuid } = PlacesUtils.bookmarks;
    this.fillPopup(popup, menuGuid, { showEmpty: false });
    popup.append(document.createXULElement("menuseparator"));
    for (let guid of [toolbarGuid, unfiledGuid]) {
      popup.append(this.folderMenu(guid, CoreBookmarks.title({ guid })));
    }
  },

  // Contenu d'un dossier (requête synchrone, comme les menus de Firefox).
  fillPopup(popup, folderGuid, { showEmpty = true } = {}) {
    let root = PlacesUtils.getFolderContents(folderGuid).root;
    try {
      for (let i = 0; i < root.childCount; i++) {
        let item = this.menuItemFor(root.getChild(i));
        if (item) {
          popup.append(item);
        }
      }
      if (!root.childCount && showEmpty) {
        let empty = document.createXULElement("menuitem");
        empty.setAttribute("label", "(vide)");
        empty.disabled = true;
        popup.append(empty);
      }
    } finally {
      root.containerOpen = false;
    }
  },

  menuItemFor(node) {
    if (PlacesUtils.nodeIsSeparator(node)) {
      return document.createXULElement("menuseparator");
    }
    if (PlacesUtils.nodeIsFolderOrShortcut(node)) {
      let guid = PlacesUtils.getConcreteItemGuid(node);
      return this.folderMenu(guid, CoreBookmarks.title({ guid, title: node.title }));
    }
    // Les requêtes (place:) n'ont pas de sens sans les vues de Firefox.
    if (!PlacesUtils.nodeIsURI(node)) {
      return null;
    }
    let item = document.createXULElement("menuitem");
    item.setAttribute("label", node.title || node.uri);
    item.setAttribute("tooltiptext", node.uri);
    item.bookmarkUrl = node.uri;
    return item;
  },

  folderMenu(guid, title) {
    let menu = document.createXULElement("menu");
    menu.setAttribute("label", title);
    let popup = document.createXULElement("menupopup");
    popup.folderGuid = guid;
    menu.append(popup);
    return menu;
  },

  onCommand(event) {
    let target = event.target;
    if (target.bookmarkUrl) {
      CoreBookmarks.open(window, target.bookmarkUrl, CoreBookmarks.whereToOpen(event));
      return;
    }
    switch (target.id) {
      case "menu-bookmark-page":
        this.editCurrentPage();
        break;
      case "menu-bookmarks-manager":
        this.openManager();
        break;
      case "menu-bookmarks-toolbar":
        this.toggleBar();
        break;
      case "bookmark-context-open":
        CoreBookmarks.open(window, this._contextItem.url, "tab");
        break;
      case "bookmark-context-edit":
        this.editBarItem(this._contextItem);
        break;
      case "bookmark-context-remove":
        PlacesTransactions.Remove({ guids: [this._contextItem.guid] })
          .transact()
          .catch(console.error);
        break;
    }
  },

  // Ferme le menu (et ses parents) d'où vient un clic du milieu.
  closeMenus(item) {
    let popup = item.closest("menupopup");
    while (popup.parentNode.closest("menupopup")) {
      popup = popup.parentNode.closest("menupopup");
    }
    popup.hidePopup();
  },

  /* Barre de marque-pages */

  get barVisible() {
    return Services.prefs.getBoolPref(this.BAR_PREF, false);
  },

  toggleBar() {
    Services.prefs.setBoolPref(this.BAR_PREF, !this.barVisible);
  },

  initBar() {
    Services.prefs.addObserver(this.BAR_PREF, this);
    let bar = this.bar;
    bar.addEventListener("click", event => this.onBarClick(event));
    bar.addEventListener("auxclick", event => {
      if (event.button == 1) {
        this.onBarClick(event);
      }
    });
    bar.addEventListener("contextmenu", event => {
      let button = event.target.closest(".bookmark-item");
      if (!button?.bookmarkUrl) {
        return;
      }
      event.preventDefault();
      this._contextItem = { guid: button.bookmarkGuid, url: button.bookmarkUrl, button };
      document.getElementById("bookmark-context").openPopupAtScreen(event.screenX, event.screenY, true);
    });
    // Molette : défilement horizontal, comme la barre d'onglets.
    bar.addEventListener("wheel", event => {
      if (!event.deltaX) {
        bar.scrollLeft += event.deltaY * (event.deltaMode ? 40 : 1);
        event.preventDefault();
      }
    }, { passive: false });
    this.updateBarVisibility();
  },

  observe(subject, topic, data) {
    if (data == this.BAR_PREF) {
      this.updateBarVisibility();
    }
  },

  updateBarVisibility() {
    this.bar.hidden = !this.barVisible;
    this.refreshBar();
  },

  refreshBar() {
    let bar = this.bar;
    if (bar.hidden) {
      bar.replaceChildren();
      return;
    }
    let root = PlacesUtils.getFolderContents(PlacesUtils.bookmarks.toolbarGuid).root;
    let items = [];
    try {
      for (let i = 0; i < root.childCount; i++) {
        let node = root.getChild(i);
        let button = document.createElement("button");
        button.className = "bookmark-item";
        if (PlacesUtils.nodeIsSeparator(node)) {
          button = document.createElement("div");
          button.className = "bookmark-separator";
        } else if (PlacesUtils.nodeIsFolderOrShortcut(node)) {
          button.classList.add("bookmark-folder");
          button.textContent = node.title;
          button.folderGuid = PlacesUtils.getConcreteItemGuid(node);
          button.setAttribute("aria-haspopup", "menu");
        } else if (PlacesUtils.nodeIsURI(node)) {
          button.textContent = node.title || node.uri;
          button.title = node.title ? `${node.title}\n${node.uri}` : node.uri;
          button.bookmarkUrl = node.uri;
          button.bookmarkGuid = node.bookmarkGuid;
        } else {
          continue;
        }
        items.push(button);
      }
    } finally {
      root.containerOpen = false;
    }
    if (!items.length) {
      let hint = document.createElement("span");
      hint.className = "bookmarks-bar-empty";
      hint.textContent =
        "Les marque-pages rangés dans « Barre de marque-pages » s'affichent ici.";
      items.push(hint);
    }
    bar.replaceChildren(...items);
  },

  onBarClick(event) {
    let button = event.target.closest(".bookmark-item");
    if (!button) {
      return;
    }
    if (button.folderGuid) {
      if (event.button == 0) {
        let popup = document.getElementById("bookmarks-bar-popup");
        popup.folderGuid = button.folderGuid;
        popup.openPopup(button, "after_start");
      }
      return;
    }
    CoreBookmarks.open(window, button.bookmarkUrl, CoreBookmarks.whereToOpen(event));
  },

  async editBarItem({ guid, button }) {
    let item = await PlacesUtils.bookmarks.fetch(guid);
    if (item) {
      this.openPanel(item, button);
    }
  },
};
