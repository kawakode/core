/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Préférences par défaut de Core. Les valeurs de Gecko (modules/libpref)
// s'appliquent pour tout ce qui n'est pas listé ici.

// Fenêtre ouverte au démarrage (toolkit/components/DefaultCLH.sys.mjs).
pref("toolkit.defaultChromeURI", "chrome://core/content/main.xhtml");
pref("browser.chromeURL", "chrome://core/content/main.xhtml");
pref("core.homepage", "about:blank");

pref("general.useragent.locale", "en-US");
pref("intl.locale.requested", "");

// Rien ne se charge sans demande explicite.
pref("network.prefetch-next", false);
pref("network.predictor.enabled", false);
pref("network.dns.disablePrefetch", true);
pref("network.http.speculative-parallel-limit", 0);
pref("browser.urlbar.speculativeConnect.enabled", false);

// Pas de télémétrie ni d'études.
pref("toolkit.telemetry.enabled", false);
pref("toolkit.telemetry.unified", false);
pref("toolkit.telemetry.archive.enabled", false);
pref("datareporting.policy.dataSubmissionEnabled", false);
pref("datareporting.healthreport.uploadEnabled", false);
pref("app.shield.optoutstudies.enabled", false);
pref("app.normandy.enabled", false);

// Pas de vérification de mise à jour tant qu'il n'y a pas de canal.
pref("app.update.enabled", false);
pref("extensions.update.enabled", true);

// Une seule page gardée en mémoire pour précédent/suivant (bfcache). À 0, le
// processus de la page quittée est détruit et chaque navigation en relance
// un : premier affichage 2 à 3 fois plus lent, pour 50 Mo économisés
// (Firefox, à -1, en garde jusqu'à 8).
pref("browser.sessionhistory.max_total_viewers", 1);

// Sécurité. Firefox règle ces valeurs dans browser/app/profile/firefox.js,
// que Core n'embarque pas : sans elles, Gecko retombe sur ses propres valeurs
// par défaut (sandbox de contenu au niveau 0 sous Linux, extensions dans le
// processus principal).

// Sandbox des processus de contenu, mêmes niveaux que Firefox. L'utilisateur
// peut la désactiver dans les réglages (chrome://core/content/settings.xhtml),
// ce qui pose une valeur utilisateur à 0. Gecko impose de toute façon un
// minimum sous Windows (6) et macOS (1).
#if defined(XP_WIN) && defined(MOZ_SANDBOX)
pref("security.sandbox.content.level", 9);
pref("security.sandbox.logging.enabled", false);
#endif
#if defined(XP_MACOSX) && defined(MOZ_SANDBOX)
pref("security.sandbox.content.level", 3);
pref("security.sandbox.content.mac.disconnect-windowserver", true);
pref("security.sandbox.logging.enabled", false);
#endif
#if defined(XP_LINUX) && defined(MOZ_SANDBOX)
pref("security.sandbox.content.level", 6);
pref("security.sandbox.content.write_path_whitelist", "");
pref("security.sandbox.content.read_path_whitelist", "");
pref("security.sandbox.content.syscall_whitelist", "");
pref("security.sandbox.socket.process.level", 2);
#endif

// Réseau de WebRTC dans le processus socket : nécessaire au niveau 9 de la
// sandbox Windows (security/sandbox/common/SandboxSettings.cpp).
pref("media.peerconnection.mtransport_process", true);

// Extensions dans leur propre processus, sans parcourir les dossiers
// d'extensions du système au démarrage.
pref("extensions.webextensions.remote", true);
pref("extensions.startupScanScopes", 0);

