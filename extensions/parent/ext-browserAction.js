/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Boutons des extensions (browser_action en MV2, action en MV3) : un bouton
// par extension dans la barre d'outils de chaque fenêtre (#extension-buttons),
// qui ouvre la fenêtre surgissante de l'extension ou envoie onClicked.
// Les propriétés (titre, icône, badge, popup) sont gérées par
// BrowserActionBase de toolkit, comme dans Firefox et GeckoView.

ChromeUtils.defineESModuleGetters(this, {
  PanelPopup: "resource:///modules/ExtensionPopups.sys.mjs",
});

var { BrowserActionBase } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionActions.sys.mjs"
);

var { ExtensionParent } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionParent.sys.mjs"
);

var { IconDetails, StartupCache } = ExtensionParent;

class BrowserAction extends BrowserActionBase {
  constructor(extension, buttonDelegate) {
    let tabContext = new TabContext(target => {
      let window = target.documentGlobal ?? target;
      // Données d'un onglet : héritent de celles de sa fenêtre, puis des
      // valeurs globales.
      if (target != window) {
        return this.getContextData(window);
      }
      return this.globals;
    });
    super(tabContext, extension);
    this.buttonDelegate = buttonDelegate;
  }

  updateOnChange(target) {
    if (target) {
      let window = target.documentGlobal ?? target;
      if (target == window || window.gTabs.selected?.tab == target) {
        this.buttonDelegate.updateWindow(window);
      }
    } else {
      for (let window of windowTracker.browserWindows()) {
        this.buttonDelegate.updateWindow(window);
      }
    }
  }

  getTab(tabId) {
    return tabTracker.getTab(tabId);
  }

  getWindow(windowId) {
    return windowTracker.getWindow(windowId);
  }

  dispatchClick(tab, clickInfo) {
    this.buttonDelegate.emit("click", tab, clickInfo);
  }

  isPanelShownBlockingOpenPopup(window) {
    return [...window.document.querySelectorAll("panel.browser-extension-panel")].some(
      panel => panel.state != "closed"
    );
  }
}

