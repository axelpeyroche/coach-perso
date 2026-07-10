import { useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { useAuth } from "../AuthContext";
import api from "../api";

// ─── Helpers ────────────────────────────────────────────────────────────────

function ChoixCard({ icon, titre, description, selected, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={clsx(
        "w-full flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all",
        selected
          ? "border-brand bg-brand/5 dark:bg-brand/10"
          : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-900"
      )}>
      <span className="text-2xl shrink-0">{icon}</span>
      <div>
        <p className={clsx("font-semibold text-sm", selected ? "text-brand" : "text-gray-900 dark:text-white")}>{titre}</p>
        {description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>}
      </div>
      <span className={clsx("ml-auto w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center mt-0.5",
        selected ? "border-brand bg-brand" : "border-gray-300 dark:border-gray-600")}>
        {selected && <span className="text-white text-xs">✓</span>}
      </span>
    </button>
  );
}

function NumInput({ label, value, onChange, min = 1, max = 14, placeholder }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      <input type="number" min={min} max={max}
        value={value === 0 ? "" : value}
        placeholder={placeholder}
        onChange={e => {
          const v = e.target.value;
          if (v === "" || v === "0") { onChange(0); return; }
          const n = parseInt(v, 10);
          if (!isNaN(n)) onChange(Math.min(Math.max(n, min), max));
        }}
        onBlur={e => { if (!e.target.value || parseInt(e.target.value) < min) onChange(min); }}
        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
    </div>
  );
}

function TextInput({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
    </div>
  );
}

const ETAPES = [
  { num: 1, label: "Programme" },
  { num: 2, label: "Organisation" },
  { num: 3, label: "Historique" },
  { num: 4, label: "Objectif" },
];

// ─── Étape 1 : type de programme ────────────────────────────────────────────

function Etape1({ data, set }) {
  return (
    <div className="space-y-3">
      <ChoixCard icon="🏃" titre="Course à pied uniquement"
        description="Séances de running, endurance et intervalles"
        selected={data.type_programme === "course"}
        onClick={() => set({ type_programme: "course" })} />
      <ChoixCard icon="💪" titre="Musculation uniquement"
        description="AMRAP, EMOM et travail au poids du corps"
        selected={data.type_programme === "muscu"}
        onClick={() => set({ type_programme: "muscu" })} />
      <ChoixCard icon="⚡" titre="Hybride — les deux"
        description="Alternance course et musculation chaque semaine"
        selected={data.type_programme === "hybride"}
        onClick={() => set({ type_programme: "hybride" })} />
    </div>
  );
}

// ─── Étape 2 : organisation des séances ─────────────────────────────────────

function Etape2({ data, set }) {
  const isHybride = data.type_programme === "hybride";

  return (
    <div className="space-y-4">
      <NumInput
        label="Nombre de séances par semaine (total)"
        value={data.seances_semaine} onChange={v => set({ seances_semaine: v })}
        min={1} max={14}
      />

      {isHybride && (
        <>
          <NumInput
            label="Dont séances de course"
            value={data.seances_course_semaine ?? 2}
            onChange={v => set({ seances_course_semaine: v })}
            min={1} max={data.seances_semaine - 1}
          />
          <NumInput
            label="Dont séances de musculation"
            value={data.seances_muscu_semaine ?? 2}
            onChange={v => set({ seances_muscu_semaine: v })}
            min={1} max={data.seances_semaine - 1}
          />
        </>
      )}

      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Fréquence des tests d'évaluation</p>
        <div className="space-y-2">
          {[
            { v: 4,  label: "Toutes les 4 semaines", desc: "Suivi rapproché" },
            { v: 8,  label: "Toutes les 8 semaines", desc: "Recommandé" },
            { v: 12, label: "Toutes les 12 semaines", desc: "Suivi léger" },
          ].map(({ v, label, desc }) => (
            <ChoixCard key={v} icon="🎯" titre={label} description={desc}
              selected={data.frequence_tests_semaines === v}
              onClick={() => set({ frequence_tests_semaines: v })} />
          ))}
        </div>
      </div>

      <div>
        <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date de début du programme</p>
        <input type="date" value={data.date_debut_raw ?? ""}
          onChange={e => set({ date_debut_raw: e.target.value })}
          className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
        <p className="text-xs text-gray-400 mt-1">
          {data.date_debut_raw
            ? (() => {
                const [y, m, d] = data.date_debut_raw.split("-");
                return `Le programme démarrera le ${d}/${m}/${y}.`;
              })()
            : "Laisse vide pour démarrer dès le lundi de cette semaine."}
        </p>
      </div>
    </div>
  );
}

