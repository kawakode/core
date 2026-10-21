# Sécurité

Un navigateur léger mais vulnérable ne remplit pas l'objectif. Core garde
tout le modèle de sécurité de Gecko et ne le négocie pas contre de la
mémoire.

## Ce que Core garde

- **Sandbox des processus de contenu**, aux mêmes niveaux que Firefox
  (Linux 6, Windows 9, macOS 3). Gecko seul la laisse à 0 sous Linux :
  c'est `firefox.js` qui la règle, et Core le reprend dans
  `app/profile/core.js`. L'utilisateur peut la désactiver dans les réglages
  (Gecko impose de toute façon un minimum sous Windows et macOS). Vérifier
  le niveau effectif dans `about:support`, section Sandbox.
- **Fission** (un processus par site), processus GPU, socket, médias et
  extensions séparés.
- **RLBox** (bibliothèques tierces isolées en WebAssembly) et **jemalloc**.
- **Extensions** dans leur propre processus, signature obligatoire.
- **HTTPS** : page d'erreur de certificat de `toolkit/`, avec une réponse
  par défaut réglable (demander, accepter, refuser).

## Surveillance des dépendances

Deux workflows GitHub Actions :

- `securite-dependances.yml`, chaque jour et à chaque changement de Gecko :
  - le tag de Gecko pointe toujours sur `GECKO_COMMIT` (une source déplacée
    serait une attaque sur la chaîne d'approvisionnement) ;
  - aucune version ESR plus récente, donc porteuse de correctifs, n'est
    sortie ;
  - aucune nouvelle CVE ni aucun paquet malveillant dans les crates Rust,
    les paquets Python du build et les bibliothèques C/C++ de Gecko (base
    [OSV](https://osv.dev)).

  Les failles déjà examinées sont listées dans `securite/vulns-connues.txt` ;
  le résumé du job donne les lignes à y ajouter.
- `securite-workflows.yml` : audit des workflows par
  [zizmor](https://docs.zizmor.sh). Les actions sont figées par commit et
  Dependabot propose leurs mises à jour.

## Mises à jour de Gecko

Gecko corrige des failles critiques à chaque version. Core n'utilise pas
l'updater de Mozilla : chaque version ESR à point doit donner une nouvelle
release GitHub sans délai. À terme, Core consultera ces releases et
préviendra l'utilisateur qu'une version est sortie (désactivable, rien ne
s'installe tout seul). C'est le vrai coût permanent du projet.
