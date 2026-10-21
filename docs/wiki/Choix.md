# Choix du projet

Décisions prises le 18 octobre 2026 et liste de fonctionnalités validée le
même jour.

## Principes

1. **Une coquille, pas un fork.** Core n'embarque rien de `browser/` (voir
   [Architecture](Architecture.md)).
2. **Aucune fonctionnalité qui dépend d'un tiers.** Pas de Safe Browsing
   (Google), pas de services Mozilla (Sync, compte, Pocket, Firefox Suggest,
   Web Push, télémétrie, études, rapports de plantage). Remote Settings est
   coupé par défaut : les listes (sécurité, anti-pistage, bannières cookies)
   sont embarquées dans chaque release, et l'utilisateur peut activer leur
   mise à jour à distance. Seules exceptions, voulues par l'utilisateur : la
   vérification des releases GitHub (désactivable) et l'installation
   d'extensions depuis addons.mozilla.org.
3. **Aucune IA.** Ni ONNX Runtime ni llama.cpp dans le binaire (−12,7 Mo),
   `browser.ml.enable` à faux par sécurité.
4. **Aucun moteur de recherche par défaut.** L'utilisateur peut désactiver
   la recherche ou ajouter son propre moteur ; la liste proposée met SearXNG
   et degoog avant DuckDuckGo.
5. **Ce qu'une extension fait bien n'est pas dans Core** : mots de passe,
   captures d'écran, traduction, correcteur orthographique… Core installe
   les extensions Firefox d'addons.mozilla.org.
6. **Rien ne se charge sans demande** : pas de préchargement de liens ni de
   DNS, pas de connexions spéculatives.
7. **Mises à jour** : Core consultera les releases GitHub et préviendra de
   la sortie d'une version, désactivable, sans rien installer tout seul.
8. **Langues** : anglais et français.

## Gardé malgré le poids

- **DRM (EME/Widevine)** pour les sites vidéo. Le module Widevine demande un
  accord avec Google, pas encore obtenu.
- **WebRTC** pour la visio.
- **Accessibilité** (lecteurs d'écran).
- **H.265/HEVC** en logiciel via le décodeur de FFmpeg (LGPL), comme VLC,
  pour que les vidéos HEVC marchent sans extension payante ni dépôt tiers.
- **Sandbox, Fission et processus séparés** (voir [Sécurité](Securite.md)).

## Fonctionnalités

| Domaine | Gardé | Pas dans Core |
|---|---|---|
| Navigation | Menu contextuel entièrement personnalisable, recherche dans la page, zoom par site, impression, PDF.js, plein écran, `view-source:`, plusieurs fenêtres, enregistrer sous, glisser-déposer | — |
| Barre d'adresse | Moteurs configurables, autocomplétion depuis l'historique et les favoris, mots-clés, raccourcis @moteur | Suggestions du moteur, Firefox Suggest |
| Onglets | Restauration de session, rouvrir l'onglet fermé, onglets épinglés, son coupé, groupes, onglets verticaux | Aperçu au survol, Firefox View |
| Vie privée | Navigation privée, protection contre le pistage, HTTPS uniquement (actif), DNS over HTTPS (inactif), conteneurs, bannières cookies, résistance au fingerprinting (inactive), effacement des données | Safe Browsing |
| Formulaires | Passkeys et clés de sécurité, import depuis d'autres navigateurs | Mots de passe, remplissage d'adresses et de cartes (extensions) |
| Médias | Picture-in-Picture, touches multimédia, mode lecture | Traduction, lecture à voix haute, Web Push, captures, correcteur |
| Réglages | Page de préférences, `about:config`, thème clair/sombre du système, raccourcis personnalisables | — |
| Système | Mises à jour via GitHub, proxy, certificats clients | Navigateur par défaut, Kerberos/NTLM |

Feuille de route (plus tard) : thèmes d'extensions, personnalisation de la
barre d'outils, profils multiples, politiques d'entreprise, outils de
développement.

## État (21 octobre 2026)

Fait : onglets (dans la barre de titre) et leur déchargement, pages d'erreur
réseau et de certificat, extensions d'AMO (onglets, fenêtres, boutons,
favoris, historique), sandbox réglable, HEVC, build PGO + LTO Linux et
Windows, releases automatiques.

À faire en priorité : menu contextuel, traduction française des pages
d'erreur, tests réels sous Windows et macOS, mesure du temps de démarrage.

## Design

Minimal et plat : chrome de 72 px, police du système, icônes SVG
monochromes, une seule couleur d'accent (bleu, violet en navigation
privée), ni flou, ni ombre, ni dégradé, ni police web ; animations de
120 ms au plus, sur l'opacité, la couleur ou la position seulement. Pas de
barre de favoris par défaut, nouvel onglet vide.
