import { useAuth } from "../AuthContext";
import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api";
import { exporterDonnees, exporterCarnet, supprimerCompte, getPush, abonnerPush, desabonnerPush, testerPush, garderSeulPush, changerHeurePush } from "../api";
import { getErrorMessage } from "../utils/errors";
import ConfirmDialog from "../components/ConfirmDialog";
import Page from "../components/Page";
import Feuille from "../components/Feuille";
import ModalPoids from "../components/ModalPoids";
import { Chevron, Interrupteur, Segmente, SelecteurHeure } from "../components/ui";

// ── Avatar ─────────────────────────────────────────────────────────────────
// La photo est redimensionnée dans le navigateur avant l'envoi (512 px, JPEG) : n'importe
// quelle photo de téléphone passe et ne pèse plus que quelques dizaines de Ko en base.
const MAX_PHOTO_FILE_BYTES = 40_000_000;
const COTE_PHOTO = 512;

function reduirePhoto(file) {
  return new Promise((resoudre, rejeter) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Recadrage carré centré, comme l'affichage rond de l'avatar
      const c = Math.min(img.naturalWidth, img.naturalHeight);
      const cote = Math.min(COTE_PHOTO, c);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = cote;
      canvas.getContext("2d").drawImage(img, (img.naturalWidth - c) / 2, (img.naturalHeight - c) / 2, c, c, 0, 0, cote, cote);
      URL.revokeObjectURL(url);
      resoudre(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rejeter(new Error("Image illisible")); };
    img.src = url;
  });
}

const svg = { fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };

function Avatar({ initials, photoUrl, onPhotoChange }) {
  const [photo, setPhoto] = useState(photoUrl || null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sizeErr, setSizeErr] = useState("");
  const galleryRef = useRef(null);
  const cameraRef = useRef(null);

  useEffect(() => {
    setPhoto(photoUrl || null);
  }, [photoUrl]);

  const mutation = useMutation({
    mutationFn: (dataUrl) => api.patch("/utilisateur/photo", { photo_url: dataUrl }),
    onSuccess: (_data, dataUrl) => {
      setPhoto(dataUrl);
      onPhotoChange?.(dataUrl);
    },
  });

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_PHOTO_FILE_BYTES) {
      setSizeErr("Photo trop grande (max 40 Mo)");
      setMenuOpen(false);
      e.target.value = "";
      return;
    }
    setSizeErr("");
    reduirePhoto(file)
      .then((dataUrl) => mutation.mutate(dataUrl))
      .catch(() => setSizeErr("Format d'image non pris en charge — essaie une photo JPEG ou PNG"));
    setMenuOpen(false);
    e.target.value = "";
  }

  function removePhoto() {
    setSizeErr("");
    mutation.mutate(null);
    setMenuOpen(false);
  }

  const errMsg = sizeErr || (mutation.isError ? getErrorMessage(mutation.error, "Erreur lors de l'enregistrement de la photo") : "");
  const item = "menu-item justify-between gap-6";

  return (
    <div className="relative flex flex-col items-center">
      <button onClick={() => setMenuOpen(v => !v)} className="relative w-24 h-24 rounded-full overflow-hidden active:opacity-80 transition">
        {photo
          ? <img src={photo} alt="avatar" className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-gradient-to-b from-[#A1A1A6] to-[#8E8E93] flex items-center justify-center">
              <span className="font-rounded text-[38px] font-semibold text-white">{initials}</span>
            </div>
        }
      </button>
      <button onClick={() => setMenuOpen(v => !v)} className="btn-texte text-[15px] mt-2">
        {photo ? "Modifier la photo" : "Ajouter une photo"}
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute left-1/2 -translate-x-1/2 top-[132px] z-50">
          <div role="menu" className="menu-verre" style={{ transformOrigin: "top center" }}>
            <button onClick={() => { setMenuOpen(false); setTimeout(() => galleryRef.current?.click(), 50); }} className={item}>
              Choisir une photo
              <svg className="w-5 h-5" {...svg}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 16l5-5 4 4 3-3 6 6" /><circle cx="15.5" cy="8.5" r="1.5" /></svg>
            </button>
            <button onClick={() => { setMenuOpen(false); setTimeout(() => cameraRef.current?.click(), 50); }} className={item}>
              Prendre une photo
              <svg className="w-5 h-5" {...svg}><path d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><circle cx="12" cy="13" r="3" /></svg>
            </button>
            {photo && (
              <button onClick={removePhoto} className={`${item} !text-ios-red`}>
                Supprimer la photo
                <svg className="w-5 h-5" {...svg}><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M9 7V4h6v3" /></svg>
              </button>
            )}
          </div>
          </div>
        </>
      )}

      <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />

      {errMsg && <p className="mt-1 text-[13px] text-ios-red text-center">{errMsg}</p>}
    </div>
  );
}

