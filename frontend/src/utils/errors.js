// Extrait un message d'erreur affichable à l'utilisateur à partir d'une erreur
// axios (ou autre), sans jamais exposer le détail brut d'une exception serveur.
export function getErrorMessage(error, fallback = "Une erreur est survenue — réessaie.") {
  if (error?.response) {
    const detail = error.response.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail) && detail.length) {
      const msgs = detail
        .filter((d) => d?.msg)
        .map((d) => {
          const champ = Array.isArray(d.loc) ? d.loc.at(-1) : null;
          return champ ? `${champ}: ${d.msg}` : d.msg;
        });
      if (msgs.length) return msgs.join(" · ");
    }
    if (error.response.status === 422) return "Données invalides — vérifie les champs.";
    return fallback;
  }
  if (error?.request) return "Impossible de contacter le serveur — vérifie ta connexion.";
  return error?.message || fallback;
}
