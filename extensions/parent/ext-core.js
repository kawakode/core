/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Équivalent pour Core de browser/components/extensions/parent/ext-browser.js :
// tabTracker, windowTracker et les classes Tab/Window sur lesquelles reposent
// les API d'extensions (tabs, windows, browserAction, webRequest,
// webNavigation…). Tout est posé sur |global|, partagé par les scripts ext-*.
//
// L'onglet « natif » est l'élément .tab de main.xhtml : il porte entry
// (l'entrée de gTabs) et linkedBrowser, qui vaut null quand l'onglet est
// déchargé. Les événements TabOpen, TabSelect, TabClose, TabAttrModified…
// sont émis par gTabs (core/base/content/main.js).

ChromeUtils.defineESModuleGetters(this, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
});

var { ExtensionError } = ExtensionUtils;

var { defineLazyGetter } = ExtensionCommon;

let tabTracker;
let windowTracker;

/* eslint-disable mozilla/balanced-listeners */
extensions.on("uninstalling", (msg, extension) => {
  if (extension.uninstallURL) {
    windowTracker.topWindow?.gTabs.open(extension.uninstallURL, {
      triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({}),
    });
  }
});

// Ferme les onglets d'une extension qui s'arrête.
extensions.on("page-shutdown", (type, context) => {
  if (context.viewType != "tab") {
    return;
  }
  if (context.extension.id !== context.xulBrowser.contentPrincipal.addonId) {
    return;
  }
  let nativeTab = tabTracker.getTabForBrowser(context.xulBrowser);
  if (nativeTab) {
    nativeTab.documentGlobal.gTabs.close(nativeTab.entry);
  }
});
/* eslint-enable mozilla/balanced-listeners */

// runtime.openOptionsPage() : page d'options dans about:addons, ou dans un
// onglet si l'extension le demande (open_in_tab).
global.openOptionsPage = extension => {
  let window = windowTracker.topWindow;
  if (!window) {
    return Promise.reject({ message: "No browser window available" });
  }
  const { optionsPageProperties } = extension;
  if (!optionsPageProperties) {
    return Promise.reject({ message: "No options page" });
  }
  if (optionsPageProperties.open_in_tab) {
    window.switchToTabHavingURI(optionsPageProperties.page, true, {
      triggeringPrincipal: extension.principal,
    });
    return Promise.resolve();
  }
  return window.BrowserAddonUI.openAddonsMgr(
    `addons://detail/${encodeURIComponent(extension.id)}/preferences`
  );
};

global.makeWidgetId = id => {
  id = id.toLowerCase();
  return id.replace(/[^a-z0-9_-]/g, "_");
};

global.clickModifiersFromEvent = event => {
  const map = {
    shiftKey: "Shift",
    altKey: "Alt",
    metaKey: "Command",
    ctrlKey: "Ctrl",
  };
  let modifiers = Object.keys(map)
    .filter(key => event[key])
    .map(key => map[key]);
  if (event.ctrlKey && AppConstants.platform === "macosx") {
    modifiers.push("MacCtrl");
  }
  return modifiers;
};

/**
 * Données propres à un onglet ou à une fenêtre (icône, badge d'un bouton
 * d'extension…), et relais des changements d'onglet et d'adresse.
 * Même interface que celle de ext-browser.js, utilisée par ExtensionActions.
 */
global.TabContext = class extends EventEmitter {
  constructor(getDefaultPrototype) {
    super();
    this.getDefaultPrototype = getDefaultPrototype;
    this.tabData = new WeakMap();
    windowTracker.addListener("progress", this);
    windowTracker.addListener("TabSelect", this);
  }

  get(keyObject) {
    if (!this.tabData.has(keyObject)) {
      let data = Object.create(this.getDefaultPrototype(keyObject));
      this.tabData.set(keyObject, data);
    }
    return this.tabData.get(keyObject);
  }

  clear(keyObject) {
    this.tabData.delete(keyObject);
  }

  handleEvent(event) {
    if (event.type == "TabSelect") {
      let nativeTab = event.target;
      this.emit("tab-select", nativeTab);
      this.emit("location-change", nativeTab);
    }
  }

  onLocationChange(browser, webProgress, request, locationURI, flags) {
    if (!webProgress.isTopLevel) {
      return;
    }
    let tab = tabTracker.getTabForBrowser(browser);
    if (!tab) {
      return;
    }
    let fromBrowse = !(
      flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT
    );
    this.emit("location-change", tab, fromBrowse);
  }

  shutdown() {
    windowTracker.removeListener("progress", this);
    windowTracker.removeListener("TabSelect", this);
  }
};

