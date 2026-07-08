import clsx from "clsx";

const COULEURS = {
  green: "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400",
  blue: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400",
  orange: "bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400",
  red: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400",
  purple: "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400",
};

export default function StatTile({ label, value, sub, color = "blue" }) {
  return (
    <div className={clsx("rounded-2xl p-4 flex flex-col gap-1", COULEURS[color])}>
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="text-xl font-bold leading-tight">{value}</p>
      {sub && <p className="text-xs opacity-60">{sub}</p>}
    </div>
  );
}
