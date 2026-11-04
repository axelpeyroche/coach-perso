// Mannequin 3D de démonstration des exercices (séance guidée → « Voir le mouvement »).
// Un mannequin d'artiste sans genre, construit à partir de formes simples, prend
// les poses décrites en JSON (voir animations.py) : bassin, épaules, mains, pieds…
// Les coudes et les genoux se placent seuls (cinématique inverse à deux os).
// Repère : mètres, y vers le haut, sol en y = 0 ; debout face à +x, la droite est en +z.
import {
  ACESFilmicToneMapping, BoxGeometry, Color, CylinderGeometry, DirectionalLight, Fog, Group,
  HemisphereLight, Matrix4, Mesh, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera,
  PlaneGeometry, Scene, SphereGeometry, Vector3, WebGLRenderer,
} from "three";

const TRONC = 0.52, BRAS = 0.3, AVANT_BRAS = 0.27, CUISSE = 0.45, TIBIA = 0.45, EPAULES = 0.19, HANCHES = 0.09;
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const FOV = 32;
const DEPART = { az: 0.62, el: 0.2 };
// Angles proposés par le bouton « Changer d'angle » : face, profil, autre profil, dessus
const ANGLES = [[Math.PI / 2, 0.08], [0, 0.15], [Math.PI, 0.35], [0.62, 1.35]];
// Raccourcis symétriques : la valeur donnée vaut pour la droite, la gauche est son miroir (z → -z)
const SYM = {
  m: ["mg", "md"], p: ["pg", "pd"], coude: ["coude_g", "coude_d"], genou: ["genou_g", "genou_d"],
  doigts: ["doigts_g", "doigts_d"], prise: ["prise_g", "prise_d"], orteils: ["orteils_g", "orteils_d"],
};

const v3 = (a) => new Vector3(a[0], a[1], a[2]);
const ease = (x) => (1 - Math.cos(Math.PI * x)) / 2;
// a privé de sa composante selon b (unitaire)
const orth = (a, b) => a.clone().addScaledVector(b, -a.dot(b));
// Premier vecteur non nul, normé
function unitaire(...candidats) {
  for (const c of candidats) if (c && c.lengthSq() > 1e-6) return c.clone().normalize();
  return X.clone();
}
const horizontal = (v) => new Vector3(v.x, 0, v.z);

function deplier(pose) {
  const r = {};
  for (const [k, v] of Object.entries(pose)) if (!SYM[k]) r[k] = v;
  for (const [k, [g, d]] of Object.entries(SYM)) {
    const v = pose[k];
    if (!v) continue;
    if (!(d in r)) r[d] = v;
    if (!(g in r)) r[g] = [v[0], v[1], -v[2]];
  }
  return r;
}

function melanger(a, b, k) {
  const r = {};
  for (const cle of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[cle], y = b[cle];
    if (x == null || y == null) r[cle] = x ?? y;
    else if (Array.isArray(x)) r[cle] = x.map((xi, i) => xi + (y[i] - xi) * k);
    else r[cle] = x + (y - x) * k;
  }
  return r;
}

// Poses complètes (les suivantes héritent de la première) et frise des phases
function preparer(anim) {
  const brutes = Object.entries(anim.poses ?? {}).map(([nom, p]) => [nom, deplier(p)]);
  const premiere = brutes[0]?.[1] ?? {};
  const poses = Object.fromEntries(brutes.map(([nom, p]) => [nom, { ...premiere, ...p }]));
  const phases = (anim.phases ?? []).filter((ph) => poses[ph[0]]).map(([pose, duree, libelle]) => ({ pose, duree: Math.max(0.1, +duree || 1), libelle: libelle ?? "" }));
  if (!phases.length) phases.push({ pose: brutes[0]?.[0], duree: 1, libelle: "" });
  const total = phases.reduce((s, ph) => s + ph.duree, 0);
  return { poses, phases, total };
}

function poseA(prep, t) {
  const { poses, phases, total } = prep;
  let reste = ((t % total) + total) % total;
  for (let i = 0; i < phases.length; i++) {
    const ph = phases[i];
    if (reste < ph.duree || i === phases.length - 1) {
      const avant = poses[phases[(i - 1 + phases.length) % phases.length].pose];
      return { pose: melanger(avant, poses[ph.pose], ease(Math.min(1, reste / ph.duree))), libelle: ph.libelle };
    }
    reste -= ph.duree;
  }
}

