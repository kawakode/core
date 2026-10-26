# Architecture

## Un projet Gecko, pas un fork

Il n'existe plus d'API pour embarquer Gecko dans une application de bureau :
XULRunner, l'ancienne couche `embedding/`, Positron et qbrt ont disparu,
GeckoView ne tourne que sur Android et EmbedLite (Sailfish) est resté sur
ESR 91. La seule voie que Mozilla entretient en dehors de Firefox est celle de
Thunderbird : un **projet** Gecko à part, construit dans l'arbre source de
Firefox avec `--enable-project=<nom>`.

| Option étudiée | Verdict |
|---|---|
| **Projet Gecko dédié** (`--enable-project=core`, comme `comm/mail`) | **Retenu** : rien de `browser/` n'est compilé ni chargé, chaque brique de `toolkit/` est choisie |
| Fork de Firefox (LibreWolf, Floorp, Zen…) | Écarté : `browser/` est très imbriqué, chaque retrait est un patch à rebaser à chaque version |
| Firefox d'origine + profil (`user.js`, policies) | Écarté comme produit : tout `browser/` reste chargé ; utile comme point de comparaison |
| EmbedLite | Écarté : bloqué sur ESR 91, ni Windows ni macOS |
| Piloter un Firefox caché (Marionette) | Écarté : deux applications au lieu d'une |

Conséquence : Core ne contient pas Sync, Pocket, Normandy, la télémétrie de
santé, les migrateurs de profil, Firefox View, etc. Ils ne sont pas désactivés,
ils n'existent pas dans le binaire.

Core suit les versions **ESR** de Gecko : une grosse montée par an, puis des
versions correctives de sécurité. Release imposerait treize adaptations par an
aux API de `toolkit/`, qui ne sont pas stables.

## Comment le dépôt se branche sur Gecko

Le dépôt ne contient que le répertoire de projet. `scripts/bootstrap.sh` :

1. clone Firefox (`github.com/mozilla-firefox/firefox`) au tag de `GECKO_TAG` ;
2. vérifie que ce tag pointe bien sur le commit de `GECKO_COMMIT` (un tag
   déplacé ferait construire une source non vérifiée) ;
3. copie `vendor/` dans l'arbre (décodeur HEVC de FFmpeg, en-tête VA-API) ;
4. applique `patches/*.patch` ;
5. crée le lien `<gecko>/core` vers le dépôt.

Gecko trouve alors `core/moz.configure` et construit l'application.

```
gecko/                    ← clone de Firefox au tag ESR
├── toolkit/, dom/, …     ← le moteur, réutilisé tel quel
├── browser/              ← ignoré
└── core → ../core        ← ce dépôt
```

## Organisation du dépôt

