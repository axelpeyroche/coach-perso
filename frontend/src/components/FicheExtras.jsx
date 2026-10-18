// Encarts complémentaires de la fiche d'une séance : découpage par km et par tour, météo,
// chaussures, sorties sur le même parcours, segments et image à partager.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  choisirEquipement, creerSegment, getEquipementActivite, getMemeParcours, getMeteo, getSegmentsActivite, getTrace,
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
  const cols = ["2.6rem", "3.3rem", "1fr", gap && "3.3rem", fc && "2.4rem", dplus && "2.6rem"].filter(Boolean).join(" ");

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

function ciel(code) {
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
const CARDINAUX = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];

export function Meteo({ activiteId }) {
  const { data: m } = useQuery({ queryKey: ["meteo", activiteId], queryFn: () => getMeteo(activiteId), staleTime: Infinity, retry: false });
  if (!m) return null;
  const [emoji, texte] = ciel(m.code);
  return (
    <section className="card px-4 py-3 flex items-center gap-3.5">
      <span className="text-[34px] leading-none shrink-0" aria-hidden>{emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[22px] font-semibold leading-tight chiffres">
          {nombre(m.temperature, 0)}°
          {m.ressentie != null && Math.round(m.ressentie) !== Math.round(m.temperature) && (
            <span className="text-[13px] font-medium text-label-2 ml-1.5">ressenti {nombre(m.ressentie, 0)}°</span>
          )}
        </p>
        <p className="text-[13px] text-label-2 truncate">{texte}</p>
      </div>
      <div className="text-[13px] text-right chiffres space-y-0.5 shrink-0">
        {m.vent_kmh != null && (
          <p className="flex items-center justify-end gap-1">
            {m.vent_dir != null && (
              // La flèche montre où va le vent (il souffle depuis `vent_dir`)
              <span className="inline-block text-label-2" style={{ transform: `rotate(${m.vent_dir + 180}deg)` }} aria-hidden>↑</span>
            )}
            {m.vent_kmh} km/h{m.vent_dir != null && <span className="text-label-2">{CARDINAUX[Math.round(m.vent_dir / 45) % 8]}</span>}
          </p>
        )}
        <p className="text-label-2">
          {m.humidite != null && `💧 ${m.humidite} %`}
          {m.precipitation_mm > 0 && ` · ${nombre(m.precipitation_mm, 1)} mm`}
        </p>
      </div>
    </section>
  );
}

// ───────────────────────── Chaussures ─────────────────────────

export function Materiel({ activiteId }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["equipement", activiteId], queryFn: () => getEquipementActivite(activiteId), staleTime: 60_000 });
  const choix = useMutation({
    mutationFn: (v) => choisirEquipement(activiteId, v),
    onSuccess: (d) => { qc.setQueryData(["equipement", activiteId], d); qc.invalidateQueries({ queryKey: ["equipements"] }); },
  });
  if (!data || (!data.equipement && !data.options.length)) return null;
  const e = data.equipement;
  const valeur = e ? (data.manuel ? String(e.id) : "") : data.manuel ? "aucun" : "";
  return (
    <label className="card px-4 py-3 flex items-center gap-3 cursor-pointer">
      <span className="text-[22px] leading-none" aria-hidden>👟</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold truncate">{e ? e.nom : "Aucun matériel"}</span>
        <span className={clsx("block text-[12px] chiffres truncate", e?.alerte ? "text-ios-orange" : "text-label-2")}>
          {e ? `${nombre(e.km, 0)} km${e.limite_km ? ` sur ${e.limite_km}` : ""}${e.alerte ? " · à changer bientôt" : ""}` : "Non compté"}
          {!data.manuel && e && " · par défaut"}
        </span>
      </span>
      <select className="champ !w-auto max-w-[45%] text-[14px]" value={valeur} disabled={choix.isPending}
        onChange={(ev) => choix.mutate(ev.target.value === "" ? null : ev.target.value)} aria-label="Matériel de la séance">
        <option value="">Par défaut</option>
        {data.options.map((o) => <option key={o.id} value={String(o.id)}>{o.nom}</option>)}
        <option value="aucun">Aucun</option>
      </select>
    </label>
  );
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
      ) : !creation && (
        <p className="text-[13px] text-label-2">
          {data ? "Aucun segment sur ce parcours. Crée-en un pour chronométrer une montée ou une portion à chaque passage." : "Recherche des segments…"}
        </p>
      )}
    </section>
  );
}

// ───────────────────────── Image à partager ─────────────────────────

