import clsx from "clsx";

const COULEURS = {
  green:  "bg-green-400/20  dark:bg-green-500/12  text-green-800  dark:text-green-300  border border-green-300/50  dark:border-green-400/15",
  blue:   "bg-blue-400/20   dark:bg-blue-500/12   text-blue-800   dark:text-blue-300   border border-blue-300/50   dark:border-blue-400/15",
  orange: "bg-orange-400/20 dark:bg-orange-500/12 text-orange-800 dark:text-orange-300 border border-orange-300/50 dark:border-orange-400/15",
  red:    "bg-red-400/20    dark:bg-red-500/12    text-red-800    dark:text-red-300    border border-red-300/50    dark:border-red-400/15",
  purple: "bg-purple-400/20 dark:bg-purple-500/12 text-purple-800 dark:text-purple-300 border border-purple-300/50 dark:border-purple-400/15",
};

export default function StatTile({ label, value, sub, color = "blue" }) {
  return (
    <div className={clsx("rounded-2xl p-4 flex flex-col gap-1 backdrop-blur-xl", COULEURS[color])}>
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="text-xl font-bold leading-tight">{value}</p>
      {sub && <p className="text-xs opacity-60">{sub}</p>}
    </div>
  );
}
