import clsx from "clsx";

// Carte façon app Santé : titre discret, contenu sur fond plein
export default function Card({ title, action, children, className, pad = true }) {
  return (
    <section className={clsx("card overflow-hidden min-w-0", pad && "p-4 md:p-5", className)}>
      {(title || action) && (
        <div className={clsx("flex items-center justify-between gap-2 mb-3", !pad && "px-4 pt-4")}>
          {title && <h3 className="text-[17px] font-semibold tracking-[-0.02em] text-label">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