async function dessinerImage(a, points) {
  const N = 1080, c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  const s = sportInfo(a.sport);
  const fond = g.createLinearGradient(0, 0, N, N);
  fond.addColorStop(0, "#101016");
  fond.addColorStop(1, "#22222c");
  g.fillStyle = fond;
  g.fillRect(0, 0, N, N);
  const police = (px, poids = 600) => `${poids} ${px}px -apple-system, "SF Pro Display", "Segoe UI", Roboto, sans-serif`;

  // En-tête : sport, date, titre
  g.fillStyle = s.couleur;
  g.font = police(34, 600);
  g.fillText(`${s.emoji}  ${(a.sport_label || s.label).toUpperCase()}`, 72, 104);
  g.fillStyle = "rgba(255,255,255,0.6)";
  g.font = police(30, 500);
  g.fillText(new Date(a.debut).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }), 72, 150);
  g.fillStyle = "#fff";
  g.font = police(60, 700);
  let titre = a.titre || a.sport_label || s.label;
  while (g.measureText(titre).width > N - 144 && titre.length > 4) titre = `${titre.slice(0, -2)}…`.replace(/……$/, "…");
  g.fillText(titre, 72, 226);

  // Tracé
  const pts = (points || []).filter((p) => p[0] != null && p[1] != null);
  if (pts.length > 1) {
    const k = Math.cos((pts[0][0] * Math.PI) / 180);
    const xs = pts.map((p) => p[1] * k), ys = pts.map((p) => -p[0]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const zone = { x: 90, y: 270, w: N - 180, h: 470 };
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
    for (const [i, col] of [[0, "#30D158"], [pts.length - 1, "#FF453A"]]) {
      g.fillStyle = col;
      g.beginPath();
      g.arc(...P(i), 13, 0, 2 * Math.PI);
      g.fill();
      g.strokeStyle = "#fff";
      g.lineWidth = 4;
      g.stroke();
    }
  }

  // Chiffres
  const pied = PIED.has(a.sport);
  const stats = [
    a.distance_km != null && ["Distance", nombre(a.distance_km, 2), "km"],
    a.duree_sec && ["Durée", chrono(a.duree_sec), ""],
    pied ? a.allure_sec_km && ["Allure", mmss(a.allure_sec_km), "/km"] : a.vitesse_kmh && ["Vitesse", nombre(a.vitesse_kmh, 1), "km/h"],
    a.dplus_m ? ["Dénivelé", String(a.dplus_m), "m"] : a.fc_moyenne_bpm && ["FC moy.", String(a.fc_moyenne_bpm), "bpm"],
  ].filter(Boolean);
  const largeur = (N - 144) / Math.max(1, stats.length);
  stats.forEach(([l, v, u], i) => {
    const x = 72 + i * largeur;
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.font = police(28, 500);
    g.fillText(l, x, 818);
    g.fillStyle = "#fff";
    g.font = police(64, 700);
    g.fillText(v, x, 888);
    const w = g.measureText(v).width;
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.font = police(28, 600);
    g.fillText(u, x + w + 8, 888);
  });

  // Mini-profil d'altitude
  const alts = pts.map((p) => p[2]).filter((v) => v != null);
  if (alts.length > 10) {
    const cum = cumulKm(pts), tot = cum.at(-1) || 1;
    const [lo, hi] = [Math.min(...alts), Math.max(...alts)];
    const zone = { x: 72, y: 930, w: N - 144, h: 90 };
    g.beginPath();
    g.moveTo(zone.x, zone.y + zone.h);
    pts.forEach((p, i) => {
      if (p[2] == null) return;
      g.lineTo(zone.x + (cum[i] / tot) * zone.w, zone.y + zone.h - (hi > lo ? ((p[2] - lo) / (hi - lo)) * zone.h : zone.h / 2));
    });
    g.lineTo(zone.x + zone.w, zone.y + zone.h);
    g.closePath();
    g.fillStyle = `${s.couleur}55`;
    g.fill();
  }
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.font = police(24, 600);
  g.textAlign = "right";
  g.fillText("Carnet", N - 72, 104);
  return new Promise((ok) => c.toBlob(ok, "image/png"));
}

export function Partager({ activite, avecTrace }) {
  const qc = useQueryClient();
  const [etat, setEtat] = useState(null);
  const lancer = async () => {
    setEtat("…");
    try {
      const trace = avecTrace
        ? await qc.fetchQuery({ queryKey: ["trace", activite.id], queryFn: () => getTrace(activite.id), staleTime: Infinity })
        : null;
      const blob = await dessinerImage(activite, trace?.points);
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
