export default function Card({ title, children }) {
  return (
    <div className="glass rounded-2xl p-4 md:p-5 overflow-hidden min-w-0">
      {title && (
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4">{title}</h3>
      )}
      {children}
    </div>
  );
}