// ─── Étape 3 : historique de performance ────────────────────────────────────

function Etape3({ data, set }) {
  const isCourse  = data.type_programme === "course" || data.type_programme === "hybride";
  const isMuscu   = data.type_programme === "muscu"  || data.type_programme === "hybride";
  const h = data.historique;
  const setH = patch => set({ historique: { ...h, ...patch } });

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3">
        Ces informations permettent de calibrer précisément l'intensité et le volume de tes séances dès le premier jour. Tous les champs sont optionnels — laisse vide si tu ne sais pas.
      </p>

      {/* Niveau général */}
      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Ton niveau général</p>
        <div className="space-y-2">
          {[
            { v: "debutant",      icon: "🌱", titre: "Débutant",      desc: "Moins d'1 an de pratique régulière" },
            { v: "intermediaire", icon: "📈", titre: "Intermédiaire",  desc: "1 à 3 ans de pratique, bases solides" },
            { v: "confirme",      icon: "🏆", titre: "Confirmé",       desc: "3+ ans, charge d'entraînement élevée" },
          ].map(({ v, icon, titre, desc }) => (
            <ChoixCard key={v} icon={icon} titre={titre} description={desc}
              selected={h.niveau === v}
              onClick={() => setH({ niveau: v })} />
          ))}
        </div>
      </div>

      {/* Années de pratique */}
      <TextInput label="Années de pratique sportive régulière" value={h.annees_pratique ?? ""}
        onChange={v => setH({ annees_pratique: v })} placeholder="ex : 3 ans" />

      {/* Course */}
      {isCourse && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide border-t border-gray-100 dark:border-gray-800 pt-4">
            🏃 Running
          </p>
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="Volume hebdo actuel (km/sem)" value={h.volume_km_semaine ?? ""}
              onChange={v => setH({ volume_km_semaine: v })} placeholder="ex : 30" />
            <TextInput label="Longue sortie (km)" value={h.longue_sortie_km ?? ""}
              onChange={v => setH({ longue_sortie_km: v })} placeholder="ex : 15" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="Meilleur 10 km" value={h.chrono_10k ?? ""}
              onChange={v => setH({ chrono_10k: v })} placeholder="ex : 50:00" />
            <TextInput label="Meilleur semi-marathon" value={h.chrono_semi ?? ""}
              onChange={v => setH({ chrono_semi: v })} placeholder="ex : 1h50:00" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="Meilleur marathon" value={h.chrono_marathon ?? ""}
              onChange={v => setH({ chrono_marathon: v })} placeholder="ex : 4h00:00" />
            <TextInput label="VMA estimée (km/h)" value={h.vma_estimee ?? ""}
              onChange={v => setH({ vma_estimee: v })} placeholder="ex : 14" />
          </div>
          <TextInput label="Fréquence cardiaque max connue (bpm)" value={h.fc_max ?? ""}
            onChange={v => setH({ fc_max: v })} placeholder="ex : 190" />
        </div>
      )}

      {/* Muscu */}
      {isMuscu && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide border-t border-gray-100 dark:border-gray-800 pt-4">
            💪 Musculation
          </p>
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="Max pompes enchaînées" value={h.max_pompes ?? ""}
              onChange={v => setH({ max_pompes: v })} placeholder="ex : 25" />
            <TextInput label="Max tractions" value={h.max_tractions ?? ""}
              onChange={v => setH({ max_tractions: v })} placeholder="ex : 8" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="Max squats en 1 min" value={h.max_squats ?? ""}
              onChange={v => setH({ max_squats: v })} placeholder="ex : 40" />
            <TextInput label="Max burpees en 1 min" value={h.max_burpees ?? ""}
              onChange={v => setH({ max_burpees: v })} placeholder="ex : 15" />
          </div>
        </div>
      )}

      {/* Blessures / limitations */}
      <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Blessures ou limitations actuelles
        </label>
        <textarea value={h.blessures ?? ""} onChange={e => setH({ blessures: e.target.value })}
          rows={3} placeholder="Douleur genou droit, tendinite, dos fragile… (optionnel)"
          className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand" />
      </div>
    </div>
  );
}

