import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getFiltresCarnet, setFiltresCarnet } from "../api";
import { SPORTS } from "../carnet";

// Critères avancés du carnet (hors recherche et sport, gérés par la page)
export const CRITERES_VIDES = { type: "", dist_min: "", dist_max: "", dplus_min: "", fc_min: "", fc_max: "", meteo: "", lieu: "" };
const NOMBRES = ["dist_min", "dist_max", "dplus_min", "fc_min", "fc_max"];

export const nbActifs = (c) => Object.values(c).filter((v) => v !== "" && v != null).length;

// Paramètres de requête : seuls les critères remplis, nombres convertis
export function versParams(c) {
  const p = {};
  for (const [k, v] of Object.entries(c)) {
    if (v === "" || v == null) continue;
    if (NOMBRES.includes(k)) {
      const n = Number(String(v).replace(",", "."));
      if (isFinite(n) && n >= 0) p[k] = n;
    } else p[k] = v;
  }
  return p;
}

export function useFiltresCarnet() {
  return useQuery({ queryKey: ["filtres-carnet"], queryFn: getFiltresCarnet, staleTime: 10 * 60 * 1000 });
}

// Libellés courts des critères actifs (pastilles sous la recherche, quand le panneau est fermé)
export function resume(c, meta) {
  const out = [];
  if (c.type) out.push(["type", meta?.types?.[c.type] ?? c.type]);
  if (c.dist_min !== "" || c.dist_max !== "") {
    out.push(["dist", c.dist_min !== "" && c.dist_max !== "" ? `${c.dist_min}–${c.dist_max} km`
      : c.dist_min !== "" ? `≥ ${c.dist_min} km` : `≤ ${c.dist_max} km`]);
  }
  if (c.dplus_min !== "") out.push(["dplus", `D+ ≥ ${c.dplus_min} m`]);
  if (c.fc_min !== "" || c.fc_max !== "") {
    out.push(["fc", c.fc_min !== "" && c.fc_max !== "" ? `♥ ${c.fc_min}–${c.fc_max}`
      : c.fc_min !== "" ? `♥ ≥ ${c.fc_min}` : `♥ ≤ ${c.fc_max}`]);
  }
  if (c.meteo) out.push(["meteo", (meta?.meteos?.[c.meteo] ?? c.meteo).replace(/ \(.*\)$/, "")]);
  if (c.lieu) out.push(["lieu", (meta?.lieux?.[c.lieu] ?? c.lieu).replace(/ \(.*\)$/, "")]);
  return out;
}

// Critères remis à vide par le retrait d'une pastille
export const RETRAIT = {
  type: { type: "" }, dist: { dist_min: "", dist_max: "" }, dplus: { dplus_min: "" },
  fc: { fc_min: "", fc_max: "" }, meteo: { meteo: "" }, lieu: { lieu: "" },
};

function Champ({ libelle, valeur, onChange, unite }) {
  return (
    <label className="flex-1 min-w-0 flex items-center gap-2">
      <span className="text-[13px] text-label-2 shrink-0">{libelle}</span>
      <input className="champ !py-2 min-w-0 chiffres" inputMode="decimal" value={valeur} placeholder="—"
        aria-label={`${libelle} ${unite}`}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, "").slice(0, 6))} />
    </label>
  );
}

function Groupe({ titre, children }) {
  return (
    <div className="space-y-2 min-w-0">
      <h3 className="text-[13px] font-semibold text-label-2">{titre}</h3>
      {children}
    </div>
  );
}

