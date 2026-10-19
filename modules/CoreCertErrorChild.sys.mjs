/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Adapte la page de certificat invalide de toolkit (about:certerror) :
// - le bouton « Accepter le risque et continuer » remplace « Avancé »,
//   les détails sont affichés juste en dessous (certerror.css) ;
// - core.certerrors.default choisit la réponse par défaut : "ask" montre
//   la page, "accept" ajoute l'exception et recharge sans la montrer,
//   "refuse" retire le bouton Continuer.

const SHEET = "chrome://core/content/certerror.css";

export class CoreCertErrorChild extends JSWindowActorChild {
  handleEvent(event) {
    let doc = this.document;
    let params = new URLSearchParams(doc.documentURI.split("?")[1]);
    // about:certerror sert aussi aux portails captifs et à l'erreur
    // d'horloge ; seules les erreurs de certificat nous concernent.
    if (params.get("e") != "nssBadCert") {
      return;
    }

    if (event.type == "DOMDocElementInserted") {
      this.contentWindow.windowUtils.loadSheetUsingURIString(
        SHEET,
        this.contentWindow.windowUtils.AUTHOR_SHEET
      );
      if (this.mode == "accept") {
        doc.documentElement.setAttribute("core-accepting", "true");
        this.accept(params);
      }
      return;
    }

    // AboutNetErrorLoad : toolkit a fini de remplir la page.
    let continueButton = doc.getElementById("exceptionDialogButton");
    if (this.mode == "refuse") {
      continueButton.hidden = true;
      return;
    }
    doc.getElementById("advancedButton").after(continueButton);
    this.enableAfterDelay(continueButton);
  }

  get mode() {
    return Services.prefs.getStringPref("core.certerrors.default", "ask");
  }

  // Mêmes règles que disallowCertOverridesIfNeeded() dans
  // toolkit/content/aboutNetError.mjs : jamais pour un site HSTS
  // (RFC 6797, section 12.1) ni dans un cadre.
  // Les informations du certificat peuvent arriver un peu après le
  // document : on réessaie comme ensureCertErrorCode() de toolkit.
  async canOverride(params) {
    if (params.get("s") == "badStsCert" || this.browsingContext.parent) {
      return false;
    }
    for (let i = 0; i < 4; i++) {
      try {
        return this.document.getFailedCertSecurityInfo().errorIsOverridable;
      } catch (e) {
        await new Promise(r => this.contentWindow.setTimeout(r, 100));
      }
    }
    return false;
  }

  async accept(params) {
    let temporary =
      this.docShell.QueryInterface(Ci.nsILoadContext).usePrivateBrowsing ||
      !Services.prefs.getBoolPref("security.certerrors.permanentOverride");
    try {
      if (await this.canOverride(params)) {
        await this.document.addCertException(temporary);
        this.contentWindow.location.reload();
        return;
      }
    } catch (e) {
      console.error(e);
    }
    // Pas d'exception possible : on montre la page.
    this.document.documentElement.removeAttribute("core-accepting");
  }

  // Comme toolkit, on n'active le bouton qu'après un court délai pour
  // qu'un clic destiné à la page précédente ne l'actionne pas.
  enableAfterDelay(button) {
    if (button.hidden) {
      return;
    }
    button.disabled = true;
    let delay = Services.prefs.getIntPref("security.dialog_enable_delay", 1000);
    this.contentWindow.setTimeout(() => {
      button.disabled = false;
    }, delay);
  }
}
