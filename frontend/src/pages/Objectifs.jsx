import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import Card from "../components/Card";
import Page from "../components/Page";
import Feuille from "../components/Feuille";
import ConfirmDialog from "../components/ConfirmDialog";
import { BoutonAjout, Segmente } from "../components/ui";
import { getObjectifs, creerObjectif, modifierObjectif, supprimerObjectif } from "../api";
import {
  SPORTS, sportInfo, fmtDate, fmtDuree, parseDuree, dureeVersTexte, nombre, inputCls,
} from "../carnet";

const METRIQUES = {
  distance_km: "Distance cumulée (km)",
  duree_h: "Temps cumulé (h)",
  dplus_m: "Dénivelé cumulé (m D+)",
  nb_seances: "Nombre de séances",
  valeur_libre: "Valeur libre (saisie manuelle)",
};

const DISTANCES = [["5 km", 5], ["10 km", 10], ["Semi", 21.0975], ["Marathon", 42.195]];

// Jauge façon anneaux d'activité : piste grise, remplissage vert
function Barre({ pct, repere }) {
  return (
    <div className="relative h-2 rounded-full bg-remplissage overflow-hidden">
      <div className="h-full rounded-full bg-ios-green transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      {repere != null && (
        <div className="absolute -top-0.5 -bottom-0.5 w-[2px] rounded-full bg-label/50"
          style={{ left: `${Math.min(100, Math.max(0, repere))}%` }} title="Attendu à date" />
      )}
    </div>
  );
}

function Tuile({ label, value, sub, ton }) {
  return (
    <div className="tuile px-3 py-2.5 min-w-0">
      <p className="text-[12px] text-label-2 truncate">{label}</p>
      <p className={clsx("font-rounded text-[17px] font-bold chiffres truncate",
        ton === "bon" ? "text-ios-green" : ton === "mauvais" ? "text-ios-orange" : "text-label")}>{value}</p>
      {sub && <p className="text-[11px] text-label-2 truncate">{sub}</p>}
    </div>
  );
}

