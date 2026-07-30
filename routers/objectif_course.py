"""Routes du domaine objectif de course : extraction depuis URL, allures cibles."""

from __future__ import annotations

import ipaddress as _ipaddress
import re
import socket as _socket
import urllib.parse as _urlparse
import urllib.request as _urlrequest
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import obtenir_session
from models import ObjectifCourse, Utilisateur
from deps import get_current_user

router = APIRouter()


def _extraire_infos_course(url: str) -> dict:
    """
    Récupère une page web de course et tente d'en extraire distance (km),
    dénivelé positif (m) et un nom, par heuristiques (regex sur le texte).
    Best effort : les pages 100 % JavaScript ou atypiques peuvent ne rien donner.
    """
    parsed = _urlparse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(400, "URL invalide — doit commencer par http:// ou https://")
    host = (parsed.hostname or "").lower()
    if not host or host.endswith(".local"):
        raise HTTPException(400, "URL non autorisée")
    # Résout le nom d'hôte et rejette toute IP privée/loopback/link-local (dont le
    # endpoint de métadonnées cloud 169.254.169.254) pour se protéger du SSRF —
    # vérifie l'IP réelle plutôt que le simple texte de l'hôte.
    try:
        adresses = _socket.getaddrinfo(host, None)
    except _socket.gaierror as exc:
        raise HTTPException(400, f"Nom d'hôte introuvable : {exc}")
    for info in adresses:
        try:
            ip = _ipaddress.ip_address(info[4][0].split("%")[0])
        except ValueError:
            raise HTTPException(400, "URL non autorisée")
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise HTTPException(400, "URL non autorisée")

    req = _urlrequest.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    })
    try:
        with _urlrequest.urlopen(req, timeout=15) as resp:
            raw = resp.read(3_000_000)  # 3 Mo max
    except Exception as exc:
        raise HTTPException(502, f"Impossible d'accéder à la page : {exc}")

    # Décodage + nettoyage HTML → texte
    html = raw.decode("utf-8", errors="ignore")
    texte = re.sub(r"<script.*?</script>", " ", html, flags=re.S | re.I)
    texte = re.sub(r"<style.*?</style>", " ", texte, flags=re.S | re.I)
    texte = re.sub(r"<[^>]+>", " ", texte)
    texte = re.sub(r"&nbsp;|&#160;", " ", texte)
    texte = re.sub(r"\s+", " ", texte)
    low = texte.lower()

    # ── Nom de la course ─────────────────────────────────────────────────────
    def _meta(key):
        for pat in (
            rf'<meta[^>]+(?:property|name)=["\']{key}["\'][^>]*content=["\']([^"\']+)["\']',
            rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\']{key}["\']',
        ):
            m = re.search(pat, html, re.I)
            if m:
                val = re.sub(r"\s+", " ", m.group(1)).strip()
                for a, b in (("&amp;", "&"), ("&#39;", "'"), ("&rsquo;", "’"), ("&eacute;", "é")):
                    val = val.replace(a, b)
                if val:
                    return val[:120]
        return None

    # 1) Nom de marque dérivé du domaine, retrouvé dans la page avec sa vraie casse.
    #    Ex : domaine "runinlyon" → on cherche "Run in Lyon" dans le texte.
    titre_page = None
    parts = (parsed.hostname or "").split(".")
    sld = re.sub(r"[^a-z0-9]", "", parts[-2].lower()) if len(parts) >= 2 else ""
    if 4 <= len(sld) <= 30:
        pat = r"\b" + r"[ \-]?".join(re.escape(c) for c in sld) + r"\b"
        trouves = re.findall(pat, texte, re.I)  # insensible à la casse, garde la casse trouvée
        # On ne garde que les vrais noms d'affichage : avec espace ET une majuscule
        # (écarte le slug "run-in-lyon" tout en minuscules).
        noms = [t.strip() for t in trouves if " " in t and any(c.isupper() for c in t)]
        if noms:
            from collections import Counter as _CN
            titre_page = _CN(noms).most_common(1)[0][0][:120]

    # 2) Métadonnées de l'événement
    if not titre_page:
        titre_page = _meta("og:site_name") or _meta("application-name")

    # 3) Titre de page / og:title (dernier segment si séparateur)
    if not titre_page:
        og_title = _meta("og:title")
        m_title = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.S | re.I)
        titre_html = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m_title.group(1))).strip() if m_title else None
        brut = og_title or titre_html
        if brut:
            segments = [s.strip() for s in re.split(r"\s+[|·–—-]\s+", brut) if s.strip()]
            titre_page = (segments[-1] if len(segments) > 1 else brut)[:120]

    # ── Distances (toutes les valeurs distinctes plausibles) ─────────────────
    # Une course multi-distances liste souvent à la fois des "XX km" explicites
    # ET des libellés type "Marathon" / "Semi-Marathon" (dont les km sont parfois
    # en image). On combine donc les deux sources.
    from collections import Counter as _C
    candidats = []
    # 1) Distances explicites "XX km" et "XX k" (raccourci course, ex. 10K / 5K)
    for m in re.finditer(r"(\d{1,3}(?:[.,]\d{1,3})?)\s*km\b", low):
        try:
            v = float(m.group(1).replace(",", "."))
            if 1.0 <= v <= 350.0:
                candidats.append(round(v, 1))
        except ValueError:
            pass
    for m in re.finditer(r"(\d{1,3})\s*k\b", low):  # "10k", "5 k" (k sans m)
        try:
            v = float(m.group(1))
            if 1.0 <= v <= 350.0:
                candidats.append(round(v, 1))
        except ValueError:
            pass
    # 2) Libellés standard (ajoutés en plus, pas seulement en secours)
    if "semi-marathon" in low or "semi marathon" in low:
        candidats.append(21.1)
    # marathon « plein » : présent en dehors du mot « semi-marathon »
    low_sans_semi = low.replace("semi-marathon", " ").replace("semi marathon", " ")
    if re.search(r"\bmarathon\b", low_sans_semi):
        candidats.append(42.195)

    freq = _C(round(c, 1) for c in candidats)
    # Liste des distances distinctes, triées par ordre croissant
    distances = sorted(freq.keys())
    # Distance par défaut : la plus fréquente (puis la plus grande en cas d'égalité)
    distance = max(freq.items(), key=lambda kv: (kv[1], kv[0]))[0] if freq else None

    # ── Dénivelé positif ─────────────────────────────────────────────────────
    dplus = None
    patterns_dplus = [
        r"d\s*\+\s*[:\-]?\s*(\d[\d\s.]{0,6})\s*m",
        r"d[ée]nivel[ée]\s*(?:positif)?\s*[:\-]?\s*(\d[\d\s.]{0,6})\s*m",
        r"(\d[\d\s.]{0,6})\s*m\s*(?:de\s*)?d[ée]nivel[ée]",
        r"\+\s*(\d[\d\s.]{2,6})\s*m\b",
    ]
    for pat in patterns_dplus:
        m = re.search(pat, low)
        if m:
            try:
                v = int(re.sub(r"[\s.]", "", m.group(1)))
                if 10 <= v <= 30000:
                    dplus = v
                    break
            except ValueError:
                pass

    # ── Date de la course ─────────────────────────────────────────────────────
    date_course = _extraire_date_course(low)

    return {
        "nom": titre_page,
        "distance_km": round(distance, 3) if distance else None,
        "distances": distances,          # liste pour menu déroulant si plusieurs
        "dplus_m": dplus,
        "date_course": date_course,      # "dd/mm/yyyy" ou None
        "trouve": bool(distance or dplus or date_course),
    }


