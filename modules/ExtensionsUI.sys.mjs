/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Questions posées pendant l'installation d'une extension. Firefox les
// affiche dans des notifications de la barre d'adresse
// (browser/modules/ExtensionsUI.sys.mjs, browser-addons.js) ; Core se
// contente des boîtes de dialogue de toolkit (Services.prompt), ouvertes sur
// l'onglet qui a lancé l'installation.
//
// Sans ces réponses, le gestionnaire d'extensions attend indéfiniment : une
// installation depuis addons.mozilla.org ne se termine jamais.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  ExtensionData: "resource://gre/modules/Extension.sys.mjs",
});

const TOPICS = [
  "addon-install-blocked",
  "addon-install-disabled",
  "addon-install-failed",
  "addon-install-origin-blocked",
  "addon-install-policy-blocked",
  "addon-install-webapi-blocked",
  "webextension-install-notify",
  "webextension-optional-permission-prompt",
  "webextension-permission-prompt",
  "webextension-update-permission-prompt",
];

// Les messages d'erreur d'installation, par code de AddonManager.
const ERRORS = {
  [-1]: "le téléchargement a échoué.",
  [-2]: "le fichier ne correspond pas à l'extension attendue.",
  [-3]: "le fichier est corrompu.",
  [-4]: "le fichier n'a pas pu être enregistré.",
  [-5]: "l'extension n'est pas signée par Mozilla.",
  [-8]: "le fichier n'est pas une extension valide.",
  [-10]: "elle est bloquée pour des raisons de sécurité.",
  [-11]: "elle n'est pas compatible avec cette version de Core.",
};

function windowFor(browser) {
  return browser?.ownerGlobal ?? Services.wm.getMostRecentWindow("navigator:browser");
}

function alert(browser, message) {
  Services.prompt.alert(windowFor(browser), "Extensions", message);
}

// Boîte de dialogue « Ajouter » / « Annuler » avec la liste des permissions,
// formatée par toolkit (mêmes textes que Firefox).
// Une mise à jour ou une demande facultative sans permission nouvelle à
// montrer est acceptée sans question.
function confirmPermissions(browser, info, { title, accept } = {}) {
  let strings = lazy.ExtensionData.formatPermissionStrings(info, {
    fullDomainsList: true,
  });
  if (
    info.type &&
    info.type != "sideload" &&
    !strings.msgs.length &&
    !strings.dataCollectionPermissions?.msg
  ) {
    return true;
  }
  let name = info.addon.name;
  let header = (strings.header ?? "<>").replace("<>", name);
  let lines = [header];
  if (strings.msgs.length) {
    lines.push("");
    if (strings.listIntro) {
      lines.push(strings.listIntro);
    }
    lines.push(...strings.msgs.map(msg => `• ${msg}`));
  }
  if (strings.dataCollectionPermissions?.msg) {
    lines.push("", strings.dataCollectionPermissions.msg);
  }
  if (info.unsigned) {
    lines.push("", "Attention : cette extension n'est pas vérifiée par Mozilla.");
  }
  let flags =
    Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_IS_STRING +
    Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_IS_STRING +
    Services.prompt.BUTTON_POS_1_DEFAULT;
  let button = Services.prompt.confirmEx(
    windowFor(browser),
    title ?? "Ajouter une extension",
    lines.join("\n"),
    flags,
    accept ?? strings.acceptText ?? "Ajouter",
    strings.cancelText ?? "Annuler",
    null,
    null,
    {}
  );
  return button == 0;
}

export const ExtensionsUI = {
  init() {
    for (let topic of TOPICS) {
      Services.obs.addObserver(this, topic);
    }
  },

  observe(subject, topic) {
    let info = subject.wrappedJSObject;
    switch (topic) {
      case "webextension-permission-prompt": {
        let { target, info: install } = info;
        install.unsigned =
          install.addon.signedState <= lazy.AddonManager.SIGNEDSTATE_MISSING;
        if (confirmPermissions(target, install)) {
          install.resolve();
        } else {
          install.reject();
        }
        break;
      }

      case "webextension-update-permission-prompt":
        info.type = "update";
        if (
          confirmPermissions(null, info, {
            title: "Mise à jour d'une extension",
            accept: "Mettre à jour",
          })
        ) {
          info.resolve();
        } else {
          info.reject();
        }
        break;

      case "webextension-optional-permission-prompt": {
        let { browser, name, permissions, resolve } = info;
        resolve(
          confirmPermissions(browser, {
            type: "optional",
            addon: { name },
            permissions,
          }, { title: "Autorisation demandée", accept: "Autoriser" })
        );
        break;
      }

      case "webextension-install-notify":
        info.callback?.();
        break;

      // Installation proposée par un site autre qu'addons.mozilla.org.
      case "addon-install-blocked": {
        let host = info.originatingURI?.host || "Ce site";
        let allow = Services.prompt.confirm(
          windowFor(info.browser),
          "Installer une extension",
          `${host} veut installer une extension. Continuer ?`
        );
        if (allow) {
          info.install();
        } else {
          info.cancel?.();
        }
        break;
      }

      case "addon-install-origin-blocked":
      case "addon-install-webapi-blocked":
        alert(info.browser, "Ce site n'a pas le droit d'installer des extensions.");
        break;

      case "addon-install-disabled":
        alert(info.browser, "L'installation d'extensions est désactivée.");
        break;

      case "addon-install-policy-blocked":
        alert(info.browser, "L'installation de cette extension est bloquée par une règle d'administration.");
        break;

      case "addon-install-failed":
        for (let install of info.installs) {
          let name = install.addon?.name ?? install.name ?? "L'extension";
          let reason = ERRORS[install.error] ?? "erreur inconnue.";
          alert(info.browser, `${name} n'a pas pu être installée : ${reason}`);
        }
        break;
    }
  },

  QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),
};
