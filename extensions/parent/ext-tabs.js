/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// API tabs pour les onglets de Core. Reprend la logique de
// browser/components/extensions/parent/ext-tabs.js pour ce que Core sait
// faire ; le reste (épingler, masquer, grouper, couper le son…) répond par
// une erreur explicite. tabs.connect et tabs.sendMessage sont côté enfant
// (browser/components/extensions/child/ext-tabs.js, repris tel quel).

var { ExtensionError } = ExtensionUtils;

const allAttrs = new Set(["audible", "title"]);
const allProperties = new Set([
  "attention",
  "audible",
  "autoDiscardable",
  "discarded",
  "favIconUrl",
  "groupId",
  "splitViewId",
  "hidden",
  "isArticle",
  "mutedInfo",
  "openerTabId",
  "pinned",
  "sharingState",
  "status",
  "title",
  "url",
]);
const restricted = new Set(["url", "favIconUrl", "title"]);

function unsupported(name) {
  return () => Promise.reject({ message: `tabs.${name}() n'est pas pris en charge par Core` });
}

this.tabs = class extends ExtensionAPIPersistent {
  tabEventRegistrar({ event, listener }) {
    return ({ fire }) => {
      let listener2 = (eventName, eventData, ...args) => {
        listener(fire, eventData, ...args);
      };
      tabTracker.on(event, listener2);
      return {
        unregister() {
          tabTracker.off(event, listener2);
        },
        convert(_fire) {
          fire = _fire;
        },
      };
    };
  }

  PERSISTENT_EVENTS = {
    onActivated: this.tabEventRegistrar({
      event: "tab-activated",
      listener: (fire, event) => {
        let { tabId, windowId, previousTabId } = event;
        fire.async({ tabId, previousTabId, windowId });
      },
    }),
    onCreated: this.tabEventRegistrar({
      event: "tab-created",
      listener: (fire, event) => {
        let { tabManager } = this.extension;
        fire.async(tabManager.convert(event.nativeTab));
      },
    }),
    onRemoved: this.tabEventRegistrar({
      event: "tab-removed",
      listener: (fire, event) => {
        fire.async(event.tabId, {
          windowId: event.windowId,
          isWindowClosing: event.isWindowClosing,
        });
      },
    }),
    // Un seul onglet actif par fenêtre : onHighlighted suit onActivated.
    onHighlighted: this.tabEventRegistrar({
      event: "tab-activated",
      listener: (fire, event) => {
        fire.async({ tabIds: [event.tabId], windowId: event.windowId });
      },
    }),
    onMoved({ fire }) {
      let listener = event => {
        let nativeTab = event.target;
        fire.async(tabTracker.getId(nativeTab), {
          windowId: windowTracker.getId(nativeTab.documentGlobal),
          fromIndex: event.detail.fromIndex,
          toIndex: event.detail.toIndex,
        });
      };
      windowTracker.addListener("TabMove", listener);
      return {
        unregister() {
          windowTracker.removeListener("TabMove", listener);
        },
        convert(_fire) {
          fire = _fire;
        },
      };
    },

    onUpdated({ fire, context }, params) {
      let { extension } = this;
      let { tabManager } = extension;
      let [filterProps] = params;
      let filter = { ...filterProps };
      if (filter.urls) {
        filter.urls = new MatchPatternSet(filter.urls, { restrictSchemes: false });
      }
      let needsModified = true;
      if (filter.properties) {
        needsModified = filter.properties.some(p => allAttrs.has(p));
        filter.properties = new Set(filter.properties);
      } else {
        filter.properties = allProperties;
      }

      function sanitize(tab, changeInfo) {
        let result = {};
        let nonempty = false;
        for (let prop in changeInfo) {
          if (!restricted.has(prop) || tab.hasTabPermission) {
            nonempty = true;
            result[prop] = changeInfo[prop];
          }
        }
        return nonempty && result;
      }

      function getWindowID(windowId) {
        if (windowId === Window.WINDOW_ID_CURRENT) {
          let window = windowTracker.getTopWindow(context);
          return window ? windowTracker.getId(window) : undefined;
        }
        return windowId;
      }

      function matchFilters(tab) {
        if (!filterProps) {
          return true;
        }
        if (filter.tabId != null && tab.id != filter.tabId) {
          return false;
        }
        if (filter.windowId != null && tab.windowId != getWindowID(filter.windowId)) {
          return false;
        }
        if (filter.cookieStoreId != null && filter.cookieStoreId !== tab.cookieStoreId) {
          return false;
        }
        if (filter.urls) {
          return filter.urls.matches(tab._uri) && tab.hasTabPermission;
        }
        return true;
      }

      let fireForTab = (tab, changed, nativeTab) => {
        if (!tab || !matchFilters(tab)) {
          return;
        }
        let changeInfo = sanitize(tab, changed);
        if (changeInfo && nativeTab.isConnected) {
          fire.async(tab.id, changeInfo, tab.convert());
        }
      };

      let listener = event => {
        let nativeTab = event.target;
        let needed = [];
        if (event.type == "TabAttrModified") {
          let { changed } = event.detail;
          if (changed.includes("soundplaying") && filter.properties.has("audible")) {
            needed.push("audible");
          }
          if (changed.includes("label") && filter.properties.has("title")) {
            needed.push("title");
          }
        } else if (event.type == "TabBrowserInserted" || event.type == "TabBrowserDiscarded") {
          needed.push("discarded");
        }
        if (!needed.length) {
          return;
        }
        let tab = tabManager.getWrapper(nativeTab);
        let changeInfo = {};
        for (let prop of needed) {
          changeInfo[prop] = tab[prop];
        }
        fireForTab(tab, changeInfo, nativeTab);
      };

      let statusListener = ({ browser, status, url }) => {
        let nativeTab = tabTracker.getTabForBrowser(browser);
        if (!nativeTab) {
          return;
        }
        let changed = {};
        if (filter.properties.has("status")) {
          changed.status = status;
        }
        if (url && filter.properties.has("url")) {
          changed.url = url;
        }
        fireForTab(tabManager.wrapTab(nativeTab), changed, nativeTab);
      };

      let listeners = new Map();
      if (filter.properties.has("status") || filter.properties.has("url")) {
        listeners.set("status", statusListener);
      }
      if (needsModified) {
        listeners.set("TabAttrModified", listener);
      }
      if (filter.properties.has("discarded")) {
        listeners.set("TabBrowserInserted", listener);
        listeners.set("TabBrowserDiscarded", listener);
      }
      for (let [name, l] of listeners) {
        windowTracker.addListener(name, l);
      }
      return {
        unregister() {
          for (let [name, l] of listeners) {
            windowTracker.removeListener(name, l);
          }
        },
        convert(_fire, _context) {
          fire = _fire;
          context = _context;
        },
      };
    },
  };

  getAPI(context) {
    let { extension } = context;
    let { tabManager, windowManager } = extension;
    let extensionApi = this;
    let module = "tabs";

    function getTabOrActive(tabId) {
      let tab = tabId !== null ? tabTracker.getTab(tabId) : tabTracker.activeTab;
      if (!tab) {
        throw new ExtensionError(
          tabId === null ? "Cannot access activeTab" : `Invalid tab ID: ${tabId}`
        );
      }
      return tab;
    }

    function getNativeTabsFromIDArray(tabIds) {
      return [].concat(tabIds).map(tabId => tabTracker.getTab(tabId));
    }

    // Un onglet déchargé est rechargé avant d'y toucher.
    function ensureBrowser(nativeTab) {
      nativeTab.documentGlobal.gTabs.restore(nativeTab.entry);
      return nativeTab.linkedBrowser;
    }

    async function promiseTabWhenReady(tabId) {
      let nativeTab = getTabOrActive(tabId);
      ensureBrowser(nativeTab);
      await tabTracker.awaitTabReady(nativeTab);
      return tabManager.getWrapper(nativeTab);
    }

    // Comme Firefox : une extension peut ouvrir about: et moz-extension:
    // dans un onglet sans y avoir accès, avec le principal de la page ouverte.
    function contentPrincipalFor(url) {
      return Services.scriptSecurityManager.createContentPrincipal(
        Services.io.newURI(url),
        {}
      );
    }

    let event = name =>
      new EventManager({ context, module, event: name, extensionApi }).api();

    return {
      tabs: {
        onActivated: event("onActivated"),
        onCreated: event("onCreated"),
        onHighlighted: event("onHighlighted"),
        onRemoved: event("onRemoved"),
        onMoved: event("onMoved"),
        onUpdated: event("onUpdated"),
        onAttached: new EventManager({
          context,
          name: "tabs.onAttached",
          register: () => () => {},
        }).api(),
        onDetached: new EventManager({
          context,
          name: "tabs.onDetached",
          register: () => () => {},
        }).api(),
        onReplaced: new EventManager({
          context,
          name: "tabs.onReplaced",
          register: () => () => {},
        }).api(),
        onZoomChange: new EventManager({
          context,
          name: "tabs.onZoomChange",
          register: () => () => {},
        }).api(),

        async create(createProperties) {
          let window =
            createProperties.windowId !== null
              ? windowTracker.getWindow(createProperties.windowId, context)
              : windowTracker.getTopNormalWindow(context);
          if (!window) {
            throw new ExtensionError("Not allowed to create tabs on the target window");
          }
          if (!window.gBrowserInit?.delayedStartupFinished) {
            await ExtensionUtils.promiseObserved(
              "browser-delayed-startup-finished",
              win => win == window
            );
          }

          let url = null;
          let triggeringPrincipal = context.principal;
          if (createProperties.url !== null) {
            url = context.uri.resolve(createProperties.url);
            if (
              !ExtensionUtils.isExtensionUrl(url) &&
              !context.checkLoadURL(url, { dontReportErrors: true })
            ) {
              throw new ExtensionError(`Illegal URL: ${url}`);
            }
            if (url.startsWith("about:") || ExtensionUtils.isExtensionUrl(url)) {
              triggeringPrincipal = contentPrincipalFor(url);
            }
          }
          if (createProperties.discarded) {
            throw new ExtensionError("Core ne sait pas créer un onglet déjà déchargé");
          }

          let active = createProperties.active ?? true;
          let entry = window.gTabs.open(url, { select: active, triggeringPrincipal });
          if (createProperties.index != null) {
            window.gTabs.move(entry, createProperties.index);
          }
          tabTracker.addTabReadyBlocker(entry.tab);
          return tabManager.convert(entry.tab);
        },

        async remove(tabIds) {
          for (let nativeTab of getNativeTabsFromIDArray(tabIds)) {
            nativeTab.documentGlobal.gTabs.close(nativeTab.entry);
          }
        },

        async discard(tabIds) {
          for (let nativeTab of getNativeTabsFromIDArray(tabIds)) {
            nativeTab.documentGlobal.gTabs.unload(nativeTab.entry);
          }
        },

        async update(tabId, updateProperties) {
          let nativeTab = getTabOrActive(tabId);
          let gTabs = nativeTab.documentGlobal.gTabs;

          if (updateProperties.url !== null) {
            let url = context.uri.resolve(updateProperties.url);
            let options = {
              loadFlags: updateProperties.loadReplace
                ? Ci.nsIWebNavigation.LOAD_FLAGS_REPLACE_HISTORY
                : Ci.nsIWebNavigation.LOAD_FLAGS_NONE,
              triggeringPrincipal: context.principal,
            };
            if (!context.checkLoadURL(url, { dontReportErrors: true })) {
              if (ExtensionUtils.isExtensionUrl(url)) {
                options.triggeringPrincipal = contentPrincipalFor(url);
              } else {
                throw new ExtensionError(`Illegal URL: ${url}`);
              }
            }
            ensureBrowser(nativeTab).fixupAndLoadURIString(url, options);
          }
          if (updateProperties.active || updateProperties.highlighted) {
            gTabs.select(nativeTab.entry);
          }
          return tabManager.convert(nativeTab);
        },

        async reload(tabId, reloadProperties) {
          let nativeTab = getTabOrActive(tabId);
          let flags = Ci.nsIWebNavigation.LOAD_FLAGS_NONE;
          if (reloadProperties?.bypassCache) {
            flags |= Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE;
          }
          if (nativeTab.linkedBrowser) {
            nativeTab.linkedBrowser.reloadWithFlags(flags);
          } else {
            ensureBrowser(nativeTab);
          }
        },

        async warmup() {},

        async get(tabId) {
          return tabManager.get(tabId).convert();
        },

        getCurrent() {
          let tabData;
          if (context.tabId) {
            tabData = tabManager.get(context.tabId).convert();
          }
          return Promise.resolve(tabData);
        },

        async query(queryInfo) {
          return Array.from(tabManager.query(queryInfo, context), tab => tab.convert());
        },

        async captureTab(tabId, options) {
          let tab = await promiseTabWhenReady(tabId);
          return tab.capture(context, tab.browser.fullZoom, options);
        },

        async captureVisibleTab(windowId, options) {
          let window =
            windowId == null
              ? windowTracker.getTopWindow(context)
              : windowTracker.getWindow(windowId, context);
          let tab = tabManager.getWrapper(window.gTabs.selected.tab);
          if (!extension.hasPermission("<all_urls>") && !tab.hasActiveTabPermission) {
            throw new ExtensionError("Missing activeTab permission");
          }
          await tabTracker.awaitTabReady(tab.nativeTab);
          return tab.capture(context, tab.browser.fullZoom, options);
        },

        async detectLanguage(tabId) {
          let tab = await promiseTabWhenReady(tabId);
          let results = await tab.queryContent("DetectLanguage", {});
          return results[0];
        },

        async executeScript(tabId, details) {
          let tab = await promiseTabWhenReady(tabId);
          return tab.executeScript(context, details);
        },

        async insertCSS(tabId, details) {
          let tab = await promiseTabWhenReady(tabId);
          return tab.insertCSS(context, details);
        },

        async removeCSS(tabId, details) {
          let tab = await promiseTabWhenReady(tabId);
          return tab.removeCSS(context, details);
        },

        // Déplacement dans la même fenêtre seulement.
        async move(tabIds, moveProperties) {
          let nativeTabs = getNativeTabsFromIDArray(tabIds);
          let moved = [];
          let index = moveProperties.index;
          for (let nativeTab of nativeTabs) {
            let window = nativeTab.documentGlobal;
            if (
              moveProperties.windowId !== null &&
              windowTracker.getId(window) != moveProperties.windowId
            ) {
              throw new ExtensionError("Core ne déplace pas les onglets entre fenêtres");
            }
            let { gTabs } = window;
            let target = index == -1 ? gTabs.list.length - 1 : index;
            gTabs.move(nativeTab.entry, target);
            if (index != -1) {
              index = gTabs.list.indexOf(nativeTab.entry) + 1;
            }
            moved.push(nativeTab);
          }
          return moved.map(nativeTab => tabManager.convert(nativeTab));
        },

        async duplicate(tabId, duplicateProperties) {
          let nativeTab = getTabOrActive(tabId);
          let window = nativeTab.documentGlobal;
          let tab = tabManager.getWrapper(nativeTab);
          let entry = window.gTabs.open(tab._url, {
            select: duplicateProperties?.active ?? true,
          });
          let index = duplicateProperties?.index ?? tab.index + 1;
          window.gTabs.move(entry, index);
          return tabManager.convert(entry.tab);
        },

        async getZoom(tabId) {
          return ensureBrowser(getTabOrActive(tabId)).fullZoom;
        },

        async setZoom(tabId, zoom) {
          let browser = ensureBrowser(getTabOrActive(tabId));
          if (zoom !== 0 && (zoom < 0.3 || zoom > 5)) {
            throw new ExtensionError(
              `Zoom value ${zoom} out of range (must be between 0.3 and 5)`
            );
          }
          browser.fullZoom = zoom || 1;
        },

        async getZoomSettings() {
          return { mode: "automatic", scope: "per-tab", defaultZoomFactor: 1 };
        },

        setZoomSettings: unsupported("setZoomSettings"),

        goForward(tabId) {
          ensureBrowser(getTabOrActive(tabId)).goForward(false);
        },

        goBack(tabId) {
          ensureBrowser(getTabOrActive(tabId)).goBack(false);
        },

        async highlight(highlightInfo) {
          let { windowId, tabs, populate } = highlightInfo;
          if (windowId == null) {
            windowId = Window.WINDOW_ID_CURRENT;
          }
          let window = windowTracker.getWindow(windowId, context);
          let index = [].concat(tabs)[0];
          let entry = window.gTabs.list[index];
          if (!entry) {
            throw new ExtensionError(`No tab at index: ${index}`);
          }
          window.gTabs.select(entry);
          return windowManager.convert(window, { populate });
        },

        moveInSuccession: () => {},
        show: unsupported("show"),
        hide: unsupported("hide"),
        group: unsupported("group"),
        ungroup: unsupported("ungroup"),
        print: unsupported("print"),
        printPreview: unsupported("printPreview"),
        saveAsPDF: unsupported("saveAsPDF"),
        toggleReaderMode: unsupported("toggleReaderMode"),
      },
    };
  }
};
