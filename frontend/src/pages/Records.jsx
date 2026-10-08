import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import clsx from "clsx";
import Card from "../components/Card";
import Page from "../components/Page";
import { Section, Segmente } from "../components/ui";
import { axeX, axeY, grille, InfoBulle, GRIS } from "../components/graphiques";
import { getRecords } from "../api";
import { fmtDate, nombre } from "../carnet";

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

export default function Records() {
  const { data: r, isLoading } = useQuery({ queryKey: ["records"], queryFn: getRecords, staleTime: 5 * 60_000 });

  return (
    <Page titre="Records" large>
      {isLoading || !r ? (
        <p className="text-[15px] text-label-2">Chargement…</p>
      ) : (
        <div className="space-y-7">
          <Section titre="Course à pied">
            <Course c={r.course} />
          </Section>

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
