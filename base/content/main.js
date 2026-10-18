/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Fenêtre principale de Core : barre d'outils, onglets et un <browser>
// distant (processus de contenu séparé et sandboxé) par onglet.

const HOMEPAGE_PREF = "core.homepage";

const gTabs = {
  list: [],
  selected: null,

  open(uri, { select = true, openWindowInfo = null, remoteType = null } = {}) {
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

    let tab = document.createElement("div");
    tab.className = "tab";
    tab.setAttribute("role", "tab");
    let title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = "Nouvel onglet";
    let close = document.createElement("button");
    close.className = "tab-close";
    close.textContent = "×";
    close.title = "Fermer l'onglet (Ctrl+W)";
    tab.append(title, close);

    let entry = { browser, tab, title };
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

    document.getElementById("tabstrip").append(tab);
    document.getElementById("browsers").append(browser);
    this.list.push(entry);
    this.watch(entry);

    if (uri) {
      browser.fixupAndLoadURIString(uri, {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
    }
    if (select || !this.selected) {
      this.select(entry);
    }
    return entry;
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
      this.selected.tab.removeAttribute("selected");
      this.selected.browser.removeAttribute("selected");
      this.selected.browser.docShellIsActive = false;
    }
    this.selected = entry;
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
    entry.browser.remove();
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

    // Le processus de contenu peut changer (isolation par site) : il faut
    // alors réattacher l'écouteur de progression.
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
    let attach = () =>
      browser.addProgressListener(
        listener,
        Ci.nsIWebProgress.NOTIFY_LOCATION | Ci.nsIWebProgress.NOTIFY_STATE_NETWORK
      );
    attach();
    browser.addEventListener("DidChangeBrowserRemoteness", attach);
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
    document.getElementById("reload").textContent = browser.webProgress
      ?.isLoadingDocument
      ? "×"
      : "↻";
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
      urls = [Services.prefs.getStringPref(HOMEPAGE_PREF, "about:blank")];
    }
    urls.forEach((url, i) => gTabs.open(url, { select: i == 0 }));
  },
  { once: true }
);
