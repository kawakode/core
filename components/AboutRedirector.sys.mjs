/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Pages about: que Gecko attend de l'application. Firefox les déclare dans
// browser/components/about/AboutRedirector.cpp ; Core n'en garde que celles
// qui pointent vers du code de toolkit/.

const PAGES = {
  // Erreurs de certificat : même page que about:neterror (toolkit/content).
  certerror: {
    url: "chrome://global/content/aboutNetError.html",
    flags:
      Ci.nsIAboutModule.URI_SAFE_FOR_UNTRUSTED_CONTENT |
      Ci.nsIAboutModule.URI_CAN_LOAD_IN_CHILD |
      Ci.nsIAboutModule.ALLOW_SCRIPT |
      Ci.nsIAboutModule.HIDE_FROM_ABOUTABOUT,
  },
  // Gestionnaire de marque-pages, dans le processus principal (il lit et
  // modifie Places directement), interdit aux pages web.
  bookmarks: {
    url: "chrome://core/content/bookmarks-manager.xhtml",
    flags: Ci.nsIAboutModule.ALLOW_SCRIPT | Ci.nsIAboutModule.IS_SECURE_CHROME_UI,
  },
};

function pageFor(uri) {
  let name = uri.pathQueryRef.replace(/[?#].*/, "").toLowerCase();
  let page = PAGES[name];
  if (!page) {
    throw Components.Exception(`about:${name}`, Cr.NS_ERROR_ILLEGAL_VALUE);
  }
  return page;
}

export function AboutRedirector() {}

AboutRedirector.prototype = {
  QueryInterface: ChromeUtils.generateQI(["nsIAboutModule"]),

  newChannel(uri, loadInfo) {
    let page = pageFor(uri);
    let channel = Services.io.newChannelFromURIWithLoadInfo(
      Services.io.newURI(page.url),
      loadInfo
    );
    channel.originalURI = uri;
    return channel;
  },

  getURIFlags(uri) {
    return pageFor(uri).flags;
  },

  getChromeURI(uri) {
    return Services.io.newURI(pageFor(uri).url);
  },
};
