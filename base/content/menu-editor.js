/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Éditeur des menus clic droit : la disposition (liste d'identifiants,
// "-" pour un séparateur) est celle de modules/CoreContextMenu.sys.mjs.
// Glisser-déposer à la souris ; boutons Monter, Descendre, Retirer et
// Ajouter pour le clavier.

const { CoreContextMenu } = ChromeUtils.importESModule(
  "resource:///modules/CoreContextMenu.sys.mjs"
);

const DRAG_TYPE = "application/x-core-menu-item";

const gEditor = {
  menu: "page",
  layout: [],

  init() {
    for (let button of document.querySelectorAll("#menu-choice > button")) {
      button.addEventListener("click", () => this.select(button.dataset.menu));
    }
    document.getElementById("reset").addEventListener("click", () => {
      CoreContextMenu.reset(this.menu);
      this.load();
    });
    let current = document.getElementById("current");
    let available = document.getElementById("available");
    current.addEventListener("click", event => this.onCurrentClick(event));
    available.addEventListener("click", event => this.onAvailableClick(event));
    for (let list of [current, available]) {
      list.addEventListener("dragstart", event => this.onDragStart(event));
      list.addEventListener("dragover", event => this.onDragOver(event, list));
      list.addEventListener("drop", event => this.onDrop(event, list));
      list.addEventListener("dragleave", event => {
        if (!list.contains(event.relatedTarget)) {
          this.clearDropMarker();
        }
      });
    }
    document.addEventListener("dragend", () => this.clearDropMarker());
    this.load();
  },

  select(menu) {
    this.menu = menu;
    for (let button of document.querySelectorAll("#menu-choice > button")) {
      button.setAttribute("aria-selected", button.dataset.menu == menu);
    }
    this.load();
  },

  load() {
    this.layout = CoreContextMenu.layout(this.menu);
    this.render();
  },

  save(focus = null) {
    CoreContextMenu.setLayout(this.menu, this.layout);
    this.render(focus);
  },

  render(focus = null) {
    let current = document.getElementById("current");
    current.replaceChildren(
      ...this.layout.map((id, index) => {
        let row = this.row(id);
        row.dataset.index = index;
        row.append(
          this.button("up", "Monter", index == 0),
          this.button("down", "Descendre", index == this.layout.length - 1),
          this.button("remove", "Retirer du menu")
        );
        return row;
      })
    );

    let used = new Set(this.layout);
    let unused = CoreContextMenu.MENUS[this.menu].items.filter(item => !used.has(item.id));
    let available = document.getElementById("available");
    available.replaceChildren(
      ...[CoreContextMenu.SEPARATOR, ...unused.map(item => item.id)].map(id => {
        let row = this.row(id);
        row.append(this.button("add", "Ajouter au menu"));
        return row;
      })
    );
    if (unused.length == 0) {
      let empty = document.createElement("li");
      empty.className = "empty muted";
      empty.textContent = "Tous les éléments sont dans le menu.";
      available.append(empty);
    }

    // Garde le focus sur le bouton utilisé, à la nouvelle place de l'élément.
    if (focus) {
      let row =
        focus.index == null
          ? null
          : current.querySelector(`[data-index="${focus.index}"]`);
      let button = row?.querySelector(`[data-action="${focus.action}"]:not([disabled])`);
      (button ?? row?.querySelector("button:not([disabled])") ?? document.getElementById(focus.fallback ?? "current"))?.focus();
    }
  },

  row(id) {
    let row = document.createElement("li");
    row.className = "item";
    row.draggable = true;
    row.dataset.id = id;
    let label = document.createElement("span");
    label.className = "item-label";
    if (id == CoreContextMenu.SEPARATOR) {
      row.classList.add("separator");
      label.textContent = "Séparateur";
      row.append(label);
      return row;
    }
    let item = CoreContextMenu.item(this.menu, id);
    label.textContent = item.label;
    let group = document.createElement("span");
    group.className = "item-group muted";
    group.textContent = item.group;
    row.append(label, group);
    return row;
  },

  button(action, label, disabled = false) {
    let button = document.createElement("button");
    button.className = `icon-button action-${action}`;
    button.dataset.action = action;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.disabled = disabled;
    return button;
  },

  onCurrentClick(event) {
    let button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }
    let index = Number(button.closest(".item").dataset.index);
    let { action } = button.dataset;
    if (action == "remove") {
      this.layout.splice(index, 1);
      this.save({ index: Math.min(index, this.layout.length - 1), action: "remove" });
      return;
    }
    let to = action == "up" ? index - 1 : index + 1;
    if (to < 0 || to >= this.layout.length) {
      return;
    }
    let [id] = this.layout.splice(index, 1);
    this.layout.splice(to, 0, id);
    this.save({ index: to, action });
  },

  // Ajouté en fin de menu, juste avant « Éléments des extensions » s'il y
  // est en dernier.
  onAvailableClick(event) {
    let button = event.target.closest("button[data-action=add]");
    if (!button) {
      return;
    }
    let id = button.closest(".item").dataset.id;
    let index = this.layout.length;
    if (this.layout.at(-1) == "extensions") {
      index--;
    }
    this.layout.splice(index, 0, id);
    this.save({ index, action: "remove", fallback: "available" });
  },

  /* Glisser-déposer */

  onDragStart(event) {
    let row = event.target.closest?.(".item");
    if (!row) {
      return;
    }
    let source = row.parentNode.id == "current" ? Number(row.dataset.index) : null;
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ id: row.dataset.id, source }));
    event.dataTransfer.effectAllowed = "move";
    row.classList.add("dragging");
  },

  // Place d'insertion dans la liste du menu : avant la ligne dont le milieu
  // est sous le pointeur.
  dropIndex(event, list) {
    let rows = [...list.querySelectorAll(":scope > .item")];
    for (let row of rows) {
      let rect = row.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        return Number(row.dataset.index);
      }
    }
    return rows.length;
  },

  onDragOver(event, list) {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    this.clearDropMarker();
    if (list.id == "current") {
      let index = this.dropIndex(event, list);
      let row = list.querySelector(`[data-index="${index}"]`);
      if (row) {
        row.classList.add("drop-before");
      } else {
        list.classList.add("drop-end");
      }
    } else {
      list.classList.add("drop-remove");
    }
  },

  clearDropMarker() {
    for (let element of document.querySelectorAll(".drop-before, .drop-end, .drop-remove, .dragging")) {
      element.classList.remove("drop-before", "drop-end", "drop-remove", "dragging");
    }
  },

  onDrop(event, list) {
    let raw = event.dataTransfer.getData(DRAG_TYPE);
    this.clearDropMarker();
    if (!raw) {
      return;
    }
    event.preventDefault();
    let { id, source } = JSON.parse(raw);
    if (list.id == "available") {
      // Glissé hors du menu : retiré.
      if (source != null) {
        this.layout.splice(source, 1);
        this.save();
      }
      return;
    }
    let index = this.dropIndex(event, list);
    if (source != null) {
      this.layout.splice(source, 1);
      if (source < index) {
        index--;
      }
    }
    this.layout.splice(index, 0, id);
    this.save();
  },
};

window.addEventListener("load", () => gEditor.init(), { once: true });
