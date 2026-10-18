#!/usr/bin/env python3
"""Cherche les vulnérabilités connues dans les dépendances de Gecko.

Deux sources :
  - le rapport JSON d'osv-scanner sur les fichiers de verrouillage de Gecko
    (crates Rust de Cargo.lock, paquets Python du build) ;
  - les bibliothèques C/C++ copiées dans Gecko, décrites par les fichiers
    moz.yaml : leur commit d'origine est interrogé sur https://osv.dev.

Chaque vulnérabilité déjà examinée est listée dans vulns-connues.txt. Le script
échoue s'il trouve une vulnérabilité absente de cette liste, ou un paquet
signalé comme malveillant (identifiants MAL-*), même listé.

  securite/vulnerabilites.py --gecko ../gecko --osv osv.json
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tomllib
import urllib.request
from pathlib import Path

import yaml

OSV_API = "https://api.osv.dev/v1"
ICI = Path(__file__).resolve().parent

# Bibliothèques qui ne sont pas compilées dans le navigateur : tests, bancs
# d'essai, outils de développement et Android.
HORS_NAVIGATEUR = re.compile(
    r"(^|/)(tests?|testing|PerformanceTests)/|^(mobile|tools|remote|devtools)/"
    r"|^third_party/python/"
)


def osv(chemin, donnees=None):
    requete = urllib.request.Request(
        f"{OSV_API}/{chemin}",
        data=json.dumps(donnees).encode() if donnees is not None else None,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(requete, timeout=60) as reponse:
        return json.load(reponse)


def depuis_osv_scanner(rapport):
    """Vulnérabilités du rapport d'osv-scanner, groupées par alias."""
    for resultat in json.loads(Path(rapport).read_text()).get("results", []):
        source = resultat["source"]["path"]
        for paquet in resultat.get("packages", []):
            p = paquet["package"]
            details = {v["id"]: v for v in paquet.get("vulnerabilities", [])}
            for groupe in paquet.get("groups", []):
                ids = sorted(set(groupe["ids"]) | set(groupe.get("aliases", [])))
                textes = [details[i] for i in groupe["ids"] if i in details]
                resume = next((t["summary"] for t in textes if t.get("summary")),
                              textes[0].get("details", "")[:120] if textes else "")
                yield {
                    "paquet": p["name"],
                    "version": p["version"],
                    "ecosysteme": p["ecosystem"],
                    "source": Path(source).name,
                    "ids": ids,
                    "gravite": groupe.get("max_severity") or "",
                    "resume": resume,
                }


def crates_du_navigateur(gecko):
    """Crates compilées dans libxul : dépendances de gkrust dans Cargo.lock.

    Approximation par excès : Cargo.lock ignore les features et les cibles.
    mozilla-central-workspace-hack, qui ne fait qu'unifier les features de
    tout l'arbre, est ignoré.
    """
    paquets = tomllib.loads((Path(gecko) / "Cargo.lock").read_text())["package"]
    deps = {}
    for p in paquets:
        deps.setdefault(p["name"], set()).update(
            d.split()[0] for d in p.get("dependencies", [])
        )
    vues, a_voir = set(), ["gkrust"]
    while a_voir:
        nom = a_voir.pop()
        if nom not in vues and nom != "mozilla-central-workspace-hack":
            vues.add(nom)
            a_voir += deps.get(nom, ())
    return vues


def commit_du_tag(url, tag):
    sortie = subprocess.run(
        ["git", "ls-remote", url, f"refs/tags/{tag}", f"refs/tags/{tag}^{{}}"],
        capture_output=True, text=True, timeout=120,
    ).stdout.split()
    # La ligne ^{} (tag annoté) vient en dernier et donne le commit.
    return sortie[-2] if sortie else None


def bibliotheques(gecko):
    """Bibliothèques C/C++ copiées dans Gecko, avec leur commit d'origine."""
    fichiers = subprocess.run(
        ["git", "-C", gecko, "ls-files", "*moz.yaml"],
        capture_output=True, text=True, check=True,
    ).stdout.split()
    for fichier in fichiers:
        if HORS_NAVIGATEUR.search(fichier):
            continue
        meta = yaml.safe_load((Path(gecko) / fichier).read_text()) or {}
        origine = meta.get("origin") or {}
        depot = (meta.get("vendoring") or {}).get("url")
        revision = str(origine.get("revision") or "").strip()
        if not depot or not revision:
            continue
        commit = re.search(r"\b[0-9a-f]{40}\b", revision)
        commit = commit.group(0) if commit else commit_du_tag(depot, revision)
        yield {
            "paquet": str(Path(fichier).parent),
            "version": revision,
            "ecosysteme": "C/C++",
            "source": fichier,
            "depot": depot,
            "commit": commit,
            "navigateur": True,
        }


