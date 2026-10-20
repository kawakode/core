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
  // Écouteurs de progression de tous les onglets, appelés avec le <browser>
  // en premier argument (comme addTabsProgressListener de Firefox) : API
  // d'extensions tabs.onUpdated, webNavigation.
  progressListeners: new Set(),

  open(uri, { select = true, openWindowInfo = null, remoteType = null, triggeringPrincipal = null } = {}) {
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
    // L'élément de l'onglet sert d'onglet « natif » aux extensions
    // (core/extensions/parent/ext-core.js) et à WebDriver.
    tab.entry = entry;
    Object.defineProperty(tab, "linkedBrowser", { get: () => entry.browser });
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
    this.list.push(entry);
    this.attachBrowser(entry, uri, { openWindowInfo, remoteType, triggeringPrincipal });
    this.dispatch(entry, "TabOpen");

    if (select || !this.selected) {
      this.select(entry);
    }
    return entry;
  },

  attachBrowser(entry, uri, { openWindowInfo = null, remoteType = null, triggeringPrincipal = null } = {}) {
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
        triggeringPrincipal:
          triggeringPrincipal ?? Services.scriptSecurityManager.getSystemPrincipal(),
      });
    }
  },

  // Événements de tabbrowser (TabOpen, TabSelect, TabClose…), émis sur
  // l'élément de l'onglet et remontant jusqu'à la fenêtre.
  dispatch(entry, type, detail = {}) {
    entry.tab.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  },

  move(entry, index) {
    let from = this.list.indexOf(entry);
    index = Math.min(Math.max(index, 0), this.list.length - 1);
    if (from == -1 || from == index) {
      return;
    }
    this.list.splice(from, 1);
    this.list.splice(index, 0, entry);
    let next = this.list[index + 1];
    document.getElementById("tabstrip").insertBefore(entry.tab, next?.tab ?? null);
    this.dispatch(entry, "TabMove", { fromIndex: from, toIndex: index });
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
    let previous = this.selected;
    if (this.selected) {
      this.selected.lastSeen = Date.now();
      this.selected.tab.removeAttribute("selected");
      this.selected.browser.removeAttribute("selected");
      this.selected.browser.docShellIsActive = false;
    }
    this.selected = entry;
    this.restore(entry);
    entry.tab.setAttribute("selected", "true");
    entry.tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    entry.browser.setAttribute("selected", "true");
    entry.browser.docShellIsActive = true;
    gToolbar.update();
    this.dispatch(entry, "TabSelect", { previousTab: previous?.tab });
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
    this.dispatch(entry, "TabClose");
    this.list.splice(index, 1);
    if (this.selected == entry) {
      this.selected = null;
      this.select(this.list[Math.min(index, this.list.length - 1)]);
    }
    entry.tab.remove();
    entry.browser?.remove();
  },

  // Recharge un onglet déchargé depuis son adresse.
  restore(entry) {
    if (!entry.unloaded) {
      return;
    }
    let { uri } = entry.unloaded;
    entry.unloaded = null;
    entry.tab.removeAttribute("unloaded");
    this.attachBrowser(entry, uri);
    this.dispatch(entry, "TabBrowserInserted");
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
    this.dispatch(entry, "TabBrowserDiscarded");
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
        gToolbar.updateTitle(label);
      }
      this.dispatch(entry, "TabAttrModified", { changed: ["label"] });
    });

    // Un onglet qui joue du son n'est jamais déchargé.
    browser.addEventListener("DOMAudioPlaybackStarted", () => {
      entry.playing = true;
      this.dispatch(entry, "TabAttrModified", { changed: ["soundplaying"] });
    });
    browser.addEventListener("DOMAudioPlaybackStopped", () => {
      entry.playing = false;
      this.dispatch(entry, "TabAttrModified", { changed: ["soundplaying"] });
    });

    // L'écouteur est porté par le BrowsingContext de l'onglet : il survit aux
    // changements de processus (isolation par site), pas besoin de le
    // réattacher. Le réattacher échoue et interrompt le chargement.
    let listener = {
      QueryInterface: ChromeUtils.generateQI([
        "nsIWebProgressListener",
        "nsISupportsWeakReference",
      ]),
      onLocationChange(webProgress, ...args) {
        if (webProgress.isTopLevel && entry == gTabs.selected) {
          gToolbar.update();
        }
        gTabs.notifyProgress("onLocationChange", browser, webProgress, ...args);
      },
      onStateChange(webProgress, request, stateFlags, ...args) {
        if (
          webProgress.isTopLevel &&
          stateFlags & Ci.nsIWebProgressListener.STATE_IS_NETWORK &&
          entry == gTabs.selected
        ) {
          gToolbar.update();
        }
        gTabs.notifyProgress("onStateChange", browser, webProgress, request, stateFlags, ...args);
      },
    };
    entry.progressListener = listener;
    browser.addProgressListener(
      listener,
      Ci.nsIWebProgress.NOTIFY_LOCATION |
        Ci.nsIWebProgress.NOTIFY_STATE_NETWORK |
        Ci.nsIWebProgress.NOTIFY_STATE_WINDOW
    );
  },

  addTabsProgressListener(listener) {
    this.progressListeners.add(listener);
  },

  removeTabsProgressListener(listener) {
    this.progressListeners.delete(listener);
  },

  notifyProgress(method, ...args) {
    for (let listener of this.progressListeners) {
      try {
        listener[method]?.(...args);
      } catch (e) {
        console.error(e);
      }
    }
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
    this.initMenu();
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

  // Menu ≡ : menu de toolkit, stylé par main.css.
  initMenu() {
    let menu = document.getElementById("app-menu");
    let button = document.getElementById("menu-button");
    button.addEventListener("mousedown", event => {
      if (event.button == 0) {
        menu.openPopup(button, "after_end");
      }
    });
    button.addEventListener("keydown", event => {
      if (event.key == "Enter" || event.key == " ") {
        event.preventDefault();
        menu.openPopup(button, "after_end");
      }
    });
    if (AppConstants.platform == "macosx") {
      for (let item of menu.querySelectorAll("[acceltext]")) {
        item.setAttribute("acceltext", item.getAttribute("acceltext").replace("Ctrl+", "⌘"));
      }
    }
    let commands = {
      "menu-newtab": () => gTabs.open(null),
      "menu-addons": () => BrowserAddonUI.openAddonsMgr(),
      "menu-settings": openSettings,
      "menu-quit": quit,
    };
    menu.addEventListener("command", event => commands[event.target.id]?.());
  },

  update() {
    let browser = gTabs.selected?.browser;
    if (!browser) {
      return;
    }
    let spec = browser.currentURI?.spec ?? "";
    this.urlbar.value = spec == "about:blank" ? "" : spec;
    document.getElementById("back").disabled = !browser.canGoBack;
    document.getElementById("forward").hidden = !browser.canGoForward;
    let reload = document.getElementById("reload");
    let loading = !!browser.webProgress?.isLoadingDocument;
    reload.toggleAttribute("loading", loading);
    reload.title = loading ? "Arrêter" : "Recharger (Ctrl+R)";
    reload.setAttribute("aria-label", loading ? "Arrêter" : "Recharger");
    this.updateTitle(browser.contentTitle || spec);
  },

  // Titre de la fenêtre, précédé du préfixe éventuel d'une extension
  // (windows.update({ titlePreface })).
  updateTitle(label) {
    let preface = document.documentElement.getAttribute("titlepreface") ?? "";
    document.title = preface + (label ? `${label} — Core` : "Core");
  },
};

