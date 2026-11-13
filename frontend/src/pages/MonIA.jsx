import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import Page from "../components/Page";
import { getReglagesIa, enregistrerReglagesIa, getAnalyseToken, getClaudeToken, exporterCarnet, urlApiAbsolue } from "../api";
import { SPORTS } from "../carnet";
import {
  JOURS_IA, DUREES_IA, IAS_ASSISTANT, JETON_MASQUE, nomIa, autoPossible, niveauEffectif, manques,
  lundiSuivant, consigneSemi, consigneAuto,
} from "../assistantIa";

// Assistant « Mon IA crée mon plan » : quelques réponses, puis une consigne sur mesure à coller
// dans l'IA de son choix. Le carnet ne parle à aucune IA : c'est l'utilisateur qui colle la consigne.

function Etape({ n, titre, aide, children }) {
  return (
    <section className="card p-4 space-y-3">
      <div>
        <h2 className="text-[17px] font-semibold"><span className="text-brand chiffres">{n}.</span> {titre}</h2>
        {aide && <p className="text-[13px] text-label-2 mt-0.5">{aide}</p>}
      </div>
      {children}
    </section>
  );
}

function Puce({ actif, onClick, children }) {
  return (
    <button type="button" aria-pressed={actif} onClick={onClick}
      className={clsx("btn btn-sm", actif ? "bg-brand text-white" : "bg-remplissage text-label")}>
      {children}
    </button>
  );
}

function Niveau({ actif, indisponible, titre, pour, onClick, children }) {
  return (
    <button type="button" aria-pressed={actif} disabled={indisponible} onClick={onClick}
      className={clsx("tuile p-3.5 text-left w-full border-2 transition-colors",
        actif ? "border-brand" : "border-transparent", indisponible && "opacity-50")}>
      <span className="block text-[15px] font-semibold">{titre}</span>
      <span className="block text-[12px] font-semibold uppercase tracking-[0.02em] text-brand mt-0.5">{pour}</span>
      <span className="block text-[13px] text-label-2 mt-1.5">{children}</span>
    </button>
  );
}

