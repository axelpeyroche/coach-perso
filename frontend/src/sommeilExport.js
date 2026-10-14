// Lecture de l'export Apple Santé (export.zip ou export.xml) dans le navigateur.
// Le fichier fait souvent plusieurs centaines de Mo : il est lu en flux, morceau par morceau,
// et seules les tranches d'analyse du sommeil sont gardées (le reste ne quitte pas le téléphone).
import { Unzip, UnzipInflate } from "fflate";

const MARQUEUR = "HKCategoryTypeIdentifierSleepAnalysis";
const RE_RECORD = /<Record\b[^>]*HKCategoryTypeIdentifierSleepAnalysis[^>]*>/g;
const val = (balise, nom) => balise.match(new RegExp(`\\s${nom}="([^"]*)"`))?.[1];
// « 2026-10-13 23:40:12 +0200 » → « 2026-10-13T23:40:12+02:00 »
const iso = (d) => {
  const m = d?.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ?([+-]\d{2})(\d{2})$/);
  return m ? `${m[1]}T${m[2]}${m[3]}:${m[4]}` : null;
};

function lecteurLignes(depuis, tranches) {
  const decodeur = new TextDecoder();
  let reste = "";
  const traiter = (texte) => {
    if (!texte.includes(MARQUEUR)) return;
    for (const [balise] of texte.matchAll(RE_RECORD)) {
      const debut = val(balise, "startDate"), fin = val(balise, "endDate"), valeur = val(balise, "value");
      if (!valeur || !debut || debut.slice(0, 10) < depuis) continue;
      const d = iso(debut), f = iso(fin);
      if (d && f) tranches.push([valeur, d, f]);
    }
  };
  return (octets, fini) => {
    const texte = reste + decodeur.decode(octets, { stream: !fini });
    const coupe = fini ? texte.length : texte.lastIndexOf("\n") + 1;
    traiter(texte.slice(0, coupe));
    reste = texte.slice(coupe);
  };
}

/** Renvoie les tranches [libellé, début, fin] des `jours` derniers jours. `progres(0..1)` suit la lecture. */
export async function lireSommeilExport(fichier, { jours = 400, progres } = {}) {
  const depuis = new Date(Date.now() - jours * 864e5).toISOString().slice(0, 10);
  const tranches = [];
  const lire = lecteurLignes(depuis, tranches);
  const estZip = /\.zip$/i.test(fichier.name) || fichier.type.includes("zip");
  let trouve = !estZip, erreur = null, termine = !estZip;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (f) => {
    // export.xml seulement (pas export_cda.xml ni les tracés GPX)
    if (!/(^|\/)export\.xml$/i.test(f.name)) return;
    trouve = true;
    f.ondata = (err, octets, fini) => {
      if (err) { erreur = err; return; }
      lire(octets, fini);
      if (fini) termine = true;
    };
    f.start();
  };

  const lecteur = fichier.stream().getReader();
  let lus = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    lus += value.length;
    if (estZip) unzip.push(value); else lire(value, false);
    if (erreur) throw new Error("Archive illisible : ouvre le zip dans l'app Fichiers et choisis directement export.xml.");
    progres?.(lus / fichier.size);
  }
  if (estZip) unzip.push(new Uint8Array(0), true); else lire(new Uint8Array(0), true);
  if (!trouve) throw new Error("Pas de fichier export.xml dans ce zip : choisis l'export de l'app Santé (export.zip).");
  if (erreur || !termine) throw new Error("Archive incomplète ou illisible : ouvre le zip dans l'app Fichiers et choisis directement export.xml.");
  return tranches;
}
