import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import Page from "../components/Page";
import StatTile from "../components/StatTile";
import { Section, Squelettes } from "../components/ui";
import { getSanteCarnet, ecarterDesCalculs, reintegrerDansCalculs, creerSauvegarde, telechargerSauvegarde } from "../api";
import { fmtDate, sportInfo, nombre } from "../carnet";

// Santé du carnet : ce qui est bien arrivé, ce qui paraît faux, ce qui est tenu à l'écart des calculs,
// pourquoi un repère a bougé, et les sauvegardes. Rien n'est jamais supprimé d'ici.

const CLES = ["sante-carnet", "exclusions", "analyses", "alertes"];
const jourCourt = (iso) => fmtDate(iso, { day: "numeric", month: "short" });
const jourLong = (iso) => fmtDate(iso, { day: "numeric", month: "long" });

function ilYA(iso) {
  if (!iso) return "Jamais";
  const j = Math.floor((Date.now() - new Date(iso.length === 10 ? `${iso}T12:00` : iso).getTime()) / 86400000);
  return j <= 0 ? "Aujourd’hui" : j === 1 ? "Hier" : `Il y a ${j} j`;
}

function taille(octets) {
  if (octets == null) return "—";
  return octets < 1024 * 1024 ? `${Math.max(1, Math.round(octets / 1024))} Ko` : `${nombre(octets / 1024 / 1024, 1)} Mo`;
}

function valeurRepere(v, unite) {
  if (v == null) return "—";
  if (unite === "s/km") {
    const m = Math.floor(v / 60), s = Math.round(v % 60);
    return `${m}:${String(s).padStart(2, "0")} /km`;
  }
  return `${nombre(v, Number.isInteger(v) ? 0 : 1)}${unite ? ` ${unite}` : ""}`;
}

function joursEntre(du, au) {
  const jours = [];
  const d = new Date(`${du}T12:00`), fin = new Date(`${au}T12:00`);
  for (; d <= fin && jours.length < 62; d.setDate(d.getDate() + 1)) jours.push(d.toISOString().slice(0, 10));
  return jours;
}

// ── Reçu sur 30 jours ───────────────────────────────────────────────────────

function Recu({ r, jours }) {
  const manquants = new Set(r.manquants);
  const complet = r.jours >= r.sur;
  return (
    <div className="card p-4 min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[16px] font-semibold truncate min-w-0">{r.label}</h3>
        <p className={clsx("text-[15px] font-semibold chiffres shrink-0", !r.suivi ? "text-label-3" : complet ? "text-ios-green" : "text-ios-orange")}>
          {r.suivi ? `${r.jours} / ${r.sur} j` : "Non suivi"}
        </p>
      </div>
      <div className="mt-3 flex gap-[2px]" role="img"
        aria-label={r.suivi ? `${r.label} : ${r.jours} jours reçus sur ${r.sur}` : `${r.label} : aucune donnée reçue`}>
        {jours.map((j) => (
          <span key={j} title={`${jourCourt(j)}${manquants.has(j) ? " : rien reçu" : ""}`}
            className={clsx("h-5 flex-1 rounded-[3px]", !r.suivi ? "bg-remplissage" : manquants.has(j) ? "bg-ios-orange" : "bg-ios-green/70")} />
        ))}
      </div>
      <p className="mt-2.5 text-[13px] leading-[18px] text-label-2">
        {!r.suivi ? "Aucune donnée de ce type sur la période."
          : complet ? `Rien ne manque. Dernière donnée : ${jourLong(r.dernier)}.`
            : `${r.manquants.length > 6 ? `${r.manquants.length} jours sans donnée, dont` : r.manquants.length > 1 ? "Jours sans donnée :" : "Jour sans donnée :"} ${r.manquants.slice(-6).map(jourLong).join(", ")}.`}
      </p>
    </div>
  );
}

// ── À vérifier ──────────────────────────────────────────────────────────────