def depuis_bibliotheques(gecko):
    """(vulnérabilités, bibliothèques dont le commit est introuvable)"""
    libs = list(bibliotheques(gecko))
    a_verifier = [lib for lib in libs if lib["commit"]]
    reponses = osv(
        "querybatch", {"queries": [{"commit": lib["commit"]} for lib in a_verifier]}
    )["results"]
    trouvees, details = [], {}
    for lib, reponse in zip(a_verifier, reponses):
        for vuln in reponse.get("vulns", []):
            if vuln["id"] not in details:
                details[vuln["id"]] = osv(f"vulns/{vuln['id']}")
            v = details[vuln["id"]]
            trouvees.append({
                **lib,
                "ids": sorted({v["id"], *v.get("aliases", [])}),
                "gravite": "",
                "resume": v.get("summary") or v.get("details", "")[:120],
            })
    return trouvees, [lib for lib in libs if not lib["commit"]]


def connues(fichier):
    """{(paquet, identifiant)} des vulnérabilités déjà examinées."""
    vues = set()
    for ligne in Path(fichier).read_text().splitlines():
        ligne = ligne.split("#", 1)[0].split()
        if len(ligne) >= 2:
            vues.add((ligne[0], ligne[1]))
    return vues


def lien(identifiant):
    return f"[{identifiant}](https://osv.dev/{identifiant})"


def main():
    args = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    args.add_argument("--gecko", required=True, help="checkout de Gecko")
    args.add_argument("--osv", action="append", default=[],
                      help="rapport JSON d'osv-scanner")
    args.add_argument("--connues", default=ICI / "vulns-connues.txt")
    args = args.parse_args()

    trouvees = [v for rapport in args.osv for v in depuis_osv_scanner(rapport)]
    libs, non_verifiees = depuis_bibliotheques(args.gecko)
    trouvees += libs
    base = connues(args.connues)
    navigateur = crates_du_navigateur(args.gecko)
    for v in trouvees:
        if "navigateur" not in v:
            v["navigateur"] = v["ecosysteme"] == "crates.io" and v["paquet"] in navigateur

    nouvelles, malveillantes, anciennes = [], [], []
    for v in trouvees:
        if any(i.startswith("MAL-") for i in v["ids"]):
            malveillantes.append(v)
        elif any((v["paquet"], i) in base for i in v["ids"]):
            anciennes.append(v)
        else:
            nouvelles.append(v)

    lignes = ["## Vulnérabilités des dépendances de Gecko", "",
              "« Navigateur : non » signale un outil de build ou de test, "
              "absent du binaire livré."]
    if not nouvelles and not malveillantes:
        lignes.append(
            f"Rien de nouveau. {len(anciennes)} vulnérabilités déjà examinées "
            "(securite/vulns-connues.txt)."
        )
    for titre, liste in (
        (":rotating_light: Paquets malveillants", malveillantes),
        (":x: Nouvelles vulnérabilités", nouvelles),
        ("Déjà examinées", anciennes),
    ):
        if not liste:
            continue
        lignes += ["", f"### {titre} ({len(liste)})", "",
                   "| Vulnérabilité | Paquet | Version | Gravité | Navigateur | Fichier | Résumé |",
                   "|---|---|---|---|---|---|---|"]
        for v in sorted(liste, key=lambda v: (not v["navigateur"], v["ecosysteme"], v["paquet"])):
            resume = v["resume"].replace("|", "\\|").replace("\n", " ")
            lignes.append(
                f"| {' '.join(lien(i) for i in v['ids'])} | {v['paquet']} "
                f"({v['ecosysteme']}) | {v['version']} | {v['gravite']} "
                f"| {'oui' if v['navigateur'] else 'non'} | {v['source']} | {resume} |"
            )
    if non_verifiees:
        lignes += ["", "Non vérifiées (commit d'origine introuvable) : " + ", ".join(
            f"{lib['paquet']} {lib['version']}" for lib in non_verifiees)]
    if nouvelles:
        lignes += ["", "Après examen, mettre à jour Gecko ou ajouter ces lignes "
                   "à securite/vulns-connues.txt :", "", "```"]
        lignes += sorted({f"{v['paquet']} {v['ids'][0]}" for v in nouvelles})
        lignes += ["```"]

    texte = "\n".join(lignes) + "\n"
    print(texte)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as resume:
            resume.write(texte)
    return 1 if nouvelles or malveillantes else 0


if __name__ == "__main__":
    sys.exit(main())