// ── Listes groupées façon Réglages ─────────────────────────────────────────
function Groupe({ titre, pied, children }) {
  return (
    <div>
      {titre && <h2 className="entete-liste">{titre}</h2>}
      <div className="card py-0.5 overflow-hidden">{children}</div>
      {pied && <p className="px-4 pt-1.5 text-[13px] text-label-2">{pied}</p>}
    </div>
  );
}

// Pictogramme carré coloré (comme dans Réglages)
function Picto({ couleur, children }) {
  return (
    <span className="w-[29px] h-[29px] rounded-[7px] flex items-center justify-center text-white shrink-0" style={{ backgroundColor: couleur }}>
      <svg className="w-[18px] h-[18px]" {...svg}>{children}</svg>
    </span>
  );
}

function Row({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="ligne">
      <span className="flex-1 text-[17px]">{label}</span>
      <span className="text-[17px] text-label-2 truncate max-w-[60%]">{value}</span>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="libelle">{label}</span>
      {children}
    </label>
  );
}

// ── Edit infos ─────────────────────────────────────────────────────────────
function EditInfosModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState({
    prenom: user?.prenom || "",
    nom: user?.nom || "",
    email: user?.email || "",
    sexe: user?.sexe || "",
    date_naissance: user?.date_naissance || "",
    poids_kg: user?.poids_kg ?? "",
  });

  const mutation = useMutation({
    mutationFn: (payload) => api.patch("/utilisateur/infos", payload),
    onSuccess: async () => { await onSaved(); onClose(); },
  });

  function set(k) { return e => setForm(f => ({ ...f, [k]: e.target.value })); }

  function save() {
    const payload = {};
    if (form.prenom !== (user?.prenom || "")) payload.prenom = form.prenom;
    if (form.nom !== (user?.nom || "")) payload.nom = form.nom;
    if (form.email !== (user?.email || "")) payload.email = form.email;
    if (form.sexe !== (user?.sexe || "")) payload.sexe = form.sexe;
    if (form.date_naissance !== (user?.date_naissance || "")) payload.date_naissance = form.date_naissance || null;
    const newPoids = form.poids_kg !== "" ? parseFloat(form.poids_kg) : null;
    if (newPoids !== user?.poids_kg) payload.poids_kg = newPoids;
    if (Object.keys(payload).length > 0) {
      mutation.mutate(payload);
    } else {
      onClose();
    }
  }

  return (
    <Feuille titre="Informations" onClose={onClose}
      action={<button onClick={save} disabled={mutation.isPending} className="btn-texte font-semibold">{mutation.isPending ? "…" : "OK"}</button>}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        <Field label="Prénom"><input className="champ" value={form.prenom} onChange={set("prenom")} /></Field>
        <Field label="Nom"><input className="champ" value={form.nom} onChange={set("nom")} /></Field>
        <div className="col-span-2">
          <Field label="Email"><input type="email" className="champ" value={form.email} onChange={set("email")} /></Field>
        </div>
        <Field label="Sexe">
          <select className="champ" value={form.sexe} onChange={set("sexe")}>
            <option value="">—</option>
            <option value="M">Homme</option>
            <option value="F">Femme</option>
          </select>
        </Field>
        <Field label="Poids (kg)">
          <input type="number" step="0.1" min="20" max="300" inputMode="decimal" className="champ" value={form.poids_kg} onChange={set("poids_kg")} />
        </Field>
        <div className="col-span-2">
          <Field label="Date de naissance">
            <input type="date" className="champ" value={form.date_naissance || ""} onChange={set("date_naissance")} />
          </Field>
        </div>
      </div>
      {mutation.isError && <p className="text-[13px] text-ios-red text-center">{getErrorMessage(mutation.error, "Erreur — réessaie")}</p>}
      <button onClick={save} disabled={mutation.isPending} className="btn-primaire w-full">
        {mutation.isPending ? "Enregistrement…" : "Enregistrer"}
      </button>
    </Feuille>
  );
}

