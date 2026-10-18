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

// Pas de cache de pages entières en mémoire pour l'historique (bfcache).
// À mesurer : gagne de la mémoire, rend précédent/suivant moins instantané.
pref("browser.sessionhistory.max_total_viewers", 0);

// Onglets en arrière-plan déchargés après 30 minutes sans être affichés,
// et tous dès que le système signale un manque de mémoire.
pref("core.tabs.unloadAfterMinutes", 30);

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
