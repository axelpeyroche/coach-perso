import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import api from "../api";
import { getErrorMessage } from "../utils/errors";
import { Segmente } from "../components/ui";

// ─── Helpers ────────────────────────────────────────────────────────────────

// Liste groupée en encart, comme les formulaires de Réglages ou de l'identifiant Apple
function Groupe({ titre, pied, children }) {
  return (
    <section>
      {titre && <h2 className="entete-liste">{titre}</h2>}
      <div className="card overflow-hidden">{children}</div>
      {pied && <p className="px-4 pt-1.5 text-[13px] leading-[18px] text-label-2">{pied}</p>}
    </section>
  );
}

// Champ sans cadre : le texte d'aide sert de libellé, la ligne porte le séparateur
function Champ({ label, type = "text", value, onChange, required, autoComplete, autoFocus }) {
  return (
    <label className="ligne py-0">
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={label} aria-label={label}
        required={required} autoComplete={autoComplete} autoFocus={autoFocus}
        autoCapitalize={type === "email" || type === "password" ? "none" : undefined}
        spellCheck={false}
        className="w-full min-w-0 h-11 bg-transparent border-0 outline-none text-[17px] text-label
          placeholder:text-label-3/30"
      />
    </label>
  );
}

function Erreur({ texte }) {
  if (!texte) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 px-4 text-[13px] leading-[18px] text-ios-red">
      <svg className="w-4 h-4 shrink-0 mt-px" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-.75-11.5a.75.75 0 011.5 0v4a.75.75 0 01-1.5 0v-4zM10 14.75a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
      </svg>
      {texte}
    </p>
  );
}

function Indicateur() {
  return (
    <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function BoutonPrincipal({ loading, children }) {
  return (
    <button type="submit" disabled={loading} className="btn-primaire w-full h-[50px] text-[17px]">
      {loading ? <Indicateur /> : children}
    </button>
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
    <form onSubmit={submit} className="space-y-6">
      <div className="space-y-2">
        <Groupe>
          <Champ label="Adresse e-mail" type="email" value={email} onChange={setEmail} autoComplete="email" required />
          <Champ label="Mot de passe" type="password" value={password} onChange={setPassword} autoComplete="current-password" required />
        </Groupe>
        <Erreur texte={err} />
      </div>
      <BoutonPrincipal loading={loading}>Se connecter</BoutonPrincipal>
      <p className="text-center text-[15px] text-label-2">
        Pas encore de compte ?{" "}
        <button type="button" onClick={onSwitch} className="text-brand transition active:opacity-50">
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
    <form onSubmit={submit} className="space-y-6">
      <Groupe titre="Nom">
        <Champ label="Prénom" value={prenom} onChange={setPrenom} autoComplete="given-name" required autoFocus />
        <Champ label="Nom" value={nom} onChange={setNom} autoComplete="family-name" required />
      </Groupe>
      <Groupe titre="Compte">
        <Champ label="Adresse e-mail" type="email" value={email} onChange={setEmail} autoComplete="email" required />
        <Champ label="Mot de passe" type="password" value={password} onChange={setPassword} autoComplete="new-password" required />
      </Groupe>
      <Groupe titre="Profil" pied="Facultatif. Sert à estimer tes zones cardiaques et ta forme.">
        <label className="ligne py-0 h-11">
          <span className="text-[17px] shrink-0">Date de naissance</span>
          <input
            type="date" value={dateNaissance} onChange={e => setDN(e.target.value)}
            className="ml-auto min-w-0 min-h-0 h-auto bg-transparent border-0 outline-none text-[17px] text-right text-brand"
          />
        </label>
        <div className="ligne">
          <span className="text-[17px] shrink-0">Sexe</span>
          <Segmente
            className="ml-auto w-[13.5rem]"
            options={[["M", "Homme"], ["F", "Femme"], ["", "—"]]}
            valeur={sexe} onChange={setSexe}
          />
        </div>
      </Groupe>
      <div className="space-y-6">
        <Erreur texte={err} />
        <BoutonPrincipal loading={loading}>Créer mon compte</BoutonPrincipal>
        <p className="text-center text-[15px] text-label-2">
          Déjà un compte ?{" "}
          <button type="button" onClick={onSwitch} className="text-brand transition active:opacity-50">
            Se connecter
          </button>
        </p>
      </div>
    </form>
  );
}

// ─── Page Auth ───────────────────────────────────────────────────────────────

export default function Auth() {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const { login } = useAuth();
  const navigate = useNavigate();
  const inscription = mode === "register";

  async function handleRegisterSuccess(token) {
    const me = await api.get("/auth/me", { headers: { Authorization: `Bearer ${token}` } });
    login(token, me.data);
    navigate("/");
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-fond px-4 pt-safe">
      <main
        key={mode}
        className="w-full max-w-[400px] mx-auto flex-1 flex flex-col justify-center py-12"
        style={{ animation: "vueFondu 0.35s var(--doux)" }}
      >
        <header className="text-center mb-9">
          {/* Icône d'app : squircle, dégradé et reflet comme sur l'écran d'accueil */}
          <div className={`relative mx-auto mb-5 flex items-center justify-center overflow-hidden
              bg-gradient-to-b from-[#4FA8FF] to-[#0066E0] shadow-[0_8px_24px_rgba(0,102,224,0.32),0_1px_2px_rgba(0,0,0,0.12)]
              transition-all duration-500 ${inscription ? "w-16 h-16 rounded-[15px]" : "w-[88px] h-[88px] rounded-[20px]"}`}>
            <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            <svg className={`relative text-white drop-shadow-sm ${inscription ? "w-11 h-11" : "w-[60px] h-[60px]"}`} fill="currentColor" viewBox="0 0 24 24">
              <path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z" />
            </svg>
          </div>
          <h1 className="large-title">{inscription ? "Créer un compte" : "Mon carnet"}</h1>
          <p className="text-[17px] leading-[22px] text-label-2 mt-2 px-6">
            {inscription
              ? "Quelques informations pour démarrer ton carnet."
              : "Connecte-toi pour retrouver toutes tes séances, tous tes sports."}
          </p>
        </header>

        {inscription
          ? <FormRegister onSwitch={() => setMode("login")} onSuccess={handleRegisterSuccess} />
          : <FormLogin onSwitch={() => setMode("register")} />
        }
      </main>

      <footer style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }} className="text-center text-[12px] leading-4 text-label-2/70 flex items-center justify-center gap-1.5">
        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M10 1.5a4 4 0 00-4 4V8H5a2 2 0 00-2 2v6.5a2 2 0 002 2h10a2 2 0 002-2V10a2 2 0 00-2-2h-1V5.5a4 4 0 00-4-4zm2.5 6.5V5.5a2.5 2.5 0 00-5 0V8h5z" clipRule="evenodd" />
        </svg>
        Connexion chiffrée · Carnet gratuit et personnel
      </footer>
    </div>
  );
}