// ── Edit password ──────────────────────────────────────────────────────────
function EditPasswordModal({ onClose }) {
  const { user, login } = useAuth();
  const [form, setForm] = useState({ ancien: "", nouveau: "", confirmer: "" });
  const [validationErr, setValidationErr] = useState("");

  const mutation = useMutation({
    mutationFn: () => api.patch("/utilisateur/password", {
      ancien_mot_de_passe: form.ancien,
      nouveau_mot_de_passe: form.nouveau,
    }),
    // Les autres appareils sont déconnectés ; celui-ci reçoit un nouveau jeton
    onSuccess: (r) => { if (r.data?.access_token) login(r.data.access_token, user); },
  });

  function set(k) { return e => setForm(f => ({ ...f, [k]: e.target.value })); }

  function save() {
    if (form.nouveau !== form.confirmer) { setValidationErr("Les mots de passe ne correspondent pas"); return; }
    if (form.nouveau.length < 8) { setValidationErr("Minimum 8 caractères requis"); return; }
    setValidationErr("");
    mutation.mutate();
  }

  const err = validationErr || (mutation.isError ? getErrorMessage(mutation.error, "Erreur — réessaie") : "");

  return (
    <Feuille titre="Mot de passe" onClose={onClose}>
      {mutation.isSuccess ? (
        <div className="text-center py-8 space-y-3">
          <div className="mx-auto w-14 h-14 rounded-full bg-ios-green/15 text-ios-green flex items-center justify-center">
            <svg className="w-7 h-7" {...svg} strokeWidth={2.6}><path d="M5 12l5 5 9-10" /></svg>
          </div>
          <p className="text-[17px] font-semibold">Mot de passe modifié</p>
          <p className="text-[13px] text-label-2">Tes autres appareils ont été déconnectés.</p>
          <button onClick={onClose} className="btn-teinte">Fermer</button>
        </div>
      ) : (
        <>
          <Field label="Mot de passe actuel">
            <input type="password" className="champ" value={form.ancien} onChange={set("ancien")} autoComplete="current-password" />
          </Field>
          <Field label="Nouveau mot de passe">
            <input type="password" className="champ" value={form.nouveau} onChange={set("nouveau")} autoComplete="new-password" />
          </Field>
          <Field label="Confirmer le nouveau mot de passe">
            <input type="password" className="champ" value={form.confirmer} onChange={set("confirmer")} autoComplete="new-password" />
          </Field>
          {err && <p className="text-[13px] text-ios-red text-center">{err}</p>}
          <button onClick={save} disabled={mutation.isPending} className="btn-primaire w-full">
            {mutation.isPending ? "Enregistrement…" : "Modifier le mot de passe"}
          </button>
        </>
      )}
    </Feuille>
  );
}

// ── Physiologie ────────────────────────────────────────────────────────────
// auto : valeur calculée (lecture seule) ; onClick : tuile éditable (poids)
function BioStat({ label, value, unit, couleur, auto, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={`flex-1 px-3 py-3 text-center${onClick ? " active:bg-remplissage" : ""}`}>
      <p className="text-[12px] font-semibold" style={{ color: couleur }}>{label}</p>
      <p className="font-rounded text-[22px] font-bold chiffres">
        {value != null ? value : <span className="text-label-3">—</span>}
        {value != null && unit && <span className="text-[13px] font-semibold text-label-2 ml-0.5">{unit}</span>}
      </p>
      <p className={`text-[11px] ${onClick ? "text-brand" : "text-label-3"}`}>{onClick ? "Modifier" : auto ? "auto" : value != null ? "manuelle" : "aucune donnée"}</p>
    </Tag>
  );
}

// ── Export / suppression de compte ──────────────────────────────────────────
const aujourdhui = () => new Date().toLocaleDateString("sv-SE"); // AAAA-MM-JJ, heure locale

