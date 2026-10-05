import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import Card from "../components/Card";
import { getObjectifs, creerObjectif, modifierObjectif, supprimerObjectif } from "../api";
import {
  SPORTS, sportInfo, fmtDate, fmtDuree, parseDuree, dureeVersTexte, nombre,
  inputCls, btnPrimaire, btnSecondaire,
} from "../carnet";

const METRIQUES = {
  distance_km: "Distance cumulée (km)",
  duree_h: "Temps cumulé (h)",
  dplus_m: "Dénivelé cumulé (m D+)",
  nb_seances: "Nombre de séances",
  valeur_libre: "Valeur libre (saisie manuelle)",
};

const DISTANCES = [["5 km", 5], ["10 km", 10], ["Semi", 21.0975], ["Marathon", 42.195]];

function Barre({ pct, repere }) {
  return (
    <div className="relative h-2.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
      <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      {repere != null && (
        <div className="absolute top-0 bottom-0 w-0.5 bg-gray-900/50 dark:bg-white/60"
          style={{ left: `${Math.min(100, Math.max(0, repere))}%` }} title="Attendu à date" />
      )}
    </div>
  );
}

function Tuile({ label, value, sub, ton }) {
  return (
    <div className="rounded-xl bg-gray-50 dark:bg-gray-800 px-3 py-2.5">
      <p className="text-[11px] text-gray-500 dark:text-gray-400">{label}</p>
      <p className={clsx("text-sm font-bold", ton === "bon" ? "text-green-600 dark:text-green-400" : ton === "mauvais" ? "text-orange-600 dark:text-orange-400" : "text-gray-900 dark:text-white")}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 truncate">{sub}</p>}
    </div>
  );
}

