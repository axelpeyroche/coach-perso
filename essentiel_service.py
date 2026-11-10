"""
« L'essentiel » : les analyses résumées en quelques constats rédigés, calculés par
règles (aucune IA). Chaque constat pointe vers l'onglet et l'encart qui le détaillent.

ton : "alerte" (à traiter), "attention" (à surveiller), "bon" (progrès), "info" (repère).
"""
from __future__ import annotations

from datetime import date
from typing import Optional

ORDRE_TON = {"alerte": 0, "attention": 1, "bon": 2, "info": 3}


def _mmss(sec) -> str:
    sec = int(round(sec))
    return f"{sec // 60}:{sec % 60:02d}"


def _h(heures: float) -> str:
    m = round(heures * 60)
    return f"{m // 60} h {m % 60:02d}" if m % 60 else f"{m // 60} h"


def _fr(x: float, n: int = 1) -> str:
    return f"{x:.{n}f}".replace(".", ",")


def essentiel(a: dict, limite: Optional[int] = None) -> list[dict]:
    """Constats classés du plus urgent au plus anecdotique."""
    out: list[dict] = []

    def ajoute(cle, ton, titre, texte, onglet, ancre=None):
        out.append({"id": cle, "ton": ton, "titre": titre, "texte": texte, "onglet": onglet, "ancre": ancre})

    auj = date.fromisoformat(a["forme"]["actuel"]["jour"]) if (a.get("forme") or {}).get("actuel") else date.today()

    # ── Forme et charge ─────────────────────────────────────────────────────
    f = (a.get("forme") or {}).get("actuel")
    if f:
        code = f["etat"]["code"]
        if code == "surcharge":
            ajoute("forme", "alerte", "Charge trop forte",
                   f"Ta fatigue dépasse nettement ta forme de fond (fraîcheur {round(f['tsb'])}) : allège quelques jours.", "forme", "charge")
        elif code == "frais_plus":
            ajoute("forme", "attention", "Forme de fond en baisse",
                   f"Tu es très frais (fraîcheur +{round(f['tsb'])}) mais ta forme de fond recule de {abs(round(f['rampe_pct'] or 0))} % sur 7 jours. "
                   "Normal en repos ou en affûtage, à relancer ensuite.", "forme", "charge")
        elif code == "frais":
            ajoute("forme", "bon", "Frais et prêt", f"Fraîcheur à +{round(f['tsb'])} : bon moment pour une séance clé ou une course.", "forme", "charge")
        elif code == "productif":
            ajoute("forme", "bon", "Charge productive", "Tu accumules de la fatigue utile : la forme de fond progresse.", "forme", "charge")
        if (f.get("rampe_pct") or 0) > 10:
            ajoute("rampe", "attention", "Charge qui monte vite",
                   f"+{round(f['rampe_pct'])} % de forme de fond en 7 jours : au-delà de 10 %, le risque de blessure augmente.", "forme", "charge")

    m = (a.get("monotonie") or {}).get("actuel")
    if m and m.get("niveau") == "uniforme":
        ajoute("monotonie", "attention", "Semaine trop uniforme",
               f"Monotonie à {_fr(m['monotonie'])} : tes jours se ressemblent trop. Alterne vraiment jours faciles et jours durs.", "forme", "monotonie")

    z = (a.get("zones") or {}).get("bilan_4s")
    if z and z.get("couvert_min", 0) >= 120:
        dur = z["modere_pct"] + z["haut_pct"]
        if dur > 30:
            ajoute("intensite", "attention", "Beaucoup d'intensité",
                   f"{dur} % de ton temps au-dessus de l'endurance sur 4 semaines (repère : 20 %). Ralentis les sorties faciles.", "forme", "intensite")
        elif z["bas_pct"] >= 75:
            ajoute("intensite", "bon", "Répartition bien polarisée",
                   f"{z['bas_pct']} % de ton temps en endurance sur 4 semaines : la base est saine.", "forme", "intensite")

    # ── Corps ───────────────────────────────────────────────────────────────
    r = (a.get("recuperation") or {}).get("actuel")
    if r:
        if r["statut"] == "rouge":
            ajoute("recup", "alerte", "Récupération dégradée",
                   f"VFC {round(r['vfc']) if r['vfc'] else '—'} ms (habituelle {round(r['vfc_ref']) if r.get('vfc_ref') else '—'}) et "
                   f"FC de repos {round(r['fc_repos']) if r['fc_repos'] else '—'} bpm (habituelle {round(r['fc_ref']) if r.get('fc_ref') else '—'}) : "
                   "fatigue, stress ou maladie.", "corps", "recuperation")
        elif r["statut"] == "orange":
            ajoute("recup", "attention", "Récupération incomplète", "VFC ou FC de repos un peu hors de ta plage : garde l'intensité sous contrôle.", "corps", "recuperation")
        else:
            ajoute("recup", "bon", "Bien récupéré", "VFC et FC de repos dans ta plage habituelle.", "corps", "recuperation")

    n = (a.get("signaux_nuit") or {}).get("actuel")
    if n and n.get("alerte"):
        ajoute("nuit", "alerte", "Nuit inhabituelle", n.get("message") or "Respiration ou SpO2 hors de ta normale.", "corps", "signaux")

    p = a.get("pas") or {}
    if p.get("moy_7j") and p.get("moy_28j") and p["moy_28j"] > 0:
        ecart = round((p["moy_7j"] - p["moy_28j"]) / p["moy_28j"] * 100)
        if ecart <= -25:
            ajoute("pas", "info", "Moins de pas que d'habitude",
                   f"{round(p['moy_7j']):,} pas par jour cette semaine, {abs(ecart)} % sous ta moyenne sur 28 jours.".replace(",", " "), "corps", "pas")

    # ── Sommeil ─────────────────────────────────────────────────────────────
    s = a.get("sommeil") or {}
    if s.get("nuits_14j", 0) >= 7:
        if (s.get("dette_14j") or 0) >= 5:
            ajoute("dette", "alerte" if s["dette_14j"] >= 10 else "attention", "Dette de sommeil",
                   f"Il te manque {_h(s['dette_14j'])} de sommeil sur 14 nuits par rapport à ton besoin de {_h(s['besoin_h'])}.", "sommeil", "dette")
        elif (s.get("dette_14j") or 0) < 1:
            ajoute("dette", "bon", "Sommeil suffisant", f"Aucune dette sur 14 nuits (besoin : {_h(s['besoin_h'])}).", "sommeil", "dette")
    if (s.get("regularite_min") or 0) >= 60:
        ajoute("regularite", "attention", "Horaires de sommeil irréguliers",
               f"Tes heures de coucher varient de ± {s['regularite_min']} min : la régularité compte autant que la durée.", "sommeil", "regularite")

    # ── Capacités ───────────────────────────────────────────────────────────
    e = a.get("efforts_duree") or {}
    vc, vc_an = e.get("vc"), e.get("vc_an_dernier")
    if vc and vc_an:
        gain = vc_an["allure_sec_km"] - vc["allure_sec_km"]
        if gain >= 3:
            ajoute("vc", "bon", "Allure critique en progrès",
                   f"{_mmss(vc['allure_sec_km'])} /km contre {_mmss(vc_an['allure_sec_km'])} il y a un an : {gain} s/km de mieux.", "capacites", "efforts")
        elif gain <= -3:
            ajoute("vc", "attention", "Allure critique en recul",
                   f"{_mmss(vc['allure_sec_km'])} /km contre {_mmss(vc_an['allure_sec_km'])} il y a un an.", "capacites", "efforts")

    ef = a.get("efficacite") or {}
    if ef.get("tendance_pct") is not None:
        t = ef["tendance_pct"]
        if t >= 3:
            ajoute("ef", "bon", "Efficacité aérobie en hausse", f"+{_fr(t)} % : tu cours plus vite pour la même fréquence cardiaque.", "capacites", "efficacite")
        elif t <= -3:
            ajoute("ef", "attention", "Efficacité aérobie en baisse", f"{_fr(t)} % : même allure, cœur plus haut. Fatigue, chaleur ou manque de volume.", "capacites", "efficacite")

    v = a.get("vma") or {}
    if v.get("actuelle"):
        test = v.get("dernier_test")
        age = (auj - date.fromisoformat(test["date"])).days if test else None
        if age is None or age > 120:
            ajoute("vma_test", "info", "VMA à confirmer",
                   f"VMA estimée à {_fr(v['actuelle']['vma'])} km/h, " +
                   (f"dernier test il y a {age // 30} mois." if age else "sans test de référence.") +
                   " Un test la rendrait plus fiable.", "capacites", "vma")

    ch = (a.get("zones_evolution") or {}).get("changements") or []
    if ch and (auj - date.fromisoformat(ch[-1]["semaine"])).days <= 21:
        c = ch[-1]
        ajoute("zones", "info", "Zones mises à jour",
               f"FC au seuil passée de {c['avant']} à {c['apres']} bpm : tes zones ont été recalculées.", "capacites", "zones")

    d = a.get("denivele") or {}
    b, av = d.get("bilan_4s"), d.get("bilan_4s_avant")
    if b and av and av.get("dplus", 0) >= 500 and b["dplus"] > av["dplus"] * 1.5:
        ajoute("dplus", "attention", "Dénivelé en forte hausse",
               f"{b['dplus']:,} m de D+ sur 4 semaines contre {av['dplus']:,} m les 4 précédentes : attention aux mollets et tendons.".replace(",", " "),
               "technique", "denivele")

    # ── Bilan ───────────────────────────────────────────────────────────────
    pl = (a.get("plan") or {}).get("bilan_4s")
    if pl and pl.get("prevues", 0) >= 6 and pl.get("taux") is not None:
        if pl["taux"] < 70:
            ajoute("plan", "attention", "Plan suivi en partie",
                   f"{pl['realisees']} séances faites sur {pl['prevues']} prévues en 4 semaines ({pl['taux']} %).", "bilan", "plan")
        elif pl["taux"] >= 85:
            ajoute("plan", "bon", "Plan bien suivi", f"{pl['taux']} % des séances prévues réalisées sur 4 semaines.", "bilan", "plan")

    out.sort(key=lambda c: ORDRE_TON[c["ton"]])
    return out[:limite] if limite else out
