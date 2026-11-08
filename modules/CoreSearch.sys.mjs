/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Moteurs de recherche de la barre d'adresse.
//
// Core n'utilise pas le service de recherche de toolkit (liste de moteurs
// tirée de Remote Settings, moteur imposé par pays) : aucun moteur n'est
// choisi d'office, l'utilisateur ajoute ceux qu'il veut depuis la liste
// ci-dessous ou en donne l'adresse lui-même. Tout tient dans deux
// préférences :
//   core.search.engines : liste JSON de { name, url, keyword }, url contenant
//                         %s à la place des mots recherchés ;
//   core.search.default : nom du moteur de la barre d'adresse, "" = aucun
//                         (la barre d'adresse ne fait alors pas de recherche).

const ENGINES_PREF = "core.search.engines";
const DEFAULT_PREF = "core.search.default";

// Moteurs proposés, dans cet ordre. SearXNG et degoog s'installent chez soi
// (ou chez quelqu'un de confiance) : on demande l'adresse de l'instance.
const CATALOG = [
  { id: "searxng", name: "SearXNG", instance: true, path: "/search?q=%s" },
  { id: "degoog", name: "degoog", instance: true, path: "/search?q=%s" },
  { id: "duckduckgo", name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s", keyword: "ddg" },
  { id: "brave", name: "Brave Search", url: "https://search.brave.com/search?q=%s" },
  { id: "startpage", name: "Startpage", url: "https://www.startpage.com/sp/search?query=%s" },
  { id: "mojeek", name: "Mojeek", url: "https://www.mojeek.com/search?q=%s" },
  { id: "qwant", name: "Qwant", url: "https://www.qwant.com/?q=%s" },
  { id: "ecosia", name: "Ecosia", url: "https://www.ecosia.org/search?q=%s" },
  { id: "bing", name: "Bing", url: "https://www.bing.com/search?q=%s" },
  { id: "google", name: "Google", url: "https://www.google.com/search?q=%s" },
  { id: "wikipedia", name: "Wikipédia", wikipedia: true, keyword: "w" },
];

// Schémas que l'on ouvre tels quels même s'ils ne sont pas http(s).
const INTERNAL_SCHEMES = new Set([
  "about", "blob", "chrome", "data", "file", "ftp", "http", "https",
  "javascript", "jar", "moz-extension", "resource", "view-source",
]);

// Suffixes des réseaux locaux, absents de la liste publique des suffixes.
const LOCAL_SUFFIXES = new Set([
  "arpa", "corp", "home", "internal", "intranet", "lan", "local",
  "localdomain", "localhost", "test",
]);

function readEngines() {
  try {
    let list = JSON.parse(Services.prefs.getStringPref(ENGINES_PREF, "[]"));
    return Array.isArray(list)
      ? list.filter(e => e && typeof e.name == "string" && typeof e.url == "string")
      : [];
  } catch (e) {
    return [];
  }
}

function writeEngines(list) {
  Services.prefs.setStringPref(
    ENGINES_PREF,
    JSON.stringify(list.map(({ name, url, keyword }) => ({ name, url, keyword: keyword || "" })))
  );
}

function hasKnownScheme(text) {
  let match = /^([a-z][a-z0-9+.-]*):/i.exec(text);
  if (!match) {
    return false;
  }
  let scheme = match[1].toLowerCase();
  if (INTERNAL_SCHEMES.has(scheme)) {
    return true;
  }
  try {
    return Cc["@mozilla.org/uriloader/external-protocol-service;1"]
      .getService(Ci.nsIExternalProtocolService)
      .externalProtocolHandlerExists(scheme);
  } catch (e) {
    return false;
  }
}

function hostLooksReal(host) {
  if (host == "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) {
    return true;
  }
  if (Services.prefs.getBoolPref(`browser.fixup.domainwhitelist.${host}`, false)) {
    return true;
  }
  if (!host.includes(".") || host.startsWith(".") || host.endsWith(".")) {
    return false;
  }
  let suffix = host.slice(host.lastIndexOf(".") + 1);
  if (
    LOCAL_SUFFIXES.has(suffix) ||
    Services.prefs.getBoolPref(`browser.fixup.domainsuffixwhitelist.${suffix}`, false)
  ) {
    return true;
  }
  try {
    return Services.eTLD.hasKnownPublicSuffixFromHost(host);
  } catch (e) {
    return false;
  }
}

export const CoreSearch = {
  CATALOG,
  ENGINES_PREF,
  DEFAULT_PREF,

  get engines() {
    return readEngines();
  },

  // Moteur de la barre d'adresse, ou null si la recherche est désactivée.
  get defaultEngine() {
    let name = Services.prefs.getStringPref(DEFAULT_PREF, "");
    return (name && readEngines().find(e => e.name == name)) || null;
  },

  setDefault(name) {
    if (name) {
      Services.prefs.setStringPref(DEFAULT_PREF, name);
    } else {
      Services.prefs.clearUserPref(DEFAULT_PREF);
    }
  },

  // Adresse de recherche d'un moteur de la liste, pour une instance donnée
  // (SearXNG, degoog) le cas échéant.
  catalogURL(entry, instance = "") {
    if (entry.wikipedia) {
      let lang = Services.locale.appLocaleAsBCP47.split("-")[0];
      if (!/^[a-z]{2,3}$/.test(lang)) {
        lang = "en";
      }
      return `https://${lang}.wikipedia.org/wiki/Special:Search?search=%s`;
    }
    if (!entry.instance) {
      return entry.url;
    }
    instance = instance.trim();
    if (!instance) {
      throw new Error(`Indiquez l'adresse de votre instance ${entry.name}.`);
    }
    if (!/^https?:\/\//i.test(instance)) {
      instance = "https://" + instance;
    }
    let base;
    try {
      base = new URL(instance);
    } catch (e) {
      throw new Error(`« ${instance} » n'est pas une adresse valide.`);
    }
    return base.origin + base.pathname.replace(/\/+$/, "") + entry.path;
  },

  // Vérifie et ajoute un moteur. Lève une erreur au message lisible.
  add({ name, url, keyword = "" }) {
    name = name.trim();
    url = url.trim().replace("{searchTerms}", "%s");
    keyword = keyword.trim().toLowerCase();
    if (!name) {
      throw new Error("Donnez un nom au moteur.");
    }
    if (!url.includes("%s")) {
      throw new Error("L'adresse doit contenir %s à la place des mots recherchés.");
    }
    let parsed;
    try {
      parsed = new URL(url.replace("%s", "test"));
    } catch (e) {
      throw new Error(`« ${url} » n'est pas une adresse valide.`);
    }
    if (parsed.protocol != "https:" && parsed.protocol != "http:") {
      throw new Error("L'adresse doit commencer par https:// ou http://.");
    }
    if (/\s/.test(keyword)) {
      throw new Error("Le mot-clé ne doit pas contenir d'espace.");
    }
    let list = readEngines();
    if (list.some(e => e.name.toLowerCase() == name.toLowerCase())) {
      throw new Error(`Un moteur s'appelle déjà « ${name} ».`);
    }
    if (keyword && list.some(e => e.keyword == keyword)) {
      throw new Error(`Le mot-clé « ${keyword} » est déjà pris.`);
    }
    list.push({ name, url, keyword });
    writeEngines(list);
    // Premier moteur ajouté : c'est celui que l'on veut utiliser.
    if (list.length == 1) {
      this.setDefault(name);
    }
  },

  remove(name) {
    writeEngines(readEngines().filter(e => e.name != name));
    if (Services.prefs.getStringPref(DEFAULT_PREF, "") == name) {
      this.setDefault("");
    }
  },

  submission(engine, terms) {
    return engine.url.replace("%s", encodeURIComponent(terms).replace(/%20/g, "+"));
  },

  // Ce que la barre d'adresse doit faire de la saisie : l'adresse d'une
  // recherche, ou null pour l'ouvrir comme une adresse.
  searchURLFor(text) {
    text = text.trim();
    if (!text) {
      return null;
    }
    // « mot-clé mots » : le moteur de ce mot-clé, même sans moteur par défaut.
    let space = text.search(/\s/);
    if (space > 0) {
      let keyword = text.slice(0, space).toLowerCase();
      let engine = readEngines().find(e => e.keyword && e.keyword == keyword);
      if (engine) {
        return this.submission(engine, text.slice(space).trim());
      }
    }
    let engine = this.defaultEngine;
    if (!engine) {
      return null;
    }
    if (text.startsWith("?")) {
      return this.submission(engine, text.slice(1).trim());
    }
    return this.looksLikeSearch(text) ? this.submission(engine, text) : null;
  },

  // Même idée que toolkit/docshell/base/URIFixup.sys.mjs (keywordURIFixup) :
  // des mots, ou un nom sans suffixe connu, sont une recherche ; un schéma,
  // une IP, un port ou un domaine au suffixe connu sont une adresse.
  looksLikeSearch(text) {
    if (hasKnownScheme(text)) {
      return false;
    }
    if (/\s/.test(text)) {
      return true;
    }
    let uri;
    try {
      uri = Services.uriFixup.getFixupURIInfo(
        text,
        Services.uriFixup.FIXUP_FLAG_FIX_SCHEME_TYPOS
      ).fixedURI;
    } catch (e) {
      return true;
    }
    if (!uri) {
      return true;
    }
    // Chemin local (/home/…) devenu file:// : une adresse.
    if (!uri.schemeIs("http") && !uri.schemeIs("https")) {
      return false;
    }
    if (uri.port != -1 || uri.password) {
      return false;
    }
    if (uri.username) {
      return true;
    }
    return !hostLooksReal(uri.asciiHost);
  },
};
