import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import clsx from "clsx";
import Card from "../components/Card";
import Page from "../components/Page";
import StatTile from "../components/StatTile";
import { FormeGraphiques } from "../components/Forme";
import { Section, Segmente } from "../components/ui";
import { axeX, axeY, grille, curseur, InfoBulle, Legende } from "../components/graphiques";
import api, { getStatsCarnet } from "../api";
import { SPORTS, sportInfo, fmtAllureSec, fmtDate, nombre } from "../carnet";

const BLEU = "#007AFF";
const ORANGE = "#FF9500";
const VERT = "#34C759";
const CYAN = "#32ADE6";

const ZONES = {
  "sous-charge": { label: "Sous-charge", color: "blue", txt: "Charge de la semaine bien en dessous de ta moyenne : tu peux relancer." },
  optimale: { label: "Zone optimale", color: "green", txt: "Charge cohérente avec ce que tu encaisses habituellement." },
  vigilance: { label: "Vigilance", color: "orange", txt: "Hausse marquée de la charge : surveille la fatigue." },
  risque: { label: "Risque", color: "red", txt: "Pic de charge brutal (> 1,5× ta moyenne) : risque de blessure accru." },
};

// Carte de graphique façon app Santé : libellé coloré, sous-titre gris
function Graphe({ titre, couleur, sousTitre, action, children, note }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold" style={{ color: couleur }}>{titre}</p>
          {sousTitre && <p className="text-[13px] text-label-2">{sousTitre}</p>}
        </div>
        {action}
      </div>
      {children}
      {note && <p className="text-[12px] text-label-2 mt-3">{note}</p>}
    </Card>
  );
}

function Tuile({ label, value, sub }) {
  return (
    <div className="tuile px-3 py-2.5 min-w-0">
      <p className="text-[12px] text-label-2 truncate">{label}</p>
      <p className="font-rounded text-[17px] font-bold chiffres truncate">{value}</p>
      {sub && <p className="text-[11px] text-label-2 truncate">{sub}</p>}
    </div>
  );
}

const NIVEAUX = ["bg-remplissage", "bg-ios-green/25", "bg-ios-green/50", "bg-ios-green/75", "bg-ios-green"];

