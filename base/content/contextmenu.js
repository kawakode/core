/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Menus clic droit de la fenêtre principale :
// - pages web (#contentAreaContextMenu), ouvert par l'acteur ContextMenu
//   (modules/CoreContextMenuParent.sys.mjs) ;
// - onglets (#tabContextMenu) ;
// - boutons des extensions (#extension-button-context) ;
// - champs de saisie de l'interface, dont la barre d'adresse
//   (#chrome-edit-context).
// Les deux premiers suivent la disposition choisie par l'utilisateur
// (modules/CoreContextMenu.sys.mjs, Réglages > Menus clic droit). Les
// éléments ajoutés par les extensions (API menus) sont insérés par
// core/extensions/parent/ext-menus.js à la place de l'élément
// « Éléments des extensions ».

// urlSecurityCheck, saveURL, saveBrowser, internalSave et
// PrivateBrowsingUtils viennent de toolkit/content/contentAreaUtils.js,
// chargé avant ce fichier par main.xhtml.
ChromeUtils.defineESModuleGetters(this, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  CoreContextMenu: "resource:///modules/CoreContextMenu.sys.mjs",
});

var gContextMenus = {
  // Données de la page pour le menu ouvert (voir CoreContextMenuParent).
  data: null,
  // Onglet visé par le menu des onglets.
  tabEntry: null,

  init() {
    this.pageMenu = document.getElementById("contentAreaContextMenu");
    this.tabMenu = document.getElementById("tabContextMenu");
    this.editMenu = document.getElementById("chrome-edit-context");
    this.extensionMenu = document.getElementById("extension-button-context");

    // Appelé par ext-menus.js quand une extension change ses éléments
    // pendant que le menu est ouvert.
    for (let menu of [this.pageMenu, this.tabMenu, this.extensionMenu]) {
      menu.showHideSeparators = () => this.tidySeparators(menu);
    }

    this.pageMenu.addEventListener("command", event => this.onPageCommand(event));
    this.pageMenu.addEventListener("popuphiding", event => {
      if (event.target == this.pageMenu) {
        this.data?.actor.hiding();
      }
    });
    this.pageMenu.addEventListener("popuphidden", event => {
      if (event.target == this.pageMenu) {
        this.data = null;
      }
    });

    this.tabMenu.addEventListener("command", event => this.onTabCommand(event));
    this.tabMenu.addEventListener("popuphidden", event => {
      if (event.target == this.tabMenu) {
        this.tabEntry = null;
        TabContextMenu.contextTab = null;
      }
    });
    document.getElementById("tabstrip").addEventListener("contextmenu", event => {
      let tab = event.target.closest(".tab");
      if (tab?.entry) {
        event.preventDefault();
        this.openTabMenu(tab.entry, event);
      }
    });

    this.editMenu.addEventListener("command", event => this.onEditCommand(event));
    // Champs de l'interface (barre d'adresse, panneau des marque-pages) : les
    // pages web n'arrivent pas ici, l'acteur arrête leur événement.
    window.addEventListener("contextmenu", event => {
      let input = event.composedTarget;
      if (
        !event.defaultPrevented &&
        input?.localName == "input" &&
        input.ownerDocument == document &&
        input.mozIsTextField(false)
      ) {
        event.preventDefault();
        this.openEditMenu(input, event);
      }
    });

    this.extensionMenu.addEventListener("command", event => this.onExtensionCommand(event));
  },

  /* Disposition et construction */

  accel(item) {
    if (AppConstants.platform != "macosx") {
      return item.accel ?? "";
    }
    return item.macAccel ?? (item.accel ?? "").replace("Ctrl+Maj+", "⌘⇧").replace("Ctrl+", "⌘");
  },

  // Remplit un menu dans l'ordre choisi par l'utilisateur, avec les seuls
  // éléments pour lesquels describe() renvoie quelque chose : { label,
  // disabled, checked } (label remplace celui du catalogue).
  build(popup, menu, describe) {
    popup.replaceChildren();
    for (let id of CoreContextMenu.layout(menu)) {
      if (id == CoreContextMenu.SEPARATOR) {
        popup.append(document.createXULElement("menuseparator"));
        continue;
      }
      if (id == "extensions") {
        // Repère pour ext-menus.js, jamais affiché.
        let anchor = document.createXULElement("menuseparator");
        anchor.className = "core-extensions-anchor";
        anchor.hidden = true;
        popup.append(anchor);
        continue;
      }
      let state = describe(id);
      if (!state) {
        continue;
      }
      let item = CoreContextMenu.item(menu, id);
      let element = document.createXULElement("menuitem");
      element.id = `context-${id}`;
      element.setAttribute("label", state.label ?? item.label);
      element.setAttribute("core-command", id);
      let accel = this.accel(item);
      if (accel) {
        element.setAttribute("acceltext", accel);
      }
      if (item.type == "checkbox") {
        element.setAttribute("type", "checkbox");
        element.setAttribute("checked", !!state.checked);
      }
      if (state.disabled) {
        element.setAttribute("disabled", "true");
      }
      popup.append(element);
    }
    popup.setAttribute("core-layout", "true");
    this.tidySeparators(popup);
  },

  // Pas de séparateur en tête, en fin, ni deux de suite. Seuls ceux masqués
  // ici sont réaffichés ensuite (ext-menus.js peut en masquer d'autres).
  tidySeparators(popup) {
    for (let element of popup.children) {
      if (element.hasAttribute("tidyhidden")) {
        element.removeAttribute("tidyhidden");
        element.hidden = false;
      }
    }
    let previous = null;
    for (let element of popup.children) {
      if (element.hidden) {
        continue;
      }
      if (element.localName == "menuseparator" && (!previous || previous.localName == "menuseparator")) {
        element.hidden = true;
        element.setAttribute("tidyhidden", "true");
        continue;
      }
      previous = element;
    }
    if (previous?.localName == "menuseparator") {
      previous.hidden = true;
      previous.setAttribute("tidyhidden", "true");
    }
  },

  // Données pour les extensions (notification on-build-contextmenu, lue par
  // ext-menus.js), comme nsContextMenu de Firefox.
  notifyExtensions(subject) {
    subject.wrappedJSObject = subject;
    Services.obs.notifyObservers(subject, "on-build-contextmenu");
  },

  /* Commandes d'édition : contrôleur de l'élément qui a le focus (la page
   * distante relaie ses commandes à son processus). */

  commandEnabled(command) {
    try {
      return !!document.commandDispatcher
        .getControllerForCommand(command)
        ?.isCommandEnabled(command);
    } catch (e) {
      return false;
    }
  },

  doCommand(command) {
    try {
      let controller = document.commandDispatcher.getControllerForCommand(command);
      if (controller?.isCommandEnabled(command)) {
        controller.doCommand(command);
      }
    } catch (e) {
      console.error(e);
    }
  },

  copyString(text) {
    Cc["@mozilla.org/widget/clipboardhelper;1"]
      .getService(Ci.nsIClipboardHelper)
      .copyString(text);
  },

  // Nouvelle fenêtre avec une adresse, ou un onglet à y déplacer
  // (urlsFromArguments de main.js).
  openWindow(arg, { isPrivate = false, triggeringPrincipal = null } = {}) {
    let args = [arg, null, null, null, null, null, null, null, triggeringPrincipal];
    window.openDialog(
      AppConstants.BROWSER_CHROME_URL,
      "_blank",
      "chrome,all,dialog=no" + (isPrivate ? ",private" : ""),
      ...args
    );
  },

  /* Menu des pages */

  openForContent(data) {
    if (!data.context.shouldDisplay) {
      return;
    }
    if (this.pageMenu.state != "closed") {
      this.pageMenu.hidePopup();
    }
    this.data = data;
    let ctx = this.pageContext(data);
    this.build(this.pageMenu, "page", id => this.describePageItem(id, ctx));

    let { context } = data;
    this.notifyExtensions({
      menu: this.pageMenu,
      tab: ctx.entry?.tab,
      timeStamp: context.timeStamp,
      isContentSelected: ctx.isContentSelected,
      inFrame: context.inFrame,
      isTextSelected: ctx.isTextSelected,
      onTextInput: context.onTextInput,
      onLink: context.onLink,
      onImage: context.onImage,
      onVideo: context.onVideo,
      onAudio: context.onAudio,
      onCanvas: context.onCanvas,
      onEditable: context.onEditable,
      onSpellcheckable: context.onSpellcheckable,
      onPassword: context.onPassword,
      passwordRevealed: context.passwordRevealed,
      srcUrl: ctx.originalMediaURL,
      frameUrl: data.docLocation,
      pageUrl: data.browser.currentURI?.spec,
      linkText: context.linkTextStr,
      linkUrl: context.linkURL,
      linkURI: ctx.linkURI,
      selectionText: ctx.isTextSelected ? data.selectionInfo.fullText : undefined,
      frameId: data.frameID,
      webExtBrowserType: data.browser.getAttribute("webextension-view-type"),
      webExtContextData: data.webExtContextData,
    });
    this.tidySeparators(this.pageMenu);

    let event = new PointerEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      screenX: context.screenXDevPx / window.devicePixelRatio,
      screenY: context.screenYDevPx / window.devicePixelRatio,
      button: 2,
    });
    this.pageMenu.openPopupAtScreen(event.screenX, event.screenY, true, event);
  },

  pageContext(data) {
    let { context, browser, selectionInfo } = data;
    let ctx = {
      entry: gTabs.list.find(e => e.browser == browser) ?? null,
      isTextSelected: !!selectionInfo?.text.length,
      isContentSelected: !!selectionInfo && !selectionInfo.docSelectionIsCollapsed,
      mediaURL: context.mediaURL || context.bgImageURL,
      linkURI: null,
    };
    ctx.originalMediaURL = context.originalMediaURL || ctx.mediaURL;
    try {
      ctx.linkURI = context.linkURL ? Services.io.newURI(context.linkURL) : null;
    } catch (e) {
      // Lien dont l'adresse n'est pas valide.
    }
    ctx.onMedia = context.onVideo || context.onAudio;
    // Champ modifiable (ou document entier en mode édition).
    ctx.editable = context.onEditable || context.isDesignMode;
    // Ni lien, ni image, ni média, ni champ, ni sélection : la page elle-même.
    ctx.onPage = !(
      context.onLink ||
      context.onImage ||
      context.onCanvas ||
      ctx.onMedia ||
      context.onTextInput ||
      ctx.isContentSelected
    );
    ctx.engine = this.searchEngine();
    return ctx;
  },

  // Moteur de recherche choisi par l'utilisateur, s'il y en a un (Core n'en
  // a aucun par défaut).
  searchEngine() {
    try {
      if (!Services.search.isInitialized) {
        // Prêt pour le prochain menu.
        Services.search.init().catch(() => {});
        return null;
      }
      return PrivateBrowsingUtils.isWindowPrivate(window)
        ? Services.search.defaultPrivateEngine
        : Services.search.defaultEngine;
    } catch (e) {
      return null;
    }
  },

  describePageItem(id, ctx) {
    let { context, browser } = this.data;
    let link = context.onLink && !context.onMailtoLink && !context.onTelLink;
    let webLink = link && ["http", "https", "ftp", "file"].includes(ctx.linkURI?.scheme);
    let onImage = context.onImage || context.onCanvas;
    let media = ctx.onMedia && !!ctx.mediaURL && !context.onDRMMedia;
    let isVideo = context.onVideo;
    let target = context.target ?? {};
    // Éléments de la page : seulement dans un onglet.
    let pageItem = ctx.onPage && !!ctx.entry;
    let show = (condition, state = {}) => (condition ? state : null);

    switch (id) {
      case "exit-fullscreen":
        return show(!!target.ownerDocument?.fullscreen);
      case "back":
        return show(pageItem, { disabled: !browser.canGoBack });
      case "forward":
        return show(pageItem, { disabled: !browser.canGoForward });
      case "reload": {
        let loading = !!browser.webProgress?.isLoadingDocument;
        return show(pageItem, { label: loading ? "Arrêter" : "Recharger" });
      }
      case "bookmark-page":
        return show(pageItem && gBookmarks.canBookmark(browser.currentURI));
      case "save-page":
        return show(pageItem && !context.inPDFViewer);
      case "view-source":
        return show(
          pageItem && !context.inSyntheticDoc && !browser.currentURI.spec.startsWith("view-source:")
        );

      case "link-tab":
      case "link-window":
      case "link-private":
        return show(link);
      case "link-bookmark":
        return show(webLink);
      case "link-save":
        return show(link && context.onSaveableLink);
      case "link-copy": {
        let label = context.onMailtoLink
          ? "Copier l'adresse e-mail"
          : context.onTelLink
            ? "Copier le numéro"
            : null;
        return show(context.onLink, label ? { label } : {});
      }

      case "image-tab":
        return show(onImage && (context.onCanvas || !!ctx.mediaURL));
      case "image-copy":
        return show(context.onImage && (context.onLoadedImage || context.onCompletedImage));
      case "image-copy-url":
        return show(context.onImage && !!ctx.mediaURL);
      case "image-save":
        return show(onImage && (context.onCanvas || context.onLoadedImage || context.onCompletedImage));

      case "media-play": {
        let paused = target.paused || target.ended;
        return show(ctx.onMedia, { label: paused ? "Lecture" : "Pause" });
      }
      case "media-mute":
        return show(ctx.onMedia, { label: target.muted ? "Rétablir le son" : "Couper le son" });
      case "media-loop":
        return show(ctx.onMedia, { checked: target.loop });
      case "media-controls":
        return show(ctx.onMedia, { checked: target.controls });
      case "media-fullscreen":
        return show(isVideo && document.fullscreenEnabled);
      case "media-tab":
        return show(media, {
          label: isVideo ? "Ouvrir la vidéo dans un nouvel onglet" : "Ouvrir le son dans un nouvel onglet",
        });
      case "media-copy-url":
        return show(media, {
          label: isVideo ? "Copier l'adresse de la vidéo" : "Copier l'adresse du son",
        });
      case "media-save":
        return show(media, {
          label: isVideo ? "Enregistrer la vidéo sous…" : "Enregistrer le son sous…",
        });

      case "undo":
      case "redo":
      case "cut":
      case "paste":
      case "delete":
        return show(ctx.editable, { disabled: !this.commandEnabled(`cmd_${id}`) });
      case "paste-plain":
        return show(context.isDesignMode && !context.onPassword, {
          disabled: !this.commandEnabled("cmd_pasteNoFormatting"),
        });
      case "copy":
        return show(ctx.isContentSelected || context.onTextInput, {
          disabled: !this.commandEnabled("cmd_copy"),
        });
      case "select-all":
        return show(ctx.onPage || context.onTextInput);
      case "reveal-password":
        return show(context.onPassword, { checked: context.passwordRevealed });
      case "search": {
        if (!ctx.isTextSelected || context.onPassword || !ctx.engine) {
          return null;
        }
        let text = this.data.selectionInfo.text.trim().replace(/\s+/g, " ");
        let chars = Array.from(text);
        if (chars.length > 15) {
          text = chars.slice(0, 15).join("") + "…";
        }
        return { label: `Rechercher « ${text} » avec ${ctx.engine.name}` };
      }

      case "frame-tab":
        return show(context.inFrame && !context.inSrcdocFrame);
      case "frame-reload":
        return show(context.inFrame);
    }
    return null;
  },

  onPageCommand(event) {
    let id = event.target.getAttribute("core-command");
    if (!id || !this.data) {
      return;
    }
    try {
      this.runPageCommand(id, event);
    } catch (e) {
      // urlSecurityCheck refuse une adresse que la page n'a pas le droit
      // d'ouvrir (file:, chrome:…).
      console.error(e);
    }
  },

  runPageCommand(id, event) {
    let data = this.data;
    let { context, browser, actor, principal } = data;
    let ctx = this.pageContext(data);
    let isPrivate = PrivateBrowsingUtils.isBrowserPrivate(browser);
    let systemPrincipal = Services.scriptSecurityManager.getSystemPrincipal();
    let linkOptions = () => {
      urlSecurityCheck(context.linkURL, principal);
      return {
        triggeringPrincipal: principal,
        loadOptions: {
          referrerInfo: data.linkReferrerInfo ?? data.referrerInfo,
          policyContainer: data.policyContainer,
          hasValidUserGestureActivation: true,
        },
      };
    };
    let mediaOptions = () => {
      urlSecurityCheck(ctx.mediaURL, principal, Ci.nsIScriptSecurityManager.DISALLOW_SCRIPT);
      return {
        triggeringPrincipal: principal,
        loadOptions: {
          referrerInfo: data.referrerInfo,
          policyContainer: data.policyContainer,
          forceAllowDataURI: true,
        },
      };
    };
    let openWindowFor = (url, inPrivate) => {
      urlSecurityCheck(url, principal);
      // Le principal doit avoir les attributs de la nouvelle fenêtre.
      let triggeringPrincipal = Services.scriptSecurityManager.principalWithOA(principal, {
        ...principal.originAttributes,
        privateBrowsingId: inPrivate ? 1 : 0,
      });
      this.openWindow(url, { isPrivate: inPrivate, triggeringPrincipal });
    };
    let media = command => actor.mediaCommand(context.targetIdentifier, command);
    let target = context.target ?? {};

    switch (id) {
      case "exit-fullscreen":
        document.exitFullscreen();
        break;
      case "back":
        browser.goBack();
        break;
      case "forward":
        browser.goForward();
        break;
      case "reload":
        if (browser.webProgress?.isLoadingDocument) {
          browser.stop();
        } else {
          browser.reload();
        }
        break;
      case "bookmark-page":
        gBookmarks.bookmarkURI(browser.currentURI, browser.contentTitle).catch(console.error);
        break;
      case "save-page":
        saveBrowser(browser);
        break;
      case "view-source":
        gTabs.open(`view-source:${browser.currentURI.spec}`, {
          index: gTabs.list.indexOf(gTabs.selected) + 1,
        });
        break;

      case "link-tab":
        gTabs.openRelated(context.linkURL, linkOptions());
        break;
      case "link-window":
        openWindowFor(context.linkURL, isPrivate);
        break;
      case "link-private":
        openWindowFor(context.linkURL, true);
        break;
      case "link-bookmark":
        gBookmarks.bookmarkURI(ctx.linkURI, context.linkTextStr.trim()).catch(console.error);
        break;
      case "link-save":
        urlSecurityCheck(context.linkURL, principal);
        saveURL(
          context.linkURL,
          null,
          context.linkDownload || null,
          null,
          true,
          false,
          data.linkReferrerInfo ?? data.referrerInfo,
          data.cookieJarSettings,
          null,
          isPrivate,
          principal
        );
        break;
      case "link-copy":
        this.copyString(this.linkToCopy(context.linkURL, context));
        break;

      case "image-tab":
        if (context.onCanvas) {
          actor.canvasToBlobURL(context.targetIdentifier).then(blobURL => {
            gTabs.openRelated(blobURL, { triggeringPrincipal: systemPrincipal });
          }, console.error);
        } else {
          gTabs.openRelated(ctx.mediaURL, mediaOptions());
        }
        break;
      case "image-copy":
        this.doCommand("cmd_copyImage");
        break;
      case "image-copy-url":
      case "media-copy-url":
        this.copyString(ctx.originalMediaURL);
        break;
      case "image-save":
        if (context.onCanvas) {
          actor.canvasToBlobURL(context.targetIdentifier).then(blobURL => {
            internalSave(
              blobURL, null, null, "canvas.png", null, "image/png", true, "SaveImageTitle",
              null, data.referrerInfo, data.cookieJarSettings, null, false, null, isPrivate,
              systemPrincipal
            );
          }, console.error);
        } else {
          urlSecurityCheck(ctx.mediaURL, principal);
          internalSave(
            ctx.mediaURL, null, null, null, data.contentDisposition, data.contentType, false,
            "SaveImageTitle", null, data.referrerInfo, data.cookieJarSettings, null, false, null,
            isPrivate, principal
          );
        }
        break;

      case "media-play":
        media(target.paused || target.ended ? "play" : "pause");
        break;
      case "media-mute":
        media(target.muted ? "unmute" : "mute");
        break;
      case "media-loop":
        media("loop");
        break;
      case "media-controls":
        media(target.controls ? "hidecontrols" : "showcontrols");
        break;
      case "media-fullscreen":
        media("fullscreen");
        break;
      case "media-tab":
        gTabs.openRelated(ctx.mediaURL, mediaOptions());
        break;
      case "media-save":
        urlSecurityCheck(ctx.mediaURL, principal);
        saveURL(
          ctx.mediaURL, null, null, context.onVideo ? "SaveVideoTitle" : "SaveAudioTitle",
          false, false, data.referrerInfo, data.cookieJarSettings, null, isPrivate, principal
        );
        break;

      case "undo":
      case "redo":
      case "cut":
      case "copy":
      case "paste":
      case "delete":
        this.doCommand(`cmd_${id}`);
        break;
      case "paste-plain":
        this.doCommand("cmd_pasteNoFormatting");
        break;
      case "select-all":
        this.doCommand("cmd_selectAll");
        break;
      case "reveal-password":
        actor.toggleRevealPassword(context.targetIdentifier);
        break;
      case "search": {
        let engine = ctx.engine;
        if (!engine) {
          break;
        }
        let submission = engine.getSubmission(data.selectionInfo.fullText.trim(), null, "contextmenu");
        gTabs.open(submission.uri.spec, {
          index: gTabs.list.indexOf(gTabs.selected) + 1,
          loadOptions: { postData: submission.postData },
        });
        break;
      }

      case "frame-tab":
        urlSecurityCheck(data.docLocation, browser.contentPrincipal);
        gTabs.openRelated(data.docLocation, {
          triggeringPrincipal: browser.contentPrincipal,
          loadOptions: {
            referrerInfo: data.frameReferrerInfo,
            policyContainer: browser.policyContainer,
          },
        });
        break;
      case "frame-reload":
        actor.reloadFrame(context.targetIdentifier, event.shiftKey);
        break;
    }
  },

  // Adresse e-mail ou numéro seuls pour mailto: et tel:, comme Firefox.
  linkToCopy(url, context) {
    let text = url.replace(/^view-source:/, "");
    if (context.onMailtoLink) {
      let qmark = url.indexOf("?");
      text = qmark > 7 ? url.substring(7, qmark) : url.substr(7);
    } else if (context.onTelLink) {
      text = url.substr(4);
    } else {
      return text;
    }
    try {
      return Services.textToSubURI.unEscapeURIForUI(text);
    } catch (e) {
      return text;
    }
  },

  /* Menu des onglets */

  openTabMenu(entry, event) {
    this.tabEntry = entry;
    // Lu par ext-menus.js (onglet visé par les éléments des extensions).
    TabContextMenu.contextTab = entry.tab;
    let index = gTabs.list.indexOf(entry);
    let count = gTabs.list.length;
    let url = this.tabURL(entry);
    this.build(this.tabMenu, "tab", id => {
      switch (id) {
        case "new-tab":
        case "reload-tab":
        case "duplicate-tab":
        case "close-tab":
          return {};
        case "move-to-window":
          return { disabled: count == 1 };
        case "copy-tab-url":
          return { disabled: !url || url == "about:blank" };
        case "bookmark-tab":
          return { disabled: !gBookmarks.canBookmark(this.tabURI(entry)) };
        case "close-right":
          return { disabled: index == count - 1 };
        case "close-others":
          return { disabled: count == 1 };
      }
      return null;
    });
    this.tabMenu.openPopupAtScreen(event.screenX, event.screenY, true, event);
  },

  tabURL(entry) {
    return entry.browser?.currentURI.spec ?? entry.unloaded?.uri ?? "";
  },

  tabURI(entry) {
    try {
      return Services.io.newURI(this.tabURL(entry));
    } catch (e) {
      return null;
    }
  },

  onTabCommand(event) {
    let id = event.target.getAttribute("core-command");
    let entry = this.tabEntry;
    if (!id || !entry || !gTabs.list.includes(entry)) {
      return;
    }
    let index = gTabs.list.indexOf(entry);
    switch (id) {
      case "new-tab":
        gTabs.open(null);
        break;
      case "reload-tab":
        if (entry.unloaded) {
          gTabs.restore(entry);
        } else {
          entry.browser.reload();
        }
        break;
      case "duplicate-tab":
        gTabs.open(this.tabURL(entry) || null, { index: index + 1 });
        break;
      case "move-to-window":
        this.openWindow(entry.tab, { isPrivate: PrivateBrowsingUtils.isWindowPrivate(window) });
        break;
      case "copy-tab-url":
        this.copyString(this.tabURL(entry));
        break;
      case "bookmark-tab":
        gBookmarks
          .bookmarkURI(this.tabURI(entry), entry.browser?.contentTitle || entry.title.textContent)
          .catch(console.error);
        break;
      case "close-right":
        for (let other of gTabs.list.slice(index + 1).reverse()) {
          gTabs.close(other);
        }
        break;
      case "close-others":
        for (let other of gTabs.list.filter(e => e != entry)) {
          gTabs.close(other);
        }
        break;
      case "close-tab":
        gTabs.close(entry);
        break;
    }
  },

  /* Champs de saisie de l'interface */

  openEditMenu(input, event) {
    this.editInput = input;
    if (document.activeElement != input) {
      input.focus();
    }
    let isUrlbar = input == gToolbar.urlbar;
    for (let element of this.editMenu.children) {
      let command = element.getAttribute("core-command");
      if (element.id == "chrome-edit-paste-go") {
        element.hidden = !isUrlbar;
        element.toggleAttribute("disabled", !this.commandEnabled("cmd_paste"));
      } else if (command) {
        element.toggleAttribute("disabled", !this.commandEnabled(command));
      }
    }
    if (AppConstants.platform == "macosx" && !this.editMenu.macAccel) {
      this.editMenu.macAccel = true;
      for (let element of this.editMenu.querySelectorAll("[acceltext]")) {
        let text = element.getAttribute("acceltext");
        element.setAttribute("acceltext", text.replace("Ctrl+Maj+", "⌘⇧").replace("Ctrl+", "⌘"));
      }
    }
    this.editMenu.openPopupAtScreen(event.screenX, event.screenY, true, event);
  },

  onEditCommand(event) {
    let input = this.editInput;
    if (!input) {
      return;
    }
    input.focus();
    if (event.target.id == "chrome-edit-paste-go") {
      // Remplace l'adresse par le presse-papiers, puis l'ouvre.
      input.select();
      this.doCommand("cmd_paste");
      gToolbar.loadInput();
      return;
    }
    let command = event.target.getAttribute("core-command");
    if (command) {
      this.doCommand(command);
    }
  },

  /* Boutons des extensions (core/extensions/parent/ext-browserAction.js) */

  // Les éléments propres à l'extension (contexte « action ») sont ajoutés
  // ensuite en tête du menu par ext-menus.js.
  prepareExtensionMenu(extension) {
    this.extensionMenu.extension = extension;
    return this.extensionMenu;
  },

  async onExtensionCommand(event) {
    let { extension } = this.extensionMenu;
    if (!extension) {
      return;
    }
    if (event.target.id == "extension-context-manage") {
      BrowserAddonUI.openAddonsMgr(`addons://detail/${encodeURIComponent(extension.id)}`);
    } else if (event.target.id == "extension-context-remove") {
      let addon = await AddonManager.getAddonByID(extension.id);
      if (addon && (await BrowserAddonUI.promptRemoveExtension(addon)).remove) {
        addon.uninstall();
      }
    }
  },
};

// Onglet visé par le menu des onglets, au même endroit que dans Firefox
// (lu par ext-menus.js).
var TabContextMenu = {
  contextTab: null,
};