function Anomalie({ a, onEcarter, enCours }) {
  const sport = a.sport ? sportInfo(a.sport) : null;
  return (
    <article className="card p-4 flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold uppercase tracking-[0.02em] text-ios-orange">
          {a.genre === "activite" ? (sport?.label ?? "Séance") : "Mesure"} · {fmtDate(a.jour)}
        </p>
        <h3 className="text-[17px] leading-[22px] font-semibold mt-0.5 break-words">{a.titre}</h3>
        <ul className="mt-1.5 space-y-1">
          {a.problemes.map((p) => <li key={p.code} className="text-[15px] leading-5 text-label-2">{p.texte}</li>)}
        </ul>
      </div>
      <button type="button" className="btn-teinte btn-sm shrink-0 self-start" disabled={enCours} onClick={() => onEcarter(a)}>
        Écarter des calculs
      </button>
    </article>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function SanteCarnet() {
  const qc = useQueryClient();
  const [message, setMessage] = useState(null);
  const { data, isLoading, isError } = useQuery({ queryKey: ["sante-carnet"], queryFn: getSanteCarnet, staleTime: 60000 });
  const rafraichir = () => CLES.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const erreur = (e) => setMessage(e?.response?.data?.detail ?? "Action impossible pour le moment.");

  const ecarter = useMutation({
    mutationFn: (a) => ecarterDesCalculs(a.activite_id ? { activite_id: a.activite_id, raison: a.problemes?.[0]?.texte }
      : { type_mesure: a.type_mesure, jour: a.jour, raison: a.problemes?.[0]?.texte }),
    onSuccess: () => { setMessage(null); rafraichir(); }, onError: erreur,
  });
  const reintegrer = useMutation({ mutationFn: reintegrerDansCalculs, onSuccess: () => { setMessage(null); rafraichir(); }, onError: erreur });
  const sauvegarder = useMutation({
    mutationFn: creerSauvegarde,
    onSuccess: () => { setMessage(null); qc.invalidateQueries({ queryKey: ["sante-carnet"] }); }, onError: erreur,
  });

  async function telecharger(s) {
    try {
      const blob = await telechargerSauvegarde(s.id);
      const url = URL.createObjectURL(blob);
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = `carnet-sauvegarde-${s.cree_le.slice(0, 10)}.json`;
      document.body.appendChild(lien);
      lien.click();
      lien.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { erreur(e); }
  }

  if (isLoading) return <Page titre="Santé du carnet" sousTitre="Qualité des données"><Squelettes forme="page" n={2} /></Page>;
  if (isError || !data) {
    return (
      <Page titre="Santé du carnet" sousTitre="Qualité des données">
        <p className="card p-6 text-center text-[15px] text-label-2">Indisponible pour le moment. Réessaie dans un instant.</p>
      </Page>
    );
  }

  const s = data.synchros;
  const jours = joursEntre(s.du, s.au);
  const sauvegardes = data.sauvegardes.liste;
  const nbAnomalies = data.anomalies.total;
  const partielles = data.couverture.filter((c) => c.partielle);
  const resume = nbAnomalies ? `${nbAnomalies} donnée${nbAnomalies > 1 ? "s" : ""} à vérifier` : "Rien à signaler";

  return (
    <Page titre="Santé du carnet" sousTitre={resume}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Dernière synchro" color={s.intervals.connecte ? "blue" : "gray"}
          value={s.intervals.connecte ? ilYA(s.intervals.derniere_synchro) : "Non reliée"}
          sub={s.intervals.connecte ? (s.intervals.derniere_synchro ? fmtDate(s.intervals.derniere_synchro) : "Intervals.icu") : "Intervals.icu"} />
        <StatTile label="Séances sur 30 j" color="green" value={s.seances.jours_30}
          sub={s.seances.derniere ? `Dernière : ${jourCourt(s.seances.derniere)}` : "Aucune"} />
        <StatTile label="Pesées sur 30 j" color="purple" value={s.pesees.jours_30}
          sub={s.pesees.derniere ? `Dernière : ${jourCourt(s.pesees.derniere)}` : "Aucune"} />
        <StatTile label="Dernière sauvegarde" color={sauvegardes.length ? "blue" : "orange"}
          value={sauvegardes.length ? ilYA(sauvegardes[0].cree_le) : "Aucune"}
          sub={sauvegardes.length ? `${sauvegardes.length} gardée${sauvegardes.length > 1 ? "s" : ""}` : "Voir plus bas"} />
      </div>

      {message && <p role="alert" className="card p-4 text-[15px] text-ios-red">{message}</p>}

      <Section titre="Reçu sur 30 jours">
        <div className="grid gap-3 md:grid-cols-2">
          {s.recus.map((r) => <Recu key={r.cle} r={r} jours={jours} />)}
        </div>
        <p className="mt-2 px-1 text-[13px] leading-[18px] text-label-2">
          Du {jourLong(s.du)} au {jourLong(s.au)}. Une case orange est un jour où rien n’est arrivé : montre non portée, ou synchro manquée.
        </p>
      </Section>

      <Section titre="À vérifier">
        {nbAnomalies ? (
          <div className="grid gap-3 2xl:grid-cols-2">
            {data.anomalies.liste.map((a) => (
              <Anomalie key={`${a.genre}-${a.activite_id ?? a.type_mesure}-${a.jour}`} a={a} enCours={ecarter.isPending} onEcarter={ecarter.mutate} />
            ))}
          </div>
        ) : (
          <p className="card p-5 text-[15px] leading-5 text-label-2">
            Aucune donnée ne paraît fausse : pas de pic de fréquence cardiaque impossible, de saut de GPS, de doublon ni de nuit tronquée.
          </p>
        )}
        <p className="mt-2 px-1 text-[13px] leading-[18px] text-label-2">
          Écarter une donnée la retire des analyses sans la supprimer ni la modifier. Tu peux la réintégrer à tout moment.
        </p>
      </Section>

      {data.exclusions.length > 0 && (
        <Section titre="Écartés des calculs">
          <div className="card overflow-hidden">
            {data.exclusions.map((e) => (
              <div key={e.id} className="ligne" style={{ "--inset": "16px" }}>
                <div className="flex-1 min-w-0">
                  <p className="text-[16px] truncate">{e.titre}</p>
                  <p className="text-[13px] leading-[18px] text-label-2 line-clamp-2">{fmtDate(e.jour)}{e.raison ? ` · ${e.raison}` : ""}</p>
                </div>
                <button type="button" className="btn-gris btn-sm shrink-0" disabled={reintegrer.isPending} onClick={() => reintegrer.mutate(e.id)}>
                  Réintégrer
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section titre="Historique par année">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.couverture.map((c) => (
            <div key={c.annee} className="card p-4 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-rounded text-[20px] font-bold chiffres">{c.annee}</h3>
                {c.partielle && <span className="badge bg-ios-orange/[0.16] text-ios-orange">Données partielles</span>}
              </div>
              <p className="text-[13px] text-label-2 mt-0.5">{c.seances} séance{c.seances > 1 ? "s" : ""} d’endurance</p>
              <dl className="mt-3 space-y-2">
                {[["Fréquence cardiaque", c.avec_fc], ["Tracé GPS", c.avec_trace], ["Détail seconde par seconde", c.avec_flux]].map(([nom, n]) => (
                  <div key={nom}>
                    <div className="flex justify-between gap-2 text-[13px]">
                      <dt className="text-label-2 truncate min-w-0">{nom}</dt>
                      <dd className="chiffres font-medium shrink-0">{n}</dd>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-remplissage overflow-hidden">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${c.seances ? Math.round((n / c.seances) * 100) : 0}%` }} />
                    </div>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        {partielles.length > 0 && (
          <p className="mt-2 px-1 text-[13px] leading-[18px] text-label-2">
            Données partielles : la plupart des séances d’endurance de l’année n’ont pas le détail seconde par seconde. La courbe d’allure, la
            dérive cardiaque et la durabilité de ces années reposent sur peu de séances. Tu peux compléter une sortie en important son tracé GPX
            depuis <Link to="/sources" className="text-brand font-medium">Sources et import</Link> ; les fichiers FIT ne sont pas pris en charge.
          </p>
        )}
      </Section>

      <Section titre="Journal des recalculs">
        {data.journal.length ? (
          <div className="card overflow-hidden">
            {data.journal.map((l) => (
              <div key={l.id} className="ligne items-start" style={{ "--inset": "16px" }}>
                <div className="flex-1 min-w-0 py-0.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-[16px] font-medium">{l.label}</p>
                    <p className="text-[13px] text-label-2">{fmtDate(l.jour)}</p>
                  </div>
                  <p className="text-[15px] chiffres mt-0.5">
                    {l.ancienne != null && <><span className="text-label-2">{valeurRepere(l.ancienne, l.unite)}</span> <span aria-hidden>→</span> </>}
                    <span className="font-semibold">{valeurRepere(l.nouvelle, l.unite)}</span>
                  </p>
                  {l.cause && <p className="text-[13px] leading-[18px] text-label-2 mt-0.5">{l.cause}</p>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="card p-5 text-[15px] leading-5 text-label-2">
            Rien pour l’instant. Chaque fois que ta VMA, ton allure critique ou ta FC au seuil changera, la date et la raison seront notées ici.
          </p>
        )}
      </Section>

      <Section titre="Sauvegardes"
        action={<button type="button" className="btn-teinte btn-sm" disabled={sauvegarder.isPending} onClick={() => sauvegarder.mutate()}>
          {sauvegarder.isPending ? "Sauvegarde…" : <>Sauvegarder<span className="hidden sm:inline"> maintenant</span></>}
        </button>}>
        {sauvegardes.length ? (
          <div className="card overflow-hidden">
            {sauvegardes.map((sv) => (
              <div key={sv.id} className="ligne" style={{ "--inset": "16px" }}>
                <div className="flex-1 min-w-0">
                  <p className="text-[16px] truncate">{fmtDate(sv.cree_le)}</p>
                  <p className="text-[13px] leading-[18px] text-label-2">
                    {sv.origine === "manuel" ? "À la demande" : "Automatique"} · {taille(sv.taille)}
                    {sv.resume?.activites != null ? ` · ${sv.resume.activites} séances` : ""}
                  </p>
                </div>
                <button type="button" className="btn-gris btn-sm shrink-0" onClick={() => telecharger(sv)}>Télécharger</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="card p-5 text-[15px] leading-5 text-label-2">Aucune sauvegarde pour l’instant. La première se fera à la prochaine synchro du matin.</p>
        )}
        <p className="mt-2 px-1 text-[13px] leading-[18px] text-label-2">
          Une sauvegarde est faite tous les {data.sauvegardes.intervalle_jours} jours et les {data.sauvegardes.gardees} dernières sont gardées. Elles
          protègent d’une fausse manœuvre, pas de la perte de la base elle-même : télécharge-en une de temps en temps pour en garder une copie chez toi.
          Les tracés GPS détaillés et tes clés de connexion n’y figurent pas.
        </p>
      </Section>
    </Page>
  );
}
