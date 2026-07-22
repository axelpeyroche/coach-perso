export default function Card({ title, action, children }) {
  return (
    <div className="glass rounded-2xl p-4 md:p-5 overflow-hidden min-w-0">
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 mb-4">
          {title && <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