export default function MonIA() {
  const qc = useQueryClient();
  const { data: enregistre, isError: chargementRate, refetch: recharger } = useQuery({ queryKey: ["reglages-ia"], queryFn: getReglagesIa });
  const { data: analyse, isError: lienRate, refetch: rechargerLien } = useQuery({ queryKey: ["analyse-token"], queryFn: getAnalyseToken });
  const [r, setR] = useState(null);
  const [etat, setEtat] = useState(null);       // null | "enregistre" | "erreur"
  const [copie, setCopie] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const [erreurCopie, setErreurCopie] = useState(null);
  const dernier = useRef(null);      // dernières réponses saisies
  const aEnvoyer = useRef(false);    // une modification attend encore son enregistrement
  const envoi = useRef(0);           // numéro du dernier envoi : une réponse plus ancienne est ignorée

  useEffect(() => {
    if (enregistre && !r) {
      const { rempli, ...reglages } = enregistre;
      setR(reglages);
    }
  }, [enregistre, r]);

  // Enregistrement discret, peu après la dernière modification
  const enregistrer = useRef(null);
  enregistrer.current = () => {
    if (!aEnvoyer.current || !dernier.current) return;
    aEnvoyer.current = false;
    const n = ++envoi.current;
    enregistrerReglagesIa(dernier.current)
      .then((res) => {
        if (n !== envoi.current) return;
        qc.setQueryData(["reglages-ia"], res);
        if (!aEnvoyer.current) setEtat("enregistre");
      })
      .catch(() => { if (n === envoi.current) { aEnvoyer.current = true; setEtat("erreur"); } });
  };

  useEffect(() => {
    if (!r || !aEnvoyer.current) return undefined;
    const t = setTimeout(() => enregistrer.current(), 700);
    return () => clearTimeout(t);
  }, [r]);

  // Rien ne se perd : envoi immédiat en quittant la page ou l'application, nouvel essai au retour du réseau
  useEffect(() => {
    const vite = () => enregistrer.current();
    const cache = () => { if (document.visibilityState === "hidden") vite(); };
    window.addEventListener("pagehide", vite);
    window.addEventListener("online", vite);
    document.addEventListener("visibilitychange", cache);
    return () => {
      window.removeEventListener("pagehide", vite);
      window.removeEventListener("online", vite);
      document.removeEventListener("visibilitychange", cache);
      vite();
    };
  }, []);

  const changer = (champs) => {
    const suivant = { ...(dernier.current ?? r), ...champs };
    dernier.current = suivant;
    aEnvoyer.current = true;
    setEtat(null);
    setR(suivant);
  };

  const niveau = r ? niveauEffectif(r) : "semi";
  const lundi = useMemo(() => lundiSuivant(new Date()), []);
  const lien = analyse ? `${urlApiAbsolue()}/analyse/${analyse.analyse_token}` : "";
  const manque = r ? manques(r) : [];

  const apercu = useMemo(() => {
    if (!r) return "";
    return niveau === "auto"
      ? consigneAuto(r, { api: urlApiAbsolue(), jeton: JETON_MASQUE, lundi })
      : consigneSemi(r, { source: lien || "(lien en préparation)", lundi });
  }, [r, niveau, lien, lundi]);

  const marquer = (cle) => { setCopie(cle); setErreurCopie(null); setTimeout(() => setCopie(null), 2500); };

  async function copier(cle) {
    setOccupe(true);
    setErreurCopie(null);
    let pretAEcrire = false;
    const preparer = async () => {
      let texte;
      if (cle === "auto") {
        // le jeton est relu au moment de copier (jamais affiché sur cette page, jamais un ancien)
        const { claude_token: jeton } = await getClaudeToken();
        if (!jeton) throw new Error("jeton absent");
        qc.setQueryData(["claude-token"], { claude_token: jeton });
        texte = consigneAuto(r, { api: urlApiAbsolue(), jeton, lundi });
      } else if (cle === "carnet") {
        const md = await exporterCarnet("md");
        texte = `${consigneSemi(r, { source: "(contenu collé à la suite)", lundi, avecLien: false })}\n\n---\n\n${md}`;
      } else {
        texte = consigneSemi(r, { source: lien, lundi });
      }
      pretAEcrire = true;
      return texte;
    };
    try {
      const texte = preparer();
      if (cle !== "lien" && window.ClipboardItem && navigator.clipboard?.write) {
        // Safari n'accepte la copie que dans le geste : on lui confie tout de suite une promesse du texte
        await navigator.clipboard.write([new ClipboardItem({
          "text/plain": texte.then((t) => new Blob([t], { type: "text/plain" })),
        })]);
      } else {
        await navigator.clipboard.writeText(await texte);
      }
      marquer(cle);
    } catch {
      setErreurCopie(pretAEcrire
        ? "La copie n'a pas abouti. Réessaie ; si ça persiste, autorise le presse-papiers pour ce site."
        : "Impossible de préparer la consigne : vérifie ta connexion et réessaie.");
    } finally { setOccupe(false); }
  }

  if (!r && chargementRate) {
    return (
      <Page titre="Mon IA crée mon plan">
        <div className="card p-4 space-y-3" role="alert">
          <p className="text-[15px]">Impossible de charger tes réponses pour le moment.</p>
          <button className="btn-gris" onClick={() => recharger()}>Réessayer</button>
        </div>
      </Page>
    );
  }
  if (!r) {
    return <Page titre="Mon IA crée mon plan" sousTitre="Chargement…"><div className="card p-4 h-40 animate-pulse" /></Page>;
  }

  const ia = IAS_ASSISTANT.find((x) => x.id === r.ia);
  const nom = nomIa(r);
  const pret = manque.length === 0;

  return (
    <Page titre="Mon IA crée mon plan" sousTitre="Une consigne sur mesure, à coller une seule fois">
      <p className="text-[15px] leading-5 text-label-2 px-1">
        Réponds à quelques questions : le carnet écrit la consigne à donner à ton IA. Elle relit ton carnet chaque
        semaine et prépare ton plan. Le carnet, lui, n'envoie rien à aucune IA : c'est toi qui colles la consigne.
      </p>

      <Etape n={1} titre="Ton IA" aide="Celle que tu utilises déjà, gratuite ou non.">
        <div className="flex flex-wrap gap-2">
          {IAS_ASSISTANT.map((x) => (
            <Puce key={x.id} actif={r.ia === x.id} onClick={() => changer({ ia: x.id })}>{x.nom}</Puce>
          ))}
        </div>
        {r.ia === "autre" && (
          <input className="champ" maxLength={40} placeholder="Son nom (facultatif)" aria-label="Nom de ton IA"
            value={r.autre_ia} onChange={(e) => changer({ autre_ia: e.target.value })} />
        )}
      </Etape>

      <Etape n={2} titre="Ta situation" aide="Tes objectifs datés, ta charge et tes séances sont déjà dans le carnet : l'IA les lira.">
        <label className="block space-y-1">
          <span className="text-[13px] font-semibold text-label-2">Ton objectif</span>
          <textarea rows={2} maxLength={600} className="champ" value={r.objectif}
            placeholder="Exemple : courir 10 km en moins de 50 min au printemps, en gardant deux séances de renfo"
            onChange={(e) => changer({ objectif: e.target.value })} />
        </label>

        <div className="space-y-1.5">
          <p className="text-[13px] font-semibold text-label-2">Tes sports</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(SPORTS).filter(([k]) => k !== "autre").map(([k, s]) => {
              const actif = r.sports.includes(k);
              return (
                <Puce key={k} actif={actif}
                  onClick={() => changer({ sports: actif ? r.sports.filter((x) => x !== k) : [...r.sports, k] })}>
                  {s.emoji} {s.label}
                </Puce>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-[13px] font-semibold text-label-2">Tes disponibilités (durée maximale par jour)</p>
          <div className="tuile py-0.5">
            {JOURS_IA.map(([j, libelle]) => (
              <label key={j} className="ligne justify-between gap-3">
                <span className="text-[15px]">{libelle}</span>
                <select className="bg-transparent text-[15px] text-right text-brand font-medium chiffres"
                  value={r.dispos[j] ?? 0} onChange={(e) => changer({ dispos: { ...r.dispos, [j]: Number(e.target.value) } })}>
                  {DUREES_IA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>

        <label className="block space-y-1">
          <span className="text-[13px] font-semibold text-label-2">Contraintes et blessures</span>
          <textarea rows={3} maxLength={1500} className="champ" value={r.contraintes}
            placeholder="Exemple : pas de course deux jours de suite, genou droit sensible en descente, matériel à la maison : haltères et barre de traction"
            onChange={(e) => changer({ contraintes: e.target.value })} />
          <span className="block text-[12px] text-label-2">
            Ce que tu écris ici est enregistré dans ton compte et recopié dans la consigne que tu donnes à ton IA.
          </span>
        </label>
        <p className="text-[12px] text-label-2 h-4" aria-live="polite">
          {etat === "enregistre" && "✓ Réponses enregistrées"}
          {etat === "erreur" && (
            <span className="text-ios-red">
              Enregistrement impossible : vérifie ta connexion.{" "}
              <button className="underline" onClick={() => enregistrer.current()}>Réessayer</button>
            </span>
          )}
        </p>
      </Etape>

      <Etape n={3} titre="Le niveau d'automatisation"
        aide="Seules les IA capables d'envoyer elles-mêmes des données permettent un plan sans copier-coller.">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Niveau actif={niveau === "semi"} titre="Semi-automatique" pour="Toutes les IA" onClick={() => changer({ niveau: "semi" })}>
            {nom.charAt(0).toUpperCase() + nom.slice(1)} relit ton carnet chaque dimanche et prépare le plan. Tu colles sa réponse dans le Plan, en un geste.
          </Niveau>
          <Niveau actif={niveau === "auto"} indisponible={!autoPossible(r)} titre="Automatique" pour="Claude sur ordinateur"
            onClick={() => changer({ niveau: "auto" })}>
            Claude prépare le plan et l'envoie lui-même dans ton carnet chaque dimanche. Rien à copier ensuite.
          </Niveau>
        </div>
        {!autoPossible(r) && (
          <p className="text-[13px] text-label-2">
            Le niveau automatique demande une IA qui sait à la fois planifier une tâche et appeler le carnet toute seule.
            Aujourd'hui, le carnet ne le propose qu'avec Claude sur ordinateur.
          </p>
        )}
      </Etape>

      <Etape n={4} titre="Ta consigne"
        aide={niveau === "auto" ? "À coller dans Claude, sur ton ordinateur." : `À coller dans ${nom}, une seule fois.`}>
        {!pret ? (
          <p className="text-[15px] text-ios-orange">Il manque encore : {manque.join(" et ")}.</p>
        ) : (
          <>
            <pre className="tuile p-3 text-[12px] leading-[17px] font-mono whitespace-pre-wrap break-words max-h-72 overflow-y-auto"
              tabIndex={0} aria-label="Aperçu de la consigne">{apercu}</pre>

            {niveau === "auto" ? (
              <>
                <p className="text-[13px] text-label-2">
                  La consigne copiée contient ton jeton d'envoi (masqué dans l'aperçu). Il permet de lire tout ton carnet
                  et d'ajouter, modifier ou retirer tes séances prévues (jamais tes séances réalisées ni celles que tu
                  as ajoutées toi-même). Claude le garde dans sa tâche planifiée, sur ton ordinateur : ne colle cette
                  consigne que dans Claude et ne partage pas la conversation. En cas de doute, tu peux le
                  changer dans <Link to="/sources#claude-code" className="text-brand font-medium">Sources</Link> ;
                  l'ancien cesse alors de fonctionner.
                </p>
                <button className="btn-primaire w-full" disabled={occupe} onClick={() => copier("auto")}>
                  {copie === "auto" ? "✓ Consigne copiée" : "Copier la consigne"}
                </button>
              </>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primaire flex-1" disabled={occupe || !lien} onClick={() => copier("lien")}>
                    {copie === "lien" ? "✓ Consigne copiée" : "Copier la consigne"}
                  </button>
                  {ia?.url && <a href={ia.url} target="_blank" rel="noreferrer" className="btn-gris">Ouvrir {ia.nom} ↗</a>}
                </div>
                {lienRate && (
                  <p className="text-[13px] text-ios-red" role="alert">
                    Ton lien n'a pas pu être chargé.{" "}
                    <button className="underline" onClick={() => rechargerLien()}>Réessayer</button>
                  </p>
                )}
                <p className="text-[13px] text-label-2">
                  La consigne contient ton lien en lecture seule : il montre tout ton carnet à qui le possède, sans rien pouvoir
                  y changer. Ne partage pas la conversation ; en cas de doute, change le lien dans{" "}
                  <Link to="/sources#ia" className="text-brand font-medium">Sources</Link> : l'ancien cesse de fonctionner.
                  Si ton IA n'arrive pas à l'ouvrir,{" "}
                  <button className="text-brand font-medium" disabled={occupe} onClick={() => copier("carnet")}>
                    {copie === "carnet" ? "✓ copiée avec le carnet" : "copie la consigne avec le carnet à la suite"}
                  </button>
                  . Elle ne pourra alors pas le relire seule : il faudra lui redonner chaque semaine.
                </p>
              </>
            )}
            {erreurCopie && <p className="text-[13px] text-ios-red" role="alert">{erreurCopie}</p>}
          </>
        )}
      </Etape>

      {pret && (
        <Etape n={5} titre="Et ensuite ?">
          {niveau === "auto" ? (
            <ol className="list-decimal pl-5 space-y-1.5 text-[15px] leading-5">
              <li>Ouvre l'application Claude sur ton ordinateur, dans un mode qui sait planifier des tâches et exécuter des commandes (Cowork ou Claude Code).</li>
              <li>Colle la consigne. Claude crée la tâche du dimanche et envoie un premier plan.</li>
              <li>Ouvre l'onglet <Link to="/plan" className="text-brand font-medium">Plan</Link> : tes séances y sont. Tu choisis ensuite tes jours.</li>
            </ol>
          ) : (
            <ol className="list-decimal pl-5 space-y-1.5 text-[15px] leading-5">
              <li>Colle la consigne dans {nom}. Elle prépare un premier plan et, si elle le peut, programme la suite chaque dimanche.</li>
              <li>Copie toute sa réponse, bloc de code compris.</li>
              <li>Dans l'onglet <Link to="/plan" className="text-brand font-medium">Plan</Link>, touche <strong>Plan IA</strong> et colle-la : les séances s'ajoutent d'un coup.</li>
            </ol>
          )}
          <p className="text-[13px] text-label-2">
            {niveau === "auto"
              ? "La tâche tourne sur ton ordinateur : il doit être allumé, Claude ouvert, le dimanche soir. Sinon, demande simplement à Claude de la lancer à ton retour."
              : "Les tâches planifiées dépendent de ton IA et de ton abonnement. Si la tienne n'en propose pas, écris-lui « Plan de la semaine » chaque dimanche dans la même conversation."}
          </p>
        </Etape>
      )}
    </Page>
  );
}
