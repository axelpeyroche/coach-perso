import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Feuille from "./Feuille";
import { Interrupteur } from "./ui";
import { getAnalyseToken, exporterCarnet, importerPlan, urlApiAbsolue } from "../api";
import { SPORTS, sportInfo, fmtDuree, nombre } from "../carnet";
import { IAS, promptPlan, lirePlanColle } from "../ia";

// Même logique (simplifiée) que normaliser_sport côté serveur, pour l'aperçu
const MOTS = [["trail", "trail"], ["rando", "randonnee"], ["marche", "marche"], ["velo", "velo"], ["vélo", "velo"],
  ["cycl", "velo"], ["nat", "natation"], ["swim", "natation"], ["hiit", "hiit"], ["fraction", "hiit"], ["cross", "hiit"],
  ["yoga", "yoga"], ["mobilit", "yoga"], ["renfo", "muscu"], ["muscu", "muscu"], ["force", "muscu"], ["course", "course"],
  ["run", "course"], ["footing", "course"]];
const sportApercu = (s) => (SPORTS[s] ? s : MOTS.find(([m]) => s.includes(m))?.[1] ?? "autre");

const fmtSemaine = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

function Etape({ n, titre, children }) {
  return (
    <section className="tuile p-3.5 space-y-2.5">
      <p className="text-[15px] font-semibold"><span className="text-brand chiffres">{n}.</span> {titre}</p>
      {children}
    </section>
  );
}

export default function ImportPlan({ semaine, onClose }) {
  const qc = useQueryClient();
  const [copie, setCopie] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [texte, setTexte] = useState("");
  const [remplacer, setRemplacer] = useState(true);
  const [bilan, setBilan] = useState(null);
  const [erreur, setErreur] = useState(null);
  const { data } = useQuery({ queryKey: ["analyse-token"], queryFn: getAnalyseToken });
  const lien = data ? `${urlApiAbsolue()}/analyse/${data.analyse_token}` : "";

  const lu = useMemo(() => (texte.trim() ? lirePlanColle(texte) : null), [texte]);

  const marquer = (cle) => { setCopie(cle); setTimeout(() => setCopie(null), 2000); };

  async function copierAvecCarnet() {
    setChargement(true);
    try {
      const md = await exporterCarnet("md");
      await navigator.clipboard.writeText(`${promptPlan("(contenu ci-dessous)", semaine)}\n\n---\n\n${md}`);
      marquer("carnet");
    } finally { setChargement(false); }
  }

  async function copierAvecLien() {
    await navigator.clipboard.writeText(promptPlan(lien, semaine));
    marquer("lien");
  }

  async function coller() {
    try { setTexte(await navigator.clipboard.readText()); } catch { /* collage manuel */ }
  }

  const envoi = useMutation({
    mutationFn: () => importerPlan({ seances: lu.seances, remplacer_semaines: remplacer }),
    onSuccess: (r) => {
      setBilan(r);
      setErreur(null);
      ["plan", "activites", "forme-jour"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => {
      const d = e?.response?.data?.detail;
      setErreur(Array.isArray(d) ? d.map((x) => x.msg).join(" · ") : d?.toString?.() ?? "Import impossible, réessaie.");
    },
  });

  return (
    <Feuille titre="Plan avec ton IA" onClose={onClose}>
      {bilan ? (
        <div className="space-y-4 text-center py-6">
          <p className="text-[40px]">✅</p>
          <p className="text-[17px] font-semibold">Plan importé</p>
          <p className="text-[15px] text-label-2 chiffres">
            {bilan.cree} séance(s) ajoutée(s){bilan.maj ? `, ${bilan.maj} mise(s) à jour` : ""}{bilan.supprime ? `, ${bilan.supprime} retirée(s)` : ""}.
          </p>
          <button className="btn-primaire w-full" onClick={onClose}>Voir le plan</button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-label-2 px-1">
            Fonctionne avec n'importe quelle IA, même gratuite : ChatGPT, Gemini, Claude, Le Chat, Copilot…
            Semaine visée : <strong>{fmtSemaine(semaine)}</strong>.
          </p>

          <Etape n={1} titre="Copie la consigne et ton carnet">
            <button className="btn-primaire btn-sm w-full" disabled={chargement} onClick={copierAvecCarnet}>
              {copie === "carnet" ? "✓ Copié" : chargement ? "Préparation…" : "Copier consigne + carnet"}
            </button>
            <p className="text-[12px] text-label-2">
              Si ton IA sait ouvrir les liens (ChatGPT, Claude…), tu peux copier une version plus courte :{" "}
              <button className="text-brand font-medium" disabled={!lien} onClick={copierAvecLien}>
                {copie === "lien" ? "✓ copiée" : "consigne + lien"}
              </button>.
            </p>
          </Etape>

          <Etape n={2} titre="Colle-la dans ton IA">
            <div className="flex flex-wrap gap-2">
              {IAS.map((ia) => (
                <a key={ia.id} href={ia.url} target="_blank" rel="noreferrer" className="btn-gris btn-sm">{ia.nom} ↗</a>
              ))}
            </div>
            <p className="text-[12px] text-label-2">L'IA explique ses choix puis termine par un bloc de code : copie toute sa réponse.</p>
          </Etape>

          <Etape n={3} titre="Colle sa réponse ici">
            <textarea rows={5} className="champ font-mono text-[12px]" value={texte} onChange={(e) => { setTexte(e.target.value); setErreur(null); }}
              placeholder="Colle ici la réponse de l'IA (bloc JSON compris)" />
            {!texte && <button className="btn-gris btn-sm" onClick={coller}>Coller</button>}

            {lu?.erreurs.map((e) => <p key={e} className="text-[13px] text-ios-orange">{e}</p>)}

            {lu?.seances.length > 0 && (
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-label-2 chiffres">{lu.seances.length} séance(s) reconnue(s)</p>
                <div className="card py-0.5">
                  {lu.seances.map((s, i) => {
                    const info = sportInfo(sportApercu(s.sport));
                    const details = [s.duree_min && fmtDuree(s.duree_min * 60), s.distance_km && `${nombre(s.distance_km)} km`,
                      s.rpe_cible && `RPE ${nombre(s.rpe_cible)}`].filter(Boolean).join(" · ");
                    return (
                      <div key={i} className="ligne" style={{ "--inset": "3.75rem" }}>
                        <span className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-[17px]"
                          style={{ backgroundColor: `${info.couleur}26` }}>{info.emoji}</span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[15px] font-semibold truncate">{s.titre}</span>
                          <span className="block text-[13px] text-label-2 chiffres truncate">
                            {s.jour ? new Date(`${s.jour}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) : "Semaine en cours"}{details ? ` · ${details}` : ""}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex-1 text-[13px] text-label-2">
                    Remplacer les séances pas encore faites de ces semaines (les séances réalisées ou sautées restent)
                  </span>
                  <Interrupteur actif={remplacer} onChange={setRemplacer} label="Remplacer les séances non faites" />
                </div>
                {erreur && <p className="text-[13px] text-ios-red">{erreur}</p>}
                <button className="btn-primaire w-full" disabled={envoi.isPending} onClick={() => envoi.mutate()}>
                  {envoi.isPending ? "Import…" : `Ajouter ${lu.seances.length} séance(s) au plan`}
                </button>
              </div>
            )}
          </Etape>
        </div>
      )}
    </Feuille>
  );
}