export function ObjectifCarte({ o, onEdit, compact = false }) {
  const j = o.jours_restants;
  const echeance = o.date_cible
    ? j > 0 ? `J-${j}` : j === 0 ? "Aujourd'hui" : `il y a ${-j} j`
    : null;

  return (
    <div className={clsx("rounded-2xl glass p-4 space-y-3", o.statut !== "actif" && "opacity-70")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {o.type === "course" ? "🏁 Course" : "🎯 Objectif perso"}
            {o.sport ? ` · ${sportInfo(o.sport).label}` : ""}
            {o.date_cible ? ` · ${fmtDate(o.date_cible)}` : ""}
          </p>
          <h3 className="text-base font-bold text-gray-900 dark:text-white truncate">{o.titre}</h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {o.statut === "atteint" && <span className="text-xs font-semibold text-green-600">✓ Atteint</span>}
          {o.statut === "abandonne" && <span className="text-xs font-semibold text-gray-400">Abandonné</span>}
          {o.statut === "actif" && echeance && (
            <span className="text-xs font-bold text-brand bg-violet-100 dark:bg-violet-500/15 px-2 py-1 rounded-lg">{echeance}</span>
          )}
          {onEdit && (
            <button onClick={() => onEdit(o)} className="text-xs text-gray-400 hover:text-brand">Modifier</button>
          )}
        </div>
      </div>

      {o.type === "course" ? (
        <div className={clsx("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
          <Tuile label="Distance" value={o.distance_km ? `${nombre(o.distance_km, 2)} km` : "—"} sub={o.dplus_m ? `${o.dplus_m} m D+` : null} />
          <Tuile label="Objectif" value={o.temps_cible_sec ? o.temps_cible_str : "—"} sub={o.allure_cible_str} />
          <Tuile label="Prédiction actuelle"
            value={o.prediction?.temps_str ?? "—"}
            sub={o.prediction ? `base : ${o.prediction.base}` : "Pas assez de sorties récentes (≥ 3 km)"}
            ton={o.ecart_sec == null ? null : o.ecart_sec <= 0 ? "bon" : "mauvais"} />
          <Tuile label="Écart"
            value={o.ecart_sec == null ? "—" : `${o.ecart_sec <= 0 ? "−" : "+"}${fmtDuree(Math.abs(o.ecart_sec))}`}
            ton={o.ecart_sec == null ? null : o.ecart_sec <= 0 ? "bon" : "mauvais"} />
          {!compact && (
            <>
              <Tuile label="Volume à pied (moy. 4 sem.)" value={`${nombre(o.km_hebdo_4sem)} km/sem`} />
              <Tuile label="Plus longue sortie (4 sem.)" value={o.plus_longue_4sem_km ? `${nombre(o.plus_longue_4sem_km)} km` : "—"} />
              {o.resultat_temps_sec && <Tuile label="Résultat" value={o.resultat_temps_str} ton="bon" />}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-bold text-gray-900 dark:text-white">
              {nombre(o.valeur_actuelle)} {o.valeur_cible ? `/ ${nombre(o.valeur_cible)}` : ""} {o.unite ?? ""}
            </span>
            {o.pourcentage != null && <span className="font-semibold text-brand">{nombre(o.pourcentage, 0)} %</span>}
          </div>
          {o.valeur_cible ? (
            <Barre pct={o.pourcentage ?? 0}
              repere={o.attendu_a_date != null ? (100 * o.attendu_a_date) / o.valeur_cible : null} />
          ) : null}
          {o.projection != null && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Attendu à date : {nombre(o.attendu_a_date)} {o.unite} · Projection à l'échéance :{" "}
              <span className={o.projection >= o.valeur_cible ? "text-green-600 dark:text-green-400 font-semibold" : "text-orange-600 dark:text-orange-400 font-semibold"}>
                {nombre(o.projection)} {o.unite}
              </span>
            </p>
          )}
        </div>
      )}

      {!compact && o.notes && <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-line">{o.notes}</p>}
      {!compact && o.url && (
        <a href={o.url} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">Page de la course ↗</a>
      )}
    </div>
  );
}

function L({ label, children, className = "" }) {
  return (
    <label className={`block space-y-1 ${className}`}>
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4" onClick={onClose}>
      <form onSubmit={soumettre} onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-lg max-h-[92vh] overflow-y-auto space-y-4"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}>
        <h3 className="text-base font-bold text-gray-900 dark:text-white">{objectif ? "Modifier l'objectif" : "Nouvel objectif"}</h3>

        <div className="flex gap-1 rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
          {[["course", "🏁 Course officielle"], ["perso", "🎯 Objectif perso"]].map(([k, l]) => (
            <button type="button" key={k} onClick={() => setF((p) => ({ ...p, type: k }))}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold ${f.type === k ? "bg-white dark:bg-gray-700 text-brand shadow-sm" : "text-gray-500"}`}>
              {l}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
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
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${Number(f.distance_km) === d ? "bg-brand text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"}`}>
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

        {erreur && <p className="text-sm text-red-500 break-words">{erreur}</p>}

        <div className="flex gap-2">
          {objectif && (
            <button type="button" className={`${btnSecondaire} !text-red-500`}
              onClick={() => window.confirm("Supprimer cet objectif ?") && supprimer.mutate()}>Supprimer</button>
          )}
          <div className="flex-1" />
          <button type="button" className={btnSecondaire} onClick={onClose}>Annuler</button>
          <button type="submit" className={btnPrimaire} disabled={enregistrer.isPending}>Enregistrer</button>
        </div>
      </form>
    </div>
  );
}

export default function Objectifs() {
  const [modal, setModal] = useState(undefined);
  const { data: objectifs = [], isLoading } = useQuery({ queryKey: ["objectifs"], queryFn: getObjectifs });
  const actifs = objectifs.filter((o) => o.statut === "actif");
  const passes = objectifs.filter((o) => o.statut !== "actif");

  return (
    <div className="p-4 md:p-8 w-full space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Objectifs</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Courses officielles et défis perso, suivis automatiquement depuis ton carnet</p>
        </div>
        <button className={btnPrimaire} onClick={() => setModal(null)}>+ Objectif</button>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Chargement…</p>
      ) : objectifs.length === 0 ? (
        <Card>
          <div className="text-center py-8 space-y-3">
            <p className="text-3xl">🎯</p>
            <p className="text-sm text-gray-600 dark:text-gray-300">Aucun objectif. Ajoute une course (ex. marathon) ou un défi perso (ex. 1 000 km dans l'année).</p>
            <button className={btnPrimaire} onClick={() => setModal(null)}>Créer un objectif</button>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {actifs.map((o) => <ObjectifCarte key={o.id} o={o} onEdit={setModal} />)}
          </div>
          {passes.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400">Terminés</h3>
              <div className="grid gap-4 lg:grid-cols-2">
                {passes.map((o) => <ObjectifCarte key={o.id} o={o} onEdit={setModal} />)}
              </div>
            </div>
          )}
        </>
      )}

      {modal !== undefined && <ModalObjectif objectif={modal} onClose={() => setModal(undefined)} />}
    </div>
  );
}