function Puces({ options, valeur, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(options).map(([k, l]) => (
        <button key={k} type="button" aria-pressed={valeur === k}
          className={`puce ${valeur === k ? "puce-active" : ""}`}
          onClick={() => onChange(valeur === k ? "" : k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

// Panneau des filtres avancés : une colonne sur téléphone, deux puis trois sur grand écran
export function PanneauFiltres({ criteres, onChange, meta, q, sport, onFermer }) {
  const qc = useQueryClient();
  const [nom, setNom] = useState("");
  const [saisie, setSaisie] = useState(false);
  const maj = (k) => (v) => onChange({ ...criteres, [k]: v });
  const enregistres = meta?.filtres ?? [];
  const sauver = useMutation({
    mutationFn: setFiltresCarnet,
    onSuccess: (d) => {
      qc.setQueryData(["filtres-carnet"], (old) => (old ? { ...old, filtres: d.filtres } : old));
      setNom(""); setSaisie(false);
    },
  });
  const aEnregistrer = { ...(q ? { q } : {}), ...(sport ? { sport } : {}), ...versParams(criteres) };
  const vide = Object.keys(aEnregistrer).length === 0;

  return (
    <div className="card p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-4">
        {meta?.types && (
          <div className="sm:col-span-2 xl:col-span-3">
            <Groupe titre="Type de séance (course, trail, marche)">
              <Puces options={meta.types} valeur={criteres.type} onChange={maj("type")} />
            </Groupe>
          </div>
        )}
        <Groupe titre="Distance (km)">
          <div className="flex gap-3">
            <Champ libelle="de" unite="km" valeur={criteres.dist_min} onChange={maj("dist_min")} />
            <Champ libelle="à" unite="km" valeur={criteres.dist_max} onChange={maj("dist_max")} />
          </div>
        </Groupe>
        <Groupe titre="FC moyenne (bpm)">
          <div className="flex gap-3">
            <Champ libelle="de" unite="bpm" valeur={criteres.fc_min} onChange={maj("fc_min")} />
            <Champ libelle="à" unite="bpm" valeur={criteres.fc_max} onChange={maj("fc_max")} />
          </div>
        </Groupe>
        <Groupe titre="Dénivelé positif (m)">
          <div className="flex gap-3">
            <Champ libelle="au moins" unite="m" valeur={criteres.dplus_min} onChange={maj("dplus_min")} />
          </div>
        </Groupe>
        {meta?.meteos && (
          <div className="sm:col-span-2 xl:col-span-2">
            <Groupe titre="Météo de la sortie">
              <Puces options={meta.meteos} valeur={criteres.meteo} onChange={maj("meteo")} />
            </Groupe>
          </div>
        )}
        {meta?.lieux && Object.keys(meta.lieux).length > 0 && (
          <Groupe titre="Lieu de départ">
            <Puces options={meta.lieux} valeur={criteres.lieu} onChange={maj("lieu")} />
          </Groupe>
        )}
      </div>

      {enregistres.length > 0 && (
        <Groupe titre="Filtres enregistrés">
          <div className="flex flex-wrap gap-2">
            {enregistres.map((f) => (
              <span key={f.nom} className="puce !pr-1.5">
                {f.nom}
                <button type="button" aria-label={`Supprimer le filtre ${f.nom}`} disabled={sauver.isPending}
                  className="w-6 h-6 -my-1 rounded-full flex items-center justify-center text-label-2 hover:text-ios-red"
                  onClick={() => sauver.mutate(enregistres.filter((x) => x.nom !== f.nom))}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        </Groupe>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-separateur -mx-4 px-4 pt-3">
        {saisie ? (
          <form className="flex flex-1 min-w-[220px] gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!nom.trim() || vide) return;
              sauver.mutate([...enregistres.filter((x) => x.nom.toLowerCase() !== nom.trim().toLowerCase()),
                { nom: nom.trim(), criteres: aEnregistrer }]);
            }}>
            <input autoFocus className="champ !py-2 flex-1 min-w-0" maxLength={40} placeholder="Nom du filtre"
              value={nom} onChange={(e) => setNom(e.target.value)} />
            <button type="submit" className="btn-primaire btn-sm" disabled={!nom.trim() || sauver.isPending}>OK</button>
            <button type="button" className="btn-gris btn-sm" onClick={() => setSaisie(false)}>Annuler</button>
          </form>
        ) : (
          <>
            <button type="button" className="btn-teinte btn-sm" disabled={vide || enregistres.length >= 12}
              onClick={() => setSaisie(true)}>
              Enregistrer ce filtre
            </button>
            <button type="button" className="btn-gris btn-sm" disabled={nbActifs(criteres) === 0}
              onClick={() => onChange(CRITERES_VIDES)}>
              Tout effacer
            </button>
            <button type="button" className="btn-texte ml-auto" onClick={onFermer}>Fermer</button>
          </>
        )}
      </div>
      {sauver.isError && <p className="text-[12px] text-ios-red">Enregistrement impossible.</p>}
    </div>
  );
}

// Libellé d'un filtre enregistré, pour son info-bulle
export function detailFiltre(f, meta) {
  const c = { ...CRITERES_VIDES, ...f.criteres };
  return [f.criteres.q && `« ${f.criteres.q} »`, f.criteres.sport && SPORTS[f.criteres.sport]?.label,
    ...resume(c, meta).map((r) => r[1])].filter(Boolean).join(" · ");
}
