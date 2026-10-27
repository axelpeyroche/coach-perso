// Encarts complémentaires de la fiche d'une séance : découpage par km et par tour, météo,
// sorties sur le même parcours, segments et image à partager.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  creerSegment, enregistrerMeteo, getMemeParcours, getMeteo, getSegmentsActivite, getTrace,
} from "../api";
import { fmtDate, fmtDuree, nombre, sportInfo } from "../carnet";
import { Segmente } from "./ui";

const PIED = new Set(["course", "trail", "marche", "randonnee"]);

export const mmss = (s) => {
  if (s == null || !isFinite(s)) return "—";
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return sec === 60 ? `${m + 1}:00` : `${m}:${String(sec).padStart(2, "0")}`;
};
const chrono = (s) => {
  if (s == null) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
// Allure (/km) à pied, vitesse (km/h) sinon
const rythme = (pied, secKm, kmh) => (pied ? mmss(secKm) : nombre(kmh, 1));

// Distance cumulée (km) le long des points [lat, lon, …]
function cumulKm(points) {
  const RAD = Math.PI / 180, c = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const x = (b[1] - a[1]) * RAD * Math.cos(((a[0] + b[0]) / 2) * RAD), y = (b[0] - a[0]) * RAD;
    c.push(c[i - 1] + 6371 * Math.hypot(x, y));
  }
  return c;
}

// ───────────────────────── Découpage ─────────────────────────

const LIBELLES_TOURS = { work: "Effort", recovery: "Récup", warmup: "Échauffement", cooldown: "Retour au calme", rest: "Repos" };

export function Decoupage({ decoupage, sport, onPosition }) {
  const [vue, setVue] = useState("km");
  const pied = PIED.has(sport);
  const tours = decoupage?.tours ?? [];
  const lignes = vue === "tours" && tours.length ? tours : decoupage?.splits ?? [];
  const total = decoupage?.splits?.at(-1)?.fin_km;
  const gap = pied && lignes.some((l) => l.gap_sec_km);
  const fc = lignes.some((l) => l.fc);
  const dplus = lignes.some((l) => l.dplus_m != null);
  const vitesses = lignes.filter((l) => !l.partiel).map((l) => l.vitesse_kmh);
  const [vmin, vmax] = [Math.min(...vitesses), Math.max(...vitesses)];
  const record = vitesses.length > 1 ? lignes.find((l) => !l.partiel && l.vitesse_kmh === vmax) : null;
  if (!decoupage?.splits?.length) return null;

  const montrer = (l) => total && onPosition?.(((l.debut_km + l.fin_km) / 2) / total);
  const cols = ["2.6rem", "3.3rem", "1fr", gap && "3.3rem", fc && "2.4rem", dplus && "2.6rem", dplus && "2.6rem"].filter(Boolean).join(" ");

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold">Découpage</h3>
        {tours.length > 0 && (
          <Segmente className="w-[170px]" valeur={vue} onChange={setVue}
            options={[["km", decoupage.pas_km === 1 ? "Par km" : `Par ${decoupage.pas_km} km`], ["tours", "Tours"]]} />
        )}
      </div>
      <div className="text-[13px]" onMouseLeave={() => onPosition?.(null)}>
        <div className="grid gap-2 px-1 pb-1.5 text-[11px] text-label-2 uppercase tracking-[0.02em]" style={{ gridTemplateColumns: cols }}>
          <span>{vue === "tours" ? "Tour" : "Km"}</span>
          <span className="text-right">{pied ? "Allure" : "km/h"}</span>
          <span />
          {gap && <span className="text-right" title="Allure ajustée à la pente">Aj.</span>}
          {fc && <span className="text-right">FC</span>}
          {dplus && <span className="text-right">D+</span>}
          {dplus && <span className="text-right">D−</span>}
        </div>
        {lignes.map((l) => {
          const part = vmax > vmin ? (l.vitesse_kmh - vmin) / (vmax - vmin) : 1;
          const effort = vue === "tours" && l.type === "work";
          return (
            <button type="button" key={`${vue}-${l.numero}`} onMouseEnter={() => montrer(l)} onClick={() => montrer(l)}
              className={clsx("grid gap-2 items-center w-full text-left px-1 py-[5px] rounded-lg hover:bg-remplissage chiffres",
                vue === "tours" && !effort && tours.some((t) => t.type === "work") && "text-label-2")}
              style={{ gridTemplateColumns: cols }}>
              <span className="truncate">
                {vue === "tours"
                  ? (l.label || LIBELLES_TOURS[l.type] || `Tour ${l.numero}`)
                  : l.partiel ? nombre(l.distance_km, 2) : l.numero * decoupage.pas_km}
              </span>
              <span className={clsx("text-right font-semibold", l === record && "text-brand")}>
                {rythme(pied, l.allure_sec_km, l.vitesse_kmh)}
              </span>
              <span className="h-2.5 rounded-full bg-remplissage overflow-hidden">
                <span className="block h-full rounded-full" title={vue === "tours" ? `${nombre(l.distance_km, 2)} km · ${chrono(l.duree_sec)}` : undefined}
                  style={{ width: `${l.partiel ? 30 + 70 * Math.max(0, Math.min(1, part)) : 30 + 70 * part}%`,
                    background: l === record ? "rgb(var(--blue))" : effort ? "#FF9F0A" : "#64D2FF", opacity: l.partiel ? 0.5 : 1 }} />
              </span>
              {gap && <span className="text-right text-label-2">{mmss(l.gap_sec_km)}</span>}
              {fc && <span className="text-right" style={{ color: l.fc ? "#FF375F" : undefined }}>{l.fc ?? "—"}</span>}
              {dplus && <span className="text-right text-label-2">{l.dplus_m ?? "—"}</span>}
              {dplus && <span className="text-right text-label-2">{l.dmoins_m ? `−${l.dmoins_m}` : l.dmoins_m ?? "—"}</span>}
            </button>
          );
        })}
      </div>
      {gap && (
        <p className="text-[12px] text-label-2">
          « Aj. » : allure ajustée à la pente, l'équivalent sur le plat (montées comptées plus dures, descentes un peu plus faciles).
        </p>
      )}
    </section>
  );
}