this.browserAction = class extends ExtensionAPIPersistent {
  static for(extension) {
    return browserActionMap.get(extension);
  }

  async onManifestEntry() {
    let { extension } = this;
    this.action = new BrowserAction(extension, this);
    await this.action.loadIconData();
    this.buttons = new WeakMap();
    this.popups = new WeakMap();
    browserActionMap.set(extension, this);

    this.onWindowOpen = window => this.createButton(window);
    windowTracker.addOpenListener(this.onWindowOpen);
    for (let window of windowTracker.browserWindows()) {
      this.createButton(window);
    }
  }

  onShutdown() {
    browserActionMap.delete(this.extension);
    windowTracker.removeOpenListener(this.onWindowOpen);
    for (let window of windowTracker.browserWindows()) {
      this.buttons.get(window)?.remove();
      this.popups.get(window)?.destroy();
    }
    this.action.onShutdown();
  }

  createButton(window) {
    let { document } = window;
    let button = document.createElement("button");
    button.className = "icon-button extension-button";
    button.id = `${makeWidgetId(this.extension.id)}-browser-action`;
    let icon = document.createElement("img");
    icon.className = "extension-button-icon";
    icon.setAttribute("alt", "");
    let badge = document.createElement("span");
    badge.className = "extension-button-badge";
    button.append(icon, badge);

    // Comme dans Firefox, le clic se fait au relâchement ; le clic du milieu
    // est transmis à onClicked avec button = 1.
    button.addEventListener("mousedown", event => {
      if (event.button == 0) {
        // Évite que le bouton prenne le focus et ferme la fenêtre surgissante.
        event.preventDefault();
      }
    });
    button.addEventListener("click", event => {
      this.handleClick(window, {
        button: 0,
        modifiers: clickModifiersFromEvent(event),
      });
    });
    button.addEventListener("auxclick", event => {
      if (event.button == 1) {
        this.handleClick(window, {
          button: 1,
          modifiers: clickModifiersFromEvent(event),
        });
      }
    });

    document.getElementById("extension-buttons").append(button);
    this.buttons.set(window, button);
    this.updateWindow(window);
  }

  updateWindow(window) {
    let button = this.buttons.get(window);
    let tab = window.gTabs.selected?.tab;
    if (!button || !tab) {
      return;
    }
    let values = this.action.getContextData(tab);
    let title = values.title || this.extension.name;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.disabled = !values.enabled;

    let dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    let size = Math.round(16 * window.devicePixelRatio);
    let { icon } = IconDetails.getPreferredIcon(values.icon || {}, this.extension, size);
    if (typeof icon == "object") {
      icon = dark ? icon.dark : icon.light;
    }
    let img = button.querySelector(".extension-button-icon");
    if (img.getAttribute("src") != icon) {
      img.setAttribute("src", icon);
    }

    let badge = button.querySelector(".extension-button-badge");
    badge.textContent = values.badgeText || "";
    badge.hidden = !values.badgeText;
    let [r, g, b, a] = values.badgeBackgroundColor;
    badge.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    let [tr, tg, tb, ta] = this.action.getTextColor(values);
    badge.style.color = `rgba(${tr}, ${tg}, ${tb}, ${ta / 255})`;
  }

  // Raccourci clavier _execute_browser_action / _execute_action
  // (ExtensionShortcuts de toolkit).
  triggerAction(window) {
    return this.handleClick(window, { button: 0, modifiers: [] });
  }

  // Ouvre (ou referme) la fenêtre surgissante, sinon envoie onClicked.
  async handleClick(window, clickInfo) {
    let open = this.popups.get(window);
    if (open) {
      open.closePopup();
      return;
    }
    let tab = window.gTabs.selected.tab;
    let popupURL = this.action.triggerClickOrPopup(tab, clickInfo);
    if (popupURL && clickInfo.button == 0) {
      await this.openPopup(window, popupURL);
    }
  }

  async openPopup(window, popupURL) {
    let button = this.buttons.get(window);
    let popup = new PanelPopup(this.extension, window.document, popupURL, false);
    this.popups.set(window, popup);
    popup.panel.addEventListener(
      "popuphiding",
      () => {
        if (this.popups.get(window) == popup) {
          this.popups.delete(window);
        }
        button?.removeAttribute("open");
      },
      { once: true }
    );
    await popup.contentReady;
    if (popup.destroyed) {
      return;
    }
    button?.setAttribute("open", "true");
    popup.panel.openPopup(button, "bottomright topright");
  }

  PERSISTENT_EVENTS = {
    onClicked({ fire }) {
      let { tabManager } = this.extension;
      let listener = async (_event, tab, clickInfo) => {
        if (fire.wakeup) {
          await fire.wakeup();
        }
        fire.sync(tabManager.convert(tab), clickInfo);
      };
      this.on("click", listener);
      return {
        unregister: () => {
          this.off("click", listener);
        },
        convert(newFire) {
          fire = newFire;
        },
      };
    },
    // Les boutons de Core sont toujours dans la barre d'outils : rien à
    // signaler.
    onUserSettingsChanged() {
      return {
        unregister: () => {},
        convert() {},
      };
    },
  };

  getAPI(context) {
    let { extension } = context;
    let { action } = this;
    let namespace = extension.manifestVersion < 3 ? "browserAction" : "action";

    return {
      [namespace]: {
        ...action.api(context),

        onClicked: new EventManager({
          context,
          module: "browserAction",
          event: "onClicked",
          inputHandling: true,
          extensionApi: this,
        }).api(),

        onUserSettingsChanged: new EventManager({
          context,
          module: "browserAction",
          event: "onUserSettingsChanged",
          extensionApi: this,
        }).api(),

        getUserSettings: () => {
          return { isOnToolbar: true };
        },

        openPopup: async options => {
          let isHandlingUserInput = context.callContextData?.isHandlingUserInput;
          if (
            !Services.prefs.getBoolPref("extensions.openPopupWithoutUserGesture.enabled") &&
            !isHandlingUserInput
          ) {
            throw new ExtensionError("openPopup requires a user gesture");
          }
          let window =
            typeof options?.windowId === "number"
              ? windowTracker.getWindow(options.windowId, context)
              : windowTracker.getTopWindow(context);
          if (window != windowTracker.topWindow) {
            throw new ExtensionError(BrowserActionBase.ERROR_WIN_NOT_FOCUSED);
          }
          let tab = window.gTabs.selected.tab;
          let popupURL = action.getPopupUrl(tab, true);
          action.throwIfOpenPopupIsBlockedByAnyAction(window);
          if (!this.popups.get(window)) {
            await this.openPopup(window, popupURL);
          }
        },
      },
    };
  }
};

const browserActionMap = new WeakMap();
global.browserActionFor = this.browserAction.for;