function Heatmap({ calendrier }) {
  // 53 colonnes (semaines) × 7 lignes (lun→dim), se terminant aujourd'hui
  const { cols, max } = useMemo(() => {
    const auj = new Date();
    auj.setHours(12, 0, 0, 0);
    const fin = new Date(auj);
    fin.setDate(fin.getDate() + (7 - ((fin.getDay() + 6) % 7) - 1)); // dimanche courant
    const cols = [];
    let max = 0;
    for (let w = 52; w >= 0; w--) {
      const col = [];
      for (let d = 6; d >= 0; d--) {
        const j = new Date(fin);
        j.setDate(fin.getDate() - w * 7 - d);
        const iso = `${j.getFullYear()}-${String(j.getMonth() + 1).padStart(2, "0")}-${String(j.getDate()).padStart(2, "0")}`;
        const v = calendrier[iso] ?? 0;
        max = Math.max(max, v);
        col.push({ iso, v, futur: j > auj });
      }
      cols.push(col);
    }
    return { cols, max };
  }, [calendrier]);

  const niveau = (v) => (v === 0 ? 0 : v < max * 0.25 ? 1 : v < max * 0.5 ? 2 : v < max * 0.75 ? 3 : 4);

  return (
    <div className="overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0" dir="rtl">
      <div className="flex gap-[3px] w-max" dir="ltr">
        {cols.map((col, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {col.map((c) => (
              <div key={c.iso} title={`${fmtDate(c.iso)} : ${c.v} min`}
                className={clsx("w-[11px] h-[11px] rounded-[3px]", c.futur ? "opacity-0" : NIVEAUX[niveau(c.v)])} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StatsCarnet() {
  const [sport, setSport] = useState("");
  const [metrique, setMetrique] = useState("heures");
  const { data: s, isLoading } = useQuery({
    queryKey: ["stats-carnet", sport],
    queryFn: () => getStatsCarnet(sport || undefined),
  });

  // Sports ayant au moins une activité (tout l'historique) : seuls ceux-là sont proposés en filtre
  const { data: presents } = useQuery({
    queryKey: ["activites", "sports-presents"],
    queryFn: () => api.get("/carnet/sports-presents").then((r) => r.data),
  });
  const sportsFiltre = presents ? Object.keys(SPORTS).filter((k) => presents[k] > 0) : [];
  useEffect(() => {
    // Filtre actif devenu sans activité → retour à « Tous »
    if (presents && sport && !(presents[sport] > 0)) setSport("");
  }, [presents, sport]);

  const sportsPresents = useMemo(() => {
    if (!s) return [];
    return Object.keys(SPORTS).filter((k) => s.semaines.some((w) => w[`h_${k}`] > 0));
  }, [s]);

  const allures = useMemo(() => {
    if (!s) return [];
    // moyenne glissante sur 5 sorties pour lisser
    return s.allures.map((p, i, arr) => {
      const fen = arr.slice(Math.max(0, i - 4), i + 1);
      const moy = fen.reduce((t, x) => t + x.allure_sec_km, 0) / fen.length;
      const effs = fen.filter((x) => x.efficacite);
      return {
        ...p,
        label: fmtDate(p.date, { day: "numeric", month: "short" }),
        tendance: Math.round(moy),
        efficacite_moy: effs.length ? +(effs.reduce((t, x) => t + x.efficacite, 0) / effs.length).toFixed(3) : null,
      };
    });
  }, [s]);

  // Un seul sport (ou aucun) : le filtre n'apporte rien, on le masque
  const filtres = sportsFiltre.length > 1 && (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4">
      {[["", "Tous"], ...sportsFiltre.map((k) => [k, `${SPORTS[k].emoji} ${SPORTS[k].label}`])].map(([k, l]) => (
        <button key={k} onClick={() => setSport(k)} className={clsx("puce", sport === k && "puce-active")}>{l}</button>
      ))}
    </div>
  );

  if (isLoading || !s) {
    return <Page titre="Statistiques">{filtres}<p className="text-[15px] text-label-2">Chargement…</p></Page>;
  }

  const t = s.totaux;
  const zone = ZONES[s.charge.zone];
  const aucune = t.total.nb === 0;
  const maxRep = Math.max(...s.repartition.map((x) => x.duree_h), 0.01);

  return (
    <Page titre="Statistiques" large
      sousTitre={s.premiere_activite ? `Depuis le ${fmtDate(s.premiere_activite)}` : null}>
      {filtres}

      {aucune ? (
        <Card><p className="text-[15px] text-label-2 text-center py-6">Aucune activité pour ce filtre.</p></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Cette semaine" color="orange" value={`${nombre(t.semaine.duree_h)} h`} sub={`${t.semaine.nb} séance(s) · ${nombre(t.semaine.distance_km)} km`} />
            <StatTile label="Ce mois-ci" color="blue" value={`${nombre(t.mois.duree_h)} h`} sub={`${t.mois.nb} séance(s) · ${nombre(t.mois.distance_km)} km`} />
            <StatTile label={`Année ${new Date().getFullYear()}`} color="green" value={`${nombre(t.annee.distance_km, 0)} km`} sub={`${t.annee.nb} séances · ${nombre(t.annee.duree_h, 0)} h · ${t.annee.dplus_m} m D+`} />
            <StatTile label="Régularité" color="pink" value={`${s.regularite.serie_semaines} sem.`} sub={`d'affilée · ${s.regularite.jours_actifs_28j} j actifs / 28`} />
          </div>

          <Section titre="Entraînement">
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="lg:col-span-2 min-w-0">
                <Graphe titre="Volume hebdomadaire" couleur={metrique === "charge" ? ORANGE : metrique === "km" ? CYAN : BLEU}
                  sousTitre="26 dernières semaines">
                  <Segmente className="mb-3" valeur={metrique} onChange={setMetrique}
                    options={[["heures", "Heures"], ["km", "Km à pied"], ["charge", "Charge"]]} />
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={s.semaines} margin={{ left: 0, right: 0, top: 4 }}>
                      <CartesianGrid {...grille} />
                      <XAxis dataKey="label" {...axeX} interval={3} />
                      <YAxis {...axeY} width={32} />
                      <Tooltip cursor={curseur} content={<InfoBulle />} />
                      {metrique === "heures" && sportsPresents.map((k, i) => (
                        <Bar key={k} dataKey={`h_${k}`} name={SPORTS[k].label} stackId="h" fill={SPORTS[k].couleur}
                          maxBarSize={14} radius={i === sportsPresents.length - 1 ? [4, 4, 0, 0] : 0} />
                      ))}
                      {metrique === "km" && <Bar dataKey="km_pied" name="Km course + trail" fill={CYAN} radius={[4, 4, 4, 4]} maxBarSize={14} />}
                      {metrique === "charge" && <Bar dataKey="charge" name="Charge" fill={ORANGE} radius={[4, 4, 4, 4]} maxBarSize={14} />}
                    </BarChart>
                  </ResponsiveContainer>
                  {metrique === "heures" && sportsPresents.length > 1 && (
                    <Legende items={sportsPresents.map((k) => ({ label: SPORTS[k].label, couleur: SPORTS[k].couleur }))} />
                  )}
                </Graphe>
              </div>

              <Card>
                <p className="text-[13px] font-semibold text-label-2">Charge (ACWR)</p>
                {s.charge.acwr == null ? (
                  <p className="text-[15px] text-label-2 mt-2">Pas assez de données sur 28 jours.</p>
                ) : (
                  <div className="space-y-3 mt-1">
                    <div>
                      <p className="font-rounded text-[34px] leading-10 font-bold chiffres">{nombre(s.charge.acwr, 2)}</p>
                      <span className={clsx("badge text-[12px]", {
                        blue: "bg-ios-blue/15 text-ios-blue", green: "bg-ios-green/15 text-ios-green",
                        orange: "bg-ios-orange/15 text-ios-orange", red: "bg-ios-red/15 text-ios-red",
                      }[zone?.color ?? "blue"])}>{zone?.label ?? "—"}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Tuile label="Aiguë (7 j)" value={s.charge.aigue_7j} />
                      <Tuile label="Chronique / sem." value={s.charge.chronique_hebdo} />
                    </div>
                    <p className="text-[13px] text-label-2">{zone?.txt}</p>
                    <p className="text-[12px] text-label-3">Charge = minutes × RPE (5 par défaut). Ratio 7 j / moyenne hebdo 28 j.</p>
                  </div>
                )}
              </Card>
            </div>

            <Graphe titre="Volume mensuel" couleur={BLEU} sousTitre="12 derniers mois">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={s.mois} margin={{ left: 0, right: 0, top: 4 }} barGap={2}>
                  <CartesianGrid {...grille} />
                  <XAxis dataKey="label" {...axeX} />
                  <YAxis {...axeY} width={32} />
                  <Tooltip cursor={curseur} content={<InfoBulle />} />
                  <Bar dataKey="duree_h" name="Heures" fill={BLEU} radius={[4, 4, 4, 4]} maxBarSize={12} />
                  <Bar dataKey="km_pied" name="Km à pied" fill={CYAN} radius={[4, 4, 4, 4]} maxBarSize={12} />
                </BarChart>
              </ResponsiveContainer>
              <Legende items={[{ label: "Heures", couleur: BLEU }, { label: "Km à pied", couleur: CYAN }]} />
            </Graphe>
          </Section>

          <Section titre="Course à pied">
            <div className="grid gap-3 lg:grid-cols-2">
              <Graphe titre="Allure" couleur={ORANGE} sousTitre="Tendance sur 5 sorties">
                {allures.length < 2 ? (
                  <p className="text-[15px] text-label-2">Pas encore assez de sorties course/trail avec distance.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={allures} margin={{ left: 0, right: 0, top: 4 }}>
                      <CartesianGrid {...grille} />
                      <XAxis dataKey="label" {...axeX} minTickGap={28} />
                      <YAxis {...axeY} reversed domain={["dataMin - 15", "dataMax + 15"]} width={40}
                        tickFormatter={(v) => fmtAllureSec(v).replace("/km", "")} />
                      <Tooltip cursor={{ stroke: "#8E8E93", strokeOpacity: 0.3 }} content={<InfoBulle format={(v) => fmtAllureSec(v)} />} />
                      <Line dataKey="allure_sec_km" name="Allure" stroke={ORANGE} strokeOpacity={0.3} dot={{ r: 1.5, strokeWidth: 0, fill: ORANGE, fillOpacity: 0.4 }} strokeWidth={1} />
                      <Line dataKey="tendance" name="Tendance" stroke={ORANGE} dot={false} strokeWidth={2.5} strokeLinecap="round" />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </Graphe>

              {allures.some((p) => p.efficacite) && (
                <Graphe titre="Efficacité aérobie" couleur={VERT} sousTitre="Mètres par battement · moyenne sur 5 sorties"
                  note="Plus c'est haut, plus tu vas vite pour un même effort cardiaque : signe de progrès en endurance.">
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={allures.filter((p) => p.efficacite)} margin={{ left: 0, right: 0, top: 4 }}>
                      <CartesianGrid {...grille} />
                      <XAxis dataKey="label" {...axeX} minTickGap={28} />
                      <YAxis {...axeY} domain={["auto", "auto"]} width={40} />
                      <Tooltip cursor={{ stroke: "#8E8E93", strokeOpacity: 0.3 }} content={<InfoBulle />} />
                      <Line dataKey="efficacite_moy" name="m/battement" stroke={VERT} dot={false} strokeWidth={2.5} strokeLinecap="round" />
                    </LineChart>
                  </ResponsiveContainer>
                </Graphe>
              )}
            </div>

            <Card pad={false}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-4 pb-2">
                {["5 km", "10 km", "Semi", "Marathon"].map((l) => {
                  const r = s.records.distances.find((x) => x.label === l);
                  return <Tuile key={l} label={l} value={r?.temps_str ?? "—"} sub={r ? `${r.allure_str} · ${fmtDate(r.date)}` : null} />;
                })}
              </div>
              <div className="py-1">
                {s.records.autres.map((r) => (
                  <div key={r.label} className="ligne">
                    <span className="flex-1 text-[15px]">{r.label}</span>
                    <span className="text-right">
                      <span className="block text-[15px] font-semibold chiffres">{r.valeur}</span>
                      <span className="block text-[12px] text-label-2">{fmtDate(r.date)}</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[12px] text-label-2 px-4 pb-4 pt-1">
                Records estimés à partir de l'allure moyenne des sorties proches de la distance (pas de split GPS).
              </p>
            </Card>
          </Section>

          {!sport && <FormeGraphiques />}

          <Section titre="Habitudes">
            <div className="grid gap-3 lg:grid-cols-2">
              <Card pad={false} className="py-1">
                <p className="px-4 pt-3 pb-1 text-[13px] font-semibold text-label-2">Répartition · 12 mois</p>
                {s.repartition.map((r) => {
                  const info = sportInfo(r.sport);
                  return (
                    <div key={r.sport} className="ligne flex-col !items-stretch !gap-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[15px]">{info.emoji} {r.label}</span>
                        <span className="text-[13px] text-label-2 chiffres">
                          {r.nb} · {nombre(r.duree_h)} h{r.distance_km ? ` · ${nombre(r.distance_km, 0)} km` : ""}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-remplissage overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(100 * r.duree_h) / maxRep}%`, backgroundColor: info.couleur }} />
                      </div>
                    </div>
                  );
                })}
              </Card>

              <div className="space-y-3 min-w-0">
                <Card>
                  <p className="text-[13px] font-semibold text-ios-green mb-3">Calendrier · 12 mois</p>
                  <Heatmap calendrier={s.regularite.calendrier} />
                </Card>

                <Card pad={false} className="py-1">
                  {[["7 jours", t["7j"]], ["28 jours", t["28j"]], ["Année", t.annee], ["Depuis le début", t.total]].map(([l, x]) => (
                    <div key={l} className="ligne">
                      <span className="flex-1 text-[15px]">{l}</span>
                      <span className="text-right">
                        <span className="block text-[15px] font-semibold chiffres">{x.nb} séances · {nombre(x.duree_h)} h</span>
                        <span className="block text-[12px] text-label-2 chiffres">{nombre(x.distance_km)} km · {x.dplus_m} m D+</span>
                      </span>
                    </div>
                  ))}
                </Card>
              </div>
            </div>
          </Section>
        </>
      )}
    </Page>
  );
}