function telecharger(contenu, type, nom) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Notifications push ──────────────────────────────────────────────────────
const pushPossible = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const estIOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
const installee = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone);

function cleVersOctets(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const brut = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(brut, (c) => c.charCodeAt(0));
}

async function abonnementActuel() {
  if (!pushPossible) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

function Notifications() {
  const qc = useQueryClient();
  const { data: etat } = useQuery({ queryKey: ["push"], queryFn: getPush, staleTime: 60_000 });
  const [actif, setActif] = useState(false);
  const [msg, setMsg] = useState("");
  const [occupe, setOccupe] = useState(false);

  useEffect(() => { abonnementActuel().then((s) => setActif(!!s)).catch(() => {}); }, []);

  async function basculer(on) {
    setMsg(""); setOccupe(true);
    try {
      if (on) {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") throw new Error("Notifications refusées : autorise-les dans les réglages du téléphone.");
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription()
          ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleVersOctets(etat.cle_publique) });
        const { keys } = sub.toJSON();
        await abonnerPush({ endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth });
        setActif(true);
      } else {
        const sub = await abonnementActuel();
        if (sub) {
          await desabonnerPush(sub.endpoint).catch(() => {});
          await sub.unsubscribe();
        }
        setActif(false);
      }
      qc.invalidateQueries({ queryKey: ["push"] });
    } catch (e) {
      setMsg(e?.response ? getErrorMessage(e, "Erreur") : e.message || "Erreur");
    } finally {
      setOccupe(false);
    }
  }

  const test = useMutation({
    mutationFn: testerPush,
    onSuccess: () => { setMsg("Notification envoyée."); qc.invalidateQueries({ queryKey: ["push"] }); },
    onError: (e) => setMsg(getErrorMessage(e, "Échec de l'envoi")),
  });

  // Anciens abonnements (réactivations successives, ancienne installation) : on ne garde que celui-ci
  const nettoyer = useMutation({
    mutationFn: async () => {
      const sub = await abonnementActuel();
      if (!sub) throw new Error("Cet appareil n'est pas abonné : réactive les notifications.");
      return garderSeulPush(sub.endpoint);
    },
    onSuccess: (r) => {
      setMsg(r.supprimes ? `${r.supprimes} ancien${r.supprimes > 1 ? "s" : ""} abonnement${r.supprimes > 1 ? "s" : ""} supprimé${r.supprimes > 1 ? "s" : ""}.` : "Rien à nettoyer.");
      qc.invalidateQueries({ queryKey: ["push"] });
    },
    onError: (e) => setMsg(e?.response ? getErrorMessage(e, "Erreur") : e.message || "Erreur"),
  });

  const heure = useMutation({
    mutationFn: changerHeurePush,
    onMutate: (h) => qc.setQueryData(["push"], (e) => (e ? { ...e, heure: h } : e)),
    onError: (e) => { setMsg(getErrorMessage(e, "Erreur")); qc.invalidateQueries({ queryKey: ["push"] }); },
  });

  const pied = msg || (!etat?.configure
    ? "Notifications non configurées sur le serveur (clés VAPID manquantes)."
    : !pushPossible || (estIOS && !installee)
    ? "Sur iPhone, ajoute d'abord le carnet à l'écran d'accueil (Partager → Sur l'écran d'accueil) puis ouvre-le depuis l'icône."
    : `Chaque matin vers ${etat?.heure ?? "7:30"} après la synchro : forme du jour et séance conseillée, alerte si la VFC baisse plusieurs jours, records battus.`);

  const disponible = etat?.configure && pushPossible;
  return (
    <Groupe titre="Notifications" pied={pied}>
      <div className="ligne" style={{ "--inset": "3.75rem" }}>
        <Picto couleur="#FF3B30"><path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 003.4 0" /></Picto>
        <span className="flex-1 text-[17px]">Notifications du matin</span>
        {disponible
          ? <span className={occupe ? "opacity-50 pointer-events-none" : ""}><Interrupteur actif={actif} onChange={basculer} label="Notifications du matin" /></span>
          : <span className="text-[15px] text-label-3">Indisponible</span>}
      </div>
      {disponible && actif && etat?.heures && (
        <SelecteurHeure libelle="Heure d'envoi" valeur={etat.heure} valeurs={etat.heures} onChange={(h) => heure.mutate(h)} />
      )}
      {disponible && actif && (
        <button onClick={() => test.mutate()} disabled={test.isPending} className="ligne disabled:opacity-50">
          <span className="flex-1 text-[17px] text-brand">Envoyer une notification de test</span>
        </button>
      )}
      {disponible && actif && etat?.appareils > 1 && (
        <button onClick={() => nettoyer.mutate()} disabled={nettoyer.isPending} className="ligne disabled:opacity-50">
          <span className="flex-1 text-[17px] text-brand">Ne garder que cet appareil</span>
          <span className="text-[15px] text-label-2">{etat.appareils} abonnements</span>
        </button>
      )}
    </Groupe>
  );
}

