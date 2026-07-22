import { useAuth } from "../AuthContext";
import { useState, useEffect, useRef } from "react";
import api from "../api";
import { getImportToken, regenererImportToken } from "../api";

function urlBase64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ── Push toggle ────────────────────────────────────────────────────────────
function PushToggle() {
  const [status, setStatus] = useState("off"); // off|on|working|unsupported|denied
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported"); return;
    }
    if (Notification.permission === "denied") { setStatus("denied"); return; }
    // Vérifier abonnement existant en arrière-plan, bouton actif immédiatement
    navigator.serviceWorker.ready
      .then(r => r.pushManager.getSubscription())
      .then(sub => { if (sub) setStatus("on"); })
      .catch(() => {});
  }, []);

  async function toggle() {
    setErrMsg("");
    setStatus("working");
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();

      if (existing) {
        // DÉSABONNEMENT — aucune demande de permission, juste désinscrire
        await existing.unsubscribe();
        try {
          await api.delete("/push/unsubscribe", { data: { endpoint: existing.endpoint } });
        } catch (_) { /* subscription déjà absente en base, ignoré */ }
        setStatus("off");
      } else {
        // ABONNEMENT — demander la permission en premier (proche du geste)
        if (Notification.permission !== "granted") {
          const perm = await Notification.requestPermission();
          if (perm === "denied") { setStatus("denied"); return; }
          if (perm !== "granted") { setStatus("off"); return; }
        }
        const { data: vapidData } = await api.get("/push/vapid-public-key");
        const vapidKey = vapidData?.publicKey || import.meta.env.VITE_VAPID_PUBLIC_KEY;
        if (!vapidKey) throw new Error("Clé VAPID manquante côté serveur");
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
        const j = sub.toJSON();
        await api.post("/push/subscribe", { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
        setStatus("on");
      }
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message || String(e);
      setErrMsg(msg);
      setStatus("off");
    }
  }

  if (status === "unsupported") return <span className="text-xs text-gray-400 italic">Non supporté sur cet appareil</span>;

  if (status === "denied") return (
    <div className="text-right">
      <span className="text-xs text-red-400 leading-tight">Bloquées — à autoriser<br/>dans les paramètres du navigateur</span>
    </div>
  );

  const on = status === "on";
  const busy = status === "working";

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={toggle} disabled={busy}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${on ? "bg-brand" : "bg-gray-200 dark:bg-gray-700"}`}>
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
      </button>
      {errMsg && <p className="text-[10px] text-red-400 max-w-[180px] text-right leading-tight">{errMsg}</p>}
    </div>
  );
}

// ── Avatar ─────────────────────────────────────────────────────────────────
function Avatar({ userId, initials }) {
  const [photo, setPhoto] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const galleryRef = useRef(null);
  const cameraRef = useRef(null);

  useEffect(() => {
    if (userId) {
      const stored = localStorage.getItem(`profilePhoto_${userId}`);
      if (stored) setPhoto(stored);
    }
  }, [userId]);

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target.result;
      setPhoto(dataUrl);
      localStorage.setItem(`profilePhoto_${userId}`, dataUrl);
    };
    reader.readAsDataURL(file);
    setMenuOpen(false);
    e.target.value = "";
  }

  function removePhoto() {
    setPhoto(null);
    localStorage.removeItem(`profilePhoto_${userId}`);
    setMenuOpen(false);
  }

  return (
    <div className="relative">
      <button onClick={() => setMenuOpen(v => !v)}
        className="relative w-20 h-20 rounded-full overflow-hidden focus:outline-none group">
        {photo
          ? <img src={photo} alt="avatar" className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-brand/10 dark:bg-brand/20 flex items-center justify-center">
              <span className="text-3xl font-bold text-brand">{initials}</span>
            </div>
        }
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute left-1/2 -translate-x-1/2 top-[88px] z-50 bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden min-w-[200px]">
            <button onClick={() => { setMenuOpen(false); setTimeout(() => galleryRef.current?.click(), 50); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Importer depuis l'appareil
            </button>
            <button onClick={() => { setMenuOpen(false); setTimeout(() => cameraRef.current?.click(), 50); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Prendre une photo
            </button>
            {photo && (
              <button onClick={removePhoto}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 border-t border-gray-100 dark:border-gray-800">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Supprimer la photo
              </button>
            )}
          </div>
        </>
      )}

      <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
    </div>
  );
}

// ── Shared ─────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 text-xl font-bold leading-none">×</button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

const inputCls = "w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand";

function Field({ label, children }) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

// ── Edit infos modal ───────────────────────────────────────────────────────
function EditInfosModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState({
    prenom: user?.prenom || "",
    nom: user?.nom || "",
    email: user?.email || "",
    sexe: user?.sexe || "",
    date_naissance: user?.date_naissance || "",
    poids_kg: user?.poids_kg ?? "",
  });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  function set(k) { return e => setForm(f => ({ ...f, [k]: e.target.value })); }

  async function save() {
    setSaving(true); setErr("");
    try {
      const payload = {};
      if (form.prenom !== (user?.prenom || "")) payload.prenom = form.prenom;
      if (form.nom !== (user?.nom || "")) payload.nom = form.nom;
      if (form.email !== (user?.email || "")) payload.email = form.email;
      if (form.sexe !== (user?.sexe || "")) payload.sexe = form.sexe;
      if (form.date_naissance !== (user?.date_naissance || "")) payload.date_naissance = form.date_naissance || null;
      const newPoids = form.poids_kg !== "" ? parseFloat(form.poids_kg) : null;
      if (newPoids !== user?.poids_kg) payload.poids_kg = newPoids;
      if (Object.keys(payload).length > 0) {
        await api.patch("/utilisateur/infos", payload);
        await onSaved();
      }
      onClose();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Erreur — réessaie");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Modifier mes informations" onClose={onClose}>
      <Field label="Prénom">
        <input className={inputCls} value={form.prenom} onChange={set("prenom")} />
      </Field>
      <Field label="Nom">
        <input className={inputCls} value={form.nom} onChange={set("nom")} />
      </Field>
      <Field label="Email">
        <input type="email" className={inputCls} value={form.email} onChange={set("email")} />
      </Field>
      <Field label="Sexe">
        <select className={inputCls} value={form.sexe} onChange={set("sexe")}>
          <option value="">—</option>
          <option value="M">Homme</option>
          <option value="F">Femme</option>
        </select>
      </Field>
      <Field label="Date de naissance">
        <input type="date" className={inputCls} value={form.date_naissance || ""} onChange={set("date_naissance")} />
      </Field>
      <Field label="Poids (kg)">
        <input type="number" step="0.1" min="20" max="300" className={inputCls} value={form.poids_kg} onChange={set("poids_kg")} />
      </Field>
      {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
      <button onClick={save} disabled={saving}
        className="w-full py-3 rounded-xl bg-brand text-white font-semibold text-sm disabled:opacity-50 hover:bg-brand-dark transition-colors">
        {saving ? "Enregistrement…" : "Enregistrer"}
      </button>
    </Modal>
  );
}

// ── Edit password modal ────────────────────────────────────────────────────
function EditPasswordModal({ onClose }) {
  const [form, setForm] = useState({ ancien: "", nouveau: "", confirmer: "" });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  function set(k) { return e => setForm(f => ({ ...f, [k]: e.target.value })); }

  async function save() {
    if (form.nouveau !== form.confirmer) { setErr("Les mots de passe ne correspondent pas"); return; }
    if (form.nouveau.length < 8) { setErr("Minimum 8 caractères requis"); return; }
    setSaving(true); setErr("");
    try {
      await api.patch("/utilisateur/password", {
        ancien_mot_de_passe: form.ancien,
        nouveau_mot_de_passe: form.nouveau,
      });
      setDone(true);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Erreur — réessaie");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Modifier le mot de passe" onClose={onClose}>
      {done ? (
        <div className="text-center py-6">
          <div className="text-4xl mb-3">✓</div>
          <p className="text-brand font-semibold mb-4">Mot de passe modifié</p>
          <button onClick={onClose} className="px-6 py-2 rounded-xl bg-brand text-white text-sm font-medium">Fermer</button>
        </div>
      ) : (
        <>
          <Field label="Mot de passe actuel">
            <input type="password" className={inputCls} value={form.ancien} onChange={set("ancien")} autoComplete="current-password" />
          </Field>
          <Field label="Nouveau mot de passe">
            <input type="password" className={inputCls} value={form.nouveau} onChange={set("nouveau")} autoComplete="new-password" />
          </Field>
          <Field label="Confirmer le nouveau mot de passe">
            <input type="password" className={inputCls} value={form.confirmer} onChange={set("confirmer")} autoComplete="new-password" />
          </Field>
          {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
          <button onClick={save} disabled={saving}
            className="w-full py-3 rounded-xl bg-brand text-white font-semibold text-sm disabled:opacity-50 hover:bg-brand-dark transition-colors">
            {saving ? "Enregistrement…" : "Modifier le mot de passe"}
          </button>
        </>
      )}
    </Modal>
  );
}

// ── Edit programme modal ───────────────────────────────────────────────────
function EditProgrammeModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState({
    type_programme:         user?.type_programme || "hybride",
    seances_semaine:        user?.seances_semaine ?? 5,
    seances_muscu_semaine:  user?.seances_muscu_semaine ?? 3,
    seances_course_semaine: user?.seances_course_semaine ?? 2,
    type_muscu:             user?.type_muscu || "poids_corps",
    type_course:            user?.type_course || "route",
    frequence_tests_semaines: user?.frequence_tests_semaines ?? 8,
  });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  function set(k) { return e => setForm(f => ({ ...f, [k]: typeof e === "object" ? e.target.value : e })); }
  function setNum(k) { return e => setForm(f => ({ ...f, [k]: parseInt(e.target.value) || 0 })); }

  async function save() {
    setSaving(true); setErr("");
    try {
      const payload = {};
      if (form.type_programme         !== user?.type_programme)         payload.type_programme         = form.type_programme;
      if (form.seances_semaine        !== user?.seances_semaine)        payload.seances_semaine        = form.seances_semaine;
      if (form.seances_muscu_semaine  !== user?.seances_muscu_semaine)  payload.seances_muscu_semaine  = form.seances_muscu_semaine;
      if (form.seances_course_semaine !== user?.seances_course_semaine) payload.seances_course_semaine = form.seances_course_semaine;
      if (form.type_muscu             !== user?.type_muscu)             payload.type_muscu             = form.type_muscu;
      if (form.type_course            !== user?.type_course)            payload.type_course            = form.type_course;
      if (form.frequence_tests_semaines !== user?.frequence_tests_semaines) payload.frequence_tests_semaines = form.frequence_tests_semaines;
      if (Object.keys(payload).length > 0) {
        await api.patch("/utilisateur/programme", payload);
        await onSaved();
      }
      setDone(true);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Erreur — réessaie");
    } finally {
      setSaving(false);
    }
  }

  if (done) return (
    <Modal title="Programme mis à jour" onClose={onClose}>
      <div className="text-center py-6 space-y-3">
        <div className="text-4xl">✓</div>
        <p className="text-brand font-semibold">Les séances à venir ont été régénérées.</p>
        <button onClick={onClose} className="px-6 py-2 rounded-xl bg-brand text-white text-sm font-medium">Fermer</button>
      </div>
    </Modal>
  );

  const showMuscu  = form.type_programme === "muscu" || form.type_programme === "hybride";
  const showCourse = form.type_programme === "course" || form.type_programme === "hybride";
  const isVelo     = form.type_programme === "velo";

  function handleTypeProgramme(newType) {
    setForm(f => {
      const total = f.seances_semaine;
      let muscu  = f.seances_muscu_semaine;
      let course = f.seances_course_semaine;
      if (newType === "muscu")  { muscu = total; course = 0; }
      if (newType === "course") { course = total; muscu = 0; }
      if (newType === "velo")   { muscu = 0; course = 0; }
      if (newType === "hybride") {
        muscu  = Math.round(total * 0.6);
        course = total - muscu;
      }
      return { ...f, type_programme: newType, seances_muscu_semaine: muscu, seances_course_semaine: course };
    });
  }

  return (
    <Modal title="Modifier le programme" onClose={onClose}>
      <Field label="Type de programme">
        <div className="grid grid-cols-2 gap-2">
          {[["hybride","Hybride"],["course","Course"],["muscu","Muscu"],["velo","Vélo de route"]].map(([val, label]) => (
            <button key={val} onClick={() => handleTypeProgramme(val)}
              className={`py-2 rounded-xl text-sm font-semibold border transition-colors ${form.type_programme === val ? "bg-brand text-white border-brand" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-brand hover:text-brand"}`}>
              {label}
            </button>
          ))}
        </div>
        {(isVelo || form.type_programme === "hybride") && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
            🚴 {isVelo
              ? "Programme vélo : sorties PMA, sweet spot, endurance et sortie longue générées automatiquement."
              : "En hybride, une sortie vélo endurance est ajoutée chaque semaine."}
          </p>
        )}
      </Field>
      <Field label="Séances / semaine">
        <div className="flex items-center gap-3">
          <input type="range" min={2} max={10} value={form.seances_semaine}
            onChange={e => {
              const total = parseInt(e.target.value);
              setForm(f => {
                if (f.type_programme === "muscu")  return { ...f, seances_semaine: total, seances_muscu_semaine: total, seances_course_semaine: 0 };
                if (f.type_programme === "course") return { ...f, seances_semaine: total, seances_course_semaine: total, seances_muscu_semaine: 0 };
                const muscu = Math.min(f.seances_muscu_semaine, total);
                return { ...f, seances_semaine: total, seances_muscu_semaine: muscu, seances_course_semaine: total - muscu };
              });
            }} className="flex-1 accent-brand" />
          <span className="text-sm font-bold text-gray-900 dark:text-white w-4 text-right">{form.seances_semaine}</span>
        </div>
      </Field>
      {showMuscu && (
        <Field label="Séances muscu / semaine">
          <div className="flex items-center gap-3">
            <input type="range" min={0} max={form.seances_semaine} value={form.seances_muscu_semaine}
              onChange={e => {
                const v = parseInt(e.target.value);
                setForm(f => ({ ...f, seances_muscu_semaine: v, seances_course_semaine: Math.max(0, f.seances_semaine - v) }));
              }} className="flex-1 accent-brand" />
            <span className="text-sm font-bold text-gray-900 dark:text-white w-4 text-right">{form.seances_muscu_semaine}</span>
          </div>
        </Field>
      )}
      {showCourse && (
        <Field label="Séances course / semaine">
          <div className="flex items-center gap-3">
            <input type="range" min={0} max={form.seances_semaine} value={form.seances_course_semaine}
              onChange={e => {
                const v = parseInt(e.target.value);
                setForm(f => ({ ...f, seances_course_semaine: v, seances_muscu_semaine: Math.max(0, f.seances_semaine - v) }));
              }} className="flex-1 accent-brand" />
            <span className="text-sm font-bold text-gray-900 dark:text-white w-4 text-right">{form.seances_course_semaine}</span>
          </div>
        </Field>
      )}
      {showMuscu && (
        <Field label="Type de musculation">
          <select className={inputCls} value={form.type_muscu} onChange={set("type_muscu")}>
            <option value="poids_corps">Poids du corps</option>
            <option value="salle">Salle de sport</option>
          </select>
        </Field>
      )}
      {showCourse && (
        <Field label="Type de course">
          <select className={inputCls} value={form.type_course} onChange={set("type_course")}>
            <option value="route">Route</option>
            <option value="trail">Trail</option>
          </select>
        </Field>
      )}
      <Field label="Tests d'évaluation toutes les">
        <div className="flex items-center gap-3">
          <input type="range" min={2} max={16} value={form.frequence_tests_semaines} onChange={setNum("frequence_tests_semaines")} className="flex-1 accent-brand" />
          <span className="text-sm font-bold text-gray-900 dark:text-white w-16 text-right">{form.frequence_tests_semaines} sem.</span>
        </div>
      </Field>
      <p className="text-xs text-amber-500 dark:text-amber-400 mb-3">
        ⚠️ Les séances futures non validées seront régénérées selon les nouveaux paramètres.
      </p>
      {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
      <button onClick={save} disabled={saving}
        className="w-full py-3 rounded-xl bg-brand text-white font-semibold text-sm disabled:opacity-50 hover:bg-brand-dark transition-colors">
        {saving ? "Mise à jour en cours…" : "Mettre à jour le programme"}
      </button>
    </Modal>
  );
}

