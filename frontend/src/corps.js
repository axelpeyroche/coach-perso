// Corps du mannequin 3D : un vrai modèle d'homme musclé (Quaternius, « Universal Base Characters », CC0),
// converti une fois en fichiers compacts (public/modeles) : maillage + attaches aux os, relief sculpté, carte des muscles.
// La peau suit le squelette de mannequin.js ; les muscles sollicités par l'exercice se colorent.
import {
  Bone, BufferAttribute, BufferGeometry, Color, DataTexture, Group, LinearFilter, LinearMipmapLinearFilter, Matrix4,
  MeshStandardMaterial, Quaternion, RedFormat, Skeleton, SkinnedMesh, Texture, Vector2, Vector3,
} from "three";

// Debout, bras écartés du corps, jambes légèrement ouvertes
export const REPOS = {
  bassin: [0, 0.95, 0], epaules: [0, 1.5, 0], devant: [1, 0, 0],
  md: [0, 0.97, 0.4], mg: [0, 0.97, -0.4], coude_d: [-1, 0, 0], coude_g: [-1, 0, 0],
  pd: [0, 0.07, 0.16], pg: [0, 0.07, -0.16],
};
export const ZONES = ["pectoraux", "dos", "epaules", "biceps", "triceps", "avant-bras", "abdos", "fessiers", "quadriceps", "ischios", "mollets"];

const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const borne = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const orth = (a, b) => a.clone().addScaledVector(b, -a.dot(b));
function unit(...c) {
  for (const v of c) if (v.lengthSq() > 1e-8) return v.clone().normalize();
  return X.clone();
}
// Côté de la paume : face au sol si la main y est posée, sinon côté fléchisseur, vers le corps ou vers l'avant
export function paume(sq, c, prec) {
  const k = sq.cotes[c], s = c === "d" ? 1 : -1;
  const base = new Vector3().crossVectors(k.doigts, k.prise).normalize();
  if (prec) return base.dot(prec) >= 0 ? base : base.negate();
  const dA = unit(k.W.clone().sub(k.coude)), fl = orth(k.S.clone().sub(k.coude), dA);
  if (fl.lengthSq() > 1e-8) fl.normalize();
  const note = 0.5 * base.dot(fl) - 0.6 * s * base.dot(sq.L) + 0.6 * base.dot(sq.n) - (k.W.y < 0.2 ? 5 * base.y : 0);
  return note >= 0 ? base : base.negate();
}

// Orientation d'un repère : y le long de l'os, x du côté `versX`
function orient(versX, y) {
  const yy = unit(y), x = unit(orth(versX, yy), orth(X, yy), orth(Z, yy));
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, yy, new Vector3().crossVectors(x, yy)));
}
// Étirement d'un facteur s le long de l'axe a
function etire(a, s) {
  const k = s - 1;
  return new Matrix4().set(1 + k * a.x * a.x, k * a.x * a.y, k * a.x * a.z, 0, k * a.y * a.x, 1 + k * a.y * a.y, k * a.y * a.z, 0,
    k * a.z * a.x, k * a.z * a.y, 1 + k * a.z * a.z, 0, 0, 0, 0, 1);
}
// Déplacement d'un os : rotation q (et étirement le long de `axe`), le point de repos pr arrive en pt
function delta(q, pr, pt, axe, s = 1) {
  const m = new Matrix4().makeRotationFromQuaternion(q);
  if (axe && s !== 1) m.multiply(etire(axe, s));
  const o = pr.clone().applyMatrix4(m);
  return m.setPosition(pt.x - o.x, pt.y - o.y, pt.z - o.z);
}
const pivot = (p, axe, angle) => delta(new Quaternion().setFromAxisAngle(axe, angle), p, p);
const balance = (de, vers) => new Quaternion().setFromUnitVectors(de, vers);

// --- Chargement (une fois) ---
// Deux corps : « homme » et « femme » (même squelette, mêmes zones)
const fichiers = (n) => ({ bin: `/modeles/${n}.bin`, relief: `/modeles/${n}-relief.jpg`, zones: `/modeles/${n}-zones.png` });
const sources = {}, charges = {};
// Page autonome : bin peut être un ArrayBuffer, les images des adresses data:
export function sourcesModele(s, nom = "homme") { sources[nom] = { ...fichiers(nom), ...s }; delete charges[nom]; }
const image = (src) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
const DOIGTS = ["index", "middle", "ring", "pinky"];
const DELTA_PIED = 0.117;   // écart entre l'axe cheville → avant-pied du squelette et celui du modèle (rad)