function DonneesCompte({ onDeleted }) {
  const [confirmSuppr, setConfirmSuppr] = useState(false);
  const [mdpSuppr, setMdpSuppr] = useState("");

  const exportMutation = useMutation({
    mutationFn: exporterDonnees,
    onSuccess: (data) => telecharger(JSON.stringify(data, null, 2), "application/json", `carnet-sauvegarde-${aujourdhui()}.json`),
  });
  const csvMutation = useMutation({
    mutationFn: () => exporterCarnet("csv"),
    onSuccess: (data) => telecharger(data, "text/csv;charset=utf-8", `carnet-seances-${aujourdhui()}.csv`),
  });

  const deleteMutation = useMutation({
    mutationFn: () => supprimerCompte(mdpSuppr),
    onSuccess: () => { setConfirmSuppr(false); onDeleted(); },
  });

  const errMsg = exportMutation.isError || csvMutation.isError
    ? getErrorMessage(exportMutation.error || csvMutation.error, "Erreur lors de l'export")
    : deleteMutation.isError
    ? getErrorMessage(deleteMutation.error, "Erreur lors de la suppression du compte")
    : "";

  return (
    <>
      <Groupe titre="Données du compte"
        pied={errMsg || "Sauvegarde complète : profil, séances, mesures de santé, plans et traces GPS. Le CSV contient une ligne par séance (tableur)."}>
        <button onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending} className="ligne disabled:opacity-50">
          <span className="flex-1 text-[17px] text-brand">Sauvegarde complète</span>
          <span className="text-[15px] text-label-2">{exportMutation.isPending ? "…" : "JSON"}</span>
        </button>
        <button onClick={() => csvMutation.mutate()} disabled={csvMutation.isPending} className="ligne disabled:opacity-50">
          <span className="flex-1 text-[17px] text-brand">Exporter les séances</span>
          <span className="text-[15px] text-label-2">{csvMutation.isPending ? "…" : "CSV"}</span>
        </button>
        <button onClick={() => setConfirmSuppr(true)} className="ligne">
          <span className="flex-1 text-[17px] text-ios-red">Supprimer mon compte</span>
        </button>
      </Groupe>
      <ConfirmDialog
        open={confirmSuppr}
        title="Supprimer définitivement ton compte ?"
        message="Toutes tes données (séances, objectifs, historique) seront supprimées sans possibilité de récupération. Saisis ton mot de passe pour confirmer."
        danger
        confirmLabel="Supprimer"
        pending={deleteMutation.isPending}
        disabled={!mdpSuppr}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => { setConfirmSuppr(false); setMdpSuppr(""); deleteMutation.reset(); }}
      >
        <input type="password" className="champ mt-3" placeholder="Mot de passe" autoComplete="current-password"
          value={mdpSuppr} onChange={e => setMdpSuppr(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && mdpSuppr) deleteMutation.mutate(); }} />
        {deleteMutation.isError && (
          <p className="text-[13px] text-ios-red mt-2">{getErrorMessage(deleteMutation.error, "Erreur lors de la suppression")}</p>
        )}
      </ConfirmDialog>
    </>
  );
}

