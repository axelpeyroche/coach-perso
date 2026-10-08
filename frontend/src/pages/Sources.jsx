import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Card from "../components/Card";
import Page from "../components/Page";
import ConfirmDialog from "../components/ConfirmDialog";
import {
  importerFichierActivites, getImportToken, regenererImportToken,
  getAnalyseToken, regenererAnalyseToken, exporterCarnet, urlApiAbsolue,
  getClaudeToken, regenererClaudeToken, importerTraces,
  getIntervals, connecterIntervals, deconnecterIntervals, synchroIntervals,
} from "../api";

function useCopie() {
  const [copie, setCopie] = useState(null);
  const copier = (texte, cle = "x") =>
    navigator.clipboard.writeText(texte).then(() => { setCopie(cle); setTimeout(() => setCopie(null), 2000); });
  return [copie, copier];
}

function Code({ children }) {
  return (
    <code className="block flex-1 min-w-0 tuile px-3 py-2 text-[12px] font-mono text-label break-all">
      {children}
    </code>
  );
}

function invaliderCarnet(qc) {
  ["activites", "stats-carnet", "objectifs", "mesures", "plan", "carte-traces", "analyses"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

function telecharger(contenu, nom, type) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  a.click();
  URL.revokeObjectURL(url);
}

// En-tête de bloc façon Réglages : pictogramme carré coloré + titre
function Bloc({ id, icone, couleur, titre, sousTitre, children }) {
  return (
    <div id={id} className="scroll-mt-4">
      <Card pad={false}>
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <span className="w-[30px] h-[30px] rounded-[8px] flex items-center justify-center text-[16px] shrink-0"
            style={{ backgroundColor: couleur }}>{icone}</span>
          <div className="min-w-0">
            <h3 className="text-[17px] font-semibold leading-5">{titre}</h3>
            {sousTitre && <p className="text-[13px] text-label-2">{sousTitre}</p>}
          </div>
        </div>
        <div className="px-4 pb-4 space-y-3 text-[15px] text-label">{children}</div>
      </Card>
    </div>
  );
}

// Sous-bloc gris (option, encadré)
function Option({ titre, children }) {
  return (
    <div className="tuile p-3.5 space-y-2">
      {titre && <p className="text-[15px] font-semibold">{titre}</p>}
      {children}
    </div>
  );
}

const btn = "btn-gris btn-sm";
const btnP = "btn-primaire btn-sm";
const lienDanger = "text-[13px] text-ios-red active:opacity-50";

// ── Import fichier ──────────────────────────────────────────────────────────
function BlocFichier() {
  const qc = useQueryClient();
  const input = useRef(null);
  const [res, setRes] = useState(null);
  const imp = useMutation({
    mutationFn: importerFichierActivites,
    onSuccess: (r) => { setRes({ ok: true, ...r }); invaliderCarnet(qc); },
    onError: (e) => setRes({ ok: false, msg: e?.response?.data?.detail ?? "Import impossible" }),
  });

  return (
    <Bloc icone="📄" couleur="#8E8E9333" titre="Fichier CSV" sousTitre="Strava, export du carnet ou CSV générique">
      <div className="space-y-3">
        <p>Formats reconnus :</p>
        <ul className="list-disc pl-5 text-[13px] space-y-1 text-label-2">
          <li><strong>Export Strava</strong> : strava.com → Paramètres → Mon compte → « Télécharger ou supprimer votre compte » → <em>Demander une archive</em>. Dans le zip reçu par mail, prends <code>activities.csv</code>.</li>
          <li><strong>CSV générique</strong> (séparateur <code>;</code> ou <code>,</code>) avec au moins une colonne <code>date</code>/<code>debut</code>, et idéalement <code>sport</code>, <code>titre</code>, <code>duree_min</code> ou <code>duree_sec</code>, <code>distance_km</code>, <code>dplus_m</code>, <code>fc_moyenne_bpm</code>, <code>rpe</code>, <code>notes</code>, <code>id_externe</code> (identifiant unique : évite les doublons si tu réimportes). L'export CSV du carnet est réimportable.</li>
        </ul>
        <p className="text-[13px] text-label-2">Réimporter un fichier ne crée pas de doublons : les activités déjà présentes sont mises à jour ou fusionnées.</p>
        <input ref={input} type="file" accept=".csv,text/csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) { setRes(null); imp.mutate(f); } e.target.value = ""; }} />
        <button className="btn-primaire w-full" disabled={imp.isPending} onClick={() => input.current?.click()}>
          {imp.isPending ? "Import en cours…" : "Choisir un fichier"}
        </button>
        {res && (res.ok ? (
          <p className="text-[13px] text-ios-green">
            {res.source === "mesures"
              ? `✓ ${res.lignes} mesure(s) de forme lue(s) : ${res.cree} ajoutée(s), ${res.maj} mise(s) à jour, ${res.ignore} ignorée(s)`
              : `✓ ${res.lignes} ligne(s) lue(s) (${res.source}) : ${res.cree} ajoutée(s), ${res.maj + res.fusion} mise(s) à jour, ${res.inchange} inchangée(s)`}
          </p>
        ) : <p className="text-[13px] text-ios-red">{String(res.msg)}</p>)}
      </div>
    </Bloc>
  );
}

// ── Tracés GPS (export Santé) ──────────────────────────────────────────────
const RE_POINT = /<trkpt\s+([^>]*)>([\s\S]*?)<\/trkpt>/g;
const attr = (txt, nom) => { const m = txt.match(new RegExp(`${nom}="([^"]+)"`)); return m ? Number(m[1]) : NaN; };

// Lit un GPX et l'allège : un point tous les 10 m (le dernier est toujours gardé).
function lireGpx(texte) {
  const bruts = [];
  for (const [, attrs, corps] of texte.matchAll(RE_POINT)) {
    const lat = attr(attrs, "lat"), lon = attr(attrs, "lon");
    const t = Date.parse(corps.match(/<time>([^<]+)<\/time>/)?.[1]);
    const ele = Number(corps.match(/<ele>([^<]+)<\/ele>/)?.[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(t)) bruts.push([lat, lon, Number.isFinite(ele) ? ele : null, t]);
  }
  if (bruts.length < 2) return null;
  const t0 = bruts[0][3];
  const points = [];
  let dernier = null;
  bruts.forEach((p, i) => {
    if (dernier && i < bruts.length - 1) {
      const dx = (p[1] - dernier[1]) * Math.cos((p[0] * Math.PI) / 180) * 111320;
      const dy = (p[0] - dernier[0]) * 111320;
      if (Math.hypot(dx, dy) < 10) return;
    }
    points.push([+p[0].toFixed(6), +p[1].toFixed(6), p[2] == null ? null : +p[2].toFixed(1), Math.round((p[3] - t0) / 1000)]);
    dernier = p;
  });
  return { debut: new Date(t0).toISOString(), points };
}

function BlocTraces() {
  const qc = useQueryClient();
  const fichiers = useRef(null);
  const dossier = useRef(null);
  const [etat, setEtat] = useState(null); // { fait, total, cree, maj, rattache, erreur, fini }

  async function importer(liste) {
    const gpx = [...liste].filter((f) => f.name.toLowerCase().endsWith(".gpx"));
    if (!gpx.length) { setEtat({ erreur: "Aucun fichier .gpx dans la sélection." }); return; }
    const bilan = { fait: 0, total: gpx.length, cree: 0, maj: 0, rattache: 0 };
    setEtat({ ...bilan });
    let lot = [], taille = 0;
    const envoyer = async () => {
      if (!lot.length) return;
      const r = await importerTraces(lot);
      bilan.cree += r.cree; bilan.maj += r.maj; bilan.rattache += r.rattache;
      lot = []; taille = 0;
    };
    try {
      for (const f of gpx) {
        const t = lireGpx(await f.text());
        if (t) { lot.push(t); taille += t.points.length; }
        bilan.fait += 1;
        if (lot.length >= 25 || taille > 60000) await envoyer();
        setEtat({ ...bilan });
      }
      await envoyer();
      setEtat({ ...bilan, fini: true });
      invaliderCarnet(qc);
    } catch (e) {
      setEtat({ ...bilan, erreur: e?.response?.data?.detail?.toString?.() ?? "Envoi interrompu : relance l'import, les tracés déjà reçus ne seront pas dupliqués." });
    }
  }

  const enCours = etat && !etat.fini && !etat.erreur;
  const choisir = (ref) => (e) => { const l = e.target.files; if (l?.length) importer(l); e.target.value = ""; };

  return (
    <Bloc icone="🗺️" couleur="#34C75933" titre="Tracés GPS" sousTitre="Fichiers GPX de l'export Apple Santé">
      <div className="space-y-3">
        <p>Sur l'iPhone : app <strong>Santé</strong> → ta photo → <em>Exporter toutes les données de santé</em>. Dans le zip,
          le dossier <code>apple_health_export/workout-routes</code> contient un GPX par entraînement en extérieur.</p>
        <p className="text-[13px] text-label-2">Chaque tracé est rattaché à la séance du carnet qui commence au même moment
          (à 5 min près) et s'affiche sur une carte quand tu l'ouvres. Les fichiers sont allégés dans le navigateur avant
          l'envoi. Réimporter le dossier ne crée pas de doublons ; un tracé sans séance sera rattaché plus tard, quand la séance arrivera.</p>
        <input ref={dossier} type="file" webkitdirectory="" className="hidden" onChange={choisir(dossier)} />
        <input ref={fichiers} type="file" multiple accept=".gpx,application/gpx+xml" className="hidden" onChange={choisir(fichiers)} />
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-primaire" disabled={enCours} onClick={() => dossier.current?.click()}>Choisir le dossier</button>
          <button className="btn-teinte" disabled={enCours} onClick={() => fichiers.current?.click()}>Choisir des fichiers</button>
        </div>
        {etat?.total > 0 && (
          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-remplissage overflow-hidden">
              <div className="h-full bg-ios-green transition-all" style={{ width: `${(100 * etat.fait) / etat.total}%` }} />
            </div>
            <p className="text-[13px] text-label-2 chiffres">
              {etat.fini ? "✓ " : ""}{etat.fait} / {etat.total} fichier(s) · {etat.cree} nouveau(x) tracé(s),
              {" "}{etat.maj} mis à jour · {etat.rattache} rattaché(s) à une séance
            </p>
          </div>
        )}
        {etat?.erreur && <p className="text-[13px] text-ios-red">{etat.erreur}</p>}
      </div>
    </Bloc>
  );
}

// ── Intervals.icu (séances de la montre avec tracé GPS) ─────────────────────
// L'app gratuite « Intervals.icu Companion » y envoie chaque entraînement de l'Apple Watch ;
// le carnet les récupère avec la clé API personnelle (gratuite).
const dateHeure = (iso) => new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function BlocIntervals() {
  const qc = useQueryClient();
  const { data: statut } = useQuery({ queryKey: ["intervals"], queryFn: getIntervals });
  const [cle, setCle] = useState("");
  const [athlete, setAthlete] = useState("");
  const [res, setRes] = useState(null);
  const [confirmDeco, setConfirmDeco] = useState(false);
  const erreur = (e) => setRes({ erreur: e?.response?.data?.detail?.toString?.() ?? "Intervals.icu ne répond pas, réessaie plus tard." });

  const synchro = useMutation({
    mutationFn: () => synchroIntervals(true),
    onSuccess: (r) => { setRes(r); qc.setQueryData(["intervals"], r); invaliderCarnet(qc); },
    onError: erreur,
  });
  const connexion = useMutation({
    mutationFn: () => connecterIntervals(cle.trim(), athlete.trim() || null),
    onSuccess: (r) => { qc.setQueryData(["intervals"], r); setCle(""); setAthlete(""); setRes(null); synchro.mutate(); },
    onError: erreur,
  });
  const deco = useMutation({
    mutationFn: deconnecterIntervals,
    onSuccess: (r) => { qc.setQueryData(["intervals"], r); setRes(null); },
  });

  return (
    <Bloc icone="⌚" couleur="#5E5CE626" titre="Intervals.icu" sousTitre="Séances de la montre avec tracé GPS et dénivelé">
      {statut?.connecte ? (
        <div className="space-y-3">
          <p>✓ Connecté{statut.athlete_id ? <> (athlète <code>{statut.athlete_id}</code>)</> : null}.
            {statut.derniere_synchro && <span className="text-label-2"> Dernière synchro : {dateHeure(statut.derniere_synchro)}.</span>}</p>
          <p className="text-[13px] text-label-2">L'app Intervals.icu Companion envoie chaque entraînement de la montre
            sur Intervals.icu ; le carnet va ensuite les chercher via l'API d'Intervals.icu à chaque ouverture (au plus une fois
            par quart d'heure) et chaque nuit si la synchro nocturne est activée. Chaque séance est fusionnée avec celle du carnet qui commence au même moment, sans toucher à
            son titre, et son tracé apparaît sur la carte.</p>
          <div className="flex items-center gap-3">
            <button className={btnP} disabled={synchro.isPending} onClick={() => synchro.mutate()}>
              {synchro.isPending ? "Synchro en cours…" : "Synchroniser maintenant"}
            </button>
            <button className={lienDanger} onClick={() => setConfirmDeco(true)}>Déconnecter</button>
          </div>
          <SynchroNocturne />
        </div>
      ) : (
        <div className="space-y-3">
          <Option titre="1. Sur l'iPhone">
            <p className="text-[13px] text-label-2">Installe l'app gratuite <strong>Intervals.icu Companion</strong>, connecte-la à
              ton compte et autorise l'accès à Santé : chaque entraînement de la montre part sur Intervals.icu avec son tracé.</p>
          </Option>
          <Option titre="2. Clé API">
            <p className="text-[13px] text-label-2">Sur intervals.icu : <em>Settings</em> → <em>Developer Settings</em> → <em>API Key</em>.
              L'identifiant d'athlète (« i » suivi de chiffres) est affiché juste au-dessus. La clé reste sur le serveur du carnet.</p>
            <input className="champ" type="password" autoComplete="off" placeholder="Clé API" value={cle} onChange={(e) => setCle(e.target.value)} />
            <input className="champ" autoComplete="off" placeholder="Identifiant d'athlète (ex. i123456)" value={athlete} onChange={(e) => setAthlete(e.target.value)} />
            <button className={btnP} disabled={cle.trim().length < 10 || connexion.isPending} onClick={() => connexion.mutate()}>
              {connexion.isPending ? "Vérification…" : "Connecter"}
            </button>
          </Option>
        </div>
      )}
      {res && !res.erreur && !res.ignore && (
        <p className="text-[13px] text-label-2 chiffres">✓ {res.nouvelles} nouvelle(s) séance(s), {res.completees} complétée(s),
          {" "}{res.traces} tracé(s) ajouté(s).</p>
      )}
      {res?.forme_recue && !res.erreur && (
        <p className="text-[13px] text-label-2 chiffres">
          Mesures de forme fournies par Intervals.icu sur les {res.forme_jours} derniers jours :
          {" "}FC au repos {res.forme_recue.fc_repos} j · VFC {res.forme_recue.vfc} j · VO2max {res.forme_recue.vo2max} j
          {" "}· sommeil {res.forme_recue.sommeil} j.
        </p>
      )}
      {synchro.isPending && !statut?.derniere_synchro && (
        <p className="text-[13px] text-label-2">Première synchro : récupération des 60 derniers jours, cela peut prendre une minute.</p>
      )}
      {res?.erreur && <p className="text-[13px] text-ios-red">{res.erreur}</p>}
      <ConfirmDialog open={confirmDeco} title="Déconnecter Intervals.icu ?" danger confirmLabel="Déconnecter"
        message="Les séances et tracés déjà récupérés restent dans le carnet."
        onConfirm={() => { setConfirmDeco(false); deco.mutate(); }} onCancel={() => setConfirmDeco(false)} />
    </Bloc>
  );
}

// Synchro chaque nuit via GitHub Actions (.github/workflows/synchro-nocturne.yml).
// Le token de synchro (import_token côté serveur) prouve au carnet que l'appel vient de toi.
function SynchroNocturne() {
  const [token, setToken] = useState(null);
  const [ouvert, setOuvert] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [copie, copier] = useCopie();

  async function ouvrir() {
    if (!token) setToken((await getImportToken()).import_token);
    setOuvert((o) => !o);
  }

  return (
    <div className="tuile p-3.5 text-[13px] space-y-2">
      <p className="text-[15px] font-semibold">Synchro nocturne</p>
      <p className="text-label-2">Une tâche GitHub gratuite réveille le carnet chaque nuit vers 3 h pour récupérer
        séances et mesures de forme, même si tu n'ouvres pas l'app.</p>
      <button className="btn-teinte w-full" onClick={ouvrir}>{ouvert ? "Masquer" : "Configurer"}</button>
      {ouvert && token && (
        <div className="space-y-2 text-label-2">
          <div>
            <p className="libelle">Ton token de synchro (à garder secret)</p>
            <div className="flex gap-2 items-start">
              <Code>{token}</Code>
              <button className={btn} onClick={() => copier(token, "tok")}>{copie === "tok" ? "✓" : "Copier"}</button>
            </div>
            <button className={`${lienDanger} mt-1.5 px-1`} onClick={() => setConfirmRegen(true)}>Régénérer le token</button>
          </div>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Sur github.com, dépôt du carnet : <em>Settings</em> → <em>Secrets and variables</em> → <em>Actions</em>
              → <em>New repository secret</em>.</li>
            <li>Nom : <code>CARNET_IMPORT_TOKEN</code> · Valeur : le token ci-dessus.</li>
            <li>Pour tester : onglet <em>Actions</em> → « Synchro nocturne Intervals.icu » → <em>Run workflow</em>.</li>
          </ol>
        </div>
      )}
      <ConfirmDialog open={confirmRegen} title="Régénérer le token ?" danger
        message="L'ancien token ne fonctionnera plus : il faudra mettre à jour le secret GitHub."
        onConfirm={async () => { setToken((await regenererImportToken()).import_token); setConfirmRegen(false); }}
        onCancel={() => setConfirmRegen(false)} />
    </div>
  );
}

// ── Analyse Claude ─────────────────────────────────────────────────────────
const PROMPT_CLAUDE = (lien) => `Tu es mon coach sportif. Voici l'export complet de mon carnet d'entraînement (profil, objectifs, statistiques et toutes mes séances) : ${lien}

Analyse-le en profondeur :
1. Mon volume, ma régularité et l'évolution de ma charge (ACWR) — y a-t-il des risques ?
2. Mes progrès (allures, efficacité cardiaque, records) et mes points faibles.
3. Pour chaque objectif actif : suis-je dans les temps ? La prédiction est-elle réaliste ?
4. Des recommandations concrètes pour les 4 prochaines semaines.`;

function BlocClaude() {
  const qc = useQueryClient();
  const [copie, copier] = useCopie();
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [chargement, setChargement] = useState(null);
  const { data } = useQuery({ queryKey: ["analyse-token"], queryFn: getAnalyseToken });
  const lien = data ? `${urlApiAbsolue()}/analyse/${data.analyse_token}` : "";

  async function copierTout() {
    setChargement("copie");
    try {
      const md = await exporterCarnet("md");
      await copier(`${PROMPT_CLAUDE("(contenu ci-dessous)")}\n\n---\n\n${md}`, "tout");
    } finally { setChargement(null); }
  }

  async function exporter(format) {
    setChargement(format);
    try {
      const contenu = await exporterCarnet(format);
      const date = new Date().toISOString().slice(0, 10);
      if (format === "json") telecharger(JSON.stringify(contenu, null, 2), `carnet-${date}.json`, "application/json");
      else if (format === "csv") telecharger(contenu, `carnet-${date}.csv`, "text/csv");
      else telecharger(contenu, `carnet-${date}.md`, "text/markdown");
    } finally { setChargement(null); }
  }

  return (
    <>
      <Bloc id="claude" icone="✳️" couleur="#FF950026" titre="Analyse avec Claude" sousTitre="Avec ton abonnement claude.ai">
        <div className="space-y-3">
          <p className="text-[13px] text-label-2">
            Utilise ton abonnement claude.ai (aucun coût d'API) : donne à Claude l'accès à <strong>tout</strong> ton carnet
            de l'une de ces façons.
          </p>

          <Option titre="Lien secret en lecture seule">
            <p className="text-[13px] text-label-2">
              Colle ce lien dans une conversation claude.ai : Claude lit la version à jour du carnet à chaque fois.
              Ajoute <code>?format=json</code> ou <code>?format=csv</code> pour d'autres formats.
            </p>
            <div className="flex gap-2 items-start">
              <Code>{lien || "…"}</Code>
              <button className={btn} disabled={!lien} onClick={() => copier(lien, "lien")}>{copie === "lien" ? "✓" : "Copier"}</button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={btnP} disabled={!lien} onClick={() => copier(PROMPT_CLAUDE(lien), "prompt")}>
                {copie === "prompt" ? "✓ Copié" : "Copier lien + consigne d'analyse"}
              </button>
              <a href="https://claude.ai/new" target="_blank" rel="noreferrer" className={btn}>Ouvrir claude.ai ↗</a>
            </div>
            <button className={lienDanger} onClick={() => setConfirmRegen(true)}>
              Régénérer le lien (invalide l'ancien)
            </button>
          </Option>

          <Option titre="Copier tout le contenu">
            <p className="text-[13px] text-label-2">
              Si Claude n'arrive pas à ouvrir le lien : copie l'export complet (consigne incluse) et colle-le directement.
            </p>
            <button className={btn} disabled={chargement === "copie"} onClick={copierTout}>
              {copie === "tout" ? "✓ Copié" : chargement === "copie" ? "…" : "Copier tout le carnet"}
            </button>
          </Option>

          <Option titre="Fichier à joindre">
            <p className="text-[13px] text-label-2">Télécharge un fichier et glisse-le dans la conversation (ou dans un Projet claude.ai pour l'avoir en contexte permanent).</p>
            <div className="flex flex-wrap gap-2">
              {[["md", "Markdown"], ["csv", "CSV (tableur)"], ["json", "JSON"]].map(([f, l]) => (
                <button key={f} className={btn} disabled={chargement === f} onClick={() => exporter(f)}>
                  {chargement === f ? "…" : l}
                </button>
              ))}
            </div>
          </Option>
        </div>
      </Bloc>
      <ConfirmDialog open={confirmRegen} title="Régénérer le lien d'analyse ?" danger
        message="L'ancien lien ne fonctionnera plus (utile si tu l'as partagé par erreur)."
        onConfirm={async () => { await regenererAnalyseToken(); qc.invalidateQueries({ queryKey: ["analyse-token"] }); setConfirmRegen(false); }}
        onCancel={() => setConfirmRegen(false)} />
    </>
  );
}

// ── Plan avec Claude Code ──────────────────────────────────────────────────
function BlocPlanClaude() {
  const qc = useQueryClient();
  const [copie, copier] = useCopie();
  const [visible, setVisible] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const { data } = useQuery({ queryKey: ["claude-token"], queryFn: getClaudeToken });
  const token = data?.claude_token ?? "";
  const ligneEnv = `CARNET_TOKEN=${token}`;

  return (
    <>
      <Bloc id="plan" icone="🗓️" couleur="#007AFF26" titre="Plan avec Claude Code" sousTitre="Séances prévues envoyées par Claude">
        <div className="space-y-3">
          <p className="text-[13px] text-label-2">
            Claude Code lit ton carnet et t'envoie tes séances prévues (onglet <strong>Plan</strong>) avec ce token,
            via le script <code>outils/carnet.py</code>. Ajoute la ligne ci-dessous dans le fichier <code>.env</code> du projet.
          </p>
          <div className="flex gap-2 items-start">
            <Code>{token ? (visible ? ligneEnv : "CARNET_TOKEN=••••••••••••••••") : "…"}</Code>
            <button className={btn} disabled={!token} onClick={() => setVisible(!visible)}>{visible ? "Masquer" : "Afficher"}</button>
            <button className={btn} disabled={!token} onClick={() => copier(ligneEnv, "env")}>{copie === "env" ? "✓" : "Copier"}</button>
          </div>
          <p className="text-[13px] text-label-2">
            Ce token donne la lecture de tout le carnet et l'écriture du plan : ne le partage pas.
          </p>
          <button className={lienDanger} onClick={() => setConfirmRegen(true)}>
            Régénérer le token (invalide l'ancien)
          </button>
        </div>
      </Bloc>
      <ConfirmDialog open={confirmRegen} title="Régénérer le token Claude ?" danger
        message="L'ancien token ne fonctionnera plus : il faudra mettre à jour le fichier .env."
        onConfirm={async () => { await regenererClaudeToken(); qc.invalidateQueries({ queryKey: ["claude-token"] }); setConfirmRegen(false); }}
        onCancel={() => setConfirmRegen(false)} />
    </>
  );
}

export default function Sources() {
  useEffect(() => {
    const ancre = window.location.hash.slice(1);
    if (ancre === "claude" || ancre === "plan") {
      setTimeout(() => document.getElementById(ancre)?.scrollIntoView({ behavior: "smooth" }), 300);
    }
  }, []);

  return (
    <Page titre="Sources" sousTitre="Import et export">
      <div className="space-y-1.5">
        <h2 className="entete-liste">Importer</h2>
        <div className="grid gap-3 lg:grid-cols-2 items-start">
          {/* Import CSV et GPX masqués : les séances et tracés arrivent par Intervals.icu (BlocFichier, BlocTraces) */}
          <BlocIntervals />
        </div>
      </div>
      <div className="space-y-1.5">
        <h2 className="entete-liste">Claude</h2>
        <div className="space-y-3">
          <BlocClaude />
          <BlocPlanClaude />
        </div>
      </div>
    </Page>
  );
}
