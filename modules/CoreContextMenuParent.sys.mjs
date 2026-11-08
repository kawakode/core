/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Côté parent du menu clic droit des pages. Le côté enfant est celui de
// Firefox (browser/actors/ContextMenuChild.sys.mjs, repris tel quel) : il
// analyse ce qui est sous le pointeur (lien, image, vidéo, sélection, champ
// de saisie, cadre) et envoie le message « contextmenu ». On le passe au
// menu de la fenêtre (gContextMenus, base/content/contextmenu.js) avec ce
// que seul le processus parent connaît (principal, adresse du document).
//
// Le nom de la classe est imposé par le nom de l'acteur (ContextMenu), que
// le côté enfant et les API d'extensions attendent.

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  E10SUtils: "resource://gre/modules/E10SUtils.sys.mjs",
  WebNavigationFrames: "resource://gre/modules/WebNavigationFrames.sys.mjs",
});

export class ContextMenuParent extends JSWindowActorParent {
  receiveMessage(message) {
    if (message.name != "contextmenu") {
      return;
    }
    let browser = this.manager.rootFrameLoader?.ownerElement;
    if (!browser || browser.hasAttribute("disablecontextmenu")) {
      return;
    }
    // Un <browser> peut être dans un document imbriqué (page d'options d'une
    // extension dans about:addons) : on remonte à la fenêtre de Core.
    let win = browser.ownerDocument.defaultView;
    if (!win.gContextMenus) {
      let topBrowser = win.docShell?.chromeEventHandler;
      win = topBrowser?.ownerDocument.defaultView;
      if (!win?.gContextMenus) {
        return;
      }
    }

    let wgp = this.manager;
    // Document déjà remplacé : rien à montrer.
    if (!wgp.isCurrentGlobal) {
      return;
    }

    let { data } = message;
    let { context } = data;
    let frameID = lazy.WebNavigationFrames.getFrameId(wgp.browsingContext);
    // Adresse de la page qui a échoué quand une page d'erreur est affichée.
    let documentURIObject = wgp.browsingContext.currentURI;

    context.principal = wgp.documentPrincipal;
    context.storagePrincipal = wgp.documentStoragePrincipal;
    context.frameID = frameID;
    context.frameOuterWindowID = wgp.outerWindowId;
    context.frameBrowsingContextID = wgp.browsingContext.id;

    let deserialize = info => info && lazy.E10SUtils.deserializeReferrerInfo(info);

    win.gContextMenus.openForContent({
      context,
      browser,
      actor: this,
      editFlags: data.editFlags,
      principal: wgp.documentPrincipal,
      documentURIObject,
      docLocation: documentURIObject.spec,
      charSet: data.charSet,
      referrerInfo: deserialize(data.referrerInfo),
      linkReferrerInfo: deserialize(data.linkReferrerInfo),
      frameReferrerInfo: deserialize(data.frameReferrerInfo),
      contentType: data.contentType,
      contentDisposition: data.contentDisposition,
      selectionInfo: data.selectionInfo,
      webExtContextData: data.webExtContextData,
      cookieJarSettings: wgp.cookieJarSettings,
      policyContainer: lazy.E10SUtils.deserializePolicyContainer(context.policyContainer),
      remoteType: wgp.domProcess?.remoteType,
      frameID,
    });
  }

  hiding() {
    try {
      this.sendAsyncMessage("ContextMenu:Hiding", {});
    } catch (e) {
      // La page a pu disparaître pendant que le menu était ouvert.
    }
  }

  reloadFrame(targetIdentifier, forceReload) {
    this.sendAsyncMessage("ContextMenu:ReloadFrame", { targetIdentifier, forceReload });
  }

  toggleRevealPassword(targetIdentifier) {
    this.sendAsyncMessage("ContextMenu:ToggleRevealPassword", { targetIdentifier });
  }

  mediaCommand(targetIdentifier, command, data) {
    let browser = this.manager.rootFrameLoader.ownerElement;
    this.sendAsyncMessage("ContextMenu:MediaCommand", {
      targetIdentifier,
      command,
      data,
      handlingUserInput: browser.ownerDocument.defaultView.windowUtils.isHandlingUserInput,
    });
  }

  canvasToBlobURL(targetIdentifier) {
    return this.sendQuery("ContextMenu:Canvas:ToBlobURL", { targetIdentifier });
  }
}