export default function Profil({ theme, setTheme }) {
  const { user, setUser, logout } = useAuth();
  const qc = useQueryClient();
  const [editInfos, setEditInfos] = useState(false);
  const [editPwd, setEditPwd] = useState(false);
  const [editPoids, setEditPoids] = useState(false);

  const initials = [user?.prenom?.[0], user?.nom?.[0]].filter(Boolean).join("").toUpperCase() || "?";

  async function refreshUser() {
    const r = await api.get("/auth/me");
    setUser(r.data);
    qc.invalidateQueries();
  }

  const inset = { "--inset": "3.75rem" };

  return (
    <Page titre="Profil">
      <div className="max-w-xl mx-auto w-full space-y-7">

        <div className="text-center">
          <Avatar
            initials={initials}
            photoUrl={user?.photo_url}
            onPhotoChange={(url) => setUser(u => u ? { ...u, photo_url: url } : u)}
          />
          <h2 className="text-[22px] font-bold mt-2">{user?.prenom} {user?.nom}</h2>
          <p className="text-[15px] text-label-2">{user?.email}</p>
        </div>

        <Groupe titre="Informations personnelles">
          <Row label="Prénom" value={user?.prenom} />
          <Row label="Nom" value={user?.nom} />
          <Row label="Âge" value={user?.age ? `${user.age} ans` : null} />
          <Row label="Sexe" value={user?.sexe === "M" ? "Homme" : user?.sexe === "F" ? "Femme" : null} />
          <Row label="Poids" value={user?.poids_kg ? `${user.poids_kg} kg` : null} />
          <button onClick={() => setEditInfos(true)} className="ligne">
            <span className="flex-1 text-[17px] text-brand">Modifier mes informations</span>
          </button>
          <button onClick={() => setEditPwd(true)} className="ligne">
            <span className="flex-1 text-[17px] text-brand">Modifier le mot de passe</span>
          </button>
        </Groupe>

        <Groupe titre="Physiologie"
          pied="FC max : plus haute FC de séance des 12 derniers mois (pics isolés écartés). FC repos : moyenne des 7 dernières mesures de la montre. Calculées automatiquement pour les zones de FC ; touche le poids pour le modifier.">
          <div className="flex divide-x-[0.5px] divide-separateur">
            <BioStat label="FC max" value={user?.fc_max} unit="bpm" couleur="#FF3B30" auto={user?.fc_max_auto} />
            <BioStat label="FC repos" value={user?.fc_repos} unit="bpm" couleur="#FF2D55" auto={user?.fc_repos_auto} />
            <BioStat label="Poids" value={user?.poids_kg} unit="kg" couleur="#AF52DE" onClick={() => setEditPoids(true)} />
          </div>
        </Groupe>

        <Groupe>
          <Link to="/objectifs" className="ligne" style={inset}>
            <Picto couleur="#34C759"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.5" fill="currentColor" /></Picto>
            <span className="flex-1 text-[17px]">Objectifs</span>
            <Chevron />
          </Link>
          <Link to="/sources" className="ligne" style={inset}>
            <Picto couleur="#007AFF"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Picto>
            <span className="flex-1 text-[17px]">Sources et import</span>
            <Chevron />
          </Link>
          <Link to="/sources#ia" className="ligne" style={inset}>
            <Picto couleur="#FF9500"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" /></Picto>
            <span className="flex-1 text-[17px]">Analyse avec ton IA</span>
            <Chevron />
          </Link>
        </Groupe>

        <Groupe titre="Apparence">
          <div className="ligne" style={inset}>
            <Picto couleur="#5856D6"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" /></Picto>
            <span className="flex-1 text-[17px]">Thème</span>
            <Segmente valeur={theme} onChange={setTheme} className="w-[200px]"
              options={[["auto", "Auto"], ["light", "Clair"], ["dark", "Sombre"]]} />
          </div>
        </Groupe>

        <Notifications />

        <DonneesCompte onDeleted={logout} />

        <Groupe>
          <button onClick={logout} className="ligne justify-center">
            <span className="text-[17px] text-ios-red">Se déconnecter</span>
          </button>
        </Groupe>
      </div>

      {editPoids && <ModalPoids initialValue={user?.poids_kg} onClose={() => setEditPoids(false)} />}
      {editInfos && <EditInfosModal user={user} onClose={() => setEditInfos(false)} onSaved={refreshUser} />}
      {editPwd && <EditPasswordModal onClose={() => setEditPwd(false)} />}
    </Page>
  );
}