export function ObjectifCarte({ o, onEdit, compact = false }) {
  const j = o.jours_restants;
  const echeance = o.date_cible
    ? j > 0 ? `J-${j}` : j === 0 ? "Aujourd'hui" : `il y a ${-j} j`
    : null;

  return (
    <div className={clsx("card p-4 space-y-3", o.statut !== "actif" && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={clsx("text-[13px] font-semibold", o.type === "course" ? "text-ios-orange" : "text-ios-green")}>
            {o.type === "course" ? "Course" : "Défi"}
            <span className="font-normal text-label-2">
              {o.sport ? ` · ${sportInfo(o.sport).label}` : ""}
              {o.date_cible ? ` · ${fmtDate(o.date_cible)}` : ""}
            </span>
          </p>
          <h3 className="text-[17px] font-semibold truncate">{o.titre}</h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {o.statut === "atteint" && <span className="badge bg-ios-green/15 text-ios-green">Atteint</span>}
          {o.statut === "abandonne" && <span className="badge bg-remplissage text-label-2">Abandonné</span>}
          {o.statut === "actif" && echeance && (
            <span className="badge bg-brand/[0.12] text-brand text-[12px] chiffres">{echeance}</span>
          )}
          {onEdit && <button onClick={() => onEdit(o)} className="btn-texte text-[15px]">Modifier</button>}
        </div>
      </div>

      {o.type === "course" ? (
        <div className={clsx("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
          <Tuile label="Distance" value={o.distance_km ? `${nombre(o.distance_km, 2)} km` : "—"} sub={o.dplus_m ? `${o.dplus_m} m D+` : null} />
          <Tuile label="Objectif" value={o.temps_cible_sec ? o.temps_cible_str : "—"} sub={o.allure_cible_str} />
          <Tuile label="Prédiction"
            value={o.prediction?.temps_str ?? "—"}
            sub={o.prediction ? `base : ${o.prediction.base}` : "Pas assez de sorties ≥ 3 km"}
            ton={o.ecart_sec == null ? null : o.ecart_sec <= 0 ? "bon" : "mauvais"} />
          <Tuile label="Écart"
            value={o.ecart_sec == null ? "—" : `${o.ecart_sec <= 0 ? "−" : "+"}${fmtDuree(Math.abs(o.ecart_sec))}`}
            ton={o.ecart_sec == null ? null : o.ecart_sec <= 0 ? "bon" : "mauvais"} />
          {!compact && (
            <>
              <Tuile label="Volume à pied (4 sem.)" value={`${nombre(o.km_hebdo_4sem)} km/sem`} />
              <Tuile label="Plus longue sortie" value={o.plus_longue_4sem_km ? `${nombre(o.plus_longue_4sem_km)} km` : "—"} sub="4 dernières semaines" />
              {o.resultat_temps_sec && <Tuile label="Résultat" value={o.resultat_temps_str} ton="bon" />}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="font-rounded text-[22px] font-bold chiffres">
              {nombre(o.valeur_actuelle)}
              <span className="text-[15px] font-semibold text-label-2">
                {o.valeur_cible ? ` / ${nombre(o.valeur_cible)}` : ""} {o.unite ?? ""}
              </span>
            </span>
            {o.pourcentage != null && <span className="text-[15px] font-semibold text-ios-green chiffres">{nombre(o.pourcentage, 0)} %</span>}
          </div>
          {o.valeur_cible ? (
            <Barre pct={o.pourcentage ?? 0}
              repere={o.attendu_a_date != null ? (100 * o.attendu_a_date) / o.valeur_cible : null} />
          ) : null}
          {o.projection != null && (
            <p className="text-[13px] text-label-2">
              Attendu à date : {nombre(o.attendu_a_date)} {o.unite} · Projection :{" "}
              <span className={clsx("font-semibold", o.projection >= o.valeur_cible ? "text-ios-green" : "text-ios-orange")}>
                {nombre(o.projection)} {o.unite}
              </span>
            </p>
          )}
        </div>
      )}

      {!compact && o.notes && <p className="text-[13px] text-label-2 whitespace-pre-line">{o.notes}</p>}
      {!compact && o.url && (
        <a href={o.url} target="_blank" rel="noreferrer" className="btn-texte text-[15px]">Page de la course ↗</a>
      )}
    </div>
  );
}

function L({ label, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="libelle">{label}</span>
      {children}
    </label>
  );
}

function ModalObjectif({ objectif, onClose }) {
  const qc = useQueryClient();
  const [f, setF] = useState(() => ({
    type: objectif?.type ?? "course",
    titre: objectif?.titre ?? "",
    sport: objectif?.sport ?? (objectif ? "" : "course"),
    date_cible: objectif?.date_cible ?? "",
    date_debut: objectif?.date_debut ?? new Date().toISOString().slice(0, 10),
    distance_km: objectif?.distance_km ?? "",
    dplus_m: objectif?.dplus_m ?? "",
    temps_cible: dureeVersTexte(objectif?.temps_cible_sec),
    url: objectif?.url ?? "",
    metrique: objectif?.metrique ?? "distance_km",
    valeur_cible: objectif?.valeur_cible ?? "",
    valeur_actuelle: objectif?.valeur_actuelle_saisie ?? "",
    unite: objectif?.metrique === "valeur_libre" ? (objectif?.unite ?? "") : "",
    statut: objectif?.statut ?? "actif",
    resultat: dureeVersTexte(objectif?.resultat_temps_sec),
    notes: objectif?.notes ?? "",
  }));
  const [erreur, setErreur] = useState(null);
  const [confirmSuppr, setConfirmSuppr] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const n = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));

  const invalider = () => { qc.invalidateQueries({ queryKey: ["objectifs"] }); };
  const enregistrer = useMutation({
    mutationFn: (p) => (objectif ? modifierObjectif(objectif.id, p) : creerObjectif(p)),
    onSuccess: () => { invalider(); onClose(); },
    onError: (e) => setErreur(JSON.stringify(e?.response?.data?.detail ?? "Erreur")),
  });
  const supprimer = useMutation({
    mutationFn: () => supprimerObjectif(objectif.id),
    onSuccess: () => { invalider(); onClose(); },
  });

  function soumettre(e) {
    e.preventDefault();
    const course = f.type === "course";
    enregistrer.mutate({
      type: f.type,
      titre: f.titre,
      sport: f.sport || null,
      date_cible: f.date_cible || null,
      date_debut: course ? null : f.date_debut || null,
      distance_km: course ? n(f.distance_km) : null,
      dplus_m: course ? n(f.dplus_m) : null,
      temps_cible_sec: course ? parseDuree(f.temps_cible) : null,
      url: f.url || null,
      metrique: course ? null : f.metrique,
      valeur_cible: course ? null : n(f.valeur_cible),
      valeur_actuelle: !course && f.metrique === "valeur_libre" ? n(f.valeur_actuelle) : null,
      unite: !course && f.metrique === "valeur_libre" ? f.unite || null : null,
      statut: f.statut,
      resultat_temps_sec: course ? parseDuree(f.resultat) : null,
      notes: f.notes || null,
    });
  }

  return (
    <Feuille as="form" onSubmit={soumettre} onClose={onClose} titre={objectif ? "Objectif" : "Nouvel objectif"}
      action={<button type="submit" className="btn-texte font-semibold" disabled={enregistrer.isPending}>
        {enregistrer.isPending ? "…" : objectif ? "OK" : "Ajouter"}
      </button>}>

      <Segmente options={[["course", "Course officielle"], ["perso", "Défi perso"]]} valeur={f.type}
        onChange={(v) => setF((p) => ({ ...p, type: v }))} />

      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        <L label="Titre" className="col-span-2">
          <input required className={inputCls} value={f.titre} onChange={set("titre")}
            placeholder={f.type === "course" ? "Marathon de Paris" : "1000 km de course en 2026"} />
        </L>
        <L label="Sport">
          <select className={inputCls} value={f.sport} onChange={set("sport")}>
            <option value="">Tous sports</option>
            {Object.entries(SPORTS).map(([k, s]) => <option key={k} value={k}>{s.emoji} {s.label}</option>)}
          </select>
        </L>
        <L label={f.type === "course" ? "Date de la course" : "Échéance"}>
          <input type="date" className={inputCls} value={f.date_cible} onChange={set("date_cible")} />
        </L>

        {f.type === "course" ? (
          <>
            <div className="col-span-2 flex flex-wrap gap-1.5">
              {DISTANCES.map(([l, d]) => (
                <button type="button" key={l} onClick={() => setF((p) => ({ ...p, distance_km: d }))}
                  className={clsx("puce", Number(f.distance_km) === d && "puce-active")}>
                  {l}
                </button>
              ))}
            </div>
            <L label="Distance (km)"><input inputMode="decimal" className={inputCls} value={f.distance_km} onChange={set("distance_km")} /></L>
            <L label="D+ (m)"><input inputMode="numeric" className={inputCls} value={f.dplus_m} onChange={set("dplus_m")} /></L>
            <L label="Temps visé (h:mm:ss)"><input className={inputCls} value={f.temps_cible} onChange={set("temps_cible")} placeholder="3:30:00" /></L>
            <L label="Lien de la course"><input className={inputCls} value={f.url} onChange={set("url")} placeholder="https://…" /></L>
          </>
        ) : (
          <>
            <L label="Mesure" className="col-span-2">
              <select className={inputCls} value={f.metrique} onChange={set("metrique")}>
                {Object.entries(METRIQUES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </L>
            <L label="Début de la période"><input type="date" className={inputCls} value={f.date_debut} onChange={set("date_debut")} /></L>
            <L label="Valeur cible"><input inputMode="decimal" className={inputCls} value={f.valeur_cible} onChange={set("valeur_cible")} /></L>
            {f.metrique === "valeur_libre" && (
              <>
                <L label="Valeur actuelle"><input inputMode="decimal" className={inputCls} value={f.valeur_actuelle} onChange={set("valeur_actuelle")} /></L>
                <L label="Unité"><input className={inputCls} value={f.unite} onChange={set("unite")} placeholder="tractions, kg…" /></L>
              </>
            )}
          </>
        )}

        {objectif && (
          <L label="Statut">
            <select className={inputCls} value={f.statut} onChange={set("statut")}>
              <option value="actif">En cours</option>
              <option value="atteint">Atteint</option>
              <option value="abandonne">Abandonné</option>
            </select>
          </L>
        )}
        {objectif && f.type === "course" && (
          <L label="Temps réalisé"><input className={inputCls} value={f.resultat} onChange={set("resultat")} placeholder="3:27:41" /></L>
        )}
        <L label="Notes" className="col-span-2">
          <textarea rows={2} className={inputCls} value={f.notes} onChange={set("notes")} />
        </L>
      </div>

      {erreur && <p className="text-[13px] text-ios-red text-center break-words">{erreur}</p>}

      <div className="space-y-2">
        <button type="submit" className="btn-primaire w-full" disabled={enregistrer.isPending}>Enregistrer</button>
        {objectif && (
          <button type="button" className="btn-danger w-full" onClick={() => setConfirmSuppr(true)}>Supprimer l'objectif</button>
        )}
      </div>

      <ConfirmDialog open={confirmSuppr} title="Supprimer cet objectif ?" message={`« ${f.titre} » sera définitivement supprimé.`}
        danger pending={supprimer.isPending} confirmLabel="Supprimer"
        onConfirm={() => supprimer.mutate()} onCancel={() => setConfirmSuppr(false)} />
    </Feuille>
  );
}

export default function Objectifs() {
  const [modal, setModal] = useState(undefined);
  const { data: objectifs = [], isLoading } = useQuery({ queryKey: ["objectifs"], queryFn: getObjectifs });
  const actifs = objectifs.filter((o) => o.statut === "actif");
  const passes = objectifs.filter((o) => o.statut !== "actif");

  return (
    <Page titre="Objectifs" sousTitre="Courses et défis"
      action={<BoutonAjout onClick={() => setModal(null)} label="Nouvel objectif" />}>

      {isLoading ? (
        <p className="text-[15px] text-label-2">Chargement…</p>
      ) : objectifs.length === 0 ? (
        <Card>
          <div className="text-center py-8 space-y-3">
            <p className="text-4xl">🎯</p>
            <p className="text-[17px] font-semibold">Aucun objectif</p>
            <p className="text-[15px] text-label-2 max-w-sm mx-auto">
              Ajoute une course (ex. marathon) ou un défi perso (ex. 1 000 km dans l'année) : la progression se calcule toute seule.
            </p>
            <button className="btn-primaire" onClick={() => setModal(null)}>Créer un objectif</button>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {actifs.map((o) => <ObjectifCarte key={o.id} o={o} onEdit={setModal} />)}
          </div>
          {passes.length > 0 && (
            <div className="space-y-1.5">
              <h2 className="entete-liste">Terminés</h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {passes.map((o) => <ObjectifCarte key={o.id} o={o} onEdit={setModal} />)}
              </div>
            </div>
          )}
        </>
      )}

      {modal !== undefined && <ModalObjectif objectif={modal} onClose={() => setModal(undefined)} />}
    </Page>
  );
}
