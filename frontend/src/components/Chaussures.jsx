// Usure du matériel (chaussures surtout) : km cumulés de chaque paire, alerte avant la limite.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { creerEquipement, getEquipements, modifierEquipement, supprimerEquipement } from "../api";
import { SPORTS, fmtDate, nombre } from "../carnet";
import { getErrorMessage } from "../utils/errors";
import ConfirmDialog from "./ConfirmDialog";
import Feuille from "./Feuille";
import { Interrupteur } from "./ui";

const SPORTS_MATERIEL = ["course", "trail", "marche", "randonnee", "velo"];
const aujourdhui = () => new Date().toLocaleDateString("sv-SE");

function Edition({ equipement: e, onClose }) {
  const qc = useQueryClient();
  const [f, setF] = useState(() => ({
    nom: e?.nom ?? "", sports: e?.sports ?? ["course"], par_defaut: e?.par_defaut ?? true,
    mise_en_service: e?.mise_en_service ?? aujourdhui(), km_initial: e?.km_initial ?? 0,
    limite_km: e?.limite_km ?? 700, retire_le: e?.retire_le ?? "", notes: e?.notes ?? "",
  }));
  const [suppr, setSuppr] = useState(false);
  const set = (k) => (ev) => setF((x) => ({ ...x, [k]: ev.target.value }));
  const fini = () => { qc.invalidateQueries({ queryKey: ["equipements"] }); qc.invalidateQueries({ queryKey: ["equipement"] }); onClose(); };
  const enreg = useMutation({
    mutationFn: () => {
      const d = { ...f, nom: f.nom.trim(), km_initial: Number(f.km_initial) || 0,
        limite_km: f.limite_km === "" ? null : Number(f.limite_km), retire_le: f.retire_le || null, notes: f.notes || null };
      return e ? modifierEquipement(e.id, d) : creerEquipement(d);
    },
    onSuccess: fini,
  });
  const effacer = useMutation({ mutationFn: () => supprimerEquipement(e.id), onSuccess: fini });
  const basculer = (s) => setF((x) => ({ ...x, sports: x.sports.includes(s) ? x.sports.filter((y) => y !== s) : [...x.sports, s] }));
  const valide = f.nom.trim() && f.sports.length && f.mise_en_service;

  return (
    <Feuille titre={e ? "Matériel" : "Nouveau matériel"} onClose={onClose}
      action={<button className="btn-texte font-semibold" disabled={!valide || enreg.isPending} onClick={() => enreg.mutate()}>OK</button>}>
      <label className="block">
        <span className="libelle">Nom</span>
        <input className="champ" maxLength={120} placeholder="ex. Pegasus 41 bleues" value={f.nom} onChange={set("nom")} />
      </label>
      <div>
        <span className="libelle">Sports</span>
        <div className="flex flex-wrap gap-2">
          {SPORTS_MATERIEL.map((s) => (
            <button type="button" key={s} onClick={() => basculer(s)}
              className={clsx("px-3 py-1.5 rounded-full text-[14px] font-medium",
                f.sports.includes(s) ? "bg-brand text-white" : "bg-remplissage text-label")}>
              {SPORTS[s].emoji} {SPORTS[s].label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="libelle">Mise en service</span>
          <input type="date" className="champ" value={f.mise_en_service} onChange={set("mise_en_service")} />
        </label>
        <label className="block">
          <span className="libelle">Km déjà faits</span>
          <input type="number" min="0" inputMode="decimal" className="champ" value={f.km_initial} onChange={set("km_initial")} />
        </label>
        <label className="block">
          <span className="libelle">Limite (km)</span>
          <input type="number" min="0" inputMode="numeric" className="champ" value={f.limite_km ?? ""} onChange={set("limite_km")} />
        </label>
        <label className="block">
          <span className="libelle">Retirée le</span>
          <input type="date" className="champ" value={f.retire_le} onChange={set("retire_le")} />
        </label>
      </div>
      <div className="card py-0.5">
        <div className="ligne">
          <span className="flex-1 text-[16px]">Compter par défaut</span>
          <Interrupteur actif={f.par_defaut} onChange={(v) => setF((x) => ({ ...x, par_defaut: v }))} label="Compter par défaut" />
        </div>
      </div>
      <p className="text-[13px] text-label-2 -mt-2 px-1">
        Par défaut, chaque séance de ces sports compte pour cette paire à partir de sa mise en service (la plus récente si plusieurs). La fiche d'une séance permet de choisir une autre paire.
      </p>
      <label className="block">
        <span className="libelle">Notes</span>
        <textarea className="champ min-h-[70px]" maxLength={2000} value={f.notes} onChange={set("notes")} />
      </label>
      {enreg.isError && <p className="text-[13px] text-ios-red text-center">{getErrorMessage(enreg.error)}</p>}
      <button className="btn-primaire w-full" disabled={!valide || enreg.isPending} onClick={() => enreg.mutate()}>
        {enreg.isPending ? "Enregistrement…" : "Enregistrer"}
      </button>
      {e && <button className="btn-texte text-ios-red w-full justify-center text-center" onClick={() => setSuppr(true)}>Supprimer</button>}
      <ConfirmDialog open={suppr} title="Supprimer ce matériel ?" danger confirmLabel="Supprimer" pending={effacer.isPending}
        message="Les séances restent intactes ; elles ne seront simplement plus comptées pour cette paire."
        onConfirm={() => effacer.mutate()} onCancel={() => setSuppr(false)} />
    </Feuille>
  );
}

export default function Chaussures() {
  const { data } = useQuery({ queryKey: ["equipements"], queryFn: getEquipements, staleTime: 60_000 });
  const [edition, setEdition] = useState(null);   // null | "nouveau" | équipement
  const [retirees, setRetirees] = useState(false);
  const liste = data ?? [];
  const visibles = liste.filter((e) => retirees || !e.retire_le);
  const nbRetirees = liste.length - liste.filter((e) => !e.retire_le).length;

  return (
    <div>
      <h2 className="entete-liste">Chaussures et matériel</h2>
      <div className="card py-0.5 overflow-hidden">
        {visibles.map((e) => {
          const part = e.limite_km ? Math.min(1, e.km / e.limite_km) : null;
          return (
            <button key={e.id} type="button" className="ligne !items-start !py-3 text-left" onClick={() => setEdition(e)}>
              <span className="text-[22px] leading-none mt-0.5" aria-hidden>{e.sports.includes("velo") && e.sports.length === 1 ? "🚴" : "👟"}</span>
              <span className="flex-1 min-w-0 space-y-1.5">
                <span className="flex items-baseline gap-2">
                  <span className={clsx("flex-1 truncate text-[17px]", e.retire_le && "text-label-2")}>{e.nom}</span>
                  <span className={clsx("text-[15px] font-semibold chiffres", e.alerte && "text-ios-orange")}>
                    {nombre(e.km, 0)}<span className="text-label-2 font-normal"> {e.limite_km ? `/ ${e.limite_km} km` : "km"}</span>
                  </span>
                </span>
                {part != null && (
                  <span className="block h-1.5 rounded-full bg-remplissage overflow-hidden">
                    <span className="block h-full rounded-full"
                      style={{ width: `${part * 100}%`, background: part >= 1 ? "rgb(var(--red))" : e.alerte ? "rgb(var(--orange))" : "rgb(var(--green))" }} />
                  </span>
                )}
                <span className="block text-[12px] text-label-2 chiffres truncate">
                  {e.retire_le ? `Retirée le ${fmtDate(e.retire_le)}` : `Depuis le ${fmtDate(e.mise_en_service)}`}
                  {` · ${e.nb_seances} séance${e.nb_seances > 1 ? "s" : ""}`}
                  {e.alerte && !e.retire_le && " · à remplacer bientôt"}
                </span>
              </span>
            </button>
          );
        })}
        {nbRetirees > 0 && (
          <button type="button" className="ligne" onClick={() => setRetirees((r) => !r)}>
            <span className="flex-1 text-[15px] text-label-2">{retirees ? "Masquer" : "Afficher"} le matériel retiré ({nbRetirees})</span>
          </button>
        )}
        <button type="button" className="ligne" onClick={() => setEdition("nouveau")}>
          <span className="flex-1 text-[17px] text-brand">Ajouter une paire</span>
        </button>
      </div>
      <p className="px-4 pt-1.5 text-[13px] text-label-2">
        Les km de chaque séance sont ajoutés automatiquement. Une alerte apparaît à 80 % de la limite.
      </p>
      {edition && <Edition equipement={edition === "nouveau" ? null : edition} onClose={() => setEdition(null)} />}
    </div>
  );
}
