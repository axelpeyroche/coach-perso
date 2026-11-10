import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import Page from "../components/Page";
import { Section, Chevron } from "../components/ui";
import { getAlertes } from "../api";

// Centre d'alertes : tout ce qui demande une décision, au même endroit, avec ce qu'il faut faire.

export const TONS_ALERTE = {
  alerte: { label: "À traiter", texte: "text-ios-red", fond: "bg-ios-red/[0.14]", trace: "M12 8v5M12 16.5v.01" },
  attention: { label: "À surveiller", texte: "text-ios-orange", fond: "bg-ios-orange/[0.16]", trace: "M12 8v5M12 16.5v.01" },
  bon: { label: "Bon signe", texte: "text-ios-green", fond: "bg-ios-green/[0.16]", trace: "M7.5 12.5l3 3 6-7" },
};

export function PastilleTon({ ton, className = "w-9 h-9" }) {
  const t = TONS_ALERTE[ton] ?? TONS_ALERTE.attention;
  return (
    <span aria-hidden className={clsx("rounded-full flex items-center justify-center shrink-0", className, t.fond, t.texte)}>
      <svg viewBox="0 0 24 24" className="w-[61%] h-[61%]" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <path d={t.trace} />
      </svg>
    </span>
  );
}

function Alerte({ c }) {
  const t = TONS_ALERTE[c.ton] ?? TONS_ALERTE.attention;
  return (
    <article className="card p-4 flex items-start gap-3">
      <PastilleTon ton={c.ton} />
      <div className="flex-1 min-w-0">
        <p className={clsx("text-[12px] font-semibold uppercase tracking-[0.02em]", t.texte)}>{t.label}</p>
        <h3 className="text-[17px] leading-[22px] font-semibold mt-0.5">{c.titre}</h3>
        <p className="text-[15px] leading-5 text-label-2 mt-1">{c.texte}</p>
        {c.action && (
          <div className="mt-3 rounded-[12px] bg-remplissage/60 px-3.5 py-2.5">
            <p className="text-[12px] font-semibold uppercase tracking-[0.02em] text-label-2">Quoi faire</p>
            <p className="text-[15px] leading-5 mt-0.5">{c.action}</p>
          </div>
        )}
        {c.lien && (
          <Link to={c.lien} className="mt-2.5 inline-flex items-center gap-1 text-[15px] font-medium text-brand">
            Voir le détail <Chevron />
          </Link>
        )}
      </div>
    </article>
  );
}

export default function Alertes() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["alertes"], queryFn: getAlertes, staleTime: 300000 });
  const alertes = data?.alertes ?? [];
  const bons = data?.bons ?? [];
  const resume = !data ? "Centre d’alertes"
    : alertes.length ? [data.nb_alerte && `${data.nb_alerte} à traiter`, data.nb_attention && `${data.nb_attention} à surveiller`].filter(Boolean).join(" · ")
      : "Rien à signaler";

  return (
    <Page titre="Alertes" sousTitre={resume}>
      {isLoading && (
        <div className="grid gap-3 lg:grid-cols-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="card h-[150px] animate-pulse" />)}
        </div>
      )}
      {isError && <p className="card p-6 text-center text-[15px] text-label-2">Alertes indisponibles pour le moment. Réessaie dans un instant.</p>}

      {data && !alertes.length && (
        <div className="card p-8 text-center">
          <PastilleTon ton="bon" className="w-14 h-14 mx-auto" />
          <p className="mt-3 text-[20px] font-bold">Tout est au vert</p>
          <p className="mt-1 text-[15px] leading-5 text-label-2 max-w-[420px] mx-auto">
            Charge, récupération, sommeil et plan : rien ne demande de décision aujourd’hui. Continue comme prévu.
          </p>
        </div>
      )}

      {alertes.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2 items-start">
          {alertes.map((c) => <Alerte key={c.id} c={c} />)}
        </div>
      )}

      {bons.length > 0 && (
        <Section titre="Ce qui va bien">
          <div className="card py-0.5">
            {bons.map((c) => {
              const contenu = (
                <>
                  <PastilleTon ton="bon" className="w-8 h-8" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[16px] font-semibold leading-5">{c.titre}</span>
                    <span className="block text-[14px] leading-[19px] text-label-2 mt-0.5">{c.texte}</span>
                  </span>
                  {c.lien && <Chevron />}
                </>
              );
              return c.lien
                ? <Link key={c.id} to={c.lien} className="ligne flex items-center gap-3 px-4 py-3" style={{ "--inset": "3.75rem" }}>{contenu}</Link>
                : <div key={c.id} className="ligne flex items-center gap-3 px-4 py-3" style={{ "--inset": "3.75rem" }}>{contenu}</div>;
            })}
          </div>
        </Section>
      )}

      {data && (
        <p className="px-1 text-[13px] leading-[18px] text-label-2">
          Les alertes reprennent les constats des analyses (charge, récupération, sommeil, capacités) et ceux du plan.
          Elles se mettent à jour à chaque synchro.
        </p>
      )}
    </Page>
  );
}
