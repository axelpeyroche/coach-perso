import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Card from "../components/Card";
import ConfirmDialog from "../components/ConfirmDialog";
import {
  importerFichierActivites, getImportToken, regenererImportToken,
  getAnalyseToken, regenererAnalyseToken, exporterCarnet, urlApiAbsolue,
  getClaudeToken, regenererClaudeToken,
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
  ["activites", "stats-carnet", "objectifs", "mesures", "plan"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
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
// Champs Texte du corps JSON : [clé, valeur à insérer]
const Champs = ({ lignes }) => (
  <span className="mt-1 grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5">
    {lignes.map(([k, v]) => (
      <span key={k} className="contents">
        <code className="text-gray-800 dark:text-gray-200">{k}</code>
        <span>{v}</span>
      </span>
    ))}
  </span>
);

const ETAPES_RACCOURCI = (url) => [
  ["Rechercher des échantillons de santé", "Type : Entraînements · Date de début : dans les 3 derniers jours · Limite : désactivée."],
  ["Répéter avec chaque élément", "Entrée : les échantillons trouvés. L'étape 3 se place à l'intérieur de la boucle."],
  ["Obtenir le contenu de l'URL (dans la boucle)", <>
    URL : <code>{url}/activites/import</code> · Méthode : POST · Corps de la requête : JSON, avec ces champs de type Texte.
    Pour une propriété : insère la variable « Élément de répétition », touche-la, puis choisis la propriété.
    <Champs lignes={[
      ["token", "ton token (ci-dessus)"],
      ["type", "Élément de répétition › Type d'entraînement"],
      ["debut", "› Date de début (touche-la → Format de date : ISO 8601)"],
      ["fin", "› Date de fin (ISO 8601)"],
      ["duree", "› Durée"],
      ["distance", "› Distance"],
      ["calories", "› Énergie active"],
    ]} />
  </>],
  ["Fin de la répétition", "Rien à régler."],
  ["Rechercher des échantillons de santé (une action par type)", <>
    Limite désactivée pour chacune. Renomme chaque résultat (touche la variable › Renommer) pour t'y retrouver à l'étape 6.
    <Champs lignes={[
      ["7 derniers jours", "Fréquence cardiaque au repos · Variabilité de la fréquence cardiaque · VO2 max"],
      ["3 derniers jours", "Fréquence cardiaque · Puissance de course · Vitesse de course · Longueur de foulée · Oscillation verticale · Temps de contact au sol · Nombre de pas"],
      ["3 derniers jours, si proposé", "Effort de l'entraînement (noté) · Effort estimé de l'entraînement"],
    ]} />
  </>],
  ["Obtenir le contenu de l'URL", <>
    Même URL, POST, JSON en Texte. Pour chaque type, deux champs : <code>&lt;type&gt;_valeurs</code> = la liste trouvée › Valeur,
    et <code>&lt;type&gt;_dates</code> = la liste › Date de début (ISO 8601). Un type absent est simplement ignoré.
    <Champs lignes={[
      ["token", "ton token"],
      ["fc_repos_…", "FC au repos"],
      ["vfc_…", "Variabilité"],
      ["vo2max_…", "VO2 max"],
      ["fc_…", "Fréquence cardiaque"],
      ["puissance_…", "Puissance de course"],
      ["vitesse_…", "Vitesse de course"],
      ["foulee_…", "Longueur de foulée"],
      ["oscillation_…", "Oscillation verticale"],
      ["contact_sol_…", "Temps de contact au sol"],
      ["pas_…", "Nombre de pas"],
      ["effort_…", "Effort noté sur la montre"],
      ["effort_estime_…", "Effort estimé par la montre"],
    ]} />
    Le carnet rattache chaque échantillon à la séance pendant laquelle il a été mesuré : FC moyenne / max / min, zones FC
    (calculées depuis ton profil), puissance, allure, foulée, oscillation, temps de contact, pas, et RPE depuis le score d'effort
    (la charge s'en déduit). Les valeurs déjà connues (export Santé, saisie manuelle) ne sont pas écrasées.
  </>],
  ["Afficher une notification (facultatif)", "Contenu : « Contenu de l'URL » — le carnet répond par exemple « 5 mesure(s) de forme · 2 séance(s) complétée(s) »."],
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
    type: "Course à pied", debut: "2026-10-05T07:30:00+02:00", fin: "2026-10-05T08:22:00+02:00",
    duree: "50 min", distance: "10,2 km", calories: "690 kcal",
    vfc_valeurs: "56\n47,9", vfc_dates: "2026-10-04T06:10:00+02:00\n2026-10-05T05:58:00+02:00",
    fc_valeurs: "128\n141\n…", fc_dates: "2026-10-05T07:30:05+02:00\n2026-10-05T07:30:10+02:00\n…",
    puissance_valeurs: "251 W\n…", puissance_dates: "2026-10-05T07:31:00+02:00\n…",
    effort_estime_valeurs: "6,4", effort_estime_dates: "2026-10-05T08:22:00+02:00",
  }, null, 2);

  return (
    <Card title="🍎 Apple Santé (raccourci iOS)">
      <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
        <p>
          Apple ne permet pas aux sites web de lire Santé directement : un raccourci iOS envoie tes entraînements
          (Apple Watch ou autres apps synchronisées avec Santé) tes mesures de forme (FC au repos, VFC, VO2max) et le détail de chaque séance (FC, zones, puissance, foulée, effort…) vers ton carnet. Lance-le à la main ou via une
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
                Les unités écrites par iOS (« km », « m », « kcal », « min ») et les dates localisées sont comprises.
                Aussi accepté : <code>activites</code> (liste), <code>mesures</code> (liste de {"{type, date, valeur}"}),
                <code> dplus_m</code>, <code>fc_moyenne_bpm</code>, <code>fc_max_bpm</code>, <code>rpe</code>, <code>notes</code>,
                <code> id</code> (identifiant unique pour éviter les doublons).
              </p>
            </details>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-xs space-y-1">
              <p className="font-semibold text-gray-700 dark:text-gray-200">Pour que ça tourne tout seul</p>
              <p>
                Raccourcis → Automatisation → <b>+</b> → « App » → Forme → « Est fermée » → « Exécuter immédiatement »
                → ce raccourci. Ajoute une 2ᵉ automatisation « Heure de la journée » (ex. 7 h 30, tous les jours) en filet de sécurité.
              </p>
              <p className="text-gray-400">
                iOS bloque l'accès à Santé quand l'iPhone est verrouillé : une exécution peut alors échouer, la suivante
                rattrape (le raccourci regarde 3 jours en arrière, sans créer de doublon).
              </p>
            </div>
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
    <div id="plan">
      <Card title="🗓️ Plan avec Claude Code">
        <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
          <p>
            Claude Code lit ton carnet et t'envoie tes séances prévues (onglet <strong>Plan</strong>) avec ce token,
            via le script <code>outils/carnet.py</code>. Ajoute la ligne ci-dessous dans le fichier <code>.env</code> du projet.
          </p>
          <div className="flex gap-2 items-start">
            <Code>{token ? (visible ? ligneEnv : "CARNET_TOKEN=••••••••••••••••") : "…"}</Code>
            <button className={btnSecondaire} disabled={!token} onClick={() => setVisible(!visible)}>{visible ? "Masquer" : "Afficher"}</button>
            <button className={btnSecondaire} disabled={!token} onClick={() => copier(ligneEnv, "env")}>{copie === "env" ? "✓" : "Copier"}</button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Ce token donne la lecture de tout le carnet et l'écriture du plan : ne le partage pas.
          </p>
          <button className="text-xs text-gray-400 hover:text-red-500 underline" onClick={() => setConfirmRegen(true)}>
            Régénérer le token (invalide l'ancien)
          </button>
        </div>
      </Card>
      <ConfirmDialog open={confirmRegen} title="Régénérer le token Claude ?" danger
        message="L'ancien token ne fonctionnera plus : il faudra mettre à jour le fichier .env."
        onConfirm={async () => { await regenererClaudeToken(); qc.invalidateQueries({ queryKey: ["claude-token"] }); setConfirmRegen(false); }}
        onCancel={() => setConfirmRegen(false)} />
    </div>
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
      <BlocPlanClaude />
    </div>
  );
}