// Extensions d'addons.mozilla.org : signature obligatoire, installation
// autorisée depuis AMO sans question (permission « install » de
// defaults/permissions), mises à jour vérifiées chaque jour auprès d'AMO.
// Valeurs de browser/app/profile/firefox.js.
pref("xpinstall.signatures.required", true);
pref("extensions.langpacks.signatures.required", true);
pref("permissions.manager.defaultsUrl", "resource://app/defaults/permissions");
pref("extensions.webextOptionalPermissionPrompts", true);
pref("extensions.postDownloadThirdPartyPrompt", true);
pref("extensions.update.autoUpdateDefault", true);
pref("extensions.update.url", "https://versioncheck.addons.mozilla.org/update/VersionCheck.php?reqVersion=%REQ_VERSION%&id=%ITEM_ID%&version=%ITEM_VERSION%&maxAppVersion=%ITEM_MAXAPPVERSION%&status=%ITEM_STATUS%&appID=%APP_ID%&appVersion=%APP_VERSION%&appOS=%APP_OS%&appABI=%APP_ABI%&locale=%APP_LOCALE%&currentAppVersion=%CURRENT_APP_VERSION%&updateType=%UPDATE_TYPE%&compatMode=%COMPATIBILITY_MODE%");
pref("extensions.update.background.url", "https://versioncheck-bg.addons.mozilla.org/update/VersionCheck.php?reqVersion=%REQ_VERSION%&id=%ITEM_ID%&version=%ITEM_VERSION%&maxAppVersion=%ITEM_MAXAPPVERSION%&status=%ITEM_STATUS%&appID=%APP_ID%&appVersion=%APP_VERSION%&appOS=%APP_OS%&appABI=%APP_ABI%&locale=%APP_LOCALE%&currentAppVersion=%CURRENT_APP_VERSION%&updateType=%UPDATE_TYPE%&compatMode=%COMPATIBILITY_MODE%");
pref("extensions.update.interval", 86400);
// about:addons (Ctrl+Maj+A) : ni recommandations ni données téléchargées
// d'AMO ; seul le lien « Trouver d'autres extensions » y mène.
pref("extensions.htmlaboutaddons.recommendations.enabled", false);
pref("extensions.getAddons.showPane", false);
pref("extensions.getAddons.cache.enabled", false);
pref("extensions.getAddons.link.url", "https://addons.mozilla.org/%LOCALE%/firefox/");
pref("extensions.getAddons.search.browseURL", "https://addons.mozilla.org/%LOCALE%/firefox/search?q=%TERMS%&platform=%OS%&appver=%VERSION%");

// Aucune fonction d'IA dans Core (décision du 18/10/2026).
pref("browser.ml.enable", false);

// Marque-pages : pas de barre par défaut (Ctrl+Maj+B l'affiche), et
// jusqu'à 15 sauvegardes quotidiennes dans le dossier bookmarkbackups du
// profil (modules/CoreBookmarks.sys.mjs).
pref("core.bookmarks.toolbar", false);
pref("browser.bookmarks.max_backups", 15);
// Journal de Places (toolkit) limité aux erreurs, comme Firefox : sans cette
// préférence, la console reçoit toutes les traces du module.
pref("places.loglevel", "Error");

// Onglets en arrière-plan déchargés après 30 minutes sans être affichés,
// et tous dès que le système signale un manque de mémoire.
pref("core.tabs.unloadAfterMinutes", 30);

// Téléchargements : enregistrés sans question dans le dossier
// Téléchargements du système (Firefox fait de même ; sans ces valeurs de
// browser/app/profile/firefox.js, toolkit demande chaque fois où enregistrer).
// Les réglages de Core permettent de choisir un autre dossier ou de toujours
// demander.
pref("browser.download.useDownloadDir", true);
pref("browser.download.folderList", 1);
pref("browser.download.manager.addToRecentDocs", true);
pref("browser.download.manager.resumeOnWakeDelay", 10000);
// Liste des téléchargements : "panel" (bouton et panneau sous la barre
// d'outils) ou "bar" (barre en bas de la fenêtre). Voir base/content/downloads.js.
pref("core.downloads.display", "panel");

// Liens « En savoir plus » des pages d'erreur.
pref("app.support.baseURL", "https://support.mozilla.org/1/firefox/%VERSION%/%OS%/%LOCALE%/");

// Pages d'erreur de certificat (valeurs de Firefox, lues par
// toolkit/content/aboutNetError.mjs et net-error-card.mjs).
pref("security.certerrors.permanentOverride", true);
// Ancienne présentation : la nouvelle utilise une illustration de Firefox.
pref("security.certerrors.felt-privacy-v1", false);
pref("security.certerrors.mitm.priming.enabled", true);
pref("security.certerrors.mitm.priming.endpoint", "https://mitmdetection.services.mozilla.com/");
pref("security.certerrors.mitm.auto_enable_enterprise_roots", true);
pref("browser.ipProtection.userEnabled", false);
// Réponse par défaut à un certificat invalide : "ask" (afficher la page),
// "accept" (continuer sans la page) ou "refuse" (page sans bouton
// Continuer). Appliquée par modules/CoreCertErrorChild.sys.mjs.
pref("core.certerrors.default", "ask");