// Coude ou genou : deux os de longueurs a et b entre S et la cible, plié du côté du pôle
function ik(S, cible, a, b, pole) {
  const d0 = cible.clone().sub(S);
  const dir = unitaire(d0, Y.clone().negate());
  const d = Math.min(Math.max(d0.length(), Math.abs(a - b) + 1e-3), a + b - 1e-3);
  const ca = (a * a + d * d - b * b) / (2 * a * d), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  const pp = unitaire(orth(pole, dir), orth(Y, dir), orth(X, dir));
  return { milieu: S.clone().addScaledVector(dir, a * ca).addScaledVector(pp, a * sa), fin: S.clone().addScaledVector(dir, d) };
}

// Position de chaque articulation pour une pose
function squelette(p) {
  const B = v3(p.bassin);
  const u = unitaire(v3(p.epaules ?? [0, 1.5, 0]).sub(B), Y);
  const E = B.clone().addScaledVector(u, TRONC);
  const n = unitaire(orth(v3(p.devant ?? [1, 0, 0]), u), orth(X, u), orth(Z, u));
  const L = new Vector3().crossVectors(n, u);
  // Flexion : la taille recule, le dos s'arrondit
  const M = B.clone().addScaledVector(u, 0.17).addScaledVector(n, -0.1 * (p.flexion ?? 0));
  const uP = unitaire(M.clone().sub(B)), uC = unitaire(E.clone().sub(M));
  const nP = unitaire(orth(n, uP)), nC = unitaire(orth(n, uC));
  const t = unitaire(p.tete ? v3(p.tete) : null, uC);
  const nT = unitaire(orth(nC, t), orth(n, t));
  const sq = { B, E, M, u, n, L, uP, uC, nP, nC, t, nT, cotes: {} };
  for (const s of [1, -1]) {
    const c = s > 0 ? "d" : "g";
    const S = E.clone().addScaledVector(L, EPAULES * s);
    const cibleM = p["m" + c] ? v3(p["m" + c]) : S.clone().addScaledVector(u, -0.55);
    const poleC = p["coude_" + c] ? v3(p["coude_" + c]) : n.clone().multiplyScalar(-0.6).addScaledVector(uC, -0.5).addScaledVector(L, 0.75 * s);
    const bras = ik(S, cibleM, BRAS, AVANT_BRAS, poleC);
    const W = bras.fin;
    const doigts = unitaire(p["doigts_" + c] ? v3(p["doigts_" + c]) : null, W.clone().sub(bras.milieu));
    const prise = unitaire(orth(p["prise_" + c] ? v3(p["prise_" + c]) : n, doigts), orth(uC, doigts), orth(L, doigts));
    const H = B.clone().addScaledVector(L, HANCHES * s);
    const cibleP = p["p" + c] ? v3(p["p" + c]) : H.clone().addScaledVector(u, -0.88);
    const jambe = ik(H, cibleP, CUISSE, TIBIA, p["genou_" + c] ? v3(p["genou_" + c]) : n);
    const A = jambe.fin, K = jambe.milieu;
    const k = unitaire(K.clone().sub(A));
    let O;
    if (p["orteils_" + c]) O = v3(p["orteils_" + c]);
    else {
      // Pied à plat s'il touche le sol, sinon détendu dans le prolongement
      const h = unitaire(horizontal(n).length() > 0.3 ? horizontal(n) : null, horizontal(K.clone().sub(H)), X);
      O = A.y < 0.15 ? new Vector3(A.x + h.x * 0.14, 0.02, A.z + h.z * 0.14)
        : A.clone().add(unitaire(h.clone().multiplyScalar(0.13).addScaledVector(k, -0.06)).multiplyScalar(0.15));
    }
    O.y = Math.max(O.y, 0.015);
    const f = unitaire(O.clone().sub(A), X);
    const w = unitaire(orth(k, f), orth(Y, f));
    const talon = A.clone().addScaledVector(f, -0.033).addScaledVector(w, -0.063);
    sq.cotes[c] = { S, coude: bras.milieu, W, doigts, prise, H, K, A, O, talon };
  }
  return sq;
}