// Onglets dans la barre de titre : Core dessine la barre de titre et les
// boutons de la fenêtre. Le réglage browser.tabs.inTitlebar de Gecko (0 =
// barre du système, 1 = barre de Core, -1 = choix du système) est lu via
// Services.appinfo.drawInTitlebar ; les réglages de Core le modifient.
const gTitlebar = {
  PREF: "browser.tabs.inTitlebar",

  init() {
    // Sous Linux, seulement si le bureau sait dessiner une fenêtre sans
    // décoration (client-side decorations).
    this.supported =
      AppConstants.MOZ_WIDGET_TOOLKIT != "gtk" ||
      window.matchMedia("(-moz-gtk-csd-available)").matches;
    Services.prefs.addObserver(this.PREF, this);
    window.addEventListener("unload", () => Services.prefs.removeObserver(this.PREF, this));
    window.addEventListener("sizemodechange", () => this.update());

    document.getElementById("window-minimize").addEventListener("click", () => window.minimize());
    document.getElementById("window-maximize").addEventListener("click", () => {
      if (window.windowState == window.STATE_MAXIMIZED) {
        window.restore();
      } else {
        window.maximize();
      }
    });
    document.getElementById("window-close").addEventListener("click", () => window.close());
    this.update();
  },

  observe() {
    this.update();
  },

  update() {
    document.documentElement.toggleAttribute(
      "customtitlebar",
      this.supported && Services.appinfo.drawInTitlebar && !window.fullScreen
    );
    let maximized = window.windowState == window.STATE_MAXIMIZED;
    let button = document.getElementById("window-maximize");
    button.title = maximized ? "Restaurer" : "Agrandir";
    button.setAttribute("aria-label", button.title);
  },
};

