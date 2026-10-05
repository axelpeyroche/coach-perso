"""
Client en ligne de commande du carnet, utilisé par Claude Code pour analyser
les séances et envoyer le plan d'entraînement.

Configuration (variables d'environnement ou fichier `.env` à la racine du dépôt) :
    CARNET_TOKEN=...   token Claude (Sources → « Plan avec Claude Code »)
    CARNET_API=...     facultatif, défaut https://coach-perso.onrender.com/api

Exemples :
    python outils/carnet.py export                  # carnet complet en Markdown
    python outils/carnet.py export --format json -o carnet.json
    python outils/carnet.py plan                    # semaine passée + 4 semaines
    python outils/carnet.py plan --depuis 2026-10-05 --jusqu-a 2026-10-11
    python outils/carnet.py envoyer plan.json       # crée / met à jour (id_externe)
    python outils/carnet.py envoyer plan.json --remplacer 2026-10-05 2026-10-11
    python outils/carnet.py supprimer 2026-10-07-seuil

Format de plan.json : une liste de séances, ou {"seances": [...], "remplacer": {"depuis", "jusqu_a"}}.
Séance : jour (AAAA-MM-JJ), sport, titre, et au choix description, duree_min,
distance_km, dplus_m, rpe_cible (1-10), ordre, id_externe, objectif_id.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API_DEFAUT = "https://coach-perso.onrender.com/api"
RACINE = Path(__file__).resolve().parent.parent


def _config() -> tuple[str, str]:
    env = {}
    fichier = RACINE / ".env"
    if fichier.exists():
        for ligne in fichier.read_text(encoding="utf-8").splitlines():
            if "=" in ligne and not ligne.lstrip().startswith("#"):
                k, v = ligne.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    token = os.environ.get("CARNET_TOKEN") or env.get("CARNET_TOKEN")
    api = (os.environ.get("CARNET_API") or env.get("CARNET_API") or API_DEFAUT).rstrip("/")
    if not token:
        sys.exit("CARNET_TOKEN absent : ajoute-le dans .env (Sources → « Plan avec Claude Code »).")
    return api, token


def _appel(methode: str, chemin: str, params: dict | None = None, corps=None):
    api, token = _config()
    url = f"{api}{chemin}"
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    data = json.dumps(corps).encode("utf-8") if corps is not None else None
    req = urllib.request.Request(url, data=data, method=methode, headers={
        "X-Carnet-Token": token, "Content-Type": "application/json", "User-Agent": "carnet-cli",
    })
    try:
        # Render (offre gratuite) peut mettre ~1 min à sortir de veille
        with urllib.request.urlopen(req, timeout=120) as r:
            brut = r.read().decode("utf-8")
            return json.loads(brut) if "json" in r.headers.get("Content-Type", "") else brut
    except urllib.error.HTTPError as e:
        sys.exit(f"Erreur {e.code} : {e.read().decode('utf-8', 'replace')}")


def cmd_export(a):
    res = _appel("GET", "/claude/export", {"format": a.format})
    texte = json.dumps(res, ensure_ascii=False, indent=2) if not isinstance(res, str) else res
    if a.sortie:
        Path(a.sortie).write_text(texte, encoding="utf-8")
        print(f"Export écrit dans {a.sortie}")
    else:
        print(texte)


STATUTS = {"realisee": "✓ faite", "sautee": "✗ sautée", "a_venir": "à venir",
           "aujourdhui": "aujourd'hui", "manquee": "non faite"}


def cmd_plan(a):
    res = _appel("GET", "/claude/plan", {"depuis": a.depuis, "jusqu_a": a.jusqu_a})
    if a.json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return
    print(f"Plan du {res['depuis']} au {res['jusqu_a']} — {len(res['seances'])} séance(s)")
    for s in res["seances"]:
        prevu = " · ".join(x for x in [
            f"{s['duree_min']} min" if s["duree_min"] else "",
            f"{s['distance_km']:g} km" if s["distance_km"] else "",
            f"RPE {s['rpe_cible']:g}" if s["rpe_cible"] else "",
        ] if x)
        ligne = f"{s['jour']}  {s['sport_label']:<14} {s['titre']:<38} {prevu:<26} {STATUTS.get(s['statut'], s['statut'])}"
        act = s.get("activite")
        if act:
            ligne += f"  → {act['duree_str'] or ''} {str(act['distance_km']) + ' km' if act['distance_km'] else ''}" \
                     f"{' ' + act['allure_str'] if act['allure_str'] else ''}" \
                     f"{' FC ' + str(act['fc_moyenne_bpm']) if act['fc_moyenne_bpm'] else ''}" \
                     f"{' RPE ' + format(act['rpe'], 'g') if act['rpe'] is not None else ''}"
        if s.get("commentaire"):
            ligne += f"  « {s['commentaire']} »"
        print(ligne + f"   [{s['id_externe']}]")


def cmd_envoyer(a):
    contenu = json.loads(Path(a.fichier).read_text(encoding="utf-8"))
    corps = {"seances": contenu} if isinstance(contenu, list) else contenu
    if a.remplacer:
        corps["remplacer"] = {"depuis": a.remplacer[0], "jusqu_a": a.remplacer[1]}
    res = _appel("POST", "/claude/plan", corps=corps)
    print(f"{res['cree']} créée(s), {res['maj']} mise(s) à jour, {res['supprime']} supprimée(s)")


def cmd_supprimer(a):
    _appel("DELETE", f"/claude/plan/{urllib.parse.quote(a.id_externe, safe='')}")
    print(f"Séance {a.id_externe} supprimée")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description="Client du carnet (analyse et plan)")
    sp = p.add_subparsers(dest="cmd", required=True)

    e = sp.add_parser("export", help="Export complet du carnet")
    e.add_argument("--format", choices=["md", "json", "csv"], default="md")
    e.add_argument("-o", "--sortie")
    e.set_defaults(f=cmd_export)

    pl = sp.add_parser("plan", help="Affiche le plan et ce qui a été réalisé")
    pl.add_argument("--depuis")
    pl.add_argument("--jusqu-a", dest="jusqu_a")
    pl.add_argument("--json", action="store_true")
    pl.set_defaults(f=cmd_plan)

    en = sp.add_parser("envoyer", help="Envoie un fichier de séances prévues")
    en.add_argument("fichier")
    en.add_argument("--remplacer", nargs=2, metavar=("DEPUIS", "JUSQU_A"),
                    help="Supprime les séances à venir de la période absentes du fichier")
    en.set_defaults(f=cmd_envoyer)

    su = sp.add_parser("supprimer", help="Supprime une séance prévue")
    su.add_argument("id_externe")
    su.set_defaults(f=cmd_supprimer)

    a = p.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