function preparer(buf, relief, zones) {
  const vue = new DataView(buf), lj = vue.getUint32(0, true), base = 4 + lj;
  const e = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, lj)));
  const bloc = (n, T, pas) => new T(buf, base + e.blocs[n][0], e.blocs[n][1] / pas);
  const A = Object.fromEntries(Object.entries(e.art).map(([n, p]) => [n, new Vector3(p[0], p[1], p[2])]));
  const pos = bloc("pos", Float32Array, 4);
  // Yeux : direction de chaque point depuis le centre du globe (l'iris se dessine dans le matériau)
  const oeil = new Float32Array(e.nv * 3);
  const finYeux = e.cheveux ?? e.nv;
  for (let i = finYeux; i < e.nv; i++) oeil[3 * i] = 2;      // cheveux : repère hors de la sphère unité
  for (let i = e.corps; i < finYeux; i++) {
    const c = e.yeux[pos[3 * i + 2] < 0 ? 0 : 1].c;
    const d = new Vector3(pos[3 * i] - c[0], pos[3 * i + 1] - c[1], pos[3 * i + 2] - c[2]).normalize();
    oeil.set([d.x, d.y, d.z], 3 * i);
  }
  // Carte des muscles : numéro de zone de chaque point de la peau
  const T = zones.naturalWidth, toile = document.createElement("canvas");
  toile.width = toile.height = T;
  const ctx = toile.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(zones, 0, 0);
  const px = ctx.getImageData(0, 0, T, T).data, idZone = new Uint8Array(T * T);
  for (let i = 0; i < T * T; i++) idZone[i] = Math.round(px[4 * i] / 20);

  // Repères de la pose de repos
  const mil = (a, b) => A[a].clone().add(A[b]).multiplyScalar(0.5);
  const Br = mil("thigh_l", "thigh_r"), Er = mil("upperarm_l", "upperarm_r"), ur = unit(Er.clone().sub(Br)), lt = Er.distanceTo(Br);
  const R = { Br, ur, Mr: Br.clone().addScaledVector(ur, 0.327 * lt), lP: 0.327 * lt, lC: 0.673 * lt, qR: orient(X, ur).invert(), cotes: {} };
  for (const [c, x] of [["d", "r"], ["g", "l"]]) {
    const n = (b) => `${b}_${x}`, dir = (a, b) => unit(A[n(b)].clone().sub(A[n(a)])), lg = (a, b) => A[n(a)].distanceTo(A[n(b)]);
    const dB = dir("upperarm", "lowerarm"), dA = dir("lowerarm", "hand"), dH = dir("hand", "middle_01");
    const dC = dir("thigh", "calf"), dT = dir("calf", "foot"), dF = dir("foot", "ball");
    const xF = unit(orth(Y, dF)), talon = new Vector3(A[n("foot")].x - e.talon, 0, A[n("foot")].z).sub(A[n("ball")]);
    const dn = new Vector3(0, -1, 0);   // côté paume, au repos
    R.cotes[c] = {
      n, dB, dA, dC, dT, dF, lB: lg("upperarm", "lowerarm"), lA: lg("lowerarm", "hand"), lC: lg("thigh", "calf"), lT: lg("calf", "foot"), lF: lg("foot", "ball"),
      qB: orient(X.clone().negate(), dB).invert(), qA: orient(X.clone().negate(), dA).invert(), qH: orient(dn, dH).invert(),
      qC: orient(X, dC).invert(), qT: orient(X, dT).invert(), qF: orient(Y, dF).invert(),
      talonY: talon.dot(dF), talonX: talon.dot(xF),
      doigts: DOIGTS.map((d) => [1, 2, 3].map((i) => {
        const a = A[n(`${d}_0${i}`)], b = A[n(i < 3 ? `${d}_0${i + 1}` : `${d}_04_leaf`)];
        return { nom: n(`${d}_0${i}`), p: a, axe: unit(new Vector3().crossVectors(b.clone().sub(a), dn)) };
      })),
      pouce: [1, 2, 3].map((i) => {
        const a = A[n(`thumb_0${i}`)], b = A[n(i < 3 ? `thumb_0${i + 1}` : "thumb_04_leaf")];
        return { nom: n(`thumb_0${i}`), p: a, axe: unit(new Vector3().crossVectors(b.clone().sub(a), new Vector3(-0.35, -0.85, dH.z * 0.4))) };
      }),
    };
  }
  return { e, A, R, pos, oeil, idZone, T, relief, nor: bloc("nor", Float32Array, 4), uv: bloc("uv", Float32Array, 4), ios: bloc("os", Uint8Array, 1),
           poids: bloc("poids", Uint8Array, 1), tri: bloc("tri", Uint16Array, 2), NO: Object.fromEntries(e.os.map((n, i) => [n, i])) };
}
function charger(nom) {
  const s = sources[nom] ?? fichiers(nom);
  charges[nom] ??= Promise.all([typeof s.bin === "string" ? fetch(s.bin).then((r) => r.arrayBuffer()) : s.bin, image(s.relief), image(s.zones)])
    .then(([b, r, z]) => preparer(b, r, z));
  return charges[nom];
}

