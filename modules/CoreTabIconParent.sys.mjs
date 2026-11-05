/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Reçoit l'icône chargée par CoreTabIconChild et la passe à l'onglet
// (gTabs.setIcon de base/content/main.js).

export class CoreTabIconParent extends JSWindowActorParent {
  receiveMessage({ name, data }) {
    if (name != "Core:TabIcon" || !data.dataURL?.startsWith("data:image/")) {
      return;
    }
    let browser = this.browsingContext.top.embedderElement;
    browser?.ownerGlobal.gTabs?.setIcon(browser, data.dataURL, data.pageURL);
  }
}