def _extraire_date_course(low: str) -> Optional[str]:
    """Cherche une date dans le texte (format numérique ou français) et privilégie
    une date future (la course à venir). Retourne 'dd/mm/yyyy' ou None."""
    MOIS = {
        "janvier": 1, "février": 2, "fevrier": 2, "mars": 3, "avril": 4, "mai": 5,
        "juin": 6, "juillet": 7, "août": 8, "aout": 8, "septembre": 9,
        "octobre": 10, "novembre": 11, "décembre": 12, "decembre": 12,
    }
    trouvees = []
    # Format textuel : "15 octobre 2026", "1er mars 2027"
    for m in re.finditer(r"\b(\d{1,2})(?:er)?\s+([a-zûéèêà]+)\s+(\d{4})\b", low):
        mois = MOIS.get(m.group(2))
        if mois:
            try:
                trouvees.append(date(int(m.group(3)), mois, int(m.group(1))))
            except ValueError:
                pass
    # Format numérique : "15/10/2026", "15-10-2026", "15.10.2026"
    for m in re.finditer(r"\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b", low):
        try:
            trouvees.append(date(int(m.group(3)), int(m.group(2)), int(m.group(1))))
        except ValueError:
            pass
    if not trouvees:
        return None
    today = date.today()
    futures = sorted(d for d in trouvees if d >= today)
    choisie = futures[0] if futures else max(trouvees)  # 1re date future, sinon la plus récente
    return choisie.strftime("%d/%m/%Y")