// --- Géométrie : chaque pièce est placée par sa matrice ---
function placerSeg(m, a, b) {
  const d = b.clone().sub(a), l = d.length();
  d.normalize();
  const p = new Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? Y : X).normalize();
  const q = new Vector3().crossVectors(p, d);
  m.matrix.makeBasis(p, d.clone().multiplyScalar(l), q);
  m.matrix.setPosition(a.clone().add(b).multiplyScalar(0.5));
}
function placerBoule(m, c, r) {
  m.matrix.makeScale(r, r, r);
  m.matrix.setPosition(c);
}
function placerOvo(m, c, u, n, a, b, cc) {
  const w = new Vector3().crossVectors(u, n);
  m.matrix.makeBasis(u.clone().multiplyScalar(a), n.clone().multiplyScalar(b), w.multiplyScalar(cc));
  m.matrix.setPosition(c);
}
// Objet orienté selon un axe (son y local)
function placerAxe(m, c, axe) {
  const d = unitaire(axe, Y);
  const p = new Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? Y : X).normalize();
  m.matrix.makeBasis(p, d, new Vector3().crossVectors(p, d));
  m.matrix.setPosition(c);
}

export function creerScene(conteneur, anim, { surPhase, surManip } = {}) {
  const jetables = [];
  const garder = (x) => (jetables.push(x), x);
  const rendu = new WebGLRenderer({ antialias: true });
  rendu.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  rendu.toneMapping = ACESFilmicToneMapping;
  rendu.shadowMap.enabled = true;
  rendu.shadowMap.type = PCFSoftShadowMap;
  Object.assign(rendu.domElement.style, { display: "block", width: "100%", height: "100%", touchAction: "none", cursor: "grab" });
  conteneur.appendChild(rendu.domElement);
  const toile = rendu.domElement;

  const sc = new Scene();
  sc.background = new Color(0x0d0d0f);
  sc.fog = new Fog(0x0d0d0f, 5, 11);
  const cam = new PerspectiveCamera(FOV, 1, 0.05, 30);
  sc.add(new HemisphereLight(0xffffff, 0x303038, 2));
  const soleil = new DirectionalLight(0xffffff, 4.6);
  soleil.castShadow = true;
  soleil.shadow.mapSize.set(1024, 1024);
  Object.assign(soleil.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 12 });
  sc.add(soleil, soleil.target);
  const appoint = new DirectionalLight(0xc9d6ff, 1.1);
  appoint.position.set(-2, 2, -2);
  sc.add(appoint);
  const sol = new Mesh(garder(new PlaneGeometry(20, 20)), garder(new MeshStandardMaterial({ color: 0x18181b, roughness: 1 })));
  sol.rotation.x = -Math.PI / 2;
  sol.receiveShadow = true;
  sc.add(sol);

  const peau = garder(new MeshStandardMaterial({ color: 0xd8c3a0, roughness: 0.55 }));
  const artic = garder(new MeshStandardMaterial({ color: 0xb79d76, roughness: 0.5 }));
  const metal = garder(new MeshStandardMaterial({ color: 0x9a9aa2, metalness: 0.8, roughness: 0.35 }));
  const fonte = garder(new MeshStandardMaterial({ color: 0x2c2c31, metalness: 0.5, roughness: 0.45 }));
  const sph = garder(new SphereGeometry(1, 32, 20));
  const cyl = garder(new CylinderGeometry(1, 1, 1, 20));
  const cube = garder(new BoxGeometry(1, 1, 1));
  function piece(geo, mat, parent = sc) {
    const m = new Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    parent.add(m);
    return m;
  }
  const seg = (r1, r2) => piece(garder(new CylinderGeometry(r2, r1, 1, 24)), peau);
  const boule = () => piece(sph, artic);
  const ovo = () => piece(sph, peau);

  // --- Décor ---
  const halteres = [];
  function haltere() {
    const g = new Group();
    g.matrixAutoUpdate = false;
    const poignee = piece(cyl, fonte, g);
    poignee.matrix.makeScale(0.016, 0.15, 0.016);
    for (const y of [-0.085, 0.085]) {
      const disque = piece(cyl, fonte, g);
      disque.matrix.makeScale(0.065, 0.045, 0.065);
      disque.matrix.setPosition(0, y, 0);
    }
    sc.add(g);
    return g;
  }
  function boite(c, t, mat) {
    const m = piece(cube, mat);
    m.matrix.makeScale(t[0], t[1], t[2]);
    m.matrix.setPosition(c[0], c[1], c[2]);
    return m;
  }
  function barre(a, b, r, mat) {
    const m = piece(cyl, mat);
    const A = v3(a), Bv = v3(b);
    placerSeg(m, A, Bv);
    m.matrix.multiply(new Matrix4().makeScale(r, 1, r));
    return m;
  }
  const bois = garder(new MeshStandardMaterial({ color: 0x6b5440, roughness: 0.8 }));
  const caisse = garder(new MeshStandardMaterial({ color: 0x4d4d55, roughness: 0.85 }));
  const mousse = garder(new MeshStandardMaterial({ color: 0x3a2f4a, roughness: 0.9 }));
  const acier = garder(new MeshStandardMaterial({ color: 0x55555c, metalness: 0.6, roughness: 0.5 }));
  const pointsDecor = [];
  for (const d of anim.decor ?? []) {
    if (d.type === "barre" && d.a && d.b) {
      barre(d.a, d.b, 0.016, metal);
      if (d.poteaux !== false) for (const e of [d.a, d.b]) barre([e[0], 0, e[2]], e, 0.022, acier);
      pointsDecor.push(v3(d.a), v3(d.b));
    } else if ((d.type === "boite" || d.type === "tapis") && d.c && d.t) {
      boite(d.c, d.t, d.type === "tapis" ? mousse : caisse);
    } else if (d.type === "chaise" && d.c) {
      const [x, , z] = d.c;
      const dos = unitaire(horizontal(v3(d.dossier ?? [-1, 0, 0])));
      const cote = new Vector3().crossVectors(Y, dos);
      boite([x, 0.43, z], [0.42, 0.04, 0.42], bois);
      for (const a of [-1, 1]) for (const b of [-1, 1]) {
        const pied = dos.clone().multiplyScalar(0.18 * a).addScaledVector(cote, 0.18 * b);
        barre([x + pied.x, 0, z + pied.z], [x + pied.x, 0.41, z + pied.z], 0.015, bois);
      }
      // Dossier : deux montants et une planche
      for (const b of [-1, 1]) {
        const m = dos.clone().multiplyScalar(0.19).addScaledVector(cote, 0.18 * b);
        barre([x + m.x, 0.45, z + m.z], [x + m.x, 0.88, z + m.z], 0.014, bois);
      }
      const planche = piece(cube, bois);
      planche.matrix.makeBasis(cote.clone().multiplyScalar(0.4), Y.clone().multiplyScalar(0.16), dos.clone().multiplyScalar(0.025));
      planche.matrix.setPosition(x + dos.x * 0.19, 0.78, z + dos.z * 0.19);
    } else if (d.type === "haltere") {
      const g = haltere();
      if (d.main) halteres.push({ g, main: d.main });
      else if (d.c) placerAxe(g, v3(d.c), v3(d.axe ?? [0, 0, 1]));
    }
  }

  // --- Mannequin ---
  const P = { tete: ovo(), cou: seg(0.045, 0.05), buste: ovo(), bassin: ovo(), taille: seg(0.125, 0.115), ventre: piece(sph, peau) };
  const cotes = Object.fromEntries(["d", "g"].map((c) => [c, {
    epaule: boule(), bras: seg(0.052, 0.043), coude: boule(), avb: seg(0.041, 0.031), poignet: boule(), main: ovo(),
    hanche: boule(), cuisse: seg(0.078, 0.056), genou: boule(), tibia: seg(0.052, 0.036), cheville: boule(), pied: seg(0.036, 0.028),
  }]));
  const centreMain = (k) => k.W.clone().addScaledVector(k.doigts, 0.055);

  function poser(sq) {
    const { B, E, M, uP, uC, nP, nC, t, nT } = sq;
    placerOvo(P.bassin, B.clone().addScaledVector(uP, 0.05), uP, nP, 0.13, 0.1, 0.17);
    placerOvo(P.buste, E.clone().addScaledVector(uC, -0.17).addScaledVector(nC, 0.025), uC, nC, 0.21, 0.12, 0.2);
    placerSeg(P.taille, B.clone().addScaledVector(uP, 0.08), M.clone().addScaledVector(uC, 0.06));
    placerBoule(P.ventre, M, 0.118);
    placerSeg(P.cou, E.clone().addScaledVector(uC, 0.02), E.clone().addScaledVector(t, 0.14));
    placerOvo(P.tete, E.clone().addScaledVector(t, 0.25).addScaledVector(nT, 0.015), t, nT, 0.12, 0.095, 0.09);
    for (const c of ["d", "g"]) {
      const k = sq.cotes[c], m = cotes[c];
      placerBoule(m.epaule, k.S, 0.062);
      placerSeg(m.bras, k.S, k.coude);
      placerBoule(m.coude, k.coude, 0.046);
      placerSeg(m.avb, k.coude, k.W);
      placerBoule(m.poignet, k.W, 0.032);
      placerOvo(m.main, centreMain(k), k.doigts, new Vector3().crossVectors(k.doigts, k.prise), 0.085, 0.024, 0.045);
      placerBoule(m.hanche, k.H, 0.072);
      placerSeg(m.cuisse, k.H, k.K);
      placerBoule(m.genou, k.K, 0.057);
      placerSeg(m.tibia, k.K, k.A);
      placerBoule(m.cheville, k.A, 0.036);
      placerSeg(m.pied, k.talon, k.O);
    }
    for (const h of halteres) {
      if (h.main === "gd") {
        const g = sq.cotes.g, d = sq.cotes.d;
        const c = centreMain(g).add(centreMain(d)).multiplyScalar(0.5);
        placerAxe(h.g, c, c.clone().sub(g.coude.clone().add(d.coude).multiplyScalar(0.5)));
      } else {
        const k = sq.cotes[h.main === "g" ? "g" : "d"];
        placerAxe(h.g, k.W.clone().addScaledVector(k.doigts, 0.05), k.prise);
      }
    }
  }

  // --- Cadrage : tout le mouvement tient à l'écran ---
  const prep = preparer(anim);
  const points = [...pointsDecor];
  for (const pose of Object.values(prep.poses)) {
    const sq = squelette(pose);
    points.push(sq.B, sq.E, sq.E.clone().addScaledVector(sq.t, 0.37));
    for (const k of Object.values(sq.cotes)) points.push(k.coude, centreMain(k), k.K, k.O, k.talon);
  }
  const mini = points.reduce((a, p) => a.min(p), points[0].clone());
  const maxi = points.reduce((a, p) => a.max(p), points[0].clone());
  const centre = mini.clone().add(maxi).multiplyScalar(0.5);
  soleil.position.copy(centre).add(new Vector3(1.8, 4, 2.6));
  soleil.target.position.copy(centre);
  const camAnim = anim.camera ?? {};
  const depart = { az: camAnim.az ?? DEPART.az, el: camAnim.el ?? DEPART.el, c: camAnim.cible ? v3(camAnim.cible) : centre };

  function distancePour(az, el, c) {
    if (camAnim.R && az === depart.az && el === depart.el) return camAnim.R;
    const versCam = new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    const droite = unitaire(new Vector3().crossVectors(Y, versCam), X), haut = new Vector3().crossVectors(versCam, droite);
    const tv = Math.tan((FOV / 2) * Math.PI / 180), th = tv * cam.aspect;
    let R = 0.9;
    for (const p of points) {
      const d = p.clone().sub(c);
      const z = d.dot(versCam);
      // Marges : titre en haut, consignes et boutons en bas
      R = Math.max(R, z + Math.abs(d.dot(droite)) / (th * 0.86), z + Math.abs(d.dot(haut)) / (tv * 0.6));
    }
    return Math.min(6, R * 1.04);
  }

  const cible = depart.c.clone();
  let az = depart.az, el = depart.el, R = 2.75, transition = null, touche = false;
  function placerCam() {
    cam.position.set(cible.x + R * Math.cos(el) * Math.sin(az), cible.y + R * Math.sin(el), cible.z + R * Math.cos(el) * Math.cos(az));
    cam.lookAt(cible);
  }
  function borner() {
    el = Math.min(1.5, Math.max(0.02, el));
    R = Math.min(6, Math.max(0.9, R));
    cible.clamp(mini.clone().subScalar(1).setY(0.05), maxi.clone().addScalar(1));
  }
  function aller(a, e, c) {
    while (az - a > Math.PI) a += 2 * Math.PI;
    while (a - az > Math.PI) a -= 2 * Math.PI;
    transition = { t: 0, de: [az, el, R, cible.clone()], a: [a, e, distancePour(a, e, c), c.clone()] };
  }
  const recentrer = () => aller(depart.az, depart.el, depart.c);
  let ia = -1;
  const angleSuivant = () => {
    ia = (ia + 1) % ANGLES.length;
    aller(ANGLES[ia][0], ANGLES[ia][1], depart.c);
  };

  // Taille de la toile ; le centre de l'image remonte un peu au-dessus des consignes
  function dimensionner() {
    const l = conteneur.clientWidth || 1, h = conteneur.clientHeight || 1;
    rendu.setSize(l, h, false);
    cam.aspect = l / h;
    cam.setViewOffset(l, h, 0, h * 0.07, l, h);
    cam.updateProjectionMatrix();
    if (!touche) R = distancePour(az, el, cible);
  }
  const obs = new ResizeObserver(dimensionner);
  obs.observe(conteneur);
  dimensionner();

  // --- Gestes : 1 doigt / clic tourne, pincer / molette zoome, 2 doigts / clic droit déplace ---
  function manip() {
    touche = true;
    surManip?.();
  }
  function deplacer(dx, dy) {
    const k = R * 0.0016;
    const dr = X.clone().applyQuaternion(cam.quaternion), du = Y.clone().applyQuaternion(cam.quaternion);
    cible.addScaledVector(dr, -dx * k).addScaledVector(du, dy * k);
  }
  const doigts = new Map();
  let mode = null, prec = null, dernierTap = 0;
  function etat() {
    const v = [...doigts.values()];
    if (v.length === 1) return { x: v[0].x, y: v[0].y };
    const [a, b] = v;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  }
  const ecoute = (type, f, opt) => {
    toile.addEventListener(type, f, opt);
    jetables.push({ dispose: () => toile.removeEventListener(type, f, opt) });
  };
  ecoute("contextmenu", (e) => e.preventDefault());
  ecoute("pointerdown", (e) => {
    toile.setPointerCapture?.(e.pointerId);
    doigts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    transition = null;
    if (doigts.size === 1) {
      mode = e.button === 2 || e.shiftKey ? "pan" : "tour";
      if (e.pointerType === "touch") {
        const now = performance.now();
        if (now - dernierTap < 300) recentrer();
        dernierTap = now;
      }
    } else mode = "deux";
    prec = etat();
    toile.style.cursor = "grabbing";
    manip();
  });
  ecoute("pointermove", (e) => {
    const d = doigts.get(e.pointerId);
    if (!d) return;
    d.x = e.clientX;
    d.y = e.clientY;
    const s = etat(), dx = s.x - prec.x, dy = s.y - prec.y;
    if (mode === "tour") { az -= dx * 0.011; el += dy * 0.007; }
    else if (mode === "pan") deplacer(dx, dy);
    else if (mode === "deux" && s.d && prec.d) { R *= prec.d / s.d; deplacer(dx, dy); }
    prec = s;
    borner();
    manip();
  });
  const fin = (e) => {
    doigts.delete(e.pointerId);
    if (doigts.size === 1) { mode = "tour"; prec = etat(); }
    else if (!doigts.size) { mode = null; toile.style.cursor = "grab"; }
  };
  ecoute("pointerup", fin);
  ecoute("pointercancel", fin);
  ecoute("wheel", (e) => {
    e.preventDefault();
    transition = null;
    R *= Math.exp(e.deltaY * 0.0012);
    borner();
    manip();
  }, { passive: false });
  ecoute("dblclick", recentrer);

  // --- Boucle ---
  let enPause = false, vitesse = 1, t = 0, dernier = performance.now(), libelle = null, raf = 0;
  function image(now) {
    const dt = Math.min(0.05, (now - dernier) / 1000);
    dernier = now;
    if (!enPause) t += dt * vitesse;
    if (transition) {
      transition.t = Math.min(1, transition.t + dt / 0.6);
      const k = ease(transition.t), [a0, e0, r0, c0] = transition.de, [a1, e1, r1, c1] = transition.a;
      az = a0 + (a1 - a0) * k;
      el = e0 + (e1 - e0) * k;
      R = r0 + (r1 - r0) * k;
      cible.copy(c0).lerp(c1, k);
      if (transition.t >= 1) transition = null;
    }
    const { pose, libelle: l } = poseA(prep, t);
    if (l !== libelle) { libelle = l; surPhase?.(l); }
    poser(squelette(pose));
    placerCam();
    rendu.render(sc, cam);
    raf = requestAnimationFrame(image);
  }
  raf = requestAnimationFrame(image);

  return {
    pause: (b) => { enPause = b ?? !enPause; return enPause; },
    vitesse: (v) => { vitesse = v; },
    angleSuivant,
    recentrer,
    // Tests : fige le mouvement à l'instant t (secondes)
    allerA: (x) => { t = x; enPause = true; },
    duree: prep.total,
    detruire: () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
      for (const x of jetables) x.dispose();
      rendu.dispose();
      rendu.forceContextLoss();
      toile.remove();
    },
  };
}
