import { useAuth } from "../AuthContext";

const PROG_LABEL = { course: "Course", muscu: "Musculation", hybride: "Hybride" };
const MUSCU_LABEL = { poids_corps: "Poids du corps", salle: "Salle de sport" };
const COURSE_LABEL = { route: "Route", trail: "Trail" };

function Row({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-white">{value}</span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 px-4 py-1 mb-4">
      {title && <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest pt-3 pb-1">{title}</p>}
      {children}
    </div>
  );
}

function BioStat({ label, value, unit }) {
  return (
    <div className="flex-1 flex flex-col items-center py-3">
      <span className="text-lg font-bold text-gray-900 dark:text-white">
        {value != null ? value : <span className="text-gray-300 dark:text-gray-600">—</span>}
        {value != null && unit && <span className="text-xs font-normal text-gray-400 ml-0.5">{unit}</span>}
      </span>
      <span className="text-xs text-gray-400 mt-0.5">{label}</span>
    </div>
  );
}

export default function Profil({ dark, setDark }) {
  const { user, logout } = useAuth();

  const initials = [user?.prenom?.[0], user?.nom?.[0]].filter(Boolean).join("").toUpperCase() || "?";

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      {/* Avatar + nom */}
      <div className="flex flex-col items-center mb-6">
        <div className="w-20 h-20 rounded-full bg-brand/10 dark:bg-brand/20 flex items-center justify-center mb-3">
          <span className="text-3xl font-bold text-brand">{initials}</span>
        </div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{user?.prenom} {user?.nom}</h1>
        <p className="text-sm text-gray-400 mt-0.5">{user?.email}</p>
      </div>

      {/* Infos personnelles */}
      <Section title="Informations personnelles">
        <Row label="Prénom" value={user?.prenom} />
        <Row label="Nom" value={user?.nom} />
        <Row label="Email" value={user?.email} />
        <Row label="Âge" value={user?.age ? `${user.age} ans` : null} />
        <Row label="Sexe" value={user?.sexe === "M" ? "Homme" : user?.sexe === "F" ? "Femme" : null} />
        <Row label="Poids" value={user?.poids_kg ? `${user.poids_kg} kg` : null} />
      </Section>

      {/* Programme */}
      <Section title="Programme">
        <Row label="Type" value={PROG_LABEL[user?.type_programme] ?? user?.type_programme} />
        <Row label="Musculation" value={MUSCU_LABEL[user?.type_muscu] ?? user?.type_muscu} />
        <Row label="Course" value={COURSE_LABEL[user?.type_course] ?? user?.type_course} />
        <Row label="Séances / semaine" value={user?.seances_semaine} />
        {user?.seances_muscu_semaine != null && <Row label="Séances muscu" value={user.seances_muscu_semaine} />}
        {user?.seances_course_semaine != null && <Row label="Séances course" value={user.seances_course_semaine} />}
        <Row label="Tests toutes les" value={user?.frequence_tests_semaines ? `${user.frequence_tests_semaines} semaines` : null} />
      </Section>

      {/* Physiologie */}
      <Section title="Physiologie">
        <div className="flex divide-x divide-gray-100 dark:divide-gray-800">
          <BioStat label="FC max"   value={user?.fc_max}   unit="bpm" />
          <BioStat label="FC repos" value={user?.fc_repos} unit="bpm" />
          <BioStat label="VMA"      value={user?.vma_kmh}  unit="km/h" />
          <BioStat label="Poids"    value={user?.poids_kg} unit="kg" />
        </div>
      </Section>

      {/* Apparence */}
      <Section title="Apparence">
        <div className="flex items-center justify-between py-3">
          <span className="text-sm text-gray-700 dark:text-gray-300">Mode sombre</span>
          <button
            onClick={() => setDark(d => !d)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${dark ? "bg-brand" : "bg-gray-200 dark:bg-gray-700"}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${dark ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
      </Section>

      {/* Déconnexion */}
      <button
        onClick={logout}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-red-200 dark:border-red-900 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm font-medium"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1" />
        </svg>
        Se déconnecter
      </button>
    </div>
  );
}
