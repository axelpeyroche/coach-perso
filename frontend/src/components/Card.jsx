export default function Card({ title, children }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 md:p-5 shadow-sm overflow-hidden min-w-0">
      {title && (
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4">{title}</h3>
      )}
      {children}
    </div>
  );
}