class WindowTracker extends WindowTrackerBase {
  addProgressListener(window, listener) {
    window.gTabs.addTabsProgressListener(listener);
  }

  removeProgressListener(window, listener) {
    window.gTabs.removeTabsProgressListener(listener);
  }

  // Core n'a ni navigation privée ni fenêtres surgissantes.
  getTopNormalWindow() {
    return BrowserWindowTracker.getTopWindow();
  }
}

class TabTracker extends TabTrackerBase {
  constructor() {
    super();
    this._tabs = new WeakMap();
    this._tabIds = new Map();
    this._nextId = 1;
    this._handleTabDestroyed = this._handleTabDestroyed.bind(this);
  }

  init() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    windowTracker.addListener("TabClose", this);
    windowTracker.addListener("TabOpen", this);
    windowTracker.addListener("TabSelect", this);
    windowTracker.addOpenListener(window => this._handleWindowOpen(window));
    windowTracker.addCloseListener(window => this._handleWindowClose(window));

    /* eslint-disable mozilla/balanced-listeners */
    this.on("tab-removed", this._handleTabDestroyed);
    /* eslint-enable mozilla/balanced-listeners */
  }

  getId(nativeTab) {
    let id = this._tabs.get(nativeTab);
    if (id) {
      return id;
    }
    this.init();
    id = this._nextId++;
    this._tabs.set(nativeTab, id);
    this._tabIds.set(id, nativeTab);
    return id;
  }

  getTabForBrowser(browser) {
    let window = browser.documentGlobal;
    if (!window?.gTabs) {
      // Page d'options d'une extension dans about:addons : on remonte à
      // l'onglet qui affiche about:addons.
      if (browser.id === "addon-inline-options") {
        let outer = window?.docShell.chromeEventHandler;
        return outer ? this.getTabForBrowser(outer) : null;
      }
      return null;
    }
    return window.gTabs.list.find(entry => entry.browser == browser)?.tab ?? null;
  }

  _handleTabDestroyed(event, { nativeTab }) {
    let id = this._tabs.get(nativeTab);
    if (id) {
      this._tabs.delete(nativeTab);
      if (this._tabIds.get(id) === nativeTab) {
        this._tabIds.delete(id);
      }
    }
  }

  getTab(tabId, default_ = undefined) {
    let nativeTab = this._tabIds.get(tabId);
    if (nativeTab) {
      return nativeTab;
    }
    if (default_ !== undefined) {
      return default_;
    }
    throw new ExtensionError(`Invalid tab ID: ${tabId}`);
  }

  handleEvent(event) {
    let nativeTab = event.target;
    switch (event.type) {
      case "TabOpen":
        this.emit("tab-created", { nativeTab });
        break;
      case "TabClose":
        this.emitRemoved(nativeTab, false);
        break;
      case "TabSelect":
        this.emitActivated(nativeTab, event.detail.previousTab);
        break;
    }
  }

  _handleWindowOpen(window) {
    for (let { tab } of window.gTabs.list) {
      this.emit("tab-created", { nativeTab: tab });
    }
    if (window.gTabs.selected) {
      this.emitActivated(window.gTabs.selected.tab);
    }
  }

  _handleWindowClose(window) {
    for (let { tab } of window.gTabs.list) {
      this.emitRemoved(tab, true);
    }
  }

  emitActivated(nativeTab, previousTab = undefined) {
    this.emit("tab-activated", {
      tabId: this.getId(nativeTab),
      previousTabId:
        previousTab?.isConnected ? this.getId(previousTab) : undefined,
      previousTabIsPrivate: false,
      windowId: windowTracker.getId(nativeTab.documentGlobal),
      nativeTab,
    });
  }

  emitRemoved(nativeTab, isWindowClosing) {
    this.emit("tab-removed", {
      nativeTab,
      tabId: this.getId(nativeTab),
      windowId: windowTracker.getId(nativeTab.documentGlobal),
      isWindowClosing,
    });
  }

  getBrowserData(browser) {
    let window = browser.documentGlobal;
    if (!window) {
      return { tabId: -1, windowId: -1 };
    }
    const nativeTab = this.getTabForBrowser(browser);
    if (nativeTab) {
      window = nativeTab.documentGlobal;
    } else {
      // Fenêtre surgissante d'un bouton d'extension : pas d'onglet, mais une
      // fenêtre. Page d'arrière-plan : ni l'un ni l'autre.
      window = window.browsingContext.topChromeWindow;
      if (!window || !windowTracker.isBrowserWindow(window)) {
        return { tabId: -1, windowId: -1 };
      }
    }
    return {
      tabId: nativeTab ? this.getId(nativeTab) : -1,
      windowId: windowTracker.getId(window),
    };
  }

  get activeTab() {
    return windowTracker.topWindow?.gTabs.selected?.tab ?? null;
  }
}