function quit() {
  Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
}

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

// Ouvre une adresse dans un onglet, ou bascule sur l'onglet qui l'affiche déjà.
function switchToTabHavingURI(url, openNew = true, { triggeringPrincipal = null } = {}) {
  let spec = url instanceof Ci.nsIURI ? url.spec : url;
  // Les réglages de Core sont une fenêtre, pas une page about:.
  if (/^about:(preferences|settings)\b/.test(spec)) {
    openSettings();
    return true;
  }
  let entry = gTabs.list.find(
    e => (e.browser?.currentURI.spec ?? e.unloaded?.uri) == spec
  );
  if (entry) {
    gTabs.select(entry);
    return true;
  }
  if (openNew) {
    gTabs.open(spec, { triggeringPrincipal });
  }
  return false;
}

// Fonctions de browser/ que toolkit/ appelle sur la fenêtre principale
// (about:addons, gestionnaire de téléchargements…). Tout s'ouvre en onglet.
function openTrustedLinkIn(url, where, { triggeringPrincipal = null } = {}) {
  gTabs.open(url, { triggeringPrincipal });
}

function openWebLinkIn(url, where, { triggeringPrincipal = null } = {}) {
  gTabs.open(url, {
    triggeringPrincipal:
      triggeringPrincipal ?? Services.scriptSecurityManager.createNullPrincipal({}),
  });
}

var BrowserAddonUI = {
  // view : par exemple "addons://detail/<id>/preferences".
  async openAddonsMgr(view) {
    switchToTabHavingURI("about:addons");
    if (!view) {
      return;
    }
    let browser = gTabs.selected.browser;
    let win = browser.contentWindow;
    if (!win?.loadView || win.document.readyState != "complete") {
      win = await new Promise(resolve => {
        let observer = subject => {
          if (subject.docShell?.chromeEventHandler == browser) {
            Services.obs.removeObserver(observer, "EM-loaded");
            resolve(subject);
          }
        };
        Services.obs.addObserver(observer, "EM-loaded");
      });
    }
    win.loadView(view);
  },

  // Appelé par about:addons avant de supprimer une extension.
  async promptRemoveExtension(addon) {
    let remove = Services.prompt.confirm(
      window,
      "Supprimer l'extension",
      `Supprimer ${addon.name} de Core ?`
    );
    return { remove, report: false };
  },
};

