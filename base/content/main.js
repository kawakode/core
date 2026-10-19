/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Fenêtre principale de Core : barre d'outils, onglets et un <browser>
// distant (processus de contenu séparé et sandboxé) par onglet.

// Déchargement des onglets en arrière-plan : après ce délai sans être
// affichés, ou dès que le système manque de mémoire. 0 désactive le délai.
const UNLOAD_DELAY_PREF = "core.tabs.unloadAfterMinutes";

// « var » pour être visible depuis les modules (window.gTabs).
var gTabs = {
  list: [],
  selected: null,

  open(uri, { select = true, openWindowInfo = null, remoteType = null } = {}) {
    let tab = document.createElement("div");
    tab.className = "tab";
    tab.setAttribute("role", "tab");
    let title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = "Nouvel onglet";
    let close = document.createElement("button");
    close.className = "tab-close icon-button";
    close.title = "Fermer l'onglet (Ctrl+W)";
    close.setAttribute("aria-label", "Fermer l'onglet");
    tab.append(title, close);

    // browser est null quand l'onglet est déchargé ; unloaded garde alors
    // de quoi le recharger.
    let entry = { browser: null, tab, title, lastSeen: Date.now(), unloaded: null };
    tab.addEventListener("click", () => this.select(entry));
    tab.addEventListener("auxclick", event => {
      if (event.button == 1) {
        this.close(entry);
      }
    });
    close.addEventListener("click", event => {
      event.stopPropagation();
      this.close(entry);
    });

    document.getElementById("newtab").before(tab);
    this.list.push(entry);
    this.attachBrowser(entry, uri, { openWindowInfo, remoteType });

    if (select || !this.selected) {
      this.select(entry);
    }
    return entry;
  },

  attachBrowser(entry, uri, { openWindowInfo = null, remoteType = null } = {}) {
    let browser = document.createXULElement("browser");
    browser.permanentKey = new (Cu.getGlobalForObject(Services).Object)();
    for (let [name, value] of Object.entries({
      type: "content",
      remote: "true",
      maychangeremoteness: "true",
      message: "true",
      messagemanagergroup: "browsers",
      manualactiveness: "true",
      nodefaultsrc: "true",
    })) {
      browser.setAttribute(name, value);
    }
    if (openWindowInfo) {
      browser.openWindowInfo = openWindowInfo;
    }
    browser.setAttribute(
      "remoteType",
      remoteType ?? (uri ? this.remoteTypeFor(uri) : E10SUtils.WEB_REMOTE_TYPE)
    );
    entry.browser = browser;
    document.getElementById("browsers").append(browser);
    this.watch(entry);
    if (uri) {
      browser.fixupAndLoadURIString(uri, {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
    }
  },

  remoteTypeFor(uri) {
    try {
      return (
        ChromeUtils.predictRemoteTypeForURI(Services.io.newURI(uri), {
          window,
        }) || E10SUtils.WEB_REMOTE_TYPE
      );
    } catch (e) {
      // Saisie à corriger (recherche, adresse sans schéma) : processus web.
      return E10SUtils.WEB_REMOTE_TYPE;
    }
  },

  select(entry) {
    if (this.selected == entry) {
      return;
    }
    if (this.selected) {
      this.selected.lastSeen = Date.now();
      this.selected.tab.removeAttribute("selected");
      this.selected.browser.removeAttribute("selected");
      this.selected.browser.docShellIsActive = false;
    }
    this.selected = entry;
    if (entry.unloaded) {
      let { uri } = entry.unloaded;
      entry.unloaded = null;
      entry.tab.removeAttribute("unloaded");
      this.attachBrowser(entry, uri);
    }
    entry.tab.setAttribute("selected", "true");
    entry.browser.setAttribute("selected", "true");
    entry.browser.docShellIsActive = true;
    gToolbar.update();
    if (entry.browser.currentURI.spec == "about:blank") {
      gToolbar.urlbar.focus();
    } else {
      entry.browser.focus();
    }
  },

  close(entry) {
    let index = this.list.indexOf(entry);
    if (index == -1) {
      return;
    }
    if (this.list.length == 1) {
      window.close();
      return;
    }
    this.list.splice(index, 1);
    if (this.selected == entry) {
      this.selected = null;
      this.select(this.list[Math.min(index, this.list.length - 1)]);
    }
    entry.tab.remove();
    entry.browser?.remove();
  },

  // Libère le processus et la mémoire d'un onglet en arrière-plan. Il est
  // rechargé depuis son adresse quand on le réaffiche (l'historique de
  // l'onglet et les formulaires non envoyés sont perdus).
  unload(entry) {
    if (entry == this.selected || entry.unloaded || entry.playing) {
      return false;
    }
    let uri = entry.browser.currentURI?.spec;
    if (!uri || uri == "about:blank") {
      return false;
    }
    entry.unloaded = { uri };
    entry.tab.setAttribute("unloaded", "true");
    entry.browser.remove();
    entry.browser = null;
    return true;
  },

  unloadIdle() {
    let minutes = Services.prefs.getIntPref(UNLOAD_DELAY_PREF, 0);
    if (minutes <= 0) {
      return;
    }
    let limit = Date.now() - minutes * 60 * 1000;
    for (let entry of this.list) {
      if (entry.lastSeen < limit) {
        this.unload(entry);
      }
    }
  },

  // Sur alerte mémoire du système, tout ce qui n'est pas affiché est
  // déchargé, du plus anciennement vu au plus récent.
  unloadAll() {
    [...this.list]
      .sort((a, b) => a.lastSeen - b.lastSeen)
      .forEach(entry => this.unload(entry));
  },

  watch(entry) {
    let { browser } = entry;
    browser.addEventListener("pagetitlechanged", () => {
      let label = browser.contentTitle || browser.currentURI.spec;
      entry.title.textContent = label;
      entry.tab.title = label;
      if (entry == this.selected) {
        document.title = `${label} — Core`;
      }
    });

    // Un onglet qui joue du son n'est jamais déchargé.
    browser.addEventListener("DOMAudioPlaybackStarted", () => {
      entry.playing = true;
    });
    browser.addEventListener("DOMAudioPlaybackStopped", () => {
      entry.playing = false;
    });

    // L'écouteur est porté par le BrowsingContext de l'onglet : il survit aux
    // changements de processus (isolation par site), pas besoin de le
    // réattacher. Le réattacher échoue et interrompt le chargement.
    let listener = {
      QueryInterface: ChromeUtils.generateQI([
        "nsIWebProgressListener",
        "nsISupportsWeakReference",
      ]),
      onLocationChange(webProgress) {
        if (webProgress.isTopLevel && entry == gTabs.selected) {
          gToolbar.update();
        }
      },
      onStateChange(webProgress, request, stateFlags) {
        if (
          webProgress.isTopLevel &&
          stateFlags & Ci.nsIWebProgressListener.STATE_IS_NETWORK &&
          entry == gTabs.selected
        ) {
          gToolbar.update();
        }
      },
    };
    entry.progressListener = listener;
    browser.addProgressListener(
      listener,
      Ci.nsIWebProgress.NOTIFY_LOCATION | Ci.nsIWebProgress.NOTIFY_STATE_NETWORK
    );
  },
};

const gToolbar = {
  get urlbar() {
    return document.getElementById("urlbar");
  },

  init() {
    let browser = () => gTabs.selected.browser;
    document.getElementById("back").addEventListener("click", () => browser().goBack());
    document.getElementById("forward").addEventListener("click", () => browser().goForward());
    document.getElementById("reload").addEventListener("click", () => {
      if (browser().webProgress?.isLoadingDocument) {
        browser().stop();
      } else {
        browser().reload();
      }
    });
    document.getElementById("newtab").addEventListener("click", () => gTabs.open(null));
    document.getElementById("settings").addEventListener("click", openSettings);
    this.urlbar.addEventListener("keydown", event => {
      if (event.key == "Enter" && this.urlbar.value.trim()) {
        browser().fixupAndLoadURIString(this.urlbar.value.trim(), {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
        browser().focus();
      } else if (event.key == "Escape") {
        this.update();
      }
    });
    this.urlbar.addEventListener("focus", () => this.urlbar.select());
  },

  update() {
    let browser = gTabs.selected?.browser;
    if (!browser) {
      return;
    }
    let spec = browser.currentURI?.spec ?? "";
    this.urlbar.value = spec == "about:blank" ? "" : spec;
    document.getElementById("back").disabled = !browser.canGoBack;
    document.getElementById("forward").disabled = !browser.canGoForward;
    let reload = document.getElementById("reload");
    let loading = !!browser.webProgress?.isLoadingDocument;
    reload.toggleAttribute("loading", loading);
    reload.title = loading ? "Arrêter" : "Recharger (Ctrl+R)";
    reload.setAttribute("aria-label", loading ? "Arrêter" : "Recharger");
    let label = browser.contentTitle || spec;
    document.title = label ? `${label} — Core` : "Core";
  },
};

// Une seule fenêtre de réglages : on la ramène au premier plan si elle existe.
function openSettings() {
  let win = Services.wm.getMostRecentWindow("core:settings");
  if (win) {
    win.focus();
    return;
  }
  window.openDialog(
    "chrome://core/content/settings.xhtml",
    "",
    "chrome,dialog=no,resizable,centerscreen"
  );
}

// Raccourcis clavier, en phase de capture pour passer avant la page.
function onKeyDown(event) {
  let accel = AppConstants.platform == "macosx" ? event.metaKey : event.ctrlKey;
  let browser = gTabs.selected.browser;
  let handled = true;
  if (accel && event.key == "t") {
    gTabs.open(null);
  } else if (accel && event.key == "w") {
    gTabs.close(gTabs.selected);
  } else if ((accel && event.key == "l") || event.key == "F6") {
    gToolbar.urlbar.focus();
    gToolbar.urlbar.select();
  } else if ((accel && event.key == "r") || event.key == "F5") {
    browser.reload();
  } else if (event.altKey && event.key == "ArrowLeft") {
    browser.goBack();
  } else if (event.altKey && event.key == "ArrowRight") {
    browser.goForward();
  } else if (accel && event.key == "Tab") {
    let step = event.shiftKey ? -1 : 1;
    let index = gTabs.list.indexOf(gTabs.selected);
    gTabs.select(gTabs.list[(index + step + gTabs.list.length) % gTabs.list.length]);
  } else {
    handled = false;
  }
  if (handled) {
    event.preventDefault();
    event.stopPropagation();
  }
}

// Ouverture de nouvelles fenêtres par le contenu (target=_blank,
// window.open) ou par un autre programme : tout devient un onglet.
window.browserDOMWindow = {
  QueryInterface: ChromeUtils.generateQI(["nsIBrowserDOMWindow"]),

  createContentWindowInFrame(uri, params) {
    let entry = gTabs.open(null, {
      openWindowInfo: params.openWindowInfo,
      remoteType: params.openerBrowser?.remoteType,
    });
    return entry.browser;
  },

  openURIInFrame(uri, params) {
    return gTabs.open(uri?.spec ?? null, {
      openWindowInfo: params.openWindowInfo,
    }).browser;
  },

  createContentWindow() {
    throw Components.Exception("", Cr.NS_ERROR_NOT_IMPLEMENTED);
  },

  openURI(uri) {
    let entry = gTabs.open(uri?.spec ?? null);
    return entry.browser.browsingContext;
  },

  canClose() {
    return true;
  },

  get tabCount() {
    return gTabs.list.length;
  },
};

// Adresses passées en ligne de commande (premier lancement uniquement).
function urlsFromCommandLine() {
  let cmdLine = window.arguments?.[0];
  if (!(cmdLine instanceof Ci.nsICommandLine)) {
    return [];
  }
  let urls = [];
  for (let i = 0; i < cmdLine.length; i++) {
    let arg = cmdLine.getArgument(i);
    if (!arg.startsWith("-")) {
      try {
        urls.push(cmdLine.resolveURI(arg).spec);
      } catch (e) {
        urls.push(arg);
      }
    }
  }
  return urls;
}

window.addEventListener(
  "load",
  () => {
    var { AppConstants } = ChromeUtils.importESModule(
      "resource://gre/modules/AppConstants.sys.mjs"
    );
    var { E10SUtils } = ChromeUtils.importESModule(
      "resource://gre/modules/E10SUtils.sys.mjs"
    );
    window.AppConstants = AppConstants;
    window.E10SUtils = E10SUtils;

    gToolbar.init();
    window.addEventListener("keydown", onKeyDown, true);

    let urls = urlsFromCommandLine();
    if (!urls.length) {
      let { HomePage } = ChromeUtils.importESModule(
        "resource:///modules/HomePage.sys.mjs"
      );
      urls = [HomePage.get()];
    }
    urls.forEach((url, i) => gTabs.open(url, { select: i == 0 }));

    setInterval(() => gTabs.unloadIdle(), 60 * 1000);
    let onMemoryPressure = () => gTabs.unloadAll();
    Services.obs.addObserver(onMemoryPressure, "memory-pressure");
    window.addEventListener("unload", () =>
      Services.obs.removeObserver(onMemoryPressure, "memory-pressure")
    );
  },
  { once: true }
);
