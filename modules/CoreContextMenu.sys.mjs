/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Éléments des menus clic droit et leur disposition, partagés par la
// fenêtre principale (base/content/contextmenu.js) et l'éditeur de menus
// (base/content/menu-editor.js).
//
// Chaque menu est une liste ordonnée d'identifiants, enregistrée dans une
// préférence (core.contextmenu.<menu>), où "-" est un séparateur.
// L'utilisateur peut déplacer, retirer et ajouter chaque élément. Un élément
// ne s'affiche que là où il a un sens (« Copier le lien » sur un lien, etc.)
// et les séparateurs inutiles sont masqués à l'ouverture du menu.

export const SEPARATOR = "-";

// group : où l'élément apparaît, montré dans l'éditeur.
const PAGE_ITEMS = [
  { id: "exit-fullscreen", label: "Quitter le plein écran", group: "Plein écran" },
  { id: "back", label: "Précédent", group: "Page", accel: "Alt+←", macAccel: "⌘[" },
  { id: "forward", label: "Suivant", group: "Page", accel: "Alt+→", macAccel: "⌘]" },
  { id: "reload", label: "Recharger", group: "Page", accel: "Ctrl+R" },
  { id: "bookmark-page", label: "Marquer cette page", group: "Page", accel: "Ctrl+D" },
  { id: "save-page", label: "Enregistrer la page sous…", group: "Page" },
  { id: "view-source", label: "Code source de la page", group: "Page" },

  { id: "link-tab", label: "Ouvrir le lien dans un nouvel onglet", group: "Lien" },
  { id: "link-window", label: "Ouvrir le lien dans une nouvelle fenêtre", group: "Lien" },
  { id: "link-private", label: "Ouvrir le lien dans une fenêtre privée", group: "Lien" },
  { id: "link-bookmark", label: "Marquer ce lien", group: "Lien" },
  { id: "link-save", label: "Enregistrer la cible du lien sous…", group: "Lien" },
  { id: "link-copy", label: "Copier le lien", group: "Lien" },

  { id: "image-tab", label: "Ouvrir l'image dans un nouvel onglet", group: "Image" },
  { id: "image-copy", label: "Copier l'image", group: "Image" },
  { id: "image-copy-url", label: "Copier l'adresse de l'image", group: "Image" },
  { id: "image-save", label: "Enregistrer l'image sous…", group: "Image" },

  { id: "media-play", label: "Lecture / Pause", group: "Vidéo et son" },
  { id: "media-mute", label: "Couper / rétablir le son", group: "Vidéo et son" },
  { id: "media-loop", label: "Lire en boucle", group: "Vidéo et son", type: "checkbox" },
  { id: "media-controls", label: "Afficher les contrôles", group: "Vidéo et son", type: "checkbox" },
  { id: "media-fullscreen", label: "Plein écran", group: "Vidéo et son" },
  { id: "media-tab", label: "Ouvrir la vidéo dans un nouvel onglet", group: "Vidéo et son" },
  { id: "media-copy-url", label: "Copier l'adresse de la vidéo", group: "Vidéo et son" },
  { id: "media-save", label: "Enregistrer la vidéo sous…", group: "Vidéo et son" },

  { id: "undo", label: "Annuler", group: "Champ de saisie", accel: "Ctrl+Z" },
  { id: "redo", label: "Rétablir", group: "Champ de saisie", accel: "Ctrl+Maj+Z" },
  { id: "cut", label: "Couper", group: "Champ de saisie", accel: "Ctrl+X" },
  { id: "copy", label: "Copier", group: "Sélection et champ de saisie", accel: "Ctrl+C" },
  { id: "paste", label: "Coller", group: "Champ de saisie", accel: "Ctrl+V" },
  { id: "paste-plain", label: "Coller sans mise en forme", group: "Champ de saisie", accel: "Ctrl+Maj+V" },
  { id: "delete", label: "Supprimer", group: "Champ de saisie" },
  { id: "select-all", label: "Tout sélectionner", group: "Page et champ de saisie", accel: "Ctrl+A" },
  { id: "reveal-password", label: "Afficher le mot de passe", group: "Champ de saisie", type: "checkbox" },
  { id: "search", label: "Rechercher la sélection", group: "Sélection" },

  { id: "frame-tab", label: "Ouvrir le cadre dans un nouvel onglet", group: "Cadre" },
  { id: "frame-reload", label: "Recharger le cadre", group: "Cadre" },

  { id: "extensions", label: "Éléments des extensions", group: "Extensions" },
];

const TAB_ITEMS = [
  { id: "new-tab", label: "Nouvel onglet", group: "Onglet", accel: "Ctrl+T" },
  { id: "reload-tab", label: "Recharger l'onglet", group: "Onglet" },
  { id: "duplicate-tab", label: "Dupliquer l'onglet", group: "Onglet" },
  { id: "move-to-window", label: "Déplacer dans une nouvelle fenêtre", group: "Onglet" },
  { id: "copy-tab-url", label: "Copier l'adresse", group: "Onglet" },
  { id: "bookmark-tab", label: "Marquer cet onglet", group: "Onglet" },
  { id: "close-right", label: "Fermer les onglets à droite", group: "Onglet" },
  { id: "close-others", label: "Fermer les autres onglets", group: "Onglet" },
  { id: "close-tab", label: "Fermer l'onglet", group: "Onglet", accel: "Ctrl+W" },
  { id: "extensions", label: "Éléments des extensions", group: "Extensions" },
];

export const MENUS = {
  page: { label: "Menu des pages", pref: "core.contextmenu.page", items: PAGE_ITEMS },
  tab: { label: "Menu des onglets", pref: "core.contextmenu.tab", items: TAB_ITEMS },
};

export const CoreContextMenu = {
  SEPARATOR,
  MENUS,

  item(menu, id) {
    return MENUS[menu].items.find(item => item.id == id) ?? null;
  },

  parse(value, menu) {
    let ids = value.split(",").map(id => id.trim()).filter(Boolean);
    let seen = new Set();
    return ids.filter(id => {
      if (id == SEPARATOR) {
        return true;
      }
      // Élément inconnu (retiré d'une version de Core) ou en double : ignoré.
      if (seen.has(id) || !this.item(menu, id)) {
        return false;
      }
      seen.add(id);
      return true;
    });
  },

  // Disposition actuelle : liste d'identifiants et de séparateurs.
  layout(menu) {
    return this.parse(Services.prefs.getStringPref(MENUS[menu].pref, ""), menu);
  },

  defaultLayout(menu) {
    return this.parse(
      Services.prefs.getDefaultBranch("").getStringPref(MENUS[menu].pref, ""),
      menu
    );
  },

  setLayout(menu, ids) {
    let value = ids.join(",");
    let { pref } = MENUS[menu];
    if (value == this.defaultLayout(menu).join(",")) {
      Services.prefs.clearUserPref(pref);
    } else {
      Services.prefs.setStringPref(pref, value);
    }
  },

  reset(menu) {
    Services.prefs.clearUserPref(MENUS[menu].pref);
  },
};