// Raccourcis clavier, en phase de capture pour passer avant la page.
function onKeyDown(event) {
  let accel = AppConstants.platform == "macosx" ? event.metaKey : event.ctrlKey;
  let browser = gTabs.selected.browser;
  let handled = true;
  if (accel && event.key == "t") {
    gTabs.open(null);
  } else if (accel && event.shiftKey && event.key.toLowerCase() == "a") {
    BrowserAddonUI.openAddonsMgr();
  } else if (accel && event.key == "q") {
    quit();
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

// Adresses à ouvrir dans une nouvelle fenêtre : ligne de commande (premier
// lancement), ou arguments de Services.ww.openWindow comme Firefox les
// passe (API d'extensions windows.create) : une adresse, une liste
// d'adresses ou un onglet d'une autre fenêtre à déplacer ici.
function urlsFromArguments() {
  let arg = window.arguments?.[0];
  if (arg instanceof Ci.nsICommandLine) {
    let urls = [];
    for (let i = 0; i < arg.length; i++) {
      let value = arg.getArgument(i);
      if (!value.startsWith("-")) {
        try {
          urls.push(arg.resolveURI(value).spec);
        } catch (e) {
          urls.push(value);
        }
      }
    }
    return { urls };
  }
  let triggeringPrincipal = window.arguments?.[8] ?? null;
  if (typeof arg == "string") {
    return { urls: [arg], triggeringPrincipal };
  }
  if (arg instanceof Ci.nsIArray) {
    let urls = Array.from(arg.enumerate(Ci.nsISupportsString), str => str.data);
    return { urls, triggeringPrincipal };
  }
  if (arg?.entry) {
    let { entry } = arg;
    let url = entry.browser?.currentURI.spec ?? entry.unloaded?.uri;
    arg.documentGlobal.gTabs.close(entry);
    return { urls: [url] };
  }
  return { urls: [] };
}

// Interface minimale de gBrowser attendue par WebDriver (remote/shared/TabManager).
var gBrowser = {
  get tabs() {
    return gTabs.list.map(entry => this._tab(entry));
  },
  get selectedTab() {
    return gTabs.selected && this._tab(gTabs.selected);
  },
  set selectedTab(tab) {
    gTabs.select(tab.entry);
  },
  get selectedBrowser() {
    return gTabs.selected?.browser ?? null;
  },
  getTabForBrowser(browser) {
    let entry = gTabs.list.find(e => e.browser == browser);
    return entry ? this._tab(entry) : null;
  },
  addTab(uri) {
    return this._tab(gTabs.open(uri, { select: false }));
  },
  removeTab(tab) {
    gTabs.close(tab.entry);
  },
  updateTitlebar() {
    gToolbar.update();
  },
  addEventListener(...args) {
    window.addEventListener(...args);
  },
  removeEventListener(...args) {
    window.removeEventListener(...args);
  },
  _tab(entry) {
    return entry.tab;
  },
};
// Core n'a pas de barre latérale : les raccourcis clavier d'extensions
// (toolkit/components/extensions/ExtensionShortcuts.sys.mjs) appellent
// quand même ceci pour _execute_sidebar_action.
var SidebarController = {
  updateShortcut() {},
};

var gBrowserInit = {
  delayedStartupFinished: false,
  // Core ne déplace pas d'onglet d'une fenêtre à l'autre (lu par l'API
  // d'extensions webNavigation).
  isAdoptingTab() {
    return false;
  },
};

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
    gTitlebar.init();
    window.addEventListener("keydown", onKeyDown, true);

    // window.close() d'une page (fenêtres surgissantes, connexions OAuth) :
    // relayé par toolkit/actors/BrowserElementParent.sys.mjs.
    document.getElementById("browsers").addEventListener("DOMWindowClose", event => {
      let entry = gTabs.list.find(e => e.browser == event.target);
      if (entry) {
        event.preventDefault();
        gTabs.close(entry);
      }
    });

    // Molette sur les onglets : défilement horizontal, sans flèches.
    let tabstrip = document.getElementById("tabstrip");
    tabstrip.addEventListener("wheel", event => {
      if (!event.deltaX) {
        tabstrip.scrollLeft += event.deltaY * (event.deltaMode ? 40 : 1);
        event.preventDefault();
      }
    }, { passive: false });

    let { urls, triggeringPrincipal } = urlsFromArguments();
    if (!urls.length) {
      let { HomePage } = ChromeUtils.importESModule(
        "resource:///modules/HomePage.sys.mjs"
      );
      urls = [HomePage.get()];
    }
    urls.forEach((url, i) => gTabs.open(url, { select: i == 0, triggeringPrincipal }));

    gBrowserInit.delayedStartupFinished = true;
    Services.obs.notifyObservers(window, "browser-delayed-startup-finished");
    Services.tm.idleDispatchToMainThread(() =>
      Services.obs.notifyObservers(null, "browser-idle-startup-tasks-finished")
    );

    setInterval(() => gTabs.unloadIdle(), 60 * 1000);
    let onMemoryPressure = () => gTabs.unloadAll();
    Services.obs.addObserver(onMemoryPressure, "memory-pressure");
    window.addEventListener("unload", () =>
      Services.obs.removeObserver(onMemoryPressure, "memory-pressure")
    );
  },
  { once: true }
);
