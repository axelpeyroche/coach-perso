import { useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { useAuth } from "../AuthContext";
import api from "../api";

// ─── Helpers ────────────────────────────────────────────────────────────────

function Input({ label, type = "text", value, onChange, placeholder, required }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} required={required}
        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand"
      />
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      <select
        value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ─── Formulaire de connexion ────────────────────────────────────────────────

function FormLogin({ onSwitch }) {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr]           = useState("");
  const [loading, setLoading]   = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const r = await api.post("/auth/login", { email, password });
      const me = await api.get("/auth/me", { headers: { Authorization: `Bearer ${r.data.access_token}` } });
      login(r.data.access_token, me.data);
      if (!r.data.onboarding_complet) navigate("/onboarding");
      else navigate("/");
    } catch (e) {
      setErr(e?.response?.data?.detail ?? "Erreur de connexion");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Input label="Email" type="email" value={email} onChange={setEmail} placeholder="toi@exemple.fr" required />
      <Input label="Mot de passe" type="password" value={password} onChange={setPassword} placeholder="••••••••" required />
      {err && <p className="text-sm text-red-500">{err}</p>}
      <button type="submit" disabled={loading}
        className="w-full py-3 rounded-xl bg-brand text-white font-semibold hover:bg-brand-dark transition-colors disabled:opacity-50">
        {loading ? "Connexion…" : "Se connecter"}
      </button>
      <p className="text-center text-sm text-gray-500 dark:text-gray-400">
        Pas encore de compte ?{" "}
        <button type="button" onClick={onSwitch} className="text-brand font-semibold hover:underline">
          Créer un compte
        </button>
      </p>
    </form>
  );
}

// ─── Formulaire d'inscription ────────────────────────────────────────────────

function FormRegister({ onSwitch, onSuccess }) {
  const [prenom, setPrenom]       = useState("");
  const [nom, setNom]             = useState("");
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [dateNaissance, setDN]    = useState("");
  const [sexe, setSexe]           = useState("homme");
  const [poids, setPoids]         = useState("");
  const [err, setErr]             = useState("");
  const [loading, setLoading]     = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const payload = {
        prenom, nom, email, password, sexe,
        date_naissance: dateNaissance || null,
        poids_kg: poids ? parseFloat(poids) : null,
      };
      const r = await api.post("/auth/register", payload);
      onSuccess(r.data.access_token);
    } catch (e) {
      setErr(e?.response?.data?.detail ?? "Erreur lors de l'inscription");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Input label="Prénom" value={prenom} onChange={setPrenom} required />
        <Input label="Nom" value={nom} onChange={setNom} required />
      </div>
      <Input label="Email" type="email" value={email} onChange={setEmail} placeholder="toi@exemple.fr" required />
      <Input label="Mot de passe" type="password" value={password} onChange={setPassword} placeholder="••••••••" required />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Date de naissance" type="date" value={dateNaissance} onChange={setDN} />
        <Input label="Poids (kg)" type="number" value={poids} onChange={setPoids} placeholder="75" />
      </div>
      <Select label="Sexe" value={sexe} onChange={setSexe} options={[
        { value: "homme", label: "Homme" },
        { value: "femme", label: "Femme" },
        { value: "autre", label: "Autre / Non précisé" },
      ]} />
      {err && <p className="text-sm text-red-500">{err}</p>}
      <button type="submit" disabled={loading}
        className="w-full py-3 rounded-xl bg-brand text-white font-semibold hover:bg-brand-dark transition-colors disabled:opacity-50">
        {loading ? "Création…" : "Créer mon compte"}
      </button>
      <p className="text-center text-sm text-gray-500 dark:text-gray-400">
        Déjà un compte ?{" "}
        <button type="button" onClick={onSwitch} className="text-brand font-semibold hover:underline">
          Se connecter
        </button>
      </p>
    </form>
  );
}

// ─── Page Auth ───────────────────────────────────────────────────────────────

export default function Auth() {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleRegisterSuccess(token) {
    // Récupère le profil puis redirige vers onboarding
    const me = await api.get("/auth/me", { headers: { Authorization: `Bearer ${token}` } });
    login(token, me.data);
    navigate("/onboarding");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">⚡</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Coach Perso</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Ton programme d'entraînement personnalisé</p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
          {/* Onglets */}
          <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1 mb-6">
            {[["login","Connexion"],["register","Inscription"]].map(([m, label]) => (
              <button key={m} onClick={() => setMode(m)}
                className={clsx("flex-1 py-2 text-sm font-semibold rounded-lg transition-colors",
                  mode === m
                    ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-gray-400"
                )}>
                {label}
              </button>
            ))}
          </div>

          {mode === "login"
            ? <FormLogin onSwitch={() => setMode("register")} />
            : <FormRegister onSwitch={() => setMode("login")} onSuccess={handleRegisterSuccess} />
          }
        </div>
      </div>
    </div>
  );
}
