import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import Card from "../components/Card";
import { getChatHistory, envoyerMessageChat, supprimerChatHistory } from "../api";
import { getErrorMessage } from "../utils/errors";

function Bulle({ role, contenu }) {
  const isUser = role === "user";
  return (
    <div className={clsx("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={clsx(
          "max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words",
          isUser
            ? "bg-gradient-to-br from-violet-600 to-indigo-500 text-white"
            : "glass-sm text-gray-800 dark:text-gray-100"
        )}
      >
        {contenu}
      </div>
    </div>
  );
}

export default function Chat() {
  const qc = useQueryClient();
  const [texte, setTexte] = useState("");
  const [enAttente, setEnAttente] = useState(false);
  const [erreur, setErreur] = useState(null);
  const finRef = useRef(null);

  const { data, isLoading } = useQuery({
    queryKey: ["chat-history"],
    queryFn: getChatHistory,
  });

  const messages = data?.messages || [];

  const envoyer = useMutation({
    mutationFn: envoyerMessageChat,
    onMutate: () => { setErreur(null); setEnAttente(true); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat-history"] });
      qc.invalidateQueries({ queryKey: ["semaine-courante"] });
      qc.invalidateQueries({ queryKey: ["objectif-course"] });
    },
    onError: (e) => setErreur(getErrorMessage(e, "Le coach n'a pas pu répondre — réessaie.")),
    onSettled: () => setEnAttente(false),
  });

  const effacer = useMutation({
    mutationFn: supprimerChatHistory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-history"] }),
  });

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, enAttente]);

  function onSubmit(e) {
    e.preventDefault();
    const message = texte.trim();
    if (!message || envoyer.isPending) return;
    // Affichage optimiste immédiat de la bulle utilisateur
    qc.setQueryData(["chat-history"], (old) => ({
      messages: [...(old?.messages || []), { id: `tmp-${Date.now()}`, role: "user", contenu: message }],
    }));
    setTexte("");
    envoyer.mutate(message);
  }

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-0 py-6 md:py-8 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Coach IA</h1>
        {messages.length > 0 && (
          <button
            onClick={() => { if (confirm("Effacer tout l'historique de conversation ?")) effacer.mutate(); }}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            Effacer l'historique
          </button>
        )}
      </div>

      <Card>
        <div className="flex flex-col gap-3 min-h-[50vh] max-h-[65vh] overflow-y-auto pr-1">
          {isLoading && <p className="text-sm text-gray-400 text-center py-8">Chargement…</p>}

          {!isLoading && messages.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">
              Dis-moi comment s'est passée ta séance, ou demande-moi de planifier ta semaine.
            </p>
          )}

          {messages.map((m) => (
            <Bulle key={m.id} role={m.role} contenu={m.contenu} />
          ))}

          {enAttente && (
            <div className="flex justify-start">
              <div className="glass-sm rounded-2xl px-4 py-2.5 text-sm text-gray-400 dark:text-gray-500">
                <span className="animate-pulse">Le coach réfléchit…</span>
              </div>
            </div>
          )}

          {erreur && <p className="text-xs text-red-500 text-center">{erreur}</p>}

          <div ref={finRef} />
        </div>
      </Card>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          type="text"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          placeholder="Écris à ton coach…"
          className="flex-1 rounded-xl px-4 py-2.5 text-sm glass-sm border border-white/40 dark:border-white/10 bg-transparent focus:outline-none focus:ring-2 focus:ring-violet-400"
          disabled={envoyer.isPending}
        />
        <button
          type="submit"
          disabled={envoyer.isPending || !texte.trim()}
          className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-br from-violet-600 to-indigo-500 disabled:opacity-40 transition-opacity"
        >
          Envoyer
        </button>
      </form>
    </div>
  );
}
