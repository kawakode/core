/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// about:history : pages visitées (base Places de toolkit/), de la plus
// récente à la plus ancienne, regroupées par jour. Page du processus
// parent : elle lit la base directement et ouvre les pages dans l'onglet
// qui l'affiche.

const { PlacesUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/PlacesUtils.sys.mjs"
);

// Lignes chargées à la fois ; les suivantes arrivent en faisant défiler.
const PAGE_SIZE = 150;

const gHistory = {
  // Nombre de lignes affichées, recherche en cours, dernier jour affiché.
  shown: 0,
  query: "",
  lastDay: "",
  done: false,
  // Numéro de la requête en cours : une frappe pendant une requête rend
  // l'ancienne obsolète.
  generation: 0,

  get list() {
    return document.getElementById("list");
  },

  init() {
    let search = document.getElementById("search");
    let timer = null;
    search.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        this.query = search.value.trim();
        this.reload();
      }, 150);
    });
    document.getElementById("clear").addEventListener("click", () => this.clear());

    this.list.addEventListener("click", event => this.onClick(event));
    this.list.addEventListener("auxclick", event => {
      if (event.button == 1) {
        this.onClick(event);
      }
    });
    this.list.addEventListener("keydown", event => {
      let entry = event.target.closest(".entry");
      if (entry && event.key == "Delete") {
        this.remove(entry);
      }
    });

    // Plus de lignes à l'approche du bas de la liste.
    new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        this.load();
      }
    }, { rootMargin: "400px" }).observe(document.getElementById("more"));

    // Suivre les visites faites dans les autres onglets.
    this.listener = events => this.onPlacesEvents(events);
    let types = ["page-visited", "page-title-changed", "page-removed", "history-cleared"];
    PlacesUtils.observers.addListener(types, this.listener);
    window.addEventListener("unload", () =>
      PlacesUtils.observers.removeListener(types, this.listener)
    );

    // Note affichée tant que l'enregistrement est coupé dans les Réglages.
    let updateNote = () => {
      document.getElementById("disabled-note").hidden =
        Services.prefs.getBoolPref("places.history.enabled", true);
    };
    updateNote();
    Services.prefs.addObserver("places.history.enabled", updateNote);
    window.addEventListener("unload", () =>
      Services.prefs.removeObserver("places.history.enabled", updateNote)
    );
    this.reload();
  },

  async reload(count = PAGE_SIZE) {
    let generation = ++this.generation;
    let rows = await this.fetch(0, count);
    if (generation != this.generation) {
      return;
    }
    let focusedUrl = document.activeElement?.closest?.(".entry")?.dataset.url;
    this.list.textContent = "";
    this.shown = 0;
    this.lastDay = "";
    this.append(rows, count);
    if (focusedUrl) {
      this.list.querySelector(`.entry[data-url="${CSS.escape(focusedUrl)}"]`)?.focus();
    }
  },

  async load() {
    if (this.done || this.loading) {
      return;
    }
    this.loading = true;
    let generation = this.generation;
    let rows = await this.fetch(this.shown, PAGE_SIZE);
    this.loading = false;
    if (generation == this.generation) {
      this.append(rows, PAGE_SIZE);
    }
  },

  // Une ligne par page (dernière visite), sans les pages cachées
  // (redirections, cadres).
  async fetch(offset, limit) {
    let db = await PlacesUtils.promiseDBConnection();
    let where = "";
    let params = { offset, limit };
    if (this.query) {
      where = "AND (url LIKE :q ESCAPE '/' OR title LIKE :q ESCAPE '/')";
      // escapeStringForLIKE n'existe que sur les requêtes, pas sur la connexion.
      params.q = `%${this.query.replace(/[/%_]/g, "/$&")}%`;
    }
    let rows = await db.executeCached(
      `SELECT url, title, last_visit_date FROM moz_places
       WHERE last_visit_date NOT NULL AND hidden = 0 ${where}
       ORDER BY last_visit_date DESC
       LIMIT :limit OFFSET :offset`,
      params
    );
    return rows.map(row => ({
      url: row.getResultByName("url"),
      title: row.getResultByName("title"),
      date: new Date(row.getResultByName("last_visit_date") / 1000),
    }));
  },

  append(rows, requested) {
    this.done = rows.length < requested;
    let fragment = document.createDocumentFragment();
    for (let { url, title, date } of rows) {
      let day = date.toDateString();
      if (day != this.lastDay) {
        this.lastDay = day;
        let heading = document.createElement("h2");
        heading.textContent = dayLabel(date);
        fragment.append(heading);
      }
      let entry = document.createElement("a");
      entry.className = "entry";
      entry.href = url;
      entry.dataset.url = url;
      entry.setAttribute("role", "listitem");
      let time = document.createElement("span");
      time.className = "time";
      time.textContent = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      let label = document.createElement("span");
      label.className = "title";
      label.textContent = title || url;
      let address = document.createElement("span");
      address.className = "url";
      address.textContent = title ? url : "";
      let remove = document.createElement("button");
      remove.className = "remove icon-button";
      remove.title = "Supprimer de l'historique (Suppr)";
      remove.setAttribute("aria-label", "Supprimer de l'historique");
      entry.append(time, label, address, remove);
      fragment.append(entry);
    }
    this.list.append(fragment);
    this.shown += rows.length;

    let empty = document.getElementById("empty");
    empty.hidden = this.shown > 0;
    empty.textContent = this.query
      ? "Aucune page ne correspond à cette recherche."
      : "Aucune page visitée.";
  },

  // Clic : ouvre la page dans cet onglet. Ctrl+clic ou clic milieu : dans
  // un nouvel onglet, en arrière-plan.
  onClick(event) {
    let entry = event.target.closest(".entry");
    if (!entry) {
      return;
    }
    event.preventDefault();
    if (event.target.closest(".remove")) {
      this.remove(entry);
      return;
    }
    let chromeWin = window.browsingContext.topChromeWindow;
    if (event.button == 1 || event.ctrlKey || event.metaKey) {
      chromeWin.gTabs.open(entry.dataset.url, { select: false });
    } else {
      window.browsingContext.embedderElement.fixupAndLoadURIString(entry.dataset.url, {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
    }
  },

  // La ligne disparaît tout de suite ; le focus passe à la suivante.
  remove(entry) {
    // Ligne voisine, en sautant les titres de jour.
    let sibling = direction => {
      let node = entry[direction];
      while (node && !node.classList.contains("entry")) {
        node = node[direction];
      }
      return node;
    };
    let next = sibling("nextElementSibling") ?? sibling("previousElementSibling");
    this.removeRow(entry);
    next?.focus();
    PlacesUtils.history.remove(entry.dataset.url).catch(console.error);
  },

  removeRow(entry) {
    let heading = entry.previousElementSibling;
    let after = entry.nextElementSibling;
    entry.remove();
    this.shown--;
    // Titre d'un jour qui n'a plus de ligne.
    if (heading?.localName == "h2" && (!after || after.localName == "h2")) {
      heading.remove();
      if (!after) {
        this.lastDay = "";
      }
    }
  },

  async clear() {
    let range = document.getElementById("clear-range").value;
    if (range == "all") {
      let ok = Services.prompt.confirm(
        window.browsingContext.topChromeWindow,
        "Effacer l'historique",
        "Effacer tout l'historique de navigation ? Les marque-pages sont conservés."
      );
      if (!ok) {
        return;
      }
      await PlacesUtils.history.clear();
      return;
    }
    let beginDate = new Date();
    if (range == "hour") {
      beginDate.setHours(beginDate.getHours() - 1);
    } else {
      beginDate.setHours(0, 0, 0, 0);
    }
    await PlacesUtils.history.removeByFilter({ beginDate, endDate: new Date() });
  },

  onPlacesEvents(events) {
    let refresh = false;
    for (let event of events) {
      if (event.type == "page-removed" && event.isRemovedFromStore) {
        let row = this.list.querySelector(`.entry[data-url="${CSS.escape(event.url)}"]`);
        if (row) {
          this.removeRow(row);
        }
      } else if (event.type != "page-visited" || !event.hidden) {
        refresh = true;
      }
    }
    if (refresh && !this.refreshPending) {
      // Une rafale de visites (redirections, chargement d'une page) ne
      // relit la base qu'une fois.
      this.refreshPending = true;
      setTimeout(() => {
        this.refreshPending = false;
        this.reload(Math.max(this.shown, PAGE_SIZE));
      }, 250);
    }
  },
};

function dayLabel(date) {
  let today = new Date();
  today.setHours(0, 0, 0, 0);
  let days = Math.round((today - new Date(date).setHours(0, 0, 0, 0)) / 86400000);
  if (days == 0) {
    return "Aujourd'hui";
  }
  if (days == 1) {
    return "Hier";
  }
  let options = { weekday: "long", day: "numeric", month: "long" };
  if (date.getFullYear() != today.getFullYear()) {
    options.year = "numeric";
  }
  let label = date.toLocaleDateString(undefined, options);
  return label[0].toUpperCase() + label.slice(1);
}

window.addEventListener("DOMContentLoaded", () => gHistory.init(), { once: true });
