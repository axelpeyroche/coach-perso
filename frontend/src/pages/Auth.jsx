import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import api from "../api";
import { getErrorMessage } from "../utils/errors";
import { Segmente } from "../components/ui";

// ─── Helpers ────────────────────────────────────────────────────────────────

function Input({ label, type = "text", value, onChange, placeholder, required, autoComplete }) {
  return (
    <label className="block">
      <span className="libelle">{label}</span>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} required={required} autoComplete={autoComplete}
        className="champ"
      />
    </label>
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
      navigate("/");
    } catch (e) {
      setErr(getErrorMessage(e, "Erreur de connexion"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Input label="Email" type="email" value={email} onChange={setEmail} placeholder="toi@exemple.fr" autoComplete="email" required />
      <Input label="Mot de passe" type="password" value={password} onChange={setPassword} placeholder="••••••••" autoComplete="current-password" required />
      {err && <p className="text-[13px] text-ios-red text-center">{err}</p>}
      <button type="submit" disabled={loading} className="btn-primaire w-full">
        {loading ? "Connexion…" : "Se connecter"}
      </button>
      <p className="text-center text-[15px] text-label-2">
        Pas encore de compte ?{" "}
        <button type="button" onClick={onSwitch} className="text-brand font-semibold">
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
  const [sexe, setSexe]           = useState("");
  const [err, setErr]             = useState("");
  const [loading, setLoading]     = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const payload = {
        prenom, nom, email, password,
        date_naissance: dateNaissance || null,
        sexe: sexe || null,
      };
      const r = await api.post("/auth/register", payload);
      onSuccess(r.data.access_token);
    } catch (e) {
      setErr(getErrorMessage(e, "Erreur lors de l'inscription"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Input label="Prénom" value={prenom} onChange={setPrenom} autoComplete="given-name" required />
        <Input label="Nom" value={nom} onChange={setNom} autoComplete="family-name" required />
      </div>
      <Input label="Email" type="email" value={email} onChange={setEmail} placeholder="toi@exemple.fr" autoComplete="email" required />
      <Input label="Mot de passe" type="password" value={password} onChange={setPassword} placeholder="••••••••" autoComplete="new-password" required />
      <Input label="Date de naissance" type="date" value={dateNaissance} onChange={setDN} />
      <div>
        <span className="libelle">Sexe</span>
        <Segmente
          options={[["M", "Homme"], ["F", "Femme"], ["", "Non précisé"]]}
          valeur={sexe} onChange={setSexe}
        />
      </div>
      {err && <p className="text-[13px] text-ios-red text-center">{err}</p>}
      <button type="submit" disabled={loading} className="btn-primaire w-full">
        {loading ? "Création…" : "Créer mon compte"}
      </button>
      <p className="text-center text-[15px] text-label-2">
        Déjà un compte ?{" "}
        <button type="button" onClick={onSwitch} className="text-brand font-semibold">
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
    const me = await api.get("/auth/me", { headers: { Authorization: `Bearer ${token}` } });
    login(token, me.data);
    navigate("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-fond px-4 py-10 pt-safe">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mx-auto w-[76px] h-[76px] rounded-[18px] bg-gradient-to-b from-[#3A9BFF] to-[#007AFF] shadow-lg shadow-ios-blue/30 flex items-center justify-center mb-4">
            <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z" /></svg>
          </div>
          <h1 className="text-[28px] font-bold tracking-tight">Mon carnet</h1>
          <p className="text-[15px] text-label-2 mt-1">Toutes tes séances, tous tes sports</p>
        </div>

        <div className="card p-5">
          <Segmente
            className="mb-5"
            options={[["login", "Connexion"], ["register", "Inscription"]]}
            valeur={mode} onChange={setMode}
          />
          {mode === "login"
            ? <FormLogin onSwitch={() => setMode("register")} />
            : <FormRegister onSwitch={() => setMode("login")} onSuccess={handleRegisterSuccess} />
          }
        </div>
      </div>
    </div>
  );
}
