import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { getEquipementActivite, getMemeParcours, getMeteo, getSegmentsActivite, getTrace } from "../api";
import { nombre, sportInfo, SOURCES } from "../carnet";
import { ciel, mmss } from "./FicheExtras";

const chrono = (s) => {
  if (s == null) return null;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

// Fait défiler la feuille jusqu'à l'encart détaillé correspondant
export const ancre = (id, quoi) => `fiche-${id}-${quoi}`;
const aller = (id, quoi) => document.getElementById(ancre(id, quoi))?.scrollIntoView({ behavior: "smooth", block: "start" });

// Intensité de 0 à 1 : temps passé dans les zones cardiaques, sinon effort ressenti
function intensite(a) {
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

// Tracé dessiné en SVG (projection simple, suffisante à cette échelle)
function MiniCarte({ points, couleur }) {
  const d = useMemo(() => {
    const pts = (points ?? []).filter((p) => p[0] != null && p[1] != null);
    if (pts.length < 2) return null;
    const pas = Math.max(1, Math.floor(pts.length / 400));
    const k = Math.cos((pts[0][0] * Math.PI) / 180);
    const xs = [], ys = [];
    for (let i = 0; i < pts.length; i += pas) { xs.push(pts[i][1] * k); ys.push(-pts[i][0]); }
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const e = 84 / Math.max(x1 - x0, y1 - y0, 1e-9);
    const ox = 50 - ((x1 - x0) * e) / 2, oy = 50 - ((y1 - y0) * e) / 2;
    const P = xs.map((x, i) => [ox + (x - x0) * e, oy + (ys[i] - y0) * e]);
    return { chemin: `M${P.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" L")}`, depart: P[0], arrivee: P.at(-1) };
  }, [points]);
  if (!d) return null;
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden>
      <path d={d.chemin} fill="none" stroke="rgb(var(--surface))" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d.chemin} fill="none" stroke={couleur} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={d.arrivee[0]} cy={d.arrivee[1]} r={2.6} fill="#FF3B30" stroke="rgb(var(--surface))" strokeWidth={1.4} />
      <circle cx={d.depart[0]} cy={d.depart[1]} r={2.6} fill="#34C759" stroke="rgb(var(--surface))" strokeWidth={1.4} />
    </svg>
  );
}

function useProfil(points) {
  const p = useMemo(() => {
    const alts = (points ?? []).map((q) => q[2]).filter((v) => v != null);
    if (alts.length < 2) return null;
    const pas = Math.max(1, Math.floor(alts.length / 200));
    const ech = alts.filter((_, i) => i % pas === 0);
    const lo = Math.min(...alts), hi = Math.max(...alts);
    const y = (v) => 44 - ((v - lo) / (hi - lo || 1)) * 40;
    const d = `M${ech.map((v, i) => `${((i / (ech.length - 1)) * 400).toFixed(1)},${y(v).toFixed(1)}`).join(" L")}`;
    return { d, lo: Math.round(lo), hi: Math.round(hi) };
  }, [points]);
  return p;
}

function Puce({ children, alerte, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={clsx("inline-flex items-center gap-1.5 rounded-full card px-2.5 py-[5px] text-[13px] font-medium whitespace-nowrap max-w-full active:opacity-70 transition",
        alerte ? "text-ios-orange" : "text-brand")}>
      <span className="truncate">{children}</span>
    </button>
  );
}

