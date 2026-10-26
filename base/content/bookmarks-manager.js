/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Gestionnaire de marque-pages (about:bookmarks) : dossiers à gauche,
// contenu du dossier ou résultats de la recherche à droite, et sous la
// liste le nom, l'adresse et le dossier de la ligne choisie. Glisser une
// ligne sur un dossier l'y range, sur une autre ligne la place avant elle.
// Ctrl+Z / Ctrl+Maj+Z annulent et rétablissent (PlacesTransactions).

const { CoreBookmarks } = ChromeUtils.importESModule(
  "resource:///modules/CoreBookmarks.sys.mjs"
);
const { PlacesUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/PlacesUtils.sys.mjs"
);
const { PlacesTransactions } = ChromeUtils.importESModule(
  "resource://gre/modules/PlacesTransactions.sys.mjs"
);

const DRAG_TYPE = "application/x-core-bookmark";
const { TYPE_BOOKMARK, TYPE_FOLDER, TYPE_SEPARATOR } = PlacesUtils.bookmarks;

const gManager = {
  // Dossier affiché, ligne choisie et lignes affichées.
  folder: PlacesUtils.bookmarks.menuGuid,
  selected: null,
  items: [],
  folders: [],
  query: "",
  _refreshQueued: false,

  get list() {
    return document.getElementById("items");
  },

  get selectedItem() {
    return this.items.find(item => item.guid == this.selected) ?? null;
  },

  // Fenêtre principale qui contient l'onglet : c'est là qu'on ouvre les
  // marque-pages.
  get chromeWindow() {
    return window.browsingContext.topChromeWindow;
  },

  async init() {
    let search = document.getElementById("search");
    search.addEventListener("input", () => {
      this.query = search.value.trim();
      this.selected = null;
      this.refresh();
    });
    document.getElementById("new-folder").addEventListener("click", () => this.newFolder());
    document.getElementById("new-separator").addEventListener("click", () => this.newSeparator());
    document.getElementById("import").addEventListener("click", () => this.importHTML());
    document.getElementById("export").addEventListener("click", () => this.exportHTML());

    let list = this.list;
    list.addEventListener("click", event => {
      let row = event.target.closest("li");
      if (row) {
        this.select(row.dataset.guid);
      }
    });
    list.addEventListener("dblclick", event => {
      if (event.target.closest("li")) {
        this.activate(this.selectedItem, "tab");
      }
    });
    list.addEventListener("auxclick", event => {
      let item = this.items.find(i => i.guid == event.target.closest("li")?.dataset.guid);
      if (event.button == 1 && item?.type == TYPE_BOOKMARK) {
        CoreBookmarks.open(this.chromeWindow, item.url.href, "background");
      }
    });
    list.addEventListener("keydown", event => this.onListKey(event));
    list.addEventListener("dragstart", event => this.onDragStart(event));
    list.addEventListener("dragover", event => this.onDragOver(event));
    list.addEventListener("drop", event => this.onDrop(event));

    let folders = document.getElementById("folders");
    folders.addEventListener("click", event => {
      let row = event.target.closest(".folder");
      if (row) {
        this.showFolder(row.dataset.guid);
      }
    });
    folders.addEventListener("keydown", event => this.onFoldersKey(event));
    folders.addEventListener("dragover", event => this.onDragOver(event));
    folders.addEventListener("drop", event => this.onDrop(event));

    this.initDetails();

    window.addEventListener("keydown", event => {
      let accel = Services.appinfo.OS == "Darwin" ? event.metaKey : event.ctrlKey;
      // Les champs de texte gardent leur propre annulation.
      if (!accel || event.target.localName == "input") {
        return;
      }
      if (event.key.toLowerCase() == "z" || event.key == "y") {
        event.preventDefault();
        let redo = event.shiftKey || event.key == "y";
        (redo ? PlacesTransactions.redo() : PlacesTransactions.undo()).catch(console.error);
      } else if (event.key == "f") {
        event.preventDefault();
        search.focus();
      }
    });

    let listener = () => this.refresh();
    PlacesUtils.observers.addListener(CoreBookmarks.EVENTS, listener);
    window.addEventListener("unload", () =>
      PlacesUtils.observers.removeListener(CoreBookmarks.EVENTS, listener)
    );

    await this.render();
    list.focus();
  },

  // Changements dans Places, d'ici ou d'ailleurs : un seul rendu par image.
  refresh() {
    if (this._refreshQueued) {
      return;
    }
    this._refreshQueued = true;
    window.requestAnimationFrame(() => {
      this._refreshQueued = false;
      this.render().catch(console.error);
    });
  },

  async render() {
    this.folders = await CoreBookmarks.listFolders();
    if (!this.folders.some(f => f.guid == this.folder)) {
      this.folder = PlacesUtils.bookmarks.menuGuid;
    }
    if (this.query) {
      let results = await PlacesUtils.bookmarks.search(this.query);
      this.items = results.filter(item => item.type == TYPE_BOOKMARK);
    } else {
      let items = [];
      await PlacesUtils.bookmarks.fetch({ parentGuid: this.folder }, item => items.push(item));
      this.items = items.sort((a, b) => a.index - b.index);
    }
    if (!this.selectedItem) {
      this.selected = null;
    }
    this.renderFolders();
    this.renderItems();
    this.renderDetails();
  },

  renderFolders() {
    let rows = this.folders.map(folder => {
      let row = document.createElement("div");
      row.className = "folder";
      row.setAttribute("role", "treeitem");
      row.setAttribute("aria-level", folder.depth + 1);
      row.dataset.guid = folder.guid;
      row.textContent = folder.title;
      row.style.paddingInlineStart = `${28 + folder.depth * 16}px`;
      row.style.backgroundPosition = `${8 + folder.depth * 16}px center`;
      let current = !this.query && folder.guid == this.folder;
      row.toggleAttribute("selected", current);
      row.setAttribute("aria-selected", current);
      row.tabIndex = current ? 0 : -1;
      return row;
    });
    document.getElementById("folders").replaceChildren(...rows);
  },

  renderItems() {
    let title = document.getElementById("content-title");
    title.textContent = this.query
      ? `Résultats pour « ${this.query} »`
      : this.folders.find(f => f.guid == this.folder)?.title ?? "";

    let rows = this.items.map(item => {
      let row = document.createElement("li");
      row.setAttribute("role", "option");
      row.dataset.guid = item.guid;
      row.draggable = true;
      let selected = item.guid == this.selected;
      row.toggleAttribute("selected", selected);
      row.setAttribute("aria-selected", selected);
      if (item.type == TYPE_SEPARATOR) {
        row.className = "separator";
        row.setAttribute("aria-label", "Séparateur");
        return row;
      }
      row.className = item.type == TYPE_FOLDER ? "folder-item" : "bookmark";
      let name = document.createElement("span");
      name.className = "name";
      name.textContent = CoreBookmarks.label(item);
      row.append(name);
      if (item.type == TYPE_BOOKMARK) {
        let url = document.createElement("span");
        url.className = "url";
        url.textContent = item.url.href;
        row.append(url);
        row.title = item.url.href;
      }
      return row;
    });
    this.list.replaceChildren(...rows);

    let empty = document.getElementById("empty");
    empty.hidden = !!rows.length;
    empty.textContent = this.query
      ? "Aucun marque-page ne correspond."
      : "Ce dossier est vide. Marquez une page avec l'étoile de la barre d'adresse ou Ctrl+D.";
  },

  showFolder(guid) {
    this.folder = guid;
    this.selected = null;
    this.query = "";
    document.getElementById("search").value = "";
    return this.render().catch(console.error);
  },

  select(guid) {
    if (this.selected == guid) {
      return;
    }
    this.selected = guid;
    for (let row of this.list.children) {
      let selected = row.dataset.guid == guid;
      row.toggleAttribute("selected", selected);
      row.setAttribute("aria-selected", selected);
      if (selected) {
        row.scrollIntoView({ block: "nearest" });
      }
    }
    this.renderDetails();
  },

  // Entrée ou double-clic : ouvre un marque-page dans un nouvel onglet, ou
  // entre dans un dossier.
  activate(item, where) {
    if (item?.type == TYPE_FOLDER) {
      this.showFolder(item.guid);
    } else if (item?.type == TYPE_BOOKMARK) {
      CoreBookmarks.open(this.chromeWindow, item.url.href, where);
    }
  },

  remove(item) {
    if (item) {
      let index = this.items.indexOf(item);
      let next = this.items[index + 1] ?? this.items[index - 1];
      this.selected = next?.guid ?? null;
      PlacesTransactions.Remove({ guids: [item.guid] }).transact().catch(console.error);
    }
  },

  onListKey(event) {
    let index = this.items.indexOf(this.selectedItem);
    let move = step => {
      let item = this.items[Math.min(Math.max(index + step, 0), this.items.length - 1)];
      if (item) {
        this.select(item.guid);
      }
    };
    switch (event.key) {
      case "ArrowDown":
        move(index == -1 ? 0 : 1);
        break;
      case "ArrowUp":
        move(-1);
        break;
      case "Home":
        move(-index);
        break;
      case "End":
        move(this.items.length);
        break;
      case "Enter":
        this.activate(this.selectedItem, "tab");
        break;
      case "Delete":
        this.remove(this.selectedItem);
        break;
      case "Backspace": {
        // Remonte au dossier parent.
        let current = this.folders.findIndex(f => f.guid == this.folder);
        let depth = this.folders[current]?.depth ?? 0;
        let parent = this.folders.slice(0, current).findLast(f => f.depth < depth);
        if (parent && !this.query) {
          this.showFolder(parent.guid);
        }
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  },

  onFoldersKey(event) {
    let index = this.folders.findIndex(f => f.guid == this.folder);
    let step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) {
      return;
    }
    event.preventDefault();
    let folder = this.folders[index + step];
    if (folder) {
      this.showFolder(folder.guid).then(() =>
        document.querySelector(`#folders > [data-guid="${folder.guid}"]`)?.focus()
      );
    }
  },

  /* Détails de la ligne choisie */

  initDetails() {
    let name = document.getElementById("detail-name");
    let url = document.getElementById("detail-url");
    let save = async () => {
      let item = this.selectedItem;
      if (!item) {
        return;
      }
      let title = name.value.trim();
      if (title != (item.title ?? "")) {
        await PlacesTransactions.EditTitle({ guid: item.guid, title }).transact();
      }
      if (item.type == TYPE_BOOKMARK) {
        let href = url.value.trim();
        url.toggleAttribute("invalid", !URL.canParse(href));
        if (href != item.url.href && URL.canParse(href)) {
          await PlacesTransactions.EditUrl({ guid: item.guid, url: href }).transact();
        }
      }
    };
    for (let input of [name, url]) {
      input.addEventListener("change", () => save().catch(console.error));
      input.addEventListener("keydown", event => {
        if (event.key == "Enter") {
          save().catch(console.error);
          this.list.focus();
        } else if (event.key == "Escape") {
          this.renderDetails();
          this.list.focus();
        }
      });
    }
    document.getElementById("detail-folder").addEventListener("command", event => {
      let item = this.selectedItem;
      let parentGuid = event.currentTarget.value;
      if (item && parentGuid != item.parentGuid) {
        PlacesTransactions.Move({ guids: [item.guid], newParentGuid: parentGuid })
          .transact()
          .catch(error => this.status(`Déplacement impossible : ${error.message}`));
      }
    });
    document.getElementById("detail-open").addEventListener("click", () =>
      this.activate(this.selectedItem, "tab")
    );
    document.getElementById("detail-remove").addEventListener("click", () =>
      this.remove(this.selectedItem)
    );
  },

  renderDetails() {
    let item = this.selectedItem;
    let details = document.getElementById("details");
    details.hidden = !item || item.type == TYPE_SEPARATOR;
    if (details.hidden) {
      return;
    }
    let isBookmark = item.type == TYPE_BOOKMARK;
    for (let element of details.querySelectorAll(".bookmark-only")) {
      element.hidden = !isBookmark;
    }
    document.getElementById("detail-name").value = item.title ?? "";
    let url = document.getElementById("detail-url");
    url.value = isBookmark ? item.url.href : "";
    url.removeAttribute("invalid");

    // Un dossier ne peut pas être rangé dans lui-même ni dans ses
    // sous-dossiers.
    let menulist = document.getElementById("detail-folder");
    let popup = menulist.menupopup;
    popup.replaceChildren();
    let excludedDepth = null;
    for (let folder of this.folders) {
      if (excludedDepth != null && folder.depth > excludedDepth) {
        continue;
      }
      excludedDepth = null;
      if (folder.guid == item.guid) {
        excludedDepth = folder.depth;
        continue;
      }
      let entry = document.createXULElement("menuitem");
      entry.setAttribute("label", folder.title);
      entry.setAttribute("value", folder.guid);
      entry.style.paddingInlineStart = `${8 + folder.depth * 16}px`;
      popup.append(entry);
    }
    menulist.value = item.parentGuid;
  },

  /* Création */

  // Dossier où créer : celui affiché, ou celui de la ligne choisie pendant
  // une recherche.
  get insertionPoint() {
    let selected = this.selectedItem;
    if (selected && !this.query) {
      return { parentGuid: this.folder, index: selected.index + 1 };
    }
    return { parentGuid: this.query ? selected?.parentGuid ?? this.folder : this.folder };
  },

  async newFolder() {
    let guid = await PlacesTransactions.NewFolder({
      ...this.insertionPoint,
      title: "Nouveau dossier",
    }).transact();
    this.clearSearch();
    await this.render();
    this.select(guid);
    let name = document.getElementById("detail-name");
    name.focus();
    name.select();
  },

  async newSeparator() {
    let guid = await PlacesTransactions.NewSeparator(this.insertionPoint).transact();
    this.clearSearch();
    await this.render();
    this.select(guid);
  },

  clearSearch() {
    if (this.query) {
      this.folder = this.insertionPoint.parentGuid;
      this.query = "";
      document.getElementById("search").value = "";
    }
  },

  /* Glisser-déposer */

  onDragStart(event) {
    let row = event.target.closest("li");
    let item = this.items.find(i => i.guid == row?.dataset.guid);
    if (!item) {
      return;
    }
    event.dataTransfer.setData(DRAG_TYPE, item.guid);
    if (item.type == TYPE_BOOKMARK) {
      event.dataTransfer.setData("text/x-moz-url", `${item.url.href}\n${item.title ?? ""}`);
      event.dataTransfer.setData("text/uri-list", item.url.href);
      event.dataTransfer.setData("text/plain", item.url.href);
    }
    event.dataTransfer.effectAllowed = "move";
  },

  // Cible du dépôt : { parentGuid, index? }, ou null si impossible.
  dropTarget(event) {
    let folder = event.target.closest(".folder");
    if (folder) {
      return { parentGuid: folder.dataset.guid };
    }
    let row = event.target.closest("li");
    if (row && !this.query) {
      let item = this.items.find(i => i.guid == row.dataset.guid);
      return { parentGuid: this.folder, index: item.index };
    }
    return null;
  },

  onDragOver(event) {
    if (event.dataTransfer.types.includes(DRAG_TYPE) && this.dropTarget(event)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
  },

  onDrop(event) {
    let guid = event.dataTransfer.getData(DRAG_TYPE);
    let target = this.dropTarget(event);
    if (!guid || !target || guid == target.parentGuid) {
      return;
    }
    event.preventDefault();
    PlacesTransactions.Move({
      guids: [guid],
      newParentGuid: target.parentGuid,
      newIndex: target.index ?? PlacesUtils.bookmarks.DEFAULT_INDEX,
    })
      .transact()
      .catch(error => this.status(`Déplacement impossible : ${error.message}`));
  },

  /* Import et export au format HTML (Firefox, Chrome, Safari…) */

  pickFile(mode, title) {
    let picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    picker.init(window.browsingContext, title, mode);
    picker.appendFilters(Ci.nsIFilePicker.filterHTML);
    picker.appendFilters(Ci.nsIFilePicker.filterAll);
    if (mode == Ci.nsIFilePicker.modeSave) {
      picker.defaultString = "marque-pages.html";
      picker.defaultExtension = "html";
    }
    return new Promise(resolve =>
      picker.open(result =>
        resolve(result == Ci.nsIFilePicker.returnCancel ? null : picker.file.path)
      )
    );
  },

  async importHTML() {
    let path = await this.pickFile(Ci.nsIFilePicker.modeOpen, "Importer des marque-pages");
    if (!path) {
      return;
    }
    let { BookmarkHTMLUtils } = ChromeUtils.importESModule(
      "resource://gre/modules/BookmarkHTMLUtils.sys.mjs"
    );
    try {
      let count = await BookmarkHTMLUtils.importFromFile(path);
      this.status(
        count
          ? `${count} marque-pages et dossiers importés.`
          : "Ce fichier ne contient pas de marque-pages lisibles."
      );
    } catch (error) {
      this.status("Ce fichier ne contient pas de marque-pages lisibles.");
    }
  },

  async exportHTML() {
    let path = await this.pickFile(Ci.nsIFilePicker.modeSave, "Exporter les marque-pages");
    if (!path) {
      return;
    }
    let { BookmarkHTMLUtils } = ChromeUtils.importESModule(
      "resource://gre/modules/BookmarkHTMLUtils.sys.mjs"
    );
    try {
      await BookmarkHTMLUtils.exportToFile(path);
      this.status(`Marque-pages exportés dans ${path}.`);
    } catch (error) {
      this.status(`Export impossible : ${error.message}`);
    }
  },

  status(text) {
    document.getElementById("status").textContent = text;
  },
};

window.addEventListener("load", () => gManager.init().catch(console.error), { once: true });