// ── Layout components ──────────────────────────────────────────────────────
const PROG_LABEL = { course: "Course", muscu: "Musculation", hybride: "Hybride", velo: "Vélo de route" };
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

function Section({ title, action, children }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 px-4 py-1 mb-4">
      {title && (
        <div className="flex items-center justify-between pt-3 pb-1">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{title}</p>
          {action}
        </div>
      )}
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

// ── Page ───────────────────────────────────────────────────────────────────
function ShortcutIOS() {
  const [token, setToken] = useState(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const apiUrl = (import.meta.env.VITE_API_URL || "/api").replace(/\/api$/, "");

  async function chargerToken() {
    setLoading(true);
    try {
      const data = await getImportToken();
      setToken(data.import_token);
      setVisible(true);
    } finally {
      setLoading(false);
    }
  }

  async function regenerer() {
    if (!window.confirm("Regénérer le token ? L'ancien ne fonctionnera plus dans le raccourci.")) return;
    setLoading(true);
    try {
      const data = await regenererImportToken();
      setToken(data.import_token);
    } finally {
      setLoading(false);
    }
  }

  function copier(text) {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  return (
    <div className="py-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Raccourci iOS (Apple Watch)</p>
          <p className="text-xs text-gray-400 mt-0.5">Importe tes séances depuis l'app Santé</p>
        </div>
        <button onClick={visible ? () => setVisible(false) : chargerToken} disabled={loading}
          className="text-xs px-3 py-1.5 rounded-xl bg-brand text-white font-semibold hover:bg-brand-dark transition-colors disabled:opacity-50">
          {loading ? "…" : visible ? "Masquer" : "Configurer"}
        </button>
      </div>

      {visible && token && (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 space-y-4 text-xs">
          {/* Token */}
          <div>
            <p className="font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Ton token d'accès</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-xs font-mono text-gray-800 dark:text-gray-200 break-all">
                {token}
              </code>
              <button onClick={() => copier(token)}
                className="shrink-0 px-3 py-2 rounded-lg bg-brand text-white font-semibold hover:bg-brand-dark transition-colors">
                {copied ? "✓" : "Copier"}
              </button>
            </div>
            <button onClick={regenerer} disabled={loading}
              className="mt-1.5 text-gray-400 hover:text-red-500 transition-colors underline text-xs">
              Regénérer le token
            </button>
          </div>

          {/* URL API */}
          <div>
            <p className="font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">URL de ton coach</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-xs font-mono text-gray-800 dark:text-gray-200 break-all">
                {apiUrl}
              </code>
              <button onClick={() => copier(apiUrl)}
                className="shrink-0 px-3 py-2 rounded-lg bg-brand text-white font-semibold hover:bg-brand-dark transition-colors">
                Copier
              </button>
            </div>
          </div>

          {/* Instructions détaillées */}
          <div className="space-y-3">
            <p className="font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-xs">Guide de configuration — 13 étapes</p>
            <p className="text-gray-500 dark:text-gray-400">Ouvre l'app <strong className="text-gray-700 dark:text-gray-300">Raccourcis</strong> sur iPhone, crée un nouveau raccourci (bouton <strong className="text-gray-700 dark:text-gray-300">+</strong>), puis ajoute les actions dans l'ordre ci-dessous.</p>

            {/* Section 1 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                <span className="text-xs font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">Section 1 — Configuration initiale</span>
                <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
              </div>
              {[
                { n: "1", title: "Action : Texte", body: "Ajoute une action Texte. Colle ton token dans le champ.", note: "Appuie sur la flèche en bas → \"Mémoriser dans la variable\" → nomme-la TOKEN" },
                { n: "2", title: "Action : Texte", body: `Ajoute une action Texte. Colle l'URL : ${apiUrl}`, note: "Mémorise dans la variable API_URL" },
              ].map(({ n, title, body, note }) => (
                <div key={n} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-lg bg-brand text-white flex items-center justify-center text-xs font-bold">{n}</span>
                  <div className="space-y-0.5 min-w-0">
                    <p className="text-xs font-semibold text-brand uppercase tracking-wide">{title}</p>
                    <p className="text-gray-700 dark:text-gray-300">{body}</p>
                    {note && <p className="text-gray-400 italic">{note}</p>}
                  </div>
                </div>
              ))}
            </div>

            {/* Section 2 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                <span className="text-xs font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">Section 2 — Choisir la séance</span>
                <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
              </div>
              {[
                { n: "3", title: "Action : Contenu d'une URL", body: null, fields: [["URL", "Variable API_URL + /api/import/seances-recentes?token= + Variable TOKEN"], ["Méthode", "GET"]], note: "Pour insérer une variable : appuie longuement dans le champ URL → \"Insérer une variable\"" },
                { n: "4", title: "Action : Valeur du dictionnaire", body: "L'entrée est le résultat de l'étape 3.", fields: [["Clé", "seances"]], note: "Mémorise le résultat dans la variable SEANCES" },
                { n: "5", title: "Action : Choisir dans une liste", body: null, fields: [["Liste", "Variable SEANCES"], ["Invite", "Quelle séance valider ?"]], note: "Mémorise dans la variable SEANCE" },
                { n: "6", title: "Action : Valeur du dictionnaire", body: null, fields: [["Dictionnaire", "Variable SEANCE"], ["Clé", "id"]], note: "Mémorise dans la variable SEANCE_ID" },
              ].map(({ n, title, body, fields, note }) => (
                <div key={n} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-lg bg-brand text-white flex items-center justify-center text-xs font-bold">{n}</span>
                  <div className="space-y-1.5 min-w-0 w-full">
                    <p className="text-xs font-semibold text-brand uppercase tracking-wide">{title}</p>
                    {body && <p className="text-gray-700 dark:text-gray-300">{body}</p>}
                    {fields && (
                      <div className="space-y-1">
                        {fields.map(([k, v]) => (
                          <div key={k} className="flex gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg px-2.5 py-1.5">
                            <span className="text-gray-400 shrink-0 w-16">{k}</span>
                            <span className="text-gray-700 dark:text-gray-300 font-mono text-xs break-all">{v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {note && <p className="text-gray-400 italic">{note}</p>}
                  </div>
                </div>
              ))}
            </div>

            {/* Section 3 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                <span className="text-xs font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">Section 3 — Données Apple Watch</span>
                <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
              </div>
              {[
                { n: "7", title: "Action : Rechercher des échantillons de santé", body: null, fields: [["Type", "Entraînement"], ["Trier par", "Date de début (décroissant)"], ["Limite", "5"]], note: null },
                { n: "8", title: "Action : Choisir dans une liste", body: null, fields: [["Liste", "Résultats de l'étape 7"], ["Invite", "Quel workout Apple Watch ?"]], note: "Mémorise dans la variable WORKOUT" },
                { n: "9", title: "Action : Obtenir les détails d'un échantillon de santé × 3", body: "Répète cette action 3 fois. L'entrée doit être la variable WORKOUT à chaque fois.", fields: [["Détail 1", "Durée (en secondes) → Variable DUREE_SEC"], ["Détail 2", "Distance → Variable DISTANCE_KM"], ["Détail 3", "Fréquence cardiaque moy. → Variable FC_MOY"]], note: null },
                { n: "10", title: "Action : Calculer", body: "La durée est en secondes, il faut la convertir en minutes.", fields: [["Opération", "Variable DUREE_SEC ÷ 60"]], note: "Mémorise dans la variable DUREE_MIN" },
              ].map(({ n, title, body, fields, note }) => (
                <div key={n} className="bg-white dark:bg-gray-900 border border-orange-200 dark:border-orange-900/50 rounded-xl p-3 flex gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-lg bg-orange-500 text-white flex items-center justify-center text-xs font-bold">{n}</span>
                  <div className="space-y-1.5 min-w-0 w-full">
                    <p className="text-xs font-semibold text-orange-500 uppercase tracking-wide">{title}</p>
                    {body && <p className="text-gray-700 dark:text-gray-300">{body}</p>}
                    {fields && (
                      <div className="space-y-1">
                        {fields.map(([k, v]) => (
                          <div key={k} className="flex gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg px-2.5 py-1.5">
                            <span className="text-gray-400 shrink-0 w-20">{k}</span>
                            <span className="text-gray-700 dark:text-gray-300 font-mono text-xs break-all">{v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {note && <p className="text-gray-400 italic">{note}</p>}
                  </div>
                </div>
              ))}
            </div>

            {/* Section 4 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                <span className="text-xs font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">Section 4 — Envoyer au coach</span>
                <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
              </div>

              {/* Étape 11 : Dictionnaire */}
              <div className="bg-white dark:bg-gray-900 border border-green-200 dark:border-green-900/50 rounded-xl p-3 flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-lg bg-green-500 text-white flex items-center justify-center text-xs font-bold">11</span>
                <div className="space-y-1.5 min-w-0 w-full">
                  <p className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">Action : Dictionnaire</p>
                  <p className="text-gray-700 dark:text-gray-300">Crée un dictionnaire avec les paires clé/valeur suivantes. Pour chaque valeur, appuie sur le champ → "Insérer une variable".</p>
                  <div className="bg-gray-900 rounded-lg p-2.5 overflow-x-auto">
                    <pre className="font-mono text-xs text-gray-100 whitespace-pre">{`token          → Variable TOKEN
seance_id      → Variable SEANCE_ID
duree_min      → Variable DUREE_MIN
distance_km    → Variable DISTANCE_KM
fc_moyenne_bpm → Variable FC_MOY
rpe            → 7`}</pre>
                  </div>
                </div>
              </div>

              {/* Étape 12 : POST */}
              <div className="bg-white dark:bg-gray-900 border border-green-200 dark:border-green-900/50 rounded-xl p-3 flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-lg bg-green-500 text-white flex items-center justify-center text-xs font-bold">12</span>
                <div className="space-y-1.5 min-w-0 w-full">
                  <p className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">Action : Contenu d'une URL</p>
                  <div className="space-y-1">
                    {[
                      ["URL", `Variable API_URL + /api/import/workout`],
                      ["Méthode", "POST"],
                      ["Corps de la requête", "JSON"],
                      ["Corps JSON", "Dictionnaire (étape 11)"],
                    ].map(([k, v]) => (
                      <div key={k} className="flex gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg px-2.5 py-1.5">
                        <span className="text-gray-400 shrink-0 w-28">{k}</span>
                        <span className="text-gray-700 dark:text-gray-300 font-mono text-xs break-all">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Étape 13 : Confirmation */}
              <div className="bg-white dark:bg-gray-900 border border-green-200 dark:border-green-900/50 rounded-xl p-3 flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-lg bg-green-500 text-white flex items-center justify-center text-xs font-bold">13</span>
                <div className="space-y-1.5 min-w-0 w-full">
                  <p className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">Action : Afficher le résultat</p>
                  <div className="flex gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg px-2.5 py-1.5">
                    <span className="text-gray-400 shrink-0 w-16">Texte</span>
                    <span className="text-gray-700 dark:text-gray-300 font-mono text-xs">✓ Séance importée dans le coach !</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Résumé utilisation */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-1.5">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Utilisation au quotidien</p>
              <ol className="space-y-1 text-gray-600 dark:text-gray-400 list-decimal list-inside">
                <li>Tu finis ton entraînement (la Watch enregistre automatiquement)</li>
                <li>Tu ouvres le raccourci sur iPhone</li>
                <li>Tu choisis la séance dans ton programme</li>
                <li>Tu choisis le bon workout Watch</li>
                <li>Tout s'importe — durée, distance, FC ✓</li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Profil({ dark, setDark }) {
  const { user, setUser, logout } = useAuth();
  const [editInfos, setEditInfos] = useState(false);
  const [editPwd, setEditPwd] = useState(false);
  const [editProgramme, setEditProgramme] = useState(false);

  const initials = [user?.prenom?.[0], user?.nom?.[0]].filter(Boolean).join("").toUpperCase() || "?";

  async function refreshUser() {
    const r = await api.get("/auth/me");
    setUser(r.data);
  }

  return (
    <div className="w-full px-4 md:px-8 py-6">

      {/* Avatar + nom */}
      <div className="flex flex-col items-center mb-6">
        <Avatar userId={user?.id} initials={initials} />
        <h1 className="text-xl font-bold text-gray-900 dark:text-white mt-3">{user?.prenom} {user?.nom}</h1>
        <p className="text-sm text-gray-400 mt-0.5">{user?.email}</p>
      </div>

      {/* Infos personnelles */}
      <Section title="Informations personnelles" action={
        <button onClick={() => setEditInfos(true)}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="Modifier">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
      }>
        <Row label="Prénom" value={user?.prenom} />
        <Row label="Nom" value={user?.nom} />
        <Row label="Email" value={user?.email} />
        <Row label="Âge" value={user?.age ? `${user.age} ans` : null} />
        <Row label="Sexe" value={user?.sexe === "M" ? "Homme" : user?.sexe === "F" ? "Femme" : null} />
        <Row label="Poids" value={user?.poids_kg ? `${user.poids_kg} kg` : null} />
        <button onClick={() => setEditPwd(true)}
          className="flex items-center gap-2 py-3 text-sm text-brand font-medium hover:opacity-75 transition-opacity">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          Modifier le mot de passe
        </button>
      </Section>

      {/* Programme */}
      <Section title="Programme" action={
        <button onClick={() => setEditProgramme(true)}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="Modifier">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
      }>
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
        <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-800">
          <span className="text-sm text-gray-700 dark:text-gray-300">Mode sombre</span>
          <button onClick={() => setDark(d => !d)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${dark ? "bg-brand" : "bg-gray-200 dark:bg-gray-700"}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${dark ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
        <div className="flex items-center justify-between py-3">
          <span className="text-sm text-gray-700 dark:text-gray-300">Notifications push</span>
          <PushToggle />
        </div>
      </Section>

      {/* Déconnexion */}
      <button onClick={logout}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-red-200 dark:border-red-900 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm font-medium">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1" />
        </svg>
        Se déconnecter
      </button>

      {editInfos && <EditInfosModal user={user} onClose={() => setEditInfos(false)} onSaved={refreshUser} />}
      {editPwd && <EditPasswordModal onClose={() => setEditPwd(false)} />}
      {editProgramme && <EditProgrammeModal user={user} onClose={() => setEditProgramme(false)} onSaved={refreshUser} />}
    </div>
  );
}