// Masque des muscles choisis, aux bords adoucis, lu par le matériau
function masque(M, muscles) {
  const actif = new Uint8Array(32), T = M.T, n = T * T;
  for (const m of muscles) { const i = ZONES.indexOf(m); if (i >= 0) actif[i + 1] = 1; }
  let a = new Uint8Array(n), b = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = actif[M.idZone[i]] ? 255 : 0;
  for (let passe = 0; passe < 14; passe++) {
    for (let i = 1; i < n - 1; i++) b[i] = (a[i - 1] + 2 * a[i] + a[i + 1]) >> 2;
    for (let i = T; i < n - T; i++) a[i] = (b[i - T] + 2 * b[i] + b[i + T]) >> 2;
  }
  const t = new DataTexture(a, T, T, RedFormat);
  t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

// muscles : zones à colorer ; silhouette : « homme » ou « femme »
export function creerCorps(muscles = [], silhouette = "homme", couleur = 0xf2542d) {
  const groupe = new Group(), lueur = { value: 0.25 }, paumes = {}, jetables = [];
  let M = null, os = null, attente = null, detruit = false;

  function monter(modele) {
    if (detruit) return;
    M = modele;
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(M.pos, 3));
    geo.setAttribute("normal", new BufferAttribute(M.nor, 3));
    geo.setAttribute("uv", new BufferAttribute(M.uv, 2));
    geo.setAttribute("oeil", new BufferAttribute(M.oeil, 3));
    geo.setAttribute("skinIndex", new BufferAttribute(new Uint16Array(M.ios), 4));
    geo.setAttribute("skinWeight", new BufferAttribute(M.poids, 4, true));
    geo.setIndex(new BufferAttribute(M.tri, 1));
    const relief = new Texture(M.relief);
    relief.flipY = false; relief.anisotropy = 4; relief.needsUpdate = true;
    const zones = masque(M, muscles);
    const mat = new MeshStandardMaterial({ color: 0xd9dade, roughness: 0.56, normalMap: relief, normalScale: new Vector2(1, 1) });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uCouleur = { value: new Color(couleur) };
      sh.uniforms.uLueur = lueur;
      sh.uniforms.uMasque = { value: zones };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec3 oeil;\nvarying vec3 vOeil;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvOeil = oeil;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vOeil;\nuniform sampler2D uMasque;\nuniform vec3 uCouleur;\nuniform float uLueur;\nfloat gMasque = 0.0;\nfloat gOeil = 0.0;\nfloat gCheveu = 0.0;")
        .replace("#include <color_fragment>", `#include <color_fragment>
          gCheveu = step(2.0, dot(vOeil, vOeil));
          gOeil = step(0.25, dot(vOeil, vOeil)) * (1.0 - gCheveu);
          float creux = texture2D(normalMap, vNormalMapUv).b;
          gMasque = smoothstep(0.25, 0.75, texture2D(uMasque, vNormalMapUv).r) * (1.0 - 0.3 * smoothstep(0.1, 0.6, creux)) * (1.0 - gOeil) * (1.0 - gCheveu);
          vec3 peau = mix(diffuseColor.rgb, uCouleur, gMasque * 0.94) * (1.0 - 0.5 * creux);
          vec3 regard = normalize(vOeil + vec3(1e-5));
          vec3 globe = mix(vec3(0.9), vec3(0.3, 0.32, 0.36), smoothstep(0.895, 0.915, regard.x));
          globe = mix(globe, vec3(0.03), smoothstep(0.972, 0.982, regard.x));
          diffuseColor.rgb = mix(mix(peau, globe, gOeil), vec3(0.17, 0.15, 0.14), gCheveu);`)
        .replace("#include <normal_fragment_maps>", `if (gOeil + gCheveu < 0.5) {
            vec3 mapN = vec3((texture2D(normalMap, vNormalMapUv).xy * 2.0 - 1.0) * normalScale, 0.0);
            mapN.z = sqrt(max(0.0, 1.0 - dot(mapN.xy, mapN.xy)));
            normal = normalize(tbn * mapN);
          }`)
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += uCouleur * gMasque * uLueur;");
    };
    os = M.e.os.map(() => new Bone());
    const mesh = new SkinnedMesh(geo, mat);
    mesh.bind(new Skeleton(os, os.map(() => new Matrix4())), new Matrix4());
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    jetables.push(geo, mat, relief, zones, mesh.skeleton);
    if (attente) appliquer(...attente);
    groupe.add(mesh);
  }

  function appliquer(sq, serre) {
    const { A, R, NO, e } = M;
    const mettre = (nom, m) => os[NO[nom]].matrixWorld.copy(m);
    // Tronc : du bassin au thorax, la colonne se partage la courbure
    const qP = orient(sq.nP, sq.uP).multiply(R.qR), qC = orient(sq.nC, sq.uC).multiply(R.qR), qT = orient(sq.nT, sq.t).multiply(R.qR);
    const sP = sq.M.distanceTo(sq.B) / R.lP, sC = sq.E.distanceTo(sq.M) / R.lC;
    const tronc = (w) => delta(qP.clone().slerp(qC, w), R.Mr, sq.M, R.ur, sP + (sC - sP) * w);
    const DP = tronc(0), DC = tronc(1);
    for (let i = 0; i < os.length; i++) os[i].matrixWorld.copy(DP);
    mettre("spine_01", tronc(0.3)); mettre("spine_02", tronc(0.7)); mettre("spine_03", DC);
    const DN = delta(qC.clone().slerp(qT, 0.5), A.neck_01, A.neck_01.clone().applyMatrix4(DC));
    mettre("neck_01", DN);
    mettre("Head", delta(qT, A.Head, A.Head.clone().applyMatrix4(DN)));

    for (const c of ["d", "g"]) {
      const k = sq.cotes[c], r = R.cotes[c], n = r.n, f = serre[c] ?? 0.35;
      mettre(n("clavicle"), DC);
      // --- Bras ---
      const P = (paumes[c] = paume(sq, c, paumes[c])), gr = borne(2 * f - 1);
      // Main serrée : la barre se loge sous la base des doigts, côté paume
      const W = k.W.clone().addScaledVector(k.doigts, (0.055 - 0.088) * gr).addScaledVector(P, -(e.paume + 0.014) * gr);
      if (P.y < -0.7 && W.y < 0.13) W.y = Math.max(W.y, e.paume + 0.002);   // main à plat : la paume touche le sol
      const S = A[n("upperarm")].clone().applyMatrix4(DC);
      const vB = k.coude.clone().sub(S), vA = W.clone().sub(k.coude), uB = unit(vB), uA = unit(vA);
      const pointe = unit(orth(vB, unit(W.clone().sub(S))), orth(sq.nC.clone().negate(), uB));   // côté de la pointe du coude
      const b0 = balance(r.dB.clone().applyQuaternion(qC), uB).multiply(qC), b1 = orient(pointe, vB).multiply(r.qB);
      const sB = vB.length() / r.lB, pB = A[n("upperarm")];
      mettre(n("upperarm"), delta(b0, pB, S, r.dB, sB));
      mettre(n("upperarm") + "_m", delta(b0.clone().slerp(b1, 0.5), pB, S, r.dB, sB));
      mettre(n("upperarm") + "_f", delta(b1, pB, S, r.dB, sB));
      const qM = orient(P, k.doigts).multiply(r.qH);
      const a0 = orient(pointe, vA).multiply(r.qA), a1 = balance(r.dA.clone().applyQuaternion(qM), uA).multiply(qM);
      const sA = vA.length() / r.lA, pA = A[n("lowerarm")];
      mettre(n("lowerarm"), delta(a0, pA, k.coude, r.dA, sA));
      mettre(n("lowerarm") + "_m", delta(a0.clone().slerp(a1, 0.5), pA, k.coude, r.dA, sA));
      mettre(n("lowerarm") + "_f", delta(a1, pA, k.coude, r.dA, sA));
      const DM = delta(qM, A[n("hand")], W);
      mettre(n("hand"), DM);
      // Doigts : trois charnières qui s'enroulent ; le pouce vient en opposition
      for (const doigt of r.doigts) {
        const m = DM.clone();
        doigt.forEach((j, i) => { m.multiply(pivot(j.p, j.axe, [1.2, 1.55, 0.95][i] * f)); mettre(j.nom, m); });
        mettre(doigt[2].nom.replace("_03_", "_04_leaf_"), m);
      }
      const m = DM.clone().multiply(pivot(r.pouce[0].p, Z, -0.85 * f));
      r.pouce.forEach((j, i) => { m.multiply(pivot(j.p, j.axe, [0.15, 0.45, 0.7][i] * f)); mettre(j.nom, m); });
      mettre(n("thumb_04_leaf"), m);

      // --- Jambe ---
      const H = A[n("thigh")].clone().applyMatrix4(DP);
      // Pied calé sur l'avant-pied : c'est lui qui touche le sol (pompes, fentes)
      const fp = unit(k.O.clone().sub(k.A)), kk = unit(k.K.clone().sub(k.A)), wp = unit(orth(kk, fp), orth(Y, fp));
      let dir = fp.clone().multiplyScalar(Math.cos(DELTA_PIED)).addScaledVector(wp, -Math.sin(DELTA_PIED));
      let dos = wp.clone().multiplyScalar(Math.cos(DELTA_PIED)).addScaledVector(fp, Math.sin(DELTA_PIED));
      const O = k.O.clone();
      O.y = Math.max(A[n("ball")].y, O.y - 0.005);
      const ca = r.talonY * dir.y + r.talonX * dos.y, cb = r.talonY * dos.y - r.talonX * dir.y;
      if (O.y < 0.04 && O.y + ca < 0.014) {
        // Le talon ne traverse pas le sol : le pied bascule autour de l'avant-pied jusqu'à s'y poser
        const h = Math.hypot(ca, cb), t0 = Math.atan2(cb, ca), d = Math.acos(borne(-(O.y - A[n("ball")].y) / h, -1, 1));
        const t = Math.abs(t0 + d) < Math.abs(t0 - d) ? t0 + d : t0 - d;
        [dir, dos] = [dir.clone().multiplyScalar(Math.cos(t)).addScaledVector(dos, Math.sin(t)), dos.clone().multiplyScalar(Math.cos(t)).addScaledVector(dir, -Math.sin(t))];
      }
      const qPied = orient(dos, dir).multiply(r.qF), DF = delta(qPied, A[n("ball")], O);
      mettre(n("foot"), DF);
      const semelle = X.clone().applyQuaternion(qPied), sol = 1 - borne((O.y - 0.05) / 0.09);
      const DO = DF.clone().multiply(pivot(A[n("ball")], Z, borne(Math.asin(borne(-semelle.y, -1, 1)), 0, 1.25) * sol));
      mettre(n("ball"), DO); mettre(n("ball_leaf"), DO);
      const Ac = A[n("foot")].clone().applyMatrix4(DF);
      const vC = k.K.clone().sub(H), vT = Ac.clone().sub(k.K), uC = unit(vC);
      const genou = unit(orth(vC, unit(Ac.clone().sub(H))), orth(sq.nP, uC));   // côté de la rotule
      const c0 = balance(r.dC.clone().applyQuaternion(qP), uC).multiply(qP), c1 = orient(genou, vC).multiply(r.qC);
      const sCu = vC.length() / r.lC, pC = A[n("thigh")];
      mettre(n("thigh"), delta(c0, pC, H, r.dC, sCu));
      mettre(n("thigh") + "_m", delta(c0.clone().slerp(c1, 0.5), pC, H, r.dC, sCu));
      mettre(n("thigh") + "_f", delta(c1, pC, H, r.dC, sCu));
      mettre(n("calf"), delta(orient(genou, vT).multiply(r.qT), A[n("calf")], k.K, r.dT, vT.length() / r.lT));
    }
  }

  charger(silhouette === "femme" ? "femme" : "homme").then(monter).catch(() => {});
  return {
    mesh: groupe,
    lueur: (x) => { lueur.value = x; },
    // serre : fermeture de chaque main, de 0 (à plat) à 1 (poing serré sur une barre)
    poser(sq, serre = {}) {
      if (M) appliquer(sq, serre);
      else attente = [sq, serre];
    },
    detruire() { detruit = true; for (const j of jetables) j.dispose(); },
  };
}