class ExtraireCourseSchema(BaseModel):
    url: str


@router.post("/api/objectif-course/extraire", summary="Extrait distance/dénivelé depuis l'URL officielle d'une course")
def extraire_infos_course(
    payload: ExtraireCourseSchema,
    current_user: Utilisateur = Depends(get_current_user),
):
    infos = _extraire_infos_course(payload.url.strip())
    return infos


class ObjectifCourseSchema(BaseModel):
    nom: str
    date_course: str  # dd/mm/yyyy
    distance_km: float
    dplus_m: Optional[int] = 0
    objectif_temps_min: int
    notes: Optional[str] = None


def _allures_depuis_objectif(distance_km: float, objectif_temps_min: int) -> dict:
    """Calcule les allures cibles Z2/Z4/Z5 depuis l'objectif de course."""
    allure_course = objectif_temps_min / distance_km  # min/km
    def fmt(m: float) -> str:
        mins = int(m); secs = int((m - mins) * 60)
        return f"{mins}:{secs:02d}/km"
    return {
        "course": fmt(allure_course),
        "z2":     fmt(allure_course * 1.30),
        "z4":     fmt(allure_course * 1.07),
        "z5":     fmt(allure_course * 0.92),
        "course_min_km": round(allure_course, 2),
    }


@router.get("/api/objectif-course", summary="Récupère le prochain objectif de course")
def get_objectif_course(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    obj = (
        db.query(ObjectifCourse)
        .filter(ObjectifCourse.utilisateur_id == current_user.id)
        .order_by(ObjectifCourse.cree_le.desc())
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="Aucun objectif de course enregistré")
    jours_restants = (obj.date_course - date.today()).days
    allures = _allures_depuis_objectif(obj.distance_km, obj.objectif_temps_min)
    h, m = divmod(obj.objectif_temps_min, 60)
    return {
        "id": obj.id,
        "nom": obj.nom,
        "date_course": obj.date_course.strftime("%d/%m/%Y"),
        "distance_km": obj.distance_km,
        "dplus_m": obj.dplus_m,
        "objectif_temps_min": obj.objectif_temps_min,
        "objectif_temps_str": f"{h}h{m:02d}" if h else f"{m} min",
        "jours_restants": jours_restants,
        "notes": obj.notes,
        "allures": allures,
    }


@router.post("/api/objectif-course", summary="Enregistre/remplace le prochain objectif de course")
def set_objectif_course(
    payload: ObjectifCourseSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    # Remplace l'objectif existant
    db.query(ObjectifCourse).filter(ObjectifCourse.utilisateur_id == current_user.id).delete()
    try:
        date_course = datetime.strptime(payload.date_course, "%d/%m/%Y").date()
    except ValueError:
        raise HTTPException(400, "Format de date invalide — attendu jj/mm/aaaa")
    obj = ObjectifCourse(
        utilisateur_id=current_user.id,
        nom=payload.nom,
        date_course=date_course,
        distance_km=payload.distance_km,
        dplus_m=payload.dplus_m or 0,
        objectif_temps_min=payload.objectif_temps_min,
        notes=payload.notes,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    allures = _allures_depuis_objectif(obj.distance_km, obj.objectif_temps_min)
    h, m = divmod(obj.objectif_temps_min, 60)
    return {
        "id": obj.id,
        "nom": obj.nom,
        "date_course": obj.date_course.strftime("%d/%m/%Y"),
        "distance_km": obj.distance_km,
        "dplus_m": obj.dplus_m,
        "objectif_temps_str": f"{h}h{m:02d}" if h else f"{m} min",
        "jours_restants": (obj.date_course - date.today()).days,
        "allures": allures,
    }
