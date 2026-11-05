/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Icône de l'onglet : version très réduite de LinkHandlerChild et
// FaviconLoader de Firefox. Une seule icône par page, choisie parmi les
// <link rel="icon"> (sinon /favicon.ico), chargée dans le processus de la
// page avec les droits de la page, puis envoyée à la fenêtre en data: URL.
// Rien n'est enregistré sur le disque.

import { NetUtil } from "resource://gre/modules/NetUtil.sys.mjs";

// Au-delà, l'icône est ignorée : une icône d'onglet fait 16 px.
const MAX_BYTES = 100 * 1024;

export class CoreTabIconChild extends JSWindowActorChild {
  constructor() {
    super();
    this.best = null;
    this.shown = false;
    this.sent = null;
  }

  handleEvent(event) {
    switch (event.type) {
      case "pageshow":
        if (event.target == this.document) {
          this.shown = true;
          this.update();
        }
        break;
      case "pagehide":
        if (event.target == this.document) {
          this.best = null;
          this.shown = false;
          this.sent = null;
        }
        break;
      default:
        this.onLink(event.target);
    }
  }

  // DOMLinkAdded, DOMLinkChanged : retient la meilleure icône de la page.
  onLink(link) {
    if (link.documentGlobal != this.contentWindow || !link.getAttribute("href")) {
      return;
    }
    let rels = (link.rel || "").toLowerCase().split(/\s+/);
    if (!rels.includes("icon") || rels.includes("mask") || link.hasAttribute("color")) {
      return;
    }
    let score = iconScore(link);
    if (!this.best || score >= this.best.score) {
      this.best = { href: link.href, score, node: link };
    }
    // Icône changée par la page après son affichage (compteur de messages…).
    if (this.shown) {
      this.update();
    }
  }

  update() {
    let pageURI = this.document.documentURIObject;
    if (!["http", "https"].includes(pageURI.scheme)) {
      return;
    }
    let href = this.best?.href ?? pageURI.prePath + "/favicon.ico";
    if (href == this.sent) {
      return;
    }
    this.sent = href;
    let node = this.best?.node ?? this.document;
    load(href, node).then(
      dataURL => {
        if (this.sent == href) {
          this.sendAsyncMessage("Core:TabIcon", { dataURL, pageURL: pageURI.spec });
        }
      },
      () => {}
    );
  }
}

// 16 ou 32 px d'abord, puis une icône vectorielle ou sans taille.
function iconScore(link) {
  let sizes = [...link.sizes].map(s => s.toLowerCase());
  if (sizes.includes("16x16") || sizes.includes("32x32")) {
    return 3;
  }
  if (sizes.includes("any") || /svg/i.test(link.type)) {
    return 2;
  }
  if (!sizes.length) {
    return 1;
  }
  return parseInt(sizes[0]) <= 64 ? 1 : 0;
}

function load(href, node) {
  let uri = Services.io.newURI(href);
  let channel = Services.io.newChannelFromURI(
    uri,
    node,
    node.nodePrincipal,
    node.nodePrincipal,
    Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_INHERITS_SEC_CONTEXT |
      Ci.nsILoadInfo.SEC_ALLOW_CHROME |
      Ci.nsILoadInfo.SEC_DISALLOW_SCRIPT,
    Ci.nsIContentPolicy.TYPE_INTERNAL_IMAGE_FAVICON
  );
  channel.loadFlags |= Ci.nsIRequest.LOAD_BACKGROUND | Ci.nsIRequest.VALIDATE_NEVER;
  if (channel instanceof Ci.nsIHttpChannelInternal) {
    channel.blockAuthPrompt = true;
  }
  return new Promise((resolve, reject) => {
    NetUtil.asyncFetch(channel, (stream, status, request) => {
      try {
        if (!Components.isSuccessCode(status)) {
          throw new Error("échec");
        }
        if (request instanceof Ci.nsIHttpChannel && !request.requestSucceeded) {
          throw new Error(`HTTP ${request.responseStatus}`);
        }
        let length = stream.available();
        if (!length || length > MAX_BYTES) {
          throw new Error("taille");
        }
        let bytes = new Uint8Array(NetUtil.readInputStream(stream, length));
        let type = request.contentType;
        if (type != "image/svg+xml") {
          type = Cc["@mozilla.org/image/loader;1"]
            .createInstance(Ci.nsIContentSniffer)
            .getMIMETypeFromContent(request, bytes, bytes.length);
        }
        if (!type?.startsWith("image/")) {
          throw new Error("type");
        }
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        resolve(`data:${type};base64,${btoa(binary)}`);
      } catch (e) {
        reject(e);
      } finally {
        stream?.close();
      }
    });
  });
}
