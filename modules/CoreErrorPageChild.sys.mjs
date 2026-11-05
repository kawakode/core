/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Pages d'erreur de toolkit (réseau, certificat) : ajoute errorpage.css,
// qui leur donne les couleurs, la police et les boutons de Core.

const SHEET = "chrome://core/content/errorpage.css";

export class CoreErrorPageChild extends JSWindowActorChild {
  handleEvent() {
    this.contentWindow.windowUtils.loadSheetUsingURIString(
      SHEET,
      this.contentWindow.windowUtils.AUTHOR_SHEET
    );
  }
}