// ─── Étape 4 : objectif ──────────────────────────────────────────────────────

function Etape4({ data, set }) {
  const isCourse  = data.type_programme === "course"  || data.type_programme === "hybride";
  const isMuscu   = data.type_programme === "muscu"   || data.type_programme === "hybride";

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {isCourse && (
          <ChoixCard icon="🏁" titre="Objectif de course"
            description="Préparer un 10km, semi, marathon…"
            selected={data.objectif_type === "course"}
            onClick={() => set({ objectif_type: "course" })} />
        )}
        {isMuscu && (
          <ChoixCard icon="🏆" titre="Objectif de performance muscu"
            description="Progresser sur les mouvements de force"
            selected={data.objectif_type === "muscu"}
            onClick={() => set({ objectif_type: "muscu" })} />
        )}
        <ChoixCard icon="🌀" titre="Pas d'objectif particulier"
          description="Programme de progression générale"
          selected={data.objectif_type === "aucun"}
          onClick={() => set({ objectif_type: "aucun" })} />
      </div>

      {data.objectif_type === "course" && (
        <div className="rounded-xl border border-brand/30 bg-brand/5 dark:bg-brand/10 p-4 space-y-3">
          <p className="text-sm font-semibold text-brand">Détails de la course cible</p>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Nom de la course</label>
            <input type="text" value={data.objectif_course_nom ?? ""} placeholder="Marathon de Paris"
              onChange={e => set({ objectif_course_nom: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Date</label>
              <input type="date" value={data.objectif_course_date ?? ""}
                onChange={e => set({ objectif_course_date: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Distance (km)</label>
              <input type="number" step="0.1" value={data.objectif_course_km ?? ""}
                onChange={e => set({ objectif_course_km: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Objectif de temps (min)</label>
            <input type="number" value={data.objectif_course_temps ?? ""}
              placeholder="ex: 240 pour 4h"
              onChange={e => set({ objectif_course_temps: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page Onboarding ─────────────────────────────────────────────────────────

export default function Onboarding() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [etape, setEtape] = useState(1);
  const [err, setErr]     = useState("");
  const [loading, setLoading] = useState(false);

  const [data, setData] = useState({
    type_programme: "hybride",
    seances_semaine: 4,
    seances_course_semaine: 2,
    seances_muscu_semaine: 2,
    frequence_tests_semaines: 8,
    objectif_type: "aucun",
    date_debut_raw: "",
    historique: {
      niveau: "",
      annees_pratique: "",
      volume_km_semaine: "",
      longue_sortie_km: "",
      chrono_10k: "",
      chrono_semi: "",
      chrono_marathon: "",
      vma_estimee: "",
      fc_max: "",
      max_pompes: "",
      max_tractions: "",
      max_squats: "",
      max_burpees: "",
      blessures: "",
    },
    objectif_course_nom: "",
    objectif_course_date: "",
    objectif_course_km: "",
    objectif_course_temps: "",
  });

  function set(patch) { setData(d => ({ ...d, ...patch })); }

  function todayMonday() {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  function formatDateFr(isoStr) {
    if (!isoStr) return null;
    const [y, m, d] = isoStr.split("-");
    return `${d}/${m}/${y}`;
  }

  function canGoNext() {
    if (etape === 1) return !!data.type_programme;
    if (etape === 2) return data.seances_semaine >= 1 && data.frequence_tests_semaines > 0;
    if (etape === 3) return true; // tout optionnel
    if (etape === 4) return !!data.objectif_type;
    return true;
  }

  // Nettoie l'historique en enlevant les champs vides avant envoi
  function buildHistorique() {
    const h = {};
    for (const [k, v] of Object.entries(data.historique)) {
      if (v !== "" && v !== null && v !== undefined) h[k] = v;
    }
    return Object.keys(h).length > 0 ? h : null;
  }

  async function valider() {
    setErr(""); setLoading(true);
    try {
      const dateDebutRaw = data.date_debut_raw || todayMonday();
      const dateDebutFr  = formatDateFr(dateDebutRaw);

      if (data.objectif_type === "course" && data.objectif_course_nom && data.objectif_course_date && data.objectif_course_km) {
        await api.post("/objectif-course", {
          nom: data.objectif_course_nom,
          date_course: formatDateFr(data.objectif_course_date),
          distance_km: parseFloat(data.objectif_course_km),
          objectif_temps_min: data.objectif_course_temps ? parseInt(data.objectif_course_temps) : 0,
        });
      }

      await api.post("/auth/onboarding", {
        type_programme: data.type_programme,
        seances_semaine: data.seances_semaine,
        seances_course_semaine: data.type_programme === "hybride" ? data.seances_course_semaine : null,
        seances_muscu_semaine: data.type_programme === "hybride" ? data.seances_muscu_semaine : null,
        frequence_tests_semaines: data.frequence_tests_semaines,
        objectif_type: data.objectif_type,
        date_debut_programme: dateDebutFr,
        historique_perf: buildHistorique(),
      });

      const me = await api.get("/auth/me");
      setUser(me.data);
      navigate("/");
    } catch (e) {
      setErr(e?.response?.data?.detail ?? "Erreur lors de la configuration");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-6">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Bienvenue{user?.prenom ? `, ${user.prenom}` : ""} 👋</p>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Configurons ton programme</h1>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-1 mb-6">
          {ETAPES.map((e, i) => (
            <div key={e.num} className="flex-1 flex items-center gap-1">
              <div className={clsx(
                "flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shrink-0",
                etape > e.num  ? "bg-brand text-white"
                : etape === e.num ? "bg-brand text-white ring-4 ring-brand/20"
                : "bg-gray-200 dark:bg-gray-700 text-gray-400"
              )}>
                {etape > e.num ? "✓" : e.num}
              </div>
              <span className={clsx("text-[10px] hidden sm:block truncate", etape === e.num ? "text-brand font-semibold" : "text-gray-400")}>
                {e.label}
              </span>
              {i < ETAPES.length - 1 && (
                <div className={clsx("flex-1 h-0.5", etape > e.num ? "bg-brand" : "bg-gray-200 dark:bg-gray-700")} />
              )}
            </div>
          ))}
        </div>

        {/* Contenu */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
          <h2 className="font-bold text-gray-900 dark:text-white mb-4">{ETAPES[etape - 1].label}</h2>

          {etape === 1 && <Etape1 data={data} set={set} />}
          {etape === 2 && <Etape2 data={data} set={set} />}
          {etape === 3 && <Etape3 data={data} set={set} />}
          {etape === 4 && <Etape4 data={data} set={set} />}

          {err && <p className="text-sm text-red-500 mt-4">{err}</p>}

          {/* Navigation */}
          <div className="flex justify-between mt-6 gap-3">
            {etape > 1 ? (
              <button type="button" onClick={() => setEtape(e => e - 1)}
                className="px-5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                ← Retour
              </button>
            ) : <div />}

            {etape < ETAPES.length ? (
              <button type="button" onClick={() => setEtape(e => e + 1)} disabled={!canGoNext()}
                className="px-6 py-2.5 rounded-xl bg-brand text-white font-semibold text-sm hover:bg-brand-dark transition-colors disabled:opacity-40">
                Suivant →
              </button>
            ) : (
              <button type="button" onClick={valider} disabled={!canGoNext() || loading}
                className="px-6 py-2.5 rounded-xl bg-brand text-white font-semibold text-sm hover:bg-brand-dark transition-colors disabled:opacity-40">
                {loading ? "Génération du programme…" : "Lancer mon programme ⚡"}
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">Tu pourras modifier ces informations dans ton profil.</p>
      </div>
    </div>
  );
}