// ───────────────────────── Météo ─────────────────────────

export function ciel(code) {
  if (code == null) return ["🌡️", ""];
  if (code === 0) return ["☀️", "Ciel dégagé"];
  if (code <= 2) return ["🌤️", "Peu nuageux"];
  if (code === 3) return ["☁️", "Couvert"];
  if (code <= 48) return ["🌫️", "Brouillard"];
  if (code <= 57) return ["🌦️", "Bruine"];
  if (code <= 67) return ["🌧️", "Pluie"];
  if (code <= 77) return ["🌨️", "Neige"];
  if (code <= 82) return ["🌧️", "Averses"];
  if (code <= 86) return ["🌨️", "Averses de neige"];
  return ["⛈️", "Orage"];
}

// Lecture d'Open-Meteo depuis le navigateur, quand le serveur n'a rien obtenu
// (ses adresses partagées peuvent être limitées par Open-Meteo). Même calcul que meteo_service.lire.
const HORAIRES = ["temperature_2m", "apparent_temperature", "relative_humidity_2m", "precipitation",
  "weather_code", "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m"];
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${
  String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

async function meteoNavigateur(a, point) {
  const debut = new Date(a.debut), fin = new Date(debut.getTime() + (a.duree_sec || 0) * 1000);
  const recent = (Date.now() - debut.getTime()) / 86_400_000 <= 80;
  const params = new URLSearchParams({
    latitude: point[0].toFixed(3), longitude: point[1].toFixed(3), hourly: HORAIRES.join(","),
    start_date: isoLocal(debut).slice(0, 10), end_date: isoLocal(fin).slice(0, 10),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris", wind_speed_unit: "kmh",
  });
  const r = await fetch(`https://${recent ? "api" : "archive-api"}.open-meteo.com/v1/${recent ? "forecast" : "archive"}?${params}`);
  if (!r.ok) return null;
  const h = (await r.json()).hourly || {};
  const heures = h.time || [];
  const a0 = `${isoLocal(debut).slice(0, 13)}:00`, a1 = isoLocal(fin);
  let idx = heures.map((t, i) => (t >= a0 && t <= a1 ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) idx = heures.map((t, i) => (t === a0 ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return null;
  const col = (k) => idx.map((i) => (h[k] || [])[i]).filter((v) => typeof v === "number");
  const moy = (k) => { const v = col(k); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
  const temp = moy("temperature_2m");
  if (temp == null) return null;
  let x = 0, y = 0;
  idx.forEach((i) => {
    const d = (h.wind_direction_10m || [])[i], v = (h.wind_speed_10m || [])[i];
    if (typeof d === "number" && typeof v === "number") { x += v * Math.cos((d * Math.PI) / 180); y += v * Math.sin((d * Math.PI) / 180); }
  });
  const rond = (v, n = 0) => (v == null ? null : Math.round(v * 10 ** n) / 10 ** n);
  const codes = col("weather_code"), rafales = col("wind_gusts_10m");
  return {
    temperature: rond(temp, 1), ressentie: rond(moy("apparent_temperature"), 1), humidite: rond(moy("relative_humidity_2m")),
    precipitation_mm: rond(col("precipitation").reduce((s, v) => s + v, 0), 1), vent_kmh: rond(moy("wind_speed_10m")),
    rafales_kmh: rafales.length ? Math.round(Math.max(...rafales)) : null,
    vent_dir: x || y ? Math.round((((Math.atan2(y, x) * 180) / Math.PI) % 360 + 360) % 360) : null,
    code: codes.length ? Math.max(...codes) : null,
  };
}

// Requête partagée par l'encart et la puce de l'en-tête
export function useMeteo(a) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["meteo", a.id], staleTime: Infinity, retry: false, enabled: !!a.details?.trace,
    queryFn: async () => {
      const m = await getMeteo(a.id).catch(() => null);
      if (m) return m;
      const t = await qc.fetchQuery({ queryKey: ["trace", a.id], queryFn: () => getTrace(a.id), staleTime: Infinity });
      const p = (t?.points || []).find((q) => q[0] != null && q[1] != null);
      const res = p ? await meteoNavigateur(a, p).catch(() => null) : null;
      if (res) enregistrerMeteo(a.id, res).catch(() => {});
      return res;
    },
  });
}

// ───────────────────────── Même parcours ─────────────────────────

export function MemeParcours({ activite, onOuvrir }) {
  const { data } = useQuery({ queryKey: ["meme-parcours", activite.id], queryFn: () => getMemeParcours(activite.id), staleTime: 10 * 60_000 });
  const pied = PIED.has(activite.sport);
  const lignes = data ?? [];
  const avecTemps = lignes.filter((l) => l.duree_sec);
  if (avecTemps.length < 2) return null;
  const meilleur = avecTemps.reduce((m, l) => (l.allure_sec_km < m.allure_sec_km ? l : m));
  const courante = lignes.find((l) => l.courante);
  const rang = 1 + avecTemps.filter((l) => l.allure_sec_km < (courante?.allure_sec_km ?? Infinity)).length;
  // Petit graphe : allure (ou vitesse) de chaque passage dans l'ordre des dates
  const val = (l) => (pied ? l.allure_sec_km : 3600 / l.allure_sec_km);
  const vs = avecTemps.map(val), [lo, hi] = [Math.min(...vs), Math.max(...vs)];
  const L = 300, H = 64, y = (v) => (hi > lo ? 6 + (H - 12) * (pied ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo)) : H / 2);
  const x = (i) => (avecTemps.length > 1 ? 6 + (i * (L - 12)) / (avecTemps.length - 1) : L / 2);
  const recents = [...lignes].reverse().slice(0, 6);
  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold">Même parcours</h3>
        <p className="text-[12px] text-label-2 chiffres">{lignes.length} sorties · {rang}<sup>{rang === 1 ? "re" : "e"}</sup> plus rapide</p>
      </div>
      <svg viewBox={`0 0 ${L} ${H}`} className="w-full h-16" preserveAspectRatio="none" aria-hidden>
        <polyline points={avecTemps.map((l, i) => `${x(i)},${y(val(l))}`).join(" ")} fill="none"
          stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {avecTemps.map((l, i) => (
          <circle key={l.id} cx={x(i)} cy={y(val(l))} r={l.courante ? 4 : 2.5}
            fill={l.courante ? "rgb(var(--blue))" : l === meilleur ? "#FFD60A" : "currentColor"} fillOpacity={l.courante || l === meilleur ? 1 : 0.45} />
        ))}
      </svg>
      <ul className="divide-y divide-separateur text-[14px]">
        {recents.map((l) => (
          <li key={l.id}>
            <button type="button" disabled={l.courante || !onOuvrir} onClick={() => onOuvrir?.(l.id)}
              className={clsx("w-full flex items-center gap-3 py-2 text-left chiffres", l.courante && "font-semibold")}>
              <span className="flex-1 truncate">{l.courante ? "Cette sortie" : fmtDate(l.date)}</span>
              {l === meilleur && <span aria-label="Meilleure">🏆</span>}
              <span className="w-16 text-right">{chrono(l.duree_sec)}</span>
              <span className="w-14 text-right text-label-2">{pied ? mmss(l.allure_sec_km) : `${nombre(3600 / l.allure_sec_km, 1)}`}</span>
              <span className="w-9 text-right" style={{ color: l.fc ? "#FF375F" : undefined }}>{l.fc ?? ""}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ───────────────────────── Segments ─────────────────────────

function MiniProfil({ points, cum, debut, fin }) {
  const alts = points.map((p) => p[2]);
  const ok = alts.filter((a) => a != null);
  const L = 300, H = 56, total = cum.at(-1) || 1;
  const [lo, hi] = ok.length ? [Math.min(...ok), Math.max(...ok)] : [0, 1];
  const y = (a) => (a == null || hi === lo ? H / 2 : H - 4 - ((a - lo) / (hi - lo)) * (H - 10));
  const pas = Math.max(1, Math.floor(points.length / 300));
  const ligne = points.map((p, i) => [i, p]).filter(([i]) => i % pas === 0).map(([i, p]) => `${(cum[i] / total) * L},${y(p[2])}`);
  return (
    <svg viewBox={`0 0 ${L} ${H}`} className="w-full h-14" preserveAspectRatio="none" aria-hidden>
      <rect x={(debut / total) * L} width={Math.max(1, ((fin - debut) / total) * L)} y={0} height={H} fill="rgb(var(--blue))" fillOpacity={0.15} />
      <polyline points={ligne.join(" ")} fill="none" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function CreationSegment({ activite, onFin }) {
  const qc = useQueryClient();
  const { data: trace } = useQuery({ queryKey: ["trace", activite.id], queryFn: () => getTrace(activite.id), staleTime: Infinity });
  const cum = useMemo(() => (trace?.points ? cumulKm(trace.points) : null), [trace]);
  const total = cum?.at(-1) ?? 0;
  const [bornes, setBornes] = useState(null);
  const [nom, setNom] = useState("");
  const [d, f] = bornes ?? [0, Math.min(total, 1)];
  const creer = useMutation({
    mutationFn: () => creerSegment({ activite_id: activite.id, debut_km: d, fin_km: f, nom: nom.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["segments-activite", activite.id] });
      qc.invalidateQueries({ queryKey: ["segments"] });
      onFin();
    },
  });
  if (!cum) return <p className="text-[13px] text-label-2">Chargement du tracé…</p>;
  const regler = (i, v) => {
    const n = [d, f];
    n[i] = Math.max(0, Math.min(total, v));
    if (n[1] - n[0] < 0.1) return;
    setBornes(n);
  };
  return (
    <div className="space-y-2.5 rounded-xl bg-remplissage p-3">
      <MiniProfil points={trace.points} cum={cum} debut={d} fin={f} />
      {[["Départ", 0], ["Arrivée", 1]].map(([l, i]) => (
        <label key={l} className="flex items-center gap-3 text-[13px]">
          <span className="w-14 text-label-2">{l}</span>
          <input type="range" min={0} max={total} step={0.01} value={i ? f : d} className="flex-1"
            onChange={(e) => regler(i, Number(e.target.value))} />
          <span className="w-14 text-right chiffres">{nombre(i ? f : d, 2)} km</span>
        </label>
      ))}
      <p className="text-[12px] text-label-2 chiffres">Segment de {nombre(f - d, 2)} km</p>
      <div className="flex gap-2">
        <input className="champ flex-1" placeholder="Nom (ex. Montée du fort)" maxLength={120} value={nom}
          onChange={(e) => setNom(e.target.value)} />
        <button type="button" className="btn-primaire !px-4" disabled={!nom.trim() || creer.isPending} onClick={() => creer.mutate()}>
          Créer
        </button>
      </div>
      {creer.isError && <p className="text-[12px] text-ios-red">{creer.error?.response?.data?.detail ?? "Création impossible"}</p>}
    </div>
  );
}

export function SegmentsSeance({ activite, avecTrace }) {
  const [creation, setCreation] = useState(false);
  const pied = PIED.has(activite.sport);
  const { data } = useQuery({
    queryKey: ["segments-activite", activite.id], queryFn: () => getSegmentsActivite(activite.id),
    staleTime: 10 * 60_000, enabled: avecTrace,
  });
  if (!avecTrace) return null;
  const lignes = data ?? [];
  // Sans segment sur ce parcours : pas d'encart, juste de quoi en créer un
  if (!lignes.length && !creation) {
    return data ? (
      <button type="button" className="btn-texte block mx-auto text-[15px]" onClick={() => setCreation(true)}>
        Créer un segment sur ce parcours
      </button>
    ) : null;
  }
  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold">Segments</h3>
        <button type="button" className="btn-texte" onClick={() => setCreation((c) => !c)}>
          {creation ? "Annuler" : "Nouveau segment"}
        </button>
      </div>
      {creation && <CreationSegment activite={activite} onFin={() => setCreation(false)} />}
      {lignes.length ? (
        <ul className="divide-y divide-separateur">
          {lignes.map((s, i) => {
            const p = s.passage;
            const allure = (s.distance_m && p.duree_sec) ? p.duree_sec / (s.distance_m / 1000) : null;
            return (
              <li key={`${s.id}-${i}`} className="py-2 flex items-center gap-3">
                <span className="text-[18px] w-6 text-center" aria-hidden>
                  {s.rang === 1 && s.nb_passages > 1 ? "🥇" : s.rang === 2 ? "🥈" : s.rang === 3 ? "🥉" : "⛳"}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-medium truncate">{s.nom}</span>
                  <span className="block text-[12px] text-label-2 chiffres">
                    {nombre(s.distance_m / 1000, 2)} km{s.dplus_m ? ` · ${s.dplus_m} m D+` : ""} · {s.rang}<sup>{s.rang === 1 ? "er" : "e"}</sup> sur {s.nb_passages}
                    {s.record && s.rang > 1 && ` · record ${chrono(s.record.duree_sec)}`}
                  </span>
                </span>
                <span className="text-right chiffres">
                  <span className="block text-[15px] font-semibold">{chrono(p.duree_sec)}</span>
                  <span className="block text-[12px] text-label-2">{pied ? `${mmss(allure)}/km` : `${nombre(p.vitesse_kmh, 1)} km/h`}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

// ───────────────────────── Image à partager ─────────────────────────

// Allure ramenée au plat : allure × ratio, cohérente avec la durée de la montre
// Durée, allure et vitesse en mouvement (pauses enlevées, comme Strava) : temps de la montre,
// sinon recalculé depuis les flux ; à défaut, la durée totale
export function enMouvement(a, flux) {
  const recalc = flux?.decoupage?.duree_mouvement_sec;
  const duree = a.duree_mouvement_sec ?? (recalc && a.duree_sec && recalc < a.duree_sec ? recalc : a.duree_sec);
  const ok = duree && a.distance_km > 0;
  return {
    duree,
    pause: duree && a.duree_sec > duree,
    allure: ok && a.allure_sec_km ? duree / a.distance_km : null,
    vitesse: ok && a.vitesse_kmh ? a.distance_km / (duree / 3600) : null,
  };
}

export function allureAjustee(a, flux) {
  const d = flux?.decoupage, allure = enMouvement(a, flux).allure;
  return d?.gap_ratio && allure ? allure * d.gap_ratio : d?.gap_sec_km ?? null;
}

// Intensité de 0 à 1 : temps passé dans les zones cardiaques, sinon effort ressenti
export function intensite(a) {
  const zones = a.details?.zones_fc;
  const total = Array.isArray(zones) ? zones.reduce((t, z) => t + (z.min_passees || 0), 0) : 0;
  if (total) {
    const moy = zones.reduce((t, z, i) => t + i * (z.min_passees || 0), 0) / total;   // 0 (Z1) à 4 (Z5)
    const mot = moy <= 1.2 ? "Facile" : moy <= 1.9 ? "Modéré" : moy <= 2.6 ? "Soutenu" : moy <= 3.3 ? "Difficile" : "Maximal";
    return { f: moy / 4, mot };
  }
  if (a.rpe != null) {
    const mot = a.rpe <= 3 ? "Facile" : a.rpe <= 5 ? "Modéré" : a.rpe <= 7 ? "Soutenu" : a.rpe <= 8.5 ? "Difficile" : "Maximal";
    return { f: a.rpe / 10, mot };
  }
  return null;
}

// Image verticale 1080 × 1980 : résumé chiffré, carte, profil de dénivelé et effort
async function dessinerImage(a, points, flux) {
  const W = 1080, H = 1980, M = 72, c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  const s = sportInfo(a.sport);
  const fond = g.createLinearGradient(0, 0, W, H);
  fond.addColorStop(0, "#101016");
  fond.addColorStop(1, "#22222c");
  g.fillStyle = fond;
  g.fillRect(0, 0, W, H);
  const police = (px, poids = 600) => `${poids} ${px}px -apple-system, "SF Pro Display", "Segoe UI", Roboto, sans-serif`;
  const texte = (t, x, y, px, poids, coul, align = "left") => {
    g.font = police(px, poids);
    g.fillStyle = coul;
    g.textAlign = align;
    g.fillText(t, x, y);
    g.textAlign = "left";
    return g.measureText(t).width;
  };
  const carte = (y, h) => {
    g.fillStyle = "rgba(255,255,255,0.07)";
    g.beginPath();
    g.roundRect(M, y, W - 2 * M, h, 36);
    g.fill();
  };
  const GRIS = "rgba(255,255,255,0.55)";

  // En-tête : sport, date et heure, titre sur deux lignes au plus
  const date = new Date(a.debut);
  texte(`${s.emoji}  ${(a.sport_label || s.label).toUpperCase()}`, M, 120, 34, 700, s.couleur);
  texte("Carnet", W - M, 120, 26, 600, "rgba(255,255,255,0.35)", "right");
  texte(`${date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${
    date.toLocaleTimeString("fr-FR", { hour: "numeric", minute: "2-digit" }).replace(":", " h ")}`, M, 170, 30, 500, GRIS);
  g.font = police(64, 800);
  const lignes = [];
  let reste = (a.titre || a.sport_label || s.label).split(" ");
  while (reste.length && lignes.length < 2) {
    let n = reste.length;
    while (n > 1 && g.measureText(reste.slice(0, n).join(" ")).width > W - 2 * M) n--;
    let l = reste.slice(0, n).join(" ");
    reste = reste.slice(n);
    if (lignes.length === 1 && reste.length) l += "…";
    while (g.measureText(l).width > W - 2 * M && l.length > 4) l = `${l.slice(0, -2)}…`;
    lignes.push(l);
  }
  lignes.forEach((l, i) => texte(l, M, 260 + i * 76, 64, 800, "#fff"));
  let y = 260 + (lignes.length - 1) * 76 + 50;

  // Résumé : distance en grand (sinon la durée), puis durée, allure, allure ajustée, D+
  const pied = PIED.has(a.sport);
  const avecDistance = a.distance_km > 0;
  const ajustee = allureAjustee(a, flux), mv = enMouvement(a, flux);
  const stats = [
    avecDistance && mv.duree && [chrono(mv.duree), "Durée"],
    pied ? avecDistance && mv.allure && [mmss(mv.allure), "Allure /km"] : mv.vitesse && [nombre(mv.vitesse, 1), "km/h"],
    ajustee && [mmss(ajustee), "Ajustée /km", "#30D158"],
    a.dplus_m > 0 && [`${nombre(a.dplus_m, 0)} m`, "D+"],
    !avecDistance && a.fc_moyenne_bpm && [String(a.fc_moyenne_bpm), "FC moy."],
    !avecDistance && a.calories && [nombre(a.calories, 0), "kcal"],
  ].filter(Boolean);
  const hr = stats.length ? 340 : 230;
  carte(y, hr);
  const w = texte(avecDistance ? nombre(a.distance_km, 2) : a.duree_sec ? chrono(a.duree_sec) : "—", M + 44, y + 180, 170, 800, "#fff");
  if (avecDistance) texte("km", M + 44 + w + 14, y + 180, 54, 700, GRIS);
  const col = (W - 2 * M - 88) / Math.max(1, stats.length);
  stats.forEach(([v, l, coul], i) => {
    texte(v, M + 44 + i * col, y + 262, 50, 700, coul || "#fff");
    texte(l, M + 44 + i * col, y + 304, 26, 500, GRIS);
  });
  y += hr + 32;

  // Carte du tracé : elle prend toute la hauteur laissée par les autres blocs
  const pts = (points || []).filter((p) => p[0] != null && p[1] != null);
  const idx = pts.map((_, i) => i).filter((i) => pts[i][2] != null);
  const eff = intensite(a);
  if (pts.length > 1) {
    const h = Math.max(600, H - 80 - y - (idx.length > 10 ? 322 : 0) - (eff ? 192 : 0));
    carte(y, h);
    const k = Math.cos((pts[0][0] * Math.PI) / 180);
    const xs = pts.map((p) => p[1] * k), ys = pts.map((p) => -p[0]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const zone = { x: M + 70, y: y + 70, w: W - 2 * M - 140, h: h - 140 };
    const e = Math.min(zone.w / (x1 - x0 || 1e-9), zone.h / (y1 - y0 || 1e-9));
    const ox = zone.x + (zone.w - (x1 - x0) * e) / 2, oy = zone.y + (zone.h - (y1 - y0) * e) / 2;
    const P = (i) => [ox + (xs[i] - x0) * e, oy + (ys[i] - y0) * e];
    g.lineJoin = g.lineCap = "round";
    g.shadowColor = s.couleur;
    g.shadowBlur = 24;
    g.strokeStyle = s.couleur;
    g.lineWidth = 9;
    g.beginPath();
    pts.forEach((_, i) => (i ? g.lineTo(...P(i)) : g.moveTo(...P(i))));
    g.stroke();
    g.shadowBlur = 0;
    for (const [i, coul] of [[pts.length - 1, "#FF453A"], [0, "#30D158"]]) {
      g.fillStyle = coul;
      g.beginPath();
      g.arc(...P(i), 13, 0, 2 * Math.PI);
      g.fill();
      g.strokeStyle = "#fff";
      g.lineWidth = 4;
      g.stroke();
    }
    y += h + 32;
  }

  // Profil de dénivelé
  if (idx.length > 10) {
    const h = 290;
    carte(y, h);
    const alts = idx.map((i) => pts[i][2]);
    const [lo, hi] = [Math.min(...alts), Math.max(...alts)];
    const wd = texte(`${nombre(a.dplus_m || 0, 0)} m`, M + 44, y + 76, 46, 700, "#fff");
    texte("D+", M + 44 + wd + 12, y + 76, 28, 600, GRIS);
    texte(`de ${nombre(lo, 0)} à ${nombre(hi, 0)} m`, W - M - 44, y + 76, 28, 500, GRIS, "right");
    const cum = cumulKm(pts), tot = cum.at(-1) || 1;
    const zone = { x: M + 44, y: y + 112, w: W - 2 * M - 88, h: h - 150 };
    const X = (i) => zone.x + (cum[i] / tot) * zone.w;
    const Y = (v) => zone.y + zone.h - (hi > lo ? ((v - lo) / (hi - lo)) * zone.h : zone.h / 2);
    g.beginPath();
    idx.forEach((i, j) => (j ? g.lineTo(X(i), Y(pts[i][2])) : g.moveTo(X(i), Y(pts[i][2]))));
    g.strokeStyle = "#30D158";
    g.lineWidth = 4;
    g.stroke();
    g.lineTo(X(idx.at(-1)), zone.y + zone.h);
    g.lineTo(X(idx[0]), zone.y + zone.h);
    g.closePath();
    g.fillStyle = "rgba(48,209,88,0.22)";
    g.fill();
    y += h + 32;
  }

  // Effort : jauge verte → orange → rouge
  if (eff) {
    const h = 160;
    carte(y, h);
    const charge = a.duree_sec && a.rpe != null ? Math.round((a.duree_sec / 60) * a.rpe) : null;
    texte(`Effort${a.fc_moyenne_bpm ? ` · FC moy. ${a.fc_moyenne_bpm}` : ""}${charge ? ` · charge ${charge}` : ""}`, M + 44, y + 62, 28, 500, GRIS);
    texte(eff.mot, W - M - 44, y + 64, 40, 700, "#fff", "right");
    const bx = M + 44, bw = W - 2 * M - 88, by = y + 104;
    const deg = g.createLinearGradient(bx, 0, bx + bw, 0);
    deg.addColorStop(0, "#30D158");
    deg.addColorStop(0.5, "#FF9F0A");
    deg.addColorStop(1, "#FF453A");
    g.fillStyle = deg;
    g.beginPath();
    g.roundRect(bx, by, bw, 14, 7);
    g.fill();
    const cx = bx + bw * Math.min(0.97, Math.max(0.03, eff.f));
    g.beginPath();
    g.arc(cx, by + 7, 18, 0, 2 * Math.PI);
    g.fillStyle = "#1c1c24";
    g.fill();
    g.lineWidth = 7;
    g.strokeStyle = eff.f < 0.4 ? "#30D158" : eff.f < 0.7 ? "#FF9F0A" : "#FF453A";
    g.stroke();
  }
  return new Promise((ok) => c.toBlob(ok, "image/png"));
}

export function Partager({ activite, avecTrace, flux }) {
  const qc = useQueryClient();
  const [etat, setEtat] = useState(null);
  const lancer = async () => {
    setEtat("…");
    try {
      const trace = avecTrace
        ? await qc.fetchQuery({ queryKey: ["trace", activite.id], queryFn: () => getTrace(activite.id), staleTime: Infinity })
        : null;
      const blob = await dessinerImage(activite, trace?.points, flux);
      const nom = `seance-${activite.debut.slice(0, 10)}.png`;
      const fichier = new File([blob], nom, { type: "image/png" });
      if (navigator.canShare?.({ files: [fichier] })) {
        await navigator.share({ files: [fichier], title: activite.titre || "Séance" });
      } else {
        const url = URL.createObjectURL(blob);
        const lien = Object.assign(document.createElement("a"), { href: url, download: nom });
        lien.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
      setEtat(null);
    } catch (e) {
      setEtat(e?.name === "AbortError" ? null : "Échec");
    }
  };
  return (
    <button type="button" className="btn-gris w-full flex items-center justify-center gap-2" onClick={lancer} disabled={etat === "…"}>
      <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
      </svg>
      {etat === "…" ? "Préparation de l'image…" : etat === "Échec" ? "Réessayer le partage" : "Partager en image"}
    </button>
  );
}
