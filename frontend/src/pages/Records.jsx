import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import clsx from "clsx";
import Card from "../components/Card";
import Page from "../components/Page";
import { Section, Segmente } from "../components/ui";
import { axeX, axeY, grille, InfoBulle, GRIS } from "../components/graphiques";
import { getRecords, getSegment, getSegments, renommerSegment, supprimerSegment } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";
import Feuille from "../components/Feuille";
import { SPORTS, fmtDate, nombre } from "../carnet";

const ORANGE = "#FF9500";
const VIOLET = "#AF52DE";

const court = (iso) => fmtDate(iso, { day: "numeric", month: "short" });
const hms = (s) => {
  if (s == null) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.round(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};
const serie = (s) => (s ? `${Math.round(s.reps)} rép.${s.kg ? ` @ ${nombre(s.kg, 1)} kg` : ""}` : "—");

// Gain entre le premier et le dernier record de la liste (en secondes)
function gain(liste) {
  if (!liste || liste.length < 2) return null;
  return liste[0].temps_sec - liste[liste.length - 1].temps_sec;
}

function Course({ c }) {
  const dispo = c.distances.filter((d) => c.records[d]);
  const [dist, setDist] = useState(dispo[0] ?? c.distances[0]);
  if (!dispo.length) {
    return (
      <Card>
        <p className="text-[15px] text-label-2 text-center py-4">
          Aucun record pour l'instant : ils sont calculés à partir des traces GPS de tes sorties à pied.
        </p>
      </Card>
    );
  }
  const hist = c.historique[dist] ?? [];
  const g = gain(hist);
  const donnees = hist.map((h) => ({ date: court(h.date), temps: h.temps_sec }));

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {c.distances.map((d) => {
          const r = c.records[d];
          return (
            <button key={d} type="button" onClick={() => r && setDist(d)} disabled={!r}
              className={clsx("card p-4 text-left min-w-0 transition active:opacity-70",
                dist === d && r && "ring-2 ring-[#FF9500]")}>
              <p className="text-[13px] font-semibold" style={{ color: r ? ORANGE : GRIS }}>{d}</p>
              <p className="font-rounded text-[24px] leading-8 font-bold tracking-[-0.02em] chiffres">
                {r ? hms(r.temps_sec) : <span className="text-label-3">—</span>}
              </p>
              <p className="text-[12px] text-label-2 truncate">
                {r ? `${r.allure_str} · ${court(r.date)}` : "pas encore couru"}
              </p>
            </button>
          );
        })}
      </div>

      {hist.length > 0 && (
        <Card>
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: ORANGE }}>Progression · {dist}</p>
              <p className="text-[13px] text-label-2">
                {hist.length} record{hist.length > 1 ? "s" : ""} successif{hist.length > 1 ? "s" : ""}
                {g > 0 ? ` · ${hms(g)} gagnées` : ""}
              </p>
            </div>
          </div>
          {donnees.length > 1 && (
            <div className="h-44 -ml-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={donnees} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...grille} />
                  <XAxis dataKey="date" {...axeX} />
                  <YAxis {...axeY} reversed domain={["dataMin - 10", "dataMax + 10"]} tickFormatter={hms} width={48} />
                  <Tooltip content={<InfoBulle format={hms} />} />
                  <Line type="stepAfter" dataKey="temps" name="Record" stroke={ORANGE} strokeWidth={2.5}
                    dot={{ r: 3, fill: ORANGE }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mt-2 divide-y-[0.5px] divide-separateur">
            {[...hist].reverse().map((h, i) => (
              <div key={`${h.activite_id}-${i}`} className="flex items-center gap-3 py-2">
                <span className="w-16 shrink-0 text-[13px] text-label-2">{court(h.date)}</span>
                <span className="flex-1 min-w-0 text-[15px] truncate">{h.titre || "Sortie"}</span>
                <span className="text-[13px] text-label-2 chiffres">{h.allure_str}</span>
                <span className={clsx("w-16 text-right font-semibold chiffres", i === 0 && "text-[#FF9500]")}>{hms(h.temps_sec)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function Muscu({ m }) {
  const [vue, setVue] = useState("serie");
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4 min-w-0">
          <p className="text-[13px] font-semibold" style={{ color: VIOLET }}>Plus longue séance</p>
          <p className="font-rounded text-[24px] leading-8 font-bold chiffres">{m.plus_longue?.duree_str ?? "—"}</p>
          <p className="text-[12px] text-label-2 truncate">
            {m.plus_longue ? `${m.plus_longue.titre || "Muscu"} · ${court(m.plus_longue.date)}` : "aucune séance"}
          </p>
        </div>
        <div className="card p-4 min-w-0">
          <p className="text-[13px] font-semibold" style={{ color: VIOLET }}>Meilleure semaine</p>
          <p className="font-rounded text-[24px] leading-8 font-bold chiffres">
            {m.meilleure_semaine ? `${m.meilleure_semaine.seances} séances` : "—"}
          </p>
          <p className="text-[12px] text-label-2 truncate">
            {m.meilleure_semaine ? `semaine du ${court(m.meilleure_semaine.semaine)}` : `${m.nb_seances} séances au total`}
          </p>
        </div>
      </div>

      {m.exercices.length === 0 ? (
        <Card>
          <p className="text-[15px] text-label-2">
            Aucun exercice reconnu dans tes notes de muscu. Note tes séries comme ceci pour suivre tes records :
          </p>
          <p className="mt-2 text-[15px] font-semibold">« Dips 4x8 », « Curl 3x10 @ 10 kg », « 9 tractions »</p>
        </Card>
      ) : (
        <Card pad={false}>
          <div className="p-4 pb-2">
            <Segmente valeur={vue} onChange={setVue}
              options={[["serie", "Meilleure série"], ["volume", "Volume"], ["rm", "1RM estimé"]]} />
          </div>
          <div className="divide-y-[0.5px] divide-separateur">
            {m.exercices.map((e) => {
              const b = vue === "serie" ? e.meilleure_serie : vue === "volume" ? e.meilleur_volume : e.rm_estime;
              const prog = e.progression;
              const avant = prog.length > 1 ? prog[0] : null;
              const fin = prog[prog.length - 1];
              return (
                <div key={e.nom} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-[17px] truncate">{e.nom}</p>
                    <p className="text-[12px] text-label-2 truncate">
                      {e.nb} séance{e.nb > 1 ? "s" : ""}
                      {avant && fin ? ` · ${serie(avant)} → ${serie(fin)}` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold chiffres">
                      {!b ? <span className="text-label-3">—</span>
                        : vue === "serie" ? serie(b)
                        : vue === "volume" ? `${b.series} × ${b.reps}${b.kg ? ` @ ${nombre(b.kg, 1)} kg` : ""}`
                        : `${nombre(b.kg, 1)} kg`}
                    </p>
                    <p className="text-[12px] text-label-2">{b ? court(b.date) : vue === "rm" ? "sans charge" : ""}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
      <p className="px-1 text-[12px] text-label-2">
        Lu dans les notes de tes séances ({m.nb_notees} / {m.nb_seances} séances notées). Format reconnu : « Dips 4x8 »,
        « Curl 3x10 @ 10 kg », « 9 tractions ».
      </p>
    </>
  );
}

// Segments personnels : créés depuis la fiche d'une séance, retrouvés sur toutes les sorties
const longueur = (m) => (m >= 1000 ? `${nombre(m / 1000, 2)} km` : `${Math.round(m)} m`);
const MEDAILLES = ["🥇", "🥈", "🥉"];

function DetailSegment({ id, onClose }) {
  const qc = useQueryClient();
  const { data: d } = useQuery({ queryKey: ["segment", id], queryFn: () => getSegment(id), staleTime: 60_000 });
  const [nom, setNom] = useState(null);
  const [suppr, setSuppr] = useState(false);
  const maj = () => { qc.invalidateQueries({ queryKey: ["segments"] }); qc.invalidateQueries({ queryKey: ["segment", id] }); qc.invalidateQueries({ queryKey: ["segments-activite"] }); };
  const renommer = useMutation({ mutationFn: () => renommerSegment(id, nom.trim()), onSuccess: () => { maj(); setNom(null); } });
  const effacer = useMutation({ mutationFn: () => supprimerSegment(id), onSuccess: () => { maj(); onClose(); } });
  const rec = d?.record?.duree_sec;

  return (
    <Feuille titre={d?.nom ?? "Segment"} onClose={onClose}>
      {!d ? <p className="text-[15px] text-label-2 text-center py-6">Recherche des passages…</p> : (
        <>
          <p className="text-[15px] text-label-2 text-center chiffres">
            {SPORTS[d.sport]?.emoji} {longueur(d.distance_m)}{d.dplus_m ? ` · D+ ${Math.round(d.dplus_m)} m` : ""} · {d.nb_passages} passage{d.nb_passages > 1 ? "s" : ""}
          </p>
          <div className="card py-0.5 overflow-hidden">
            {d.passages.length === 0 && <p className="ligne text-[15px] text-label-2">Aucun passage retrouvé.</p>}
            {d.passages.map((p, i) => (
              <div key={p.activite_id} className="ligne">
                <span className="w-7 text-center text-[15px] chiffres text-label-2">{MEDAILLES[i] ?? i + 1}</span>
                <span className="flex-1 text-[15px]">{fmtDate(p.date)}</span>
                <span className="text-[13px] text-label-2 chiffres">{nombre(p.vitesse_kmh, 1)} km/h</span>
                <span className="w-16 text-right font-semibold chiffres">{hms(p.duree_sec)}</span>
                <span className="w-12 text-right text-[12px] text-label-2 chiffres">{i && rec ? `+${hms(p.duree_sec - rec)}` : ""}</span>
              </div>
            ))}
          </div>
          {nom == null ? (
            <button className="btn-gris w-full" onClick={() => setNom(d.nom)}>Renommer</button>
          ) : (
            <div className="flex gap-2">
              <input className="champ flex-1" maxLength={120} value={nom} onChange={(e) => setNom(e.target.value)} autoFocus />
              <button className="btn-primaire" disabled={!nom.trim() || renommer.isPending} onClick={() => renommer.mutate()}>OK</button>
            </div>
          )}
          <button className="btn-texte text-ios-red w-full justify-center text-center" onClick={() => setSuppr(true)}>Supprimer le segment</button>
        </>
      )}
      <ConfirmDialog open={suppr} title="Supprimer ce segment ?" danger confirmLabel="Supprimer" pending={effacer.isPending}
        message="Les séances ne changent pas ; seul le classement de ce segment disparaît."
        onConfirm={() => effacer.mutate()} onCancel={() => setSuppr(false)} />
    </Feuille>
  );
}

function Segments() {
  const { data } = useQuery({ queryKey: ["segments"], queryFn: getSegments, staleTime: 5 * 60_000 });
  const [ouvert, setOuvert] = useState(null);
  if (!data) return null;
  return (
    <Section titre="Segments">
      <Card pad={false}>
        {data.length === 0 ? (
          <p className="text-[15px] text-label-2 text-center px-4 py-5">
            Aucun segment : depuis la fiche d'une sortie avec trace GPS, choisis un départ et une arrivée pour créer le tien
            (une côte, un tour de parc…). Tous tes passages y seront classés.
          </p>
        ) : (
          <div className="divide-y-[0.5px] divide-separateur">
            {data.map((sg) => (
              <button key={sg.id} type="button" onClick={() => setOuvert(sg.id)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left active:bg-remplissage">
                <span className="text-[20px]" aria-hidden>{SPORTS[sg.sport]?.emoji ?? "📍"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[17px] truncate">{sg.nom}</p>
                  <p className="text-[12px] text-label-2 chiffres">
                    {longueur(sg.distance_m)}{sg.dplus_m ? ` · D+ ${Math.round(sg.dplus_m)} m` : ""} · {sg.nb_passages} passage{sg.nb_passages > 1 ? "s" : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold chiffres">{sg.record ? hms(sg.record.duree_sec) : "—"}</p>
                  {sg.record && <p className="text-[12px] text-label-2">{court(sg.record.date)}</p>}
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>
      {ouvert && <DetailSegment id={ouvert} onClose={() => setOuvert(null)} />}
    </Section>
  );
}

// Accès au bilan : mis en avant en décembre, discret le reste de l'année
function EntreeBilan() {
  const auj = new Date();
  const decembre = auj.getMonth() === 11;
  const annee = auj.getFullYear();
  if (decembre) {
    return (
      <Link to="/bilan" className="block rounded-[20px] text-white px-5 py-4 active:opacity-80 transition"
        style={{ background: "linear-gradient(135deg, #0a84ff, #5e5ce6)" }}>
        <p className="text-[13px] font-semibold uppercase tracking-[0.06em] opacity-80">C'est l'heure du bilan</p>
        <p className="text-[22px] font-bold">Bilan {annee} →</p>
        <p className="text-[14px] opacity-90">Kilomètres, records, régularité et sorties marquantes de l'année.</p>
      </Link>
    );
  }
  return (
    <Link to="/bilan" className="card flex items-center gap-3 px-4 py-3 active:opacity-70 transition">
      <span className="w-[30px] h-[30px] rounded-[8px] grid place-items-center text-[16px] shrink-0"
        style={{ background: "linear-gradient(135deg, #0a84ff, #5e5ce6)" }}>📅</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[17px]">Bilan de l'année</span>
        <span className="block text-[13px] text-label-2">{annee} en cours et années passées</span>
      </span>
      <svg viewBox="0 0 24 24" className="w-4 h-4 text-label-3" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

export default function Records() {
  const { data: r, isLoading } = useQuery({ queryKey: ["records"], queryFn: getRecords, staleTime: 5 * 60_000 });

  return (
    <Page titre="Records" large>
      {isLoading || !r ? (
        <p className="text-[15px] text-label-2">Chargement…</p>
      ) : (
        <div className="space-y-7">
          <EntreeBilan />

          <Section titre="Course à pied">
            <Course c={r.course} />
          </Section>

          <Segments />

          {r.officiels.length > 0 && (
            <Section titre="Sorties complètes">
              <Card pad={false}>
                <div className="divide-y-[0.5px] divide-separateur">
                  {r.officiels.map((o, i) => (
                    <div key={`${o.label}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="flex-1 min-w-0 text-[17px] truncate">{o.label}</span>
                      <span className="text-[13px] text-label-2">{o.allure_str} · {court(o.date)}</span>
                      <span className="font-semibold chiffres">{o.temps_str}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </Section>
          )}

          {r.autres.length > 0 && (
            <Section titre="Autres records">
              <Card pad={false}>
                <div className="divide-y-[0.5px] divide-separateur">
                  {r.autres.map((o, i) => (
                    <div key={`${o.label}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-[17px] truncate">{o.label}</p>
                        {o.date && <p className="text-[12px] text-label-2">{court(o.date)}</p>}
                      </div>
                      <span className="font-semibold chiffres">{o.valeur}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </Section>
          )}

          <Section titre="Musculation">
            <Muscu m={r.muscu} />
          </Section>
        </div>
      )}
    </Page>
  );
}