windowTracker = new WindowTracker();
tabTracker = new TabTracker();

Object.assign(global, { tabTracker, windowTracker });

class Tab extends TabBase {
  get entry() {
    return this.nativeTab.entry;
  }

  // Les onglets déchargés n'ont pas de <browser> : adresse et titre viennent
  // alors de l'entrée de gTabs.
  get _url() {
    return this.browser?.currentURI.spec ?? this.entry.unloaded?.uri ?? "about:blank";
  }

  get _uri() {
    return this.browser?.currentURI ?? Services.io.newURI(this._url);
  }

  get _title() {
    return this.browser?.contentTitle || this.entry.title.textContent;
  }

  get _favIconUrl() {
    return undefined;
  }

  get _incognito() {
    return false;
  }

  get innerWindowID() {
    return this.browser?.innerWindowID ?? 0;
  }

  get attention() {
    return false;
  }

  get audible() {
    return !!this.entry.playing;
  }

  get autoDiscardable() {
    return true;
  }

  get browser() {
    return this.nativeTab.linkedBrowser;
  }

  get browsingContext() {
    return this.browser?.browsingContext ?? null;
  }

  get discarded() {
    return !this.browser;
  }

  get frameLoader() {
    return this.browser?.frameLoader || { lazyWidth: 0, lazyHeight: 0 };
  }

  get hidden() {
    return false;
  }

  get sharingState() {
    return { camera: false, microphone: false, screen: undefined };
  }

  get cookieStoreId() {
    return DEFAULT_STORE;
  }

  get openerTabId() {
    return null;
  }

  get height() {
    return this.frameLoader.lazyHeight;
  }

  get width() {
    return this.frameLoader.lazyWidth;
  }

  get index() {
    return this.window.gTabs.list.indexOf(this.entry);
  }

  get mutedInfo() {
    return { muted: false };
  }

  get lastAccessed() {
    return this.entry.lastSeen;
  }

  get pinned() {
    return false;
  }

  get active() {
    return this.window.gTabs.selected == this.entry;
  }

  get highlighted() {
    return this.active;
  }

  get status() {
    return this.browser?.webProgress?.isLoadingDocument ? "loading" : "complete";
  }

  get window() {
    return this.nativeTab.documentGlobal;
  }

  get windowId() {
    return windowTracker.getId(this.window);
  }

  get isArticle() {
    return false;
  }

  get isInReaderMode() {
    return false;
  }

  get successorTabId() {
    return -1;
  }

  get groupId() {
    return -1;
  }

  get splitViewId() {
    return -1;
  }
}