// En-tête « les chiffres d'abord » : distance en grand, vignettes carte et profil,
// jauge d'effort et puces qui mènent aux encarts détaillés plus bas.
export default function EnteteFiche({ a, flux }) {
  const s = sportInfo(a.sport);
  const det = a.details || {};
  const id = a.id;
  const pied = ["course", "trail", "marche", "randonnee"].includes(a.sport);

  // Mêmes requêtes que les encarts du dessous : pas d'appel en plus
  const { data: trace } = useQuery({ queryKey: ["trace", id], queryFn: () => getTrace(id), staleTime: Infinity, enabled: !!det.trace });
  const { data: meteo } = useQuery({ queryKey: ["meteo", id], queryFn: () => getMeteo(id), staleTime: Infinity, retry: false, enabled: !!det.trace });
  const { data: equip } = useQuery({ queryKey: ["equipement", id], queryFn: () => getEquipementActivite(id), staleTime: 60_000 });
  const { data: meme } = useQuery({ queryKey: ["meme-parcours", id], queryFn: () => getMemeParcours(id), staleTime: 10 * 60_000, enabled: !!det.trace });
  const { data: segs } = useQuery({ queryKey: ["segments-activite", id], queryFn: () => getSegmentsActivite(id), staleTime: 10 * 60_000, enabled: !!det.trace });
  const profil = useProfil(trace?.points);

  const ajustee = flux?.decoupage?.gap_ratio && a.allure_sec_km ? a.allure_sec_km * flux.decoupage.gap_ratio : flux?.decoupage?.gap_sec_km;
  const avecDistance = a.distance_km > 0;
  const ligne = [
    avecDistance && a.duree_sec && [chrono(a.duree_sec), "Durée"],
    pied ? a.allure_sec_km && avecDistance && [mmss(a.allure_sec_km), "Allure /km"]
      : a.vitesse_kmh && [nombre(a.vitesse_kmh, 1), "km/h"],
    ajustee && [mmss(ajustee), "Ajustée", "text-ios-green"],
    a.dplus_m > 0 && [`${nombre(a.dplus_m, 0)} m`, "D+"],
    !avecDistance && a.fc_moyenne_bpm && [a.fc_moyenne_bpm, "FC moy."],
    !avecDistance && a.calories && [nombre(a.calories, 0), "kcal"],
  ].filter(Boolean);

  const effort = intensite(a);
  const charge = a.duree_sec && a.rpe != null ? Math.round((a.duree_sec / 60) * a.rpe) : null;
  const e = equip?.equipement;
  const fois = meme?.length > 1 && meme.find((l) => l.courante)
    ? meme.filter((l) => l.date <= meme.find((x) => x.courante).date).length : null;
  const seg = (segs ?? []).filter((x) => x.nb_passages > 0).sort((x, y) => x.rang - y.rang)[0];
  const date = new Date(a.debut);

  return (
    <div className="space-y-3 -mt-1">
      <div>
        <p className="flex items-center gap-1.5 text-[13px] text-label-2 min-w-0">
          <span className="w-[22px] h-[22px] rounded-[6px] grid place-items-center text-[13px] shrink-0"
            style={{ backgroundColor: `${s.couleur}33` }}>{a.emoji ?? s.emoji}</span>
          <span className="truncate">
            {a.sport_label || s.label}{a.est_competition && " 🏅"} · {date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
            {" · "}{date.toLocaleTimeString("fr-FR", { hour: "numeric", minute: "2-digit" }).replace(":", " h ")}
            {" · "}{SOURCES[a.source] ?? a.source}
          </span>
        </p>
        <h2 className="text-[26px] font-bold leading-[1.15] mt-0.5 [text-wrap:balance]">{a.titre || a.sport_label || s.label}</h2>
      </div>

      <div className="card px-4 pt-4 pb-3 space-y-3">
        <p className="font-rounded chiffres text-[56px] font-extrabold leading-[0.95] tracking-[-0.02em]">
          {avecDistance ? nombre(a.distance_km, 2) : chrono(a.duree_sec) ?? "—"}
          {avecDistance && <small className="text-[20px] font-semibold text-label-2 ml-1">km</small>}
        </p>
        {ligne.length > 0 && (
          <div className="flex flex-wrap gap-x-[18px] gap-y-2 chiffres">
            {ligne.map(([v, l, c]) => (
              <div key={l}>
                <b className={clsx("block font-rounded text-[19px] font-bold", c)}>{v}</b>
                <span className="text-[11px] text-label-2">{l}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {det.trace && trace?.points?.length > 1 && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => aller(id, "carte")} aria-label="Voir la carte"
            className="card relative aspect-square overflow-hidden active:opacity-80 transition"
            style={{ background: `color-mix(in srgb, ${s.couleur} 8%, rgb(var(--surface)))` }}>
            <MiniCarte points={trace.points} couleur={s.couleur} />
            <span className="absolute right-2 top-2 rounded-full card shadow px-2 py-0.5 text-[12px] font-semibold text-brand">Carte</span>
          </button>
          {profil ? (
            <button type="button" onClick={() => aller(id, "carte")} aria-label="Voir le profil de dénivelé"
              className="card aspect-square flex flex-col justify-between px-2.5 pt-2.5 pb-1.5 text-left active:opacity-80 transition">
              <span>
                <b className="block text-[17px] chiffres">{nombre(a.dplus_m || 0, 0)} m</b>
                <span className="text-[11px] text-label-2 chiffres">de {nombre(profil.lo, 0)} à {nombre(profil.hi, 0)} m</span>
              </span>
              <svg viewBox="0 0 400 46" preserveAspectRatio="none" className="w-full h-[55%]" aria-hidden>
                <path d={`${profil.d} L400,46 L0,46 Z`} fill="#34C759" fillOpacity={0.22} />
                <path d={profil.d} fill="none" stroke="#34C759" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              </svg>
            </button>
          ) : <div className="card aspect-square grid place-items-center text-[13px] text-label-2">Pas d'altitude</div>}
        </div>
      )}

      {effort && (
        <div className="card flex items-center gap-2.5 px-3.5 py-2.5">
          <div className="flex-1 grid gap-[7px] min-w-0">
            <span className="text-[13px] text-label-2 truncate chiffres">
              Effort{a.fc_moyenne_bpm ? ` · FC moy. ${a.fc_moyenne_bpm}` : ""}{a.rpe != null ? ` · ressenti ${nombre(a.rpe, 1)}/10` : ""}{charge ? ` · charge ${charge}` : ""}
            </span>
            <div className="relative h-1.5 rounded-[3px]" style={{ background: "linear-gradient(90deg, #34C759, #FF9500, #FF3B30)" }}>
              <i className="absolute -top-1 w-3.5 h-3.5 rounded-full -translate-x-1/2 border-[3px]"
                style={{ left: `${Math.min(97, Math.max(3, effort.f * 100))}%`, background: "rgb(var(--surface))",
                  borderColor: effort.f < 0.4 ? "#34C759" : effort.f < 0.7 ? "#FF9500" : "#FF3B30" }} />
            </div>
          </div>
          <b className="text-[15px]">{effort.mot}</b>
        </div>
      )}

      {(meteo || e || fois || seg) && (
        <div className="flex flex-wrap gap-1.5">
          {meteo && (
            <Puce onClick={() => aller(id, "conditions")}>
              {ciel(meteo.code)[0]} {nombre(meteo.temperature, 0)}°{meteo.vent_kmh != null ? ` · vent ${meteo.vent_kmh} km/h` : ""}
            </Puce>
          )}
          {e && <Puce alerte={e.alerte} onClick={() => aller(id, "conditions")}>👟 {e.nom} · {nombre(e.km, 0)} km</Puce>}
          {fois && <Puce onClick={() => aller(id, "parcours")}>🔁 {fois}<sup>{fois === 1 ? "re" : "e"}</sup> fois sur ce parcours</Puce>}
          {seg && (
            <Puce onClick={() => aller(id, "segments")}>
              {seg.rang === 1 && seg.nb_passages > 1 ? "🥇" : seg.rang === 2 ? "🥈" : seg.rang === 3 ? "🥉" : "⛳"} {seg.nom}
            </Puce>
          )}
        </div>
      )}
    </div>
  );
}
