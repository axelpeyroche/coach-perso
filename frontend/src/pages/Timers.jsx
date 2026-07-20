import { useState, useEffect, useRef, useCallback } from "react";
import clsx from "clsx";

// ─── Helpers ────────────────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, "0"); }

function fmtMS(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${pad(m)}:${pad(s)}`;
}

function fmtMSms(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const cs = Math.floor((ms % 1000) / 10);
  return { m: pad(m), s: pad(s), cs: pad(cs) };
}

// ─── Cercle SVG responsive ───────────────────────────────────────────────────
// La taille est pilotée par la prop `size` (px) calculée par le parent.

function TimerCircle({ progress = 1, color = "#f97316", children, pulse = false, size = 220 }) {
  const R = 110;
  const C = 2 * Math.PI * R;
  return (
    <div className="relative flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}>
      <svg viewBox="0 0 260 260" className="absolute inset-0 w-full h-full">
        <circle cx="130" cy="130" r={R} fill="none" stroke="#e5e7eb" strokeWidth="10"
          className="dark:stroke-gray-700" />
        <circle cx="130" cy="130" r={R} fill="none" stroke={color} strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - Math.max(0, progress))}
          transform="rotate(-90 130 130)"
          className={clsx(pulse && "animate-pulse")}
        />
      </svg>
      <div className="relative z-10 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
}

// ─── Hook pour mesurer la hauteur disponible ─────────────────────────────────

function useTimerSize() {
  const [size, setSize] = useState(200);
  useEffect(() => {
    function calc() {
      // Hauteur dispo = dvh - header(56) - bottom nav(64) - tabs mode(~52) - padding(24)
      const avail = window.innerHeight - 56 - 64 - 52 - 24;
      setSize(Math.min(220, Math.max(130, avail * 0.45)));
    }
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);
  return size;
}

// ─── Spinner numérique ───────────────────────────────────────────────────────

function Spinner({ label, value, onChange, min = 0, max = 99, step = 1, unit = "" }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  function inc() { onChange(Math.min(max, value + step)); }
  function dec() { onChange(Math.max(min, value - step)); }

  function startEdit() {
    setDraft(String(value));
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitEdit() {
    const n = parseInt(draft, 10);
    if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
    setEditing(false);
  }

  return (
    <div className="flex flex-col items-center gap-0.5">
      {label && <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{label}</p>}
      <button onClick={inc}
        className="w-7 h-6 flex items-center justify-center text-gray-400 hover:text-accent transition-colors rounded-lg hover:bg-accent/10">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3"><path d="M18 15l-6-6-6 6"/></svg>
      </button>
      <div className="w-14 h-11 bg-gray-100 dark:bg-gray-800 rounded-xl flex flex-col items-center justify-center cursor-pointer select-none"
        onClick={startEdit}>
        {editing ? (
          <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
            onBlur={commitEdit} onKeyDown={e => e.key === "Enter" && commitEdit()}
            className="w-12 text-center text-xl font-bold bg-transparent text-accent outline-none" autoFocus />
        ) : (
          <span className="text-xl font-bold text-gray-900 dark:text-white">{value}</span>
        )}
        <span className="text-[9px] text-gray-400 mt-0.5">{unit}</span>
      </div>
      <button onClick={dec}
        className="w-7 h-6 flex items-center justify-center text-gray-400 hover:text-accent transition-colors rounded-lg hover:bg-accent/10">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3"><path d="M6 9l6 6 6-6"/></svg>
      </button>
    </div>
  );
}

// ─── Boutons de contrôle ─────────────────────────────────────────────────────

function BtnPlay({ running, onClick }) {
  return (
    <button onClick={onClick}
      className="w-14 h-14 rounded-full bg-accent text-white flex items-center justify-center shadow-lg hover:bg-orange-500 active:scale-95 transition-transform shrink-0">
      {running
        ? <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        : <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M8 5v14l11-7z"/></svg>
      }
    </button>
  );
}

function BtnReset({ onClick }) {
  return (
    <button onClick={onClick}
      className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 active:scale-95 transition-transform shrink-0">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
        <path d="M3 3v5h5"/>
      </svg>
    </button>
  );
}

// ─── CHRONOMÈTRE ─────────────────────────────────────────────────────────────

function Chronometre({ circleSize }) {
  const [running, setRunning] = useState(false);
  const [ms, setMs]           = useState(0);
  const [laps, setLaps]       = useState([]);
  const startRef  = useRef(null);
  const savedRef  = useRef(0);
  const rafRef    = useRef(null);

  const tick = useCallback(() => {
    setMs(savedRef.current + (Date.now() - startRef.current));
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  function toggle() {
    if (running) {
      cancelAnimationFrame(rafRef.current);
      savedRef.current += Date.now() - startRef.current;
      setRunning(false);
    } else {
      startRef.current = Date.now();
      rafRef.current = requestAnimationFrame(tick);
      setRunning(true);
    }
  }

  function reset() {
    cancelAnimationFrame(rafRef.current);
    setRunning(false);
    setMs(0);
    setLaps([]);
    savedRef.current = 0;
  }

  function lap() {
    if (!running) return;
    setLaps(l => [...l, ms]);
  }

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const { m, s, cs } = fmtMSms(ms);
  const status = running ? "EN COURS" : ms === 0 ? "PRÊT" : "PAUSE";
  const fontSize = circleSize < 170 ? "text-3xl" : "text-4xl";

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <TimerCircle progress={1} pulse={running} size={circleSize}>
        <div className="flex items-baseline gap-0.5">
          <span className={clsx(fontSize, "font-black text-gray-900 dark:text-white tabular-nums")}>{m}:{s}</span>
          <span className="text-base font-bold text-gray-400 tabular-nums">.{cs}</span>
        </div>
        <p className="text-[10px] font-bold tracking-widest text-gray-400 dark:text-gray-500 mt-0.5">{status}</p>
      </TimerCircle>

      <div className="flex items-center gap-5">
        <BtnReset onClick={reset} />
        <BtnPlay running={running} onClick={toggle} />
        <button onClick={lap} disabled={!running}
          className="text-sm font-semibold text-accent disabled:text-gray-300 dark:disabled:text-gray-600 w-10 text-center transition-colors">
          Tour
        </button>
      </div>

      {laps.length > 0 && (
        <div className="w-full max-w-xs space-y-1 overflow-y-auto" style={{ maxHeight: "18vh" }}>
          {[...laps].reverse().map((t, i) => {
            const idx = laps.length - i;
            const prev = idx > 1 ? laps[idx - 2] : 0;
            const { m: lm, s: ls, cs: lcs } = fmtMSms(t - prev);
            return (
              <div key={i} className="flex justify-between items-center px-3 py-1 rounded-xl bg-gray-100 dark:bg-gray-800 text-xs">
                <span className="text-gray-500 dark:text-gray-400 font-medium">Tour {idx}</span>
                <span className="font-mono font-bold text-gray-900 dark:text-white">{lm}:{ls}<span className="text-gray-400 text-[10px]">.{lcs}</span></span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Audio beeps ─────────────────────────────────────────────────────────────

function playBeep(freq = 880, duration = 0.12, vol = 0.4) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
    osc.onended = () => ctx.close();
  } catch (_) {}
}

// ─── MINUTEUR ────────────────────────────────────────────────────────────────

function Minuteur({ circleSize }) {
  const [mins, setMins]       = useState(5);
  const [secs, setSecs]       = useState(0);
  const [running, setRunning] = useState(false);
  // remaining en ms (float) pour le rendu fluide
  const [remaining, setRemaining] = useState(null);

  const endTimeRef  = useRef(null);   // timestamp cible (ms)
  const savedMsRef  = useRef(null);   // ms restantes au moment de la pause
  const rafRef      = useRef(null);
  const beeped      = useRef(new Set());

  const totalMs  = (mins * 60 + secs) * 1000;
  const currentMs = remaining ?? totalMs;
  const currentSec = Math.ceil(currentMs / 1000);
  const progress = totalMs === 0 ? 1 : Math.max(0, currentMs / totalMs);
  const finished = !running && remaining !== null && remaining <= 0;
  const status = finished ? "TERMINÉ !" : running ? "EN COURS" : remaining !== null ? "PAUSE" : "PRÊT";
  const fontSize = circleSize < 170 ? "text-3xl" : "text-4xl";

  const tick = useCallback(() => {
    const left = endTimeRef.current - Date.now();
    if (left <= 0) {
      setRemaining(0);
      setRunning(false);
      if (!beeped.current.has(0)) { playBeep(660, 0.4, 0.5); beeped.current.add(0); }
      return;
    }
    setRemaining(left);
    const leftSec = Math.ceil(left / 1000);
    if (leftSec <= 3 && !beeped.current.has(leftSec)) {
      playBeep(880, 0.1);
      beeped.current.add(leftSec);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  function toggle() {
    if (finished) return;
    if (running) {
      cancelAnimationFrame(rafRef.current);
      savedMsRef.current = endTimeRef.current - Date.now();
      setRunning(false);
    } else {
      if (totalMs === 0) return;
      const startMs = savedMsRef.current ?? totalMs;
      endTimeRef.current = Date.now() + startMs;
      beeped.current = new Set();
      setRunning(true);
      rafRef.current = requestAnimationFrame(tick);
    }
  }

  function reset() {
    cancelAnimationFrame(rafRef.current);
    endTimeRef.current = null;
    savedMsRef.current = null;
    beeped.current = new Set();
    setRunning(false);
    setRemaining(null);
  }

  // Annule le rAF uniquement au démontage
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // Correction horloge murale quand l'onglet revient au premier plan
  useEffect(() => {
    function onVisible() {
      if (!running || !endTimeRef.current) return;
      const left = endTimeRef.current - Date.now();
      if (left <= 0) {
        setRemaining(0);
        setRunning(false);
      } else {
        setRemaining(left);
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [running]);

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <TimerCircle progress={progress} size={circleSize} pulse={running}>
        <span className={clsx(fontSize, "font-black tabular-nums", finished ? "text-accent" : "text-gray-900 dark:text-white")}>
          {fmtMS(currentSec)}
        </span>
        <p className="text-[10px] font-bold tracking-widest text-gray-400 dark:text-gray-500 mt-0.5">{status}</p>
      </TimerCircle>

      {!running && !finished && (
        <div className="flex items-start gap-3">
          <Spinner label="MIN" value={mins} onChange={v => { setMins(v); reset(); }} max={99} unit="min" />
          <div className="flex items-center h-11 mt-6 text-xl font-bold text-gray-300 dark:text-gray-600">:</div>
          <Spinner label="SEC" value={secs} onChange={v => { setSecs(v); reset(); }} max={59} step={5} unit="sec" />
        </div>
      )}

      <div className="flex items-center gap-5">
        <BtnReset onClick={reset} />
        <BtnPlay running={running} onClick={toggle} />
      </div>
    </div>
  );
}

// ─── TABATA ───────────────────────────────────────────────────────────────────

const PHASE = { PREP: "PRÉPA", WORK: "TRAVAIL", REST: "REPOS", DONE: "TERMINÉ" };
const PHASE_COLORS = {
  [PHASE.PREP]: "text-yellow-500",
  [PHASE.WORK]: "text-accent",
  [PHASE.REST]: "text-blue-500",
  [PHASE.DONE]: "text-green-500",
};
const PHASE_STROKE = {
  [PHASE.PREP]: "#eab308",
  [PHASE.WORK]: "#f97316",
  [PHASE.REST]: "#3b82f6",
  [PHASE.DONE]: "#22c55e",
};

function Tabata({ circleSize }) {
  const [prep,  setPrep]  = useState(5);
  const [work,  setWork]  = useState(60);
  const [rest,  setRest]  = useState(0);
  const [tours, setTours] = useState(9);

  const [running, setRunning] = useState(false);
  const [phase,   setPhase]   = useState(null);
  // left en ms pour affichage fluide
  const [leftMs,  setLeftMs]  = useState(0);
  const [tour,    setTour]    = useState(0);

  const stateRef   = useRef({});   // { phase, endTime, tour, phaseDurMs }
  const rafRef     = useRef(null);
  const beeped     = useRef(new Set());

  const totalWork = work * tours;
  const totalRest = rest * Math.max(0, tours - 1);
  const totalSec  = prep + totalWork + totalRest;

  function fmtT(s) { return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; }

  const leftSec = Math.ceil(leftMs / 1000);
  const phaseDurMs = stateRef.current.phaseDurMs || 1;
  const progress = phase === PHASE.DONE ? 1
    : phase === null ? 1
    : Math.max(0, leftMs / phaseDurMs);

  const fontSize = circleSize < 170 ? "text-3xl" : "text-4xl";

  function _nextPhase(ph, t) {
    if (ph === PHASE.PREP) return { phase: PHASE.WORK, durSec: work, tour: t };
    if (ph === PHASE.WORK) {
      if (t >= tours) return { phase: PHASE.DONE, durSec: 0, tour: t };
      if (rest > 0)   return { phase: PHASE.REST, durSec: rest, tour: t };
      return { phase: PHASE.WORK, durSec: work, tour: t + 1 };
    }
    if (ph === PHASE.REST) return { phase: PHASE.WORK, durSec: work, tour: t + 1 };
    return { phase: PHASE.DONE, durSec: 0, tour: t };
  }

  const tick = useCallback(() => {
    const left = stateRef.current.endTime - Date.now();
    if (left <= 0) {
      const { phase: ph, tour: t } = stateRef.current;
      const next = _nextPhase(ph, t);
      if (next.phase === PHASE.DONE) {
        playBeep(660, 0.5, 0.5);
        stateRef.current = { ...stateRef.current, phase: PHASE.DONE, endTime: Date.now(), phaseDurMs: 1 };
        setPhase(PHASE.DONE);
        setLeftMs(0);
        setTour(t);
        setRunning(false);
        return;
      }
      playBeep(660, 0.15, 0.4);
      beeped.current = new Set();
      const durMs = next.durSec * 1000;
      stateRef.current = { phase: next.phase, endTime: Date.now() + durMs, tour: next.tour, phaseDurMs: durMs };
      setPhase(next.phase);
      setTour(next.tour);
      setLeftMs(durMs);
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    setLeftMs(left);
    const ls = Math.ceil(left / 1000);
    if (ls <= 3 && !beeped.current.has(ls)) {
      playBeep(880, 0.1);
      beeped.current.add(ls);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [work, rest, tours]);

  function start() {
    if (running) return;
    let initialPhase, durSec, initialTour;
    if (phase === null) {
      initialPhase = PHASE.PREP; durSec = prep; initialTour = 1;
    } else {
      initialPhase = stateRef.current.phase;
      durSec = Math.ceil((stateRef.current.endTime - Date.now()) / 1000);
      initialTour = stateRef.current.tour;
    }
    beeped.current = new Set();
    const durMs = durSec * 1000;
    stateRef.current = { phase: initialPhase, endTime: Date.now() + durMs, tour: initialTour, phaseDurMs: durMs };
    setPhase(initialPhase);
    setTour(initialTour);
    setRunning(true);
    rafRef.current = requestAnimationFrame(tick);
  }

  function pause() {
    cancelAnimationFrame(rafRef.current);
    // Fige endTime à la valeur courante (lefMs restantes depuis maintenant)
    stateRef.current.endTime = Date.now() + leftMs;
    stateRef.current.phaseDurMs = phaseDurMs; // conserve pour la progression
    setRunning(false);
  }

  function reset() {
    cancelAnimationFrame(rafRef.current);
    stateRef.current = {};
    beeped.current = new Set();
    setRunning(false);
    setPhase(null);
    setLeftMs(0);
    setTour(0);
  }

  // Annule le rAF uniquement au démontage
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  useEffect(() => {
    function onVisible() {
      if (!running || !stateRef.current.endTime) return;
      const left = stateRef.current.endTime - Date.now();
      if (left <= 0) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setLeftMs(left);
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [running, tick]);

  if (phase !== null) {
    const isDone = phase === PHASE.DONE;
    return (
      <div className="flex flex-col items-center gap-3 w-full">
        <p className="text-xs font-bold uppercase tracking-widest text-gray-400 h-4">
          {isDone ? "" : `Tour ${tour} / ${tours}`}
        </p>
        <TimerCircle progress={progress} color={PHASE_STROKE[phase]} pulse={running} size={circleSize}>
          <p className={clsx("text-xs font-bold tracking-widest uppercase", PHASE_COLORS[phase])}>{phase}</p>
          <span className={clsx(fontSize, "font-black text-gray-900 dark:text-white tabular-nums mt-0.5")}>
            {isDone ? "🏁" : fmtT(leftSec)}
          </span>
        </TimerCircle>
        <div className="flex items-center gap-5">
          <BtnReset onClick={reset} />
          {!isDone && <BtnPlay running={running} onClick={running ? pause : start} />}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Configuration</p>
      {/* 2×2 sur mobile, 4 colonnes sur desktop */}
      <div className="grid grid-cols-4 gap-2 w-full max-w-xs">
        <Spinner label="Prépa"   value={prep}  onChange={setPrep}  max={60}  unit="s" />
        <Spinner label="Travail" value={work}  onChange={setWork}  max={300} step={5} unit="s" />
        <Spinner label="Repos"   value={rest}  onChange={setRest}  max={120} step={5} unit="s" />
        <Spinner label="Tours"   value={tours} onChange={setTours} min={1}   max={30} unit="×" />
      </div>

      <div className="w-full max-w-xs rounded-xl bg-gray-100 dark:bg-gray-800 px-3 py-2.5 space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">Durée estimée</span>
          <span className="font-bold text-gray-900 dark:text-white">{fmtT(totalSec)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">Temps de travail</span>
          <span className="font-bold text-accent">{fmtT(totalWork)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">Temps de repos</span>
          <span className="font-bold text-blue-500">{fmtT(totalRest)}</span>
        </div>
      </div>

      <BtnPlay running={false} onClick={start} />
    </div>
  );
}

// ─── Icônes modes ─────────────────────────────────────────────────────────────

const MODES = [
  {
    id: "chrono",
    label: "Chrono",
    Icon: () => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 15" />
      </svg>
    ),
  },
  {
    id: "minuteur",
    label: "Minuteur",
    Icon: () => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M5 3l4 2M19 3l-4 2" />
      </svg>
    ),
  },
  {
    id: "tabata",
    label: "Tabata",
    Icon: () => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
];

// ─── Page principale ──────────────────────────────────────────────────────────

export default function Timers() {
  const [mode, setMode] = useState("chrono");
  const circleSize = useTimerSize();

  // Verrouille tout scroll de la page (body + html) pendant que Timers est affiché.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOY = html.style.overflowY;
    const prevBodyOY = body.style.overflowY;
    html.style.overflowY = "hidden";
    body.style.overflowY = "hidden";
    return () => {
      html.style.overflowY = prevHtmlOY;
      body.style.overflowY = prevBodyOY;
    };
  }, []);

  // Sur mobile (<768px), on applique position:fixed pour ancrer le contenu
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <div
      className="flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950"
      style={isMobile ? {
        position: "fixed",
        left: 0,
        right: 0,
        top: "56px",
        bottom: "calc(64px + env(safe-area-inset-bottom, 0px))",
      } : {
        height: "100%",
      }}
    >

      {/* ── Barre de modes — pleine largeur, 3 onglets égaux ── */}
      <div className="flex-none flex w-full bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        {MODES.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setMode(id)}
            className={clsx(
              "flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-semibold transition-colors",
              mode === id
                ? "text-accent border-b-2 border-accent bg-accent/5"
                : "text-gray-500 dark:text-gray-400"
            )}>
            <Icon />
            {label}
          </button>
        ))}
      </div>

      {/* ── Contenu timer — centré dans l'espace restant ── */}
      <div className="flex-1 min-h-0 flex items-center justify-center px-4 py-3 overflow-hidden">
        <div className="w-full max-w-sm flex flex-col items-center">
          {mode === "chrono"   && <Chronometre  circleSize={circleSize} />}
          {mode === "minuteur" && <Minuteur      circleSize={circleSize} />}
          {mode === "tabata"   && <Tabata        circleSize={circleSize} />}
        </div>
      </div>

    </div>
  );
}