class Window extends WindowBase {
  updateGeometry(options) {
    let { window } = this;
    if (options.left !== null || options.top !== null) {
      let left = options.left !== null ? options.left : window.screenX;
      let top = options.top !== null ? options.top : window.screenY;
      window.moveTo(left, top);
    }
    if (options.width !== null || options.height !== null) {
      let width = options.width !== null ? options.width : window.outerWidth;
      let height = options.height !== null ? options.height : window.outerHeight;
      window.resizeTo(width, height);
    }
  }

  get _title() {
    return this.window.document.title;
  }

  setTitlePreface(titlePreface) {
    this.window.document.documentElement.setAttribute("titlepreface", titlePreface);
  }

  get focused() {
    return this.window.document.hasFocus();
  }

  get top() {
    return this.window.screenY;
  }

  get left() {
    return this.window.screenX;
  }

  get width() {
    return this.window.outerWidth;
  }

  get height() {
    return this.window.outerHeight;
  }

  get incognito() {
    return false;
  }

  get alwaysOnTop() {
    return false;
  }

  get isLastFocused() {
    return this.window === windowTracker.topWindow;
  }

  static getState(window) {
    const STATES = {
      [window.STATE_MAXIMIZED]: "maximized",
      [window.STATE_MINIMIZED]: "minimized",
      [window.STATE_FULLSCREEN]: "fullscreen",
      [window.STATE_NORMAL]: "normal",
    };
    return STATES[window.windowState];
  }

  get state() {
    return Window.getState(this.window);
  }

  async setState(state) {
    let { window } = this;
    switch (state) {
      case "maximized":
        window.maximize();
        break;
      case "minimized":
      case "docked":
        window.minimize();
        break;
      case "normal":
        if (window.fullScreen) {
          window.fullScreen = false;
        }
        window.restore();
        break;
      case "fullscreen":
        window.fullScreen = true;
        break;
      default:
        throw new Error(`Unexpected window state: ${state}`);
    }
  }

  *getTabs() {
    let { tabManager } = this.extension;
    for (let { tab } of this.window.gTabs.list) {
      yield tabManager.getWrapper(tab);
    }
  }

  *getHighlightedTabs() {
    let tab = this.activeTab;
    if (tab) {
      yield tab;
    }
  }

  get activeTab() {
    let selected = this.window.gTabs.selected;
    return selected ? this.extension.tabManager.getWrapper(selected.tab) : null;
  }

  getTabAtIndex(index) {
    let entry = this.window.gTabs.list[index];
    return entry ? this.extension.tabManager.getWrapper(entry.tab) : undefined;
  }
}

Object.assign(global, { Tab, Window });

class TabManager extends TabManagerBase {
  get(tabId, default_ = undefined) {
    let nativeTab = tabTracker.getTab(tabId, default_);
    if (nativeTab) {
      return this.getWrapper(nativeTab);
    }
    return default_;
  }

  addActiveTabPermission(nativeTab = tabTracker.activeTab) {
    return super.addActiveTabPermission(nativeTab);
  }

  revokeActiveTabPermission(nativeTab = tabTracker.activeTab) {
    return super.revokeActiveTabPermission(nativeTab);
  }

  canAccessTab() {
    return true;
  }

  wrapTab(nativeTab) {
    return new Tab(this.extension, nativeTab, tabTracker.getId(nativeTab));
  }
}

class WindowManager extends WindowManagerBase {
  get(windowId, context) {
    let window = windowTracker.getWindow(windowId, context);
    return this.getWrapper(window);
  }

  *getAll(context) {
    for (let window of windowTracker.browserWindows()) {
      if (!this.canAccessWindow(window, context)) {
        continue;
      }
      let wrapped = this.getWrapper(window);
      if (wrapped) {
        yield wrapped;
      }
    }
  }

  wrapWindow(window) {
    return new Window(this.extension, window, windowTracker.getId(window));
  }
}

// eslint-disable-next-line mozilla/balanced-listeners
extensions.on("startup", (type, extension) => {
  defineLazyGetter(extension, "tabManager", () => new TabManager(extension));
  defineLazyGetter(extension, "windowManager", () => new WindowManager(extension));
});