| Chemin | Rôle |
|---|---|
| `moz.configure` | Déclare le projet : active Places, garde l'identifiant d'application et le User-Agent de Firefox, inclut `toolkit/moz.configure` |
| `confvars.sh`, `app.mozbuild`, `moz.build` | Branchement dans le système de build de Gecko (`DIST_SUBDIR = "app"`, car `core` est déjà le nom du binaire) |
| `app/` | Lanceur natif `nsCoreApp.cpp` (dérivé de `browser/app/nsBrowserApp.cpp`), préférences par défaut `profile/core.js`, permissions par défaut |
| `base/content/` | Interface : `main.xhtml`/`main.js` (fenêtre, onglets, barre d'adresse), `settings.*` (réglages), `tokens.css` (couleurs et dimensions du design), icônes SVG |
| `components/` | `CoreGlue` (initialisation au démarrage) et `AboutRedirector` (`about:certerror`, `about:history`) |
| `modules/` | Modules que `toolkit/` attend sous `resource:///modules/` (`HomePage`, `BrowserWindowTracker`, `ExtensionsUI`, `BuiltInThemes`) et l'acteur `CoreCertErrorChild` |
| `extensions/` | API d'extensions liées à l'interface, l'équivalent de `browser/components/extensions/` |
| `branding/` | Nom et icônes |
| `mozconfigs/` | Options de build par cible (voir [Construire](Construire.md)) |
| `patches/`, `vendor/` | Correctifs de Gecko et sources tierces ajoutées par `bootstrap.sh` |
| `scripts/` | `bootstrap.sh`, recettes PGO (`pgo/`), scripts de release (`release/`) |
| `securite/` | Vérification des dépendances (voir [Sécurité](Securite.md)) |
| `winlibs/` | Bibliothèques système Windows ajoutées à l'édition de liens de libxul |

## Démarrage

1. Le lanceur natif (`app/nsCoreApp.cpp`) appelle `XRE_main` de Gecko.
2. À `profile-after-change`, `components/CoreGlue.sys.mjs` (l'équivalent très
   réduit du `BrowserGlue` de Firefox) :
   - importe `ActorManagerParent`, ce qui enregistre les acteurs de `toolkit/`
     (pages d'erreur, listes déroulantes, autocomplétion de formulaires,
     sélecteurs de date et de couleur) ;
   - enregistre l'acteur `CoreCertError` de la page de certificat invalide ;
   - initialise `ExtensionsUI` (questions posées à l'installation d'une
     extension).
3. `toolkit.defaultChromeURI` ouvre `chrome://core/content/main.xhtml`.

Firefox règle beaucoup de choses dans `browser/app/profile/firefox.js`, que
Core n'embarque pas. Sans ces valeurs, Gecko retombe sur ses propres défauts,
parfois dangereux (sandbox de contenu au niveau 0 sous Linux, extensions dans
le processus principal). `app/profile/core.js` reprend donc explicitement ce
qui compte pour la sécurité et le fonctionnement.

## L'interface

La fenêtre est en HTML privilégié (« chrome »), comme dans Firefox et
Thunderbird. Une interface native (GTK, Cocoa, Win32) n'est pas possible :
Gecko n'a plus d'API d'embarquement natif.

- **Onglets** (`gTabs` dans `main.js`) : chaque onglet est un
  `<browser type="content" remote="true">`, donc la page tourne dans un
  processus de contenu séparé et sandboxé. Les onglets en arrière-plan sont
  déchargés après `core.tabs.unloadAfterMinutes` (30 min) sans être affichés,
  et tous dès que le système signale un manque de mémoire.
- **Barre d'outils** (`gToolbar`) : précédent, suivant, recharger, adresse,
  menu ≡.
- **Barre de titre** (`gTitlebar`) : les onglets sont dans la barre de titre
  et Core dessine les boutons de la fenêtre (`browser.tabs.inTitlebar`).
- **Nouvelles fenêtres** : `target=_blank`, `window.open` et les liens venus
  d'autres programmes deviennent des onglets (`nsIBrowserDOMWindow`).
- **Compatibilité `browser/`** : `toolkit/` et WebDriver appellent des
  fonctions que Firefox définit dans `browser/` (`gBrowser`,
  `openTrustedLinkIn`, `BrowserAddonUI`, `SidebarController`…). `main.js` en
  fournit des versions minimales.
- **Réglages** (`settings.xhtml`) : sandbox, réponse par défaut aux
  certificats invalides, barre de titre du système ou de Core.

Le design (couleurs, tailles, animations) est décrit dans le document de
design du projet ; ses valeurs sont dans `base/content/tokens.css`.

Raccourcis clavier actuels : Ctrl+T, Ctrl+W, Ctrl+Tab / Ctrl+Maj+Tab, Ctrl+L
ou F6, Ctrl+R ou F5, Alt+← / Alt+→, Ctrl+Maj+A (extensions), Ctrl+Q (Cmd sur
macOS).

## Extensions

Le moteur WebExtensions et la plupart des API (`storage`, `webRequest`,
`runtime`, `downloads`…) sont dans `toolkit/`. Les API liées à l'interface
(`tabs`, `windows`, `browserAction`, `menus`…) sont, dans Firefox, dans
`browser/components/extensions/`. Core les fournit dans `extensions/`, comme
Thunderbird le fait dans `comm/mail/components/extensions/` :

- `extensions-core.manifest` et `ext-core.json` déclarent les API ;
- `parent/ext-core.js` fait le lien avec les onglets et fenêtres de Core
  (`tabTracker`, `windowTracker`) ;
- `parent/ext-tabs.js`, `ext-browserAction.js`, `ext-menus.js` sont écrits
  pour Core ; `windows`, `history`, `bookmarks` et `commands` sont repris de
  Firefox.

Pour que les extensions d'addons.mozilla.org s'installent, Core se présente
comme Firefox : même `MOZ_APP_ID`, même numéro de version, même User-Agent
(un nom de navigateur rare rendrait aussi l'utilisateur plus facile à
pister). Les extensions sont signées obligatoirement et mises à jour chaque
jour depuis AMO.

Limite actuelle : pas de menu contextuel, donc les entrées de menu des
extensions ne s'affichent pas encore.

## Correctifs de Gecko

Le principe est de ne pas patcher Gecko. Les exceptions sont petites, dans
`patches/`, et chacune est à reporter à chaque montée d'ESR :

| Correctif | Pourquoi |
|---|---|
| `0001-remote-settings-dumps-core` | Le build doit connaître l'emplacement des données Remote Settings du projet `core`, et les installer dans `app/defaults/settings`, où Remote Settings les cherche |
| `0002-sans-llama-core` | Ne pas compiler llama.cpp (`mozinference`), construit d'office sur desktop : aucune IA dans Core |
| `0003-llvm-dlltool-core` | Le build Windows de `core` a besoin de `llvm-dlltool`, comme celui de Firefox |
| `0004-hevc-ffvpx-core` | Activer le décodeur H.265/HEVC de FFmpeg dans le ffvpx embarqué |

## Multimédia

- **H.265/HEVC** : Gecko ne décode HEVC qu'avec les décodeurs du système
  (FFmpeg de la distribution sous Linux, extension payante du Store sous
  Windows, VideoToolbox sous macOS). Core ajoute le décodeur HEVC de FFmpeg
  (LGPL) au ffvpx embarqué, pour que HEVC fonctionne partout, avec VA-API
  sous Linux. Le matériel reste prioritaire quand il est disponible. Voir
  `vendor/README.md`.
- **DRM** : EME/Widevine est compilé (`--enable-eme=widevine`). Le module
  Widevine lui-même dépend d'un accord avec Google, que Core n'a pas encore.
- **WebRTC** : gardé, son réseau tourne dans le processus socket.

## Processus

Core garde le modèle de sécurité de Firefox : processus principal, processus
de contenu par site (Fission), processus GPU, socket, médias (RDD) et
extensions, sandbox active partout, jemalloc et RLBox. La mémoire se gagne sur
ce qui n'est pas chargé, pas en regroupant les processus.
