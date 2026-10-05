import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Card from "../components/Card";
import ConfirmDialog from "../components/ConfirmDialog";
import {
  importerFichierActivites, getImportToken, regenererImportToken,
  getAnalyseToken, regenererAnalyseToken, exporterCarnet, urlApiAbsolue,
} from "../api";
import { btnPrimaire, btnSecondaire } from "../carnet";

function useCopie() {
  const [copie, setCopie] = useState(null);
  const copier = (texte, cle = "x") =>
    navigator.clipboard.writeText(texte).then(() => { setCopie(cle); setTimeout(() => setCopie(null), 2000); });
  return [copie, copier];
}

function Code({ children }) {
  return (
    <code className="block flex-1 min-w-0 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-xs font-mono text-gray-800 dark:text-gray-200 break-all">
      {children}
    </code>
  );
}

function invaliderCarnet(qc) {
  ["activites", "stats-carnet", "objectifs", "mesures"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

function telecharger(contenu, nom, type) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Strava (export gratuit) ─────────────────────────────────────────────────
// La connexion API Strava est réservée aux abonnés : on passe par l'archive
// « Télécharger vos données », gratuite pour tous les comptes.
function BlocStrava() {
  return (
    <Card title="🟧 Strava (export gratuit)">
      <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
        <p>Strava permet à tous les comptes (même gratuits) de télécharger l'archive complète de leurs activités :</p>
        <ol className="list-decimal list-inside text-xs space-y-1 text-gray-500 dark:text-gray-400">
          <li>Sur <strong>strava.com</strong> (navigateur, pas l'app) : avatar → <em>Paramètres</em> → <em>Mon compte</em>.</li>
          <li>« Télécharger ou supprimer votre compte » → <em>Commencer</em> → <em>Demander une archive</em>.</li>
          <li>Tu reçois un mail avec un zip (quelques minutes à quelques heures).</li>
          <li>Dézippe-le et importe le fichier <code>activities.csv</code> dans le bloc « Fichier CSV » ci-contre.</li>
        </ol>
        <p className="text-xs text-gray-400">
          Tu peux refaire l'opération quand tu veux : les activités déjà importées sont reconnues (identifiant Strava)
          et les doublons avec Apple Santé sont fusionnés.
        </p>
      </div>
    </Card>
  );
}

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
    <Card title="📄 Fichier CSV">
      <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
        <p>Formats reconnus :</p>
        <ul className="list-disc list-inside text-xs space-y-1 text-gray-500 dark:text-gray-400">
          <li><strong>Export Strava</strong> : strava.com → Paramètres → Mon compte → « Télécharger ou supprimer votre compte » → <em>Demander une archive</em>. Dans le zip reçu par mail, prends <code>activities.csv</code>.</li>
          <li><strong>CSV générique</strong> (séparateur <code>;</code> ou <code>,</code>) avec au moins une colonne <code>date</code>/<code>debut</code>, et idéalement <code>sport</code>, <code>titre</code>, <code>duree_min</code> ou <code>duree_sec</code>, <code>distance_km</code>, <code>dplus_m</code>, <code>fc_moyenne_bpm</code>, <code>rpe</code>, <code>notes</code>, <code>id_externe</code> (identifiant unique : évite les doublons si tu réimportes). L'export CSV du carnet est réimportable.</li>
        </ul>
        <p className="text-xs text-gray-400">Réimporter un fichier ne crée pas de doublons : les activités déjà présentes sont mises à jour ou fusionnées.</p>
        <input ref={input} type="file" accept=".csv,text/csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) { setRes(null); imp.mutate(f); } e.target.value = ""; }} />
        <button className={btnPrimaire} disabled={imp.isPending} onClick={() => input.current?.click()}>
          {imp.isPending ? "Import en cours…" : "Choisir un fichier"}
        </button>
        {res && (res.ok ? (
          <p className="text-xs text-green-600 dark:text-green-400">
            {res.source === "mesures"
              ? `✓ ${res.lignes} mesure(s) de forme lue(s) : ${res.cree} ajoutée(s), ${res.maj} mise(s) à jour, ${res.ignore} ignorée(s)`
              : `✓ ${res.lignes} ligne(s) lue(s) (${res.source}) : ${res.cree} ajoutée(s), ${res.maj + res.fusion} mise(s) à jour, ${res.inchange} inchangée(s)`}
          </p>
        ) : <p className="text-xs text-red-500">{String(res.msg)}</p>)}
      </div>
    </Card>
  );
}

// ── Raccourci iOS (Apple Santé) ────────────────────────────────────────────
const ETAPES_RACCOURCI = (url) => [
  ["Rechercher des échantillons de santé", "Type : Entraînements · Date de début : dans les 7 derniers jours (ou « est après » 01/01/2026 pour le premier import de l'historique) · Trier par date de début · Limite : désactivée"],
  ["Répéter avec chaque élément", "Entrée : les échantillons trouvés. Les étapes 3 à 6 sont à l'intérieur de la boucle."],
  ["Obtenir les détails des échantillons de santé (× 6)", "Sur « Élément de répétition » : Type d'entraînement, Date de début, Date de fin, Durée, Distance, Énergie active (et Fréquence cardiaque moyenne si proposée)."],
  ["Formater la date (× 2)", "Date de début puis Date de fin → format « ISO 8601 », heure incluse."],
  ["Dictionnaire", "type → Type d'entraînement · debut → date de début formatée · fin → date de fin formatée · duree_sec → Durée · distance_km → Distance · calories → Énergie active · fc_moyenne_bpm → FC moyenne"],
  ["Obtenir le contenu de l'URL", `URL : ${url}/activites/import · Méthode : POST · Corps : JSON avec token (Texte) = ton token et activite (Dictionnaire) = le dictionnaire de l'étape 5`],
  ["Fin de la répétition, puis Afficher une notification", "« Séances envoyées au carnet ✓ »"],
];

function BlocRaccourci() {
  const [token, setToken] = useState(null);
  const [ouvert, setOuvert] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [copie, copier] = useCopie();
  const url = urlApiAbsolue();

  async function ouvrir() {
    if (!token) setToken((await getImportToken()).import_token);
    setOuvert((o) => !o);
  }

  const exemple = JSON.stringify({
    token: "TON_TOKEN",
    activite: { type: "Course à pied", debut: "2026-10-05T07:30:00+02:00", fin: "2026-10-05T08:22:00+02:00", distance_km: 10.2, fc_moyenne_bpm: 148, calories: 690 },
  }, null, 2);

  return (
    <Card title="🍎 Apple Santé (raccourci iOS)">
      <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
        <p>
          Apple ne permet pas aux sites web de lire Santé directement : un raccourci iOS envoie tes entraînements
          (Apple Watch ou autres apps synchronisées avec Santé) vers ton carnet. Lance-le à la main ou via une
          automatisation quotidienne. Renvoyer plusieurs fois la même séance ne crée pas de doublon, et les doublons avec Strava sont fusionnés automatiquement.
        </p>
        <button className={btnSecondaire} onClick={ouvrir}>{ouvert ? "Masquer le guide" : "Configurer le raccourci"}</button>
        {ouvert && token && (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">Ton token d'import (à garder secret)</p>
              <div className="flex gap-2 items-start">
                <Code>{token}</Code>
                <button className={btnSecondaire} onClick={() => copier(token, "tok")}>{copie === "tok" ? "✓" : "Copier"}</button>
              </div>
              <button className="text-xs text-gray-400 hover:text-red-500 underline mt-1" onClick={() => setConfirmRegen(true)}>Régénérer</button>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">Adresse d'envoi</p>
              <div className="flex gap-2 items-start">
                <Code>{url}/activites/import</Code>
                <button className={btnSecondaire} onClick={() => copier(`${url}/activites/import`, "url")}>{copie === "url" ? "✓" : "Copier"}</button>
              </div>
            </div>
            <ol className="space-y-2">
              {ETAPES_RACCOURCI(url).map(([titre, corps], i) => (
                <li key={i} className="flex gap-3 rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
                  <span className="shrink-0 w-6 h-6 rounded-lg bg-brand text-white flex items-center justify-center text-xs font-bold">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-brand">{titre}</span>
                    <span className="block text-xs text-gray-600 dark:text-gray-400 break-words">{corps}</span>
                  </span>
                </li>
              ))}
            </ol>
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-500">Format JSON accepté (pour un script ou un autre outil)</summary>
              <pre className="mt-2 bg-gray-900 text-gray-100 rounded-lg p-3 overflow-x-auto">{exemple}</pre>
              <p className="mt-1 text-gray-400">
                Aussi accepté : <code>activites</code> (liste), <code>duree_min</code>, <code>distance_m</code>, <code>dplus_m</code>,
                <code> fc_max_bpm</code>, <code>rpe</code>, <code>notes</code>, <code>id</code> (identifiant unique pour éviter les doublons).
              </p>
            </details>
            <p className="text-xs text-gray-400">
              Astuce : Raccourcis → Automatisation → « Heure de la journée » (ex. 21 h, tous les jours) → exécuter ce raccourci
              sans demander : ton carnet se remplit tout seul.
            </p>
          </div>
        )}
      </div>
      <ConfirmDialog open={confirmRegen} title="Régénérer le token ?" danger
        message="L'ancien token ne fonctionnera plus : il faudra mettre à jour le raccourci."
        onConfirm={async () => { setToken((await regenererImportToken()).import_token); setConfirmRegen(false); }}
        onCancel={() => setConfirmRegen(false)} />
    </Card>
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
    <div id="claude">
      <Card title="🤖 Analyse approfondie avec Claude">
        <div className="space-y-4 text-sm text-gray-600 dark:text-gray-300">
          <p>
            Utilise ton abonnement claude.ai (aucun coût d'API) : donne à Claude l'accès à <strong>tout</strong> ton carnet
            de l'une de ces façons.
          </p>

          <div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Option 1 — Lien secret en lecture seule</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Colle ce lien dans une conversation claude.ai : Claude lit la version à jour du carnet à chaque fois.
              Ajoute <code>?format=json</code> ou <code>?format=csv</code> pour d'autres formats.
            </p>
            <div className="flex gap-2 items-start">
              <Code>{lien || "…"}</Code>
              <button className={btnSecondaire} disabled={!lien} onClick={() => copier(lien, "lien")}>{copie === "lien" ? "✓" : "Copier"}</button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={btnPrimaire} disabled={!lien} onClick={() => copier(PROMPT_CLAUDE(lien), "prompt")}>
                {copie === "prompt" ? "✓ Copié" : "Copier lien + consigne d'analyse"}
              </button>
              <a href="https://claude.ai/new" target="_blank" rel="noreferrer" className={btnSecondaire}>Ouvrir claude.ai ↗</a>
            </div>
            <button className="text-xs text-gray-400 hover:text-red-500 underline" onClick={() => setConfirmRegen(true)}>
              Régénérer le lien (invalide l'ancien)
            </button>
          </div>

          <div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Option 2 — Copier tout le contenu</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Si Claude n'arrive pas à ouvrir le lien : copie l'export complet (consigne incluse) et colle-le directement.
            </p>
            <button className={btnSecondaire} disabled={chargement === "copie"} onClick={copierTout}>
              {copie === "tout" ? "✓ Copié" : chargement === "copie" ? "…" : "Copier tout le carnet"}
            </button>
          </div>

          <div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Option 3 — Fichier à joindre</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Télécharge un fichier et glisse-le dans la conversation (ou dans un Projet claude.ai pour l'avoir en contexte permanent).</p>
            <div className="flex flex-wrap gap-2">
              {[["md", "Markdown"], ["csv", "CSV (tableur)"], ["json", "JSON"]].map(([f, l]) => (
                <button key={f} className={btnSecondaire} disabled={chargement === f} onClick={() => exporter(f)}>
                  {chargement === f ? "…" : l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>
      <ConfirmDialog open={confirmRegen} title="Régénérer le lien d'analyse ?" danger
        message="L'ancien lien ne fonctionnera plus (utile si tu l'as partagé par erreur)."
        onConfirm={async () => { await regenererAnalyseToken(); qc.invalidateQueries({ queryKey: ["analyse-token"] }); setConfirmRegen(false); }}
        onCancel={() => setConfirmRegen(false)} />
    </div>
  );
}

export default function Sources() {
  useEffect(() => {
    if (window.location.hash === "#claude") {
      setTimeout(() => document.getElementById("claude")?.scrollIntoView({ behavior: "smooth" }), 300);
    }
  }, []);

  return (
    <div className="p-4 md:p-8 w-full space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Sources & export</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Importe tes séances de partout, puis fais-les analyser par Claude</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <BlocStrava />
        <BlocRaccourci />
        <BlocFichier />
      </div>
      <BlocClaude />
    </div>
  );
}
