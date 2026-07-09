import { useState, useEffect } from "react";
import { Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import clsx from "clsx";
import { useAuth } from "./AuthContext";
import Dashboard from "./pages/Dashboard";
import Programme from "./pages/Programme";
import Evaluation from "./pages/Evaluation";
import Analytics from "./pages/Analytics";
import Calendrier from "./pages/Calendrier";
import Auth from "./pages/Auth";
import Onboarding from "./pages/Onboarding";

const NAV = [
  { to: "/", label: "Dashboard", icon: "⚡" },
  { to: "/programme", label: "Programme", icon: "📅" },
  { to: "/calendrier", label: "Calendrier", icon: "🗓️" },
  { to: "/evaluation", label: "Évaluation", icon: "🎯" },
  { to: "/analytics", label: "Stats", icon: "📊" },
];

function SidebarLink({ to, label, icon }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors",
          isActive
            ? "bg-brand/10 text-brand dark:bg-brand/20"
            : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
        )
      }
    >
      <span className="text-xl leading-none">{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
}

function BottomLink({ to, label, icon }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        clsx(
          "flex flex-col items-center gap-1 px-3 py-2 text-xs font-medium transition-colors",
          isActive ? "text-brand" : "text-gray-400 dark:text-gray-500"
        )
      }
    >
      <span className="text-2xl leading-none">{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
}

function RequireAuth({ children }) {
  const { token, loading } = useAuth();
  const location = useLocation();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="text-4xl animate-pulse">⚡</div>
    </div>
  );
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function RequireOnboarding({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user && !user.onboarding_complet) return <Navigate to="/onboarding" replace />;
  return children;
}

export default function App() {
  const { user, logout } = useAuth();

  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <Routes>
      {/* Routes publiques */}
      <Route path="/login" element={<Auth />} />
      <Route path="/onboarding" element={
        <RequireAuth><Onboarding /></RequireAuth>
      } />

      {/* Routes protégées avec layout */}
      <Route path="/*" element={
        <RequireAuth>
          <RequireOnboarding>
            <div className="min-h-screen flex bg-gray-50 dark:bg-gray-950">
              {/* Sidebar desktop */}
              <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-6 gap-1 fixed top-0 left-0 h-full z-10">
                <div className="px-4 mb-6">
                  <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Coach</p>
                  <h1 className="text-lg font-bold text-gray-900 dark:text-white mt-0.5">Coach Perso</h1>
                  {user && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                      {user.prenom} {user.nom}
                    </p>
                  )}
                </div>
                {NAV.map((n) => (
                  <SidebarLink key={n.to} {...n} />
                ))}
                <div className="mt-auto px-4 space-y-1">
                  <button
                    onClick={() => setDark(d => !d)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    <span className="text-lg">{dark ? "☀️" : "🌙"}</span>
                    <span>{dark ? "Mode clair" : "Mode sombre"}</span>
                  </button>
                  <button
                    onClick={logout}
                    className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <span className="text-lg">🚪</span>
                    <span>Déconnexion</span>
                  </button>
                </div>
              </aside>

              {/* Contenu principal */}
              <main className="flex-1 md:ml-56 pb-24 md:pb-0 min-h-screen">
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/programme" element={<Programme />} />
                  <Route path="/evaluation" element={<Evaluation />} />
                  <Route path="/calendrier" element={<Calendrier />} />
                  <Route path="/analytics" element={<Analytics />} />
                </Routes>
              </main>

              {/* Bottom nav mobile */}
              <nav className="md:hidden fixed bottom-0 left-0 right-0 z-10 flex justify-around bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 pb-safe">
                {NAV.map((n) => (
                  <BottomLink key={n.to} {...n} />
                ))}
                <button
                  onClick={() => setDark(d => !d)}
                  className="flex flex-col items-center gap-1 px-3 py-2 text-xs font-medium text-gray-400 dark:text-gray-500"
                >
                  <span className="text-2xl leading-none">{dark ? "☀️" : "🌙"}</span>
                  <span>{dark ? "Clair" : "Sombre"}</span>
                </button>
              </nav>
            </div>
          </RequireOnboarding>
        </RequireAuth>
      } />
    </Routes>
  );
}
