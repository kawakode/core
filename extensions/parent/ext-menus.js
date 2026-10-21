/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// API menus / contextMenus sans affichage : Core n'a pas encore de menu
// contextuel (fonction A1 de la liste des fonctionnalités). Les extensions
// peuvent créer, modifier et supprimer leurs éléments comme dans Firefox, ce
// qui évite qu'elles s'arrêtent sur une erreur, mais aucun élément n'est
// montré et onClicked, onShown et onHidden ne se déclenchent jamais.
// Le côté enfant (child/ext-menus.js de Firefox) est repris tel quel.

var { DefaultMap, ExtensionError } = ExtensionUtils;

// Map[Extension -> Map[id -> parentId]]
const menuIds = new DefaultMap(() => new Map());

function descendants(ids, id) {
  let result = [id];
  for (let [child, parent] of ids) {
    if (parent === id) {
      result.push(...descendants(ids, child));
    }
  }
  return result;
}

function neverFires(context, name) {
  return new EventManager({ context, name, register: () => () => {} }).api();
}

this.menusInternal = class extends ExtensionAPI {
  onShutdown() {
    menuIds.delete(this.extension);
  }

  getAPI(context) {
    let { extension } = context;
    let ids = menuIds.get(extension);

    const menus = {
      refresh() {},
      onShown: neverFires(context, "menus.onShown"),
      onHidden: neverFires(context, "menus.onHidden"),
    };

    return {
      contextMenus: menus,
      menus,
      menusInternal: {
        async create(createProperties) {
          let { id, parentId } = createProperties;
          if (ids.has(id)) {
            throw new ExtensionError(`The menu id ${id} already exists in menus.create.`);
          }
          if (parentId != null && !ids.has(parentId)) {
            throw new ExtensionError(`Could not find any MenuItem with id: ${parentId}`);
          }
          ids.set(id, parentId ?? null);
        },

        async update(id, updateProperties) {
          if (!ids.has(id)) {
            throw new ExtensionError(`Cannot find menu item with id ${id}`);
          }
          if (updateProperties.parentId !== undefined) {
            ids.set(id, updateProperties.parentId);
          }
        },

        async remove(id) {
          if (!ids.has(id)) {
            throw new ExtensionError(`Cannot find menu item with id ${id}`);
          }
          for (let removed of descendants(ids, id)) {
            ids.delete(removed);
          }
        },

        async removeAll() {
          ids.clear();
        },

        onClicked: neverFires(context, "menus.onClicked"),
      },
    };
  }
};
