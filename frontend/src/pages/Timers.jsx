import { useState, useEffect, useRef, useCallback } from "react";
import clsx from "clsx";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Audio ───────────────────────────────────────────────────────────────────
// iOS Safari exige que l'AudioContext soit créé ET repris pendant un geste
// utilisateur. On garde un contexte singleton qu'on resume() à chaque press.

let _audioCtx = null;

function getAudioCtx() {
  if (!_audioCtx) {
    try {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {}
  }
  return _audioCtx;
}

// Appeler sur chaque pression de bouton (start/stop/reset)
function unlockAudio() {
  const ctx = getAudioCtx();
  if (ctx && ctx.state === "suspended") ctx.resume();
}

function playBeep(freq = 880, duration = 0.12, vol = 0.4) {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const play = () => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    };
    if (ctx.state === "suspended") {
      ctx.resume().then(play);
    } else {
      play();
    }
  } catch (_) {}
}

// ─── Persistent global timer state (survives React unmounts) ─────────────────

const PHASE = { PREP: "PRÉPA", WORK: "TRAVAIL", REST: "REPOS", DONE: "TERMINÉ" };

const _min = { mins: 5, secs: 0, running: false, endTime: null, savedMs: null, beeped: new Set() };
const _chr = { running: false, startTime: null, savedMs: 0, laps: [] };
const _tab = {
  prep: 5, work: 60, rest: 0, tours: 9,
  running: false, phase: null, endTime: null, tour: 0, phaseDurMs: 1,
  beeped: new Set(),
};

function _tabNextPhase(ph, t) {
  if (ph === PHASE.PREP) return { phase: PHASE.WORK, durSec: _tab.work, tour: t };
  if (ph === PHASE.WORK) {
    if (t >= _tab.tours) return { phase: PHASE.DONE, durSec: 0, tour: t };
    if (_tab.rest > 0)   return { phase: PHASE.REST, durSec: _tab.rest, tour: t };
    return { phase: PHASE.WORK, durSec: _tab.work, tour: t + 1 };
  }
  if (ph === PHASE.REST) return { phase: PHASE.WORK, durSec: _tab.work, tour: t + 1 };
  return { phase: PHASE.DONE, durSec: 0, tour: t };
}

// ─── Global audio interval (runs even when Timers page is unmounted) ──────────

let _audioInterval = null;

function ensureAudioTick() {
  if (_audioInterval) return;
  _audioInterval = setInterval(() => {
    let anyRunning = false;

    // Minuteur audio
    if (_min.running) {
      anyRunning = true;
      const left = _min.endTime - Date.now();
      const leftSec = Math.ceil(left / 1000);
      if (leftSec <= 3 && leftSec > 0 && !_min.beeped.has(leftSec)) {
        playBeep(880, 0.1);
        _min.beeped.add(leftSec);
      }
      if (left <= 0 && !_min.beeped.has(0)) {
        playBeep(660, 0.4, 0.5);
        _min.beeped.add(0);
        _min.running = false;
      }
    }

    // Tabata audio + phase transitions
    if (_tab.running) {
      anyRunning = true;
      const left = _tab.endTime - Date.now();
      const leftSec = Math.ceil(left / 1000);
      if (leftSec <= 3 && leftSec > 0 && !_tab.beeped.has(leftSec)) {
        playBeep(880, 0.1);
        _tab.beeped.add(leftSec);
      }
      if (left <= 0) {
        const next = _tabNextPhase(_tab.phase, _tab.tour);
        if (next.phase === PHASE.DONE) {
          playBeep(660, 0.5, 0.5);
          _tab.running = false;
          _tab.phase = PHASE.DONE;
        } else {
          playBeep(660, 0.15, 0.4);
          const durMs = next.durSec * 1000;
          _tab.phase = next.phase;
          _tab.tour = next.tour;
          _tab.endTime = Date.now() + durMs;
          _tab.phaseDurMs = durMs;
          _tab.beeped = new Set();
        }
      }
    }

    if (!anyRunning) {
      clearInterval(_audioInterval);
      _audioInterval = null;
    }
  }, 100);
}

// ─── Cercle SVG responsive ────────────────────────────────────────────────────

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

// ─── Hook pour mesurer la hauteur disponible ──────────────────────────────────

function useTimerSize() {
  const [size, setSize] = useState(200);
  useEffect(() => {
    function calc() {
      const isDesktop = window.innerWidth >= 768;
      if (isDesktop) {
        // Sur PC : cercle plus grand, limité par la hauteur disponible
        const avail = Math.min(window.innerHeight - 120, window.innerWidth - 280);
        setSize(Math.min(380, Math.max(260, avail * 0.40)));
      } else {
        const avail = window.innerHeight - 56 - 64 - 52 - 24;
        setSize(Math.min(220, Math.max(130, avail * 0.45)));
      }
    }
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);
  return size;
}

// ─── Spinner numérique ────────────────────────────────────────────────────────

function Spinner({ label, value, onChange, min = 0, max = 99, step = 1, unit = "" }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);
  const touchStartY = useRef(null);
  const touchAccum = useRef(0);

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

  function onWheel(e) {
    e.preventDefault();
    if (e.deltaY < 0) inc(); else dec();
  }

  function onTouchStart(e) {
    touchStartY.current = e.touches[0].clientY;
    touchAccum.current = 0;
  }

  function onTouchMove(e) {
    e.preventDefault();
    const dy = touchStartY.current - e.touches[0].clientY;
    touchAccum.current += dy;
    touchStartY.current = e.touches[0].clientY;
    const threshold = 12;
    if (touchAccum.current > threshold) { inc(); touchAccum.current = 0; }
    else if (touchAccum.current < -threshold) { dec(); touchAccum.current = 0; }
  }

  return (
    <div className="flex flex-col items-center gap-0.5">
      {label && <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{label}</p>}
      <button onClick={inc}
        className="w-7 h-6 flex items-center justify-center text-gray-400 hover:text-accent transition-colors rounded-lg hover:bg-accent/10">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3"><path d="M18 15l-6-6-6 6"/></svg>
      </button>
      <div
        className="w-14 h-11 bg-gray-100 dark:bg-gray-800 rounded-xl flex flex-col items-center justify-center cursor-pointer select-none touch-none"
        onClick={startEdit}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
      >
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

// ─── Boutons de contrôle ──────────────────────────────────────────────────────

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
  const [running, setRunning] = useState(_chr.running);
  const [ms, setMs] = useState(
    _chr.running ? (_chr.savedMs + (Date.now() - _chr.startTime)) : _chr.savedMs
  );
  const [laps, setLaps] = useState([..._chr.laps]);
  const rafRef = useRef(null);

  const tick = useCallback(() => {
    const current = _chr.savedMs + (Date.now() - _chr.startTime);
    setMs(current);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // Remonte : redémarre le rAF si le chrono tournait pendant la navigation
  useEffect(() => {
    if (_chr.running) {
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  function toggle() {
    unlockAudio();
    if (_chr.running) {
      cancelAnimationFrame(rafRef.current);
      _chr.savedMs += Date.now() - _chr.startTime;
      _chr.running = false;
      setRunning(false);
    } else {
      _chr.startTime = Date.now();
      _chr.running = true;
      setRunning(true);
      rafRef.current = requestAnimationFrame(tick);
    }
  }

  function reset() {
    unlockAudio();
    cancelAnimationFrame(rafRef.current);
    _chr.running = false;
    _chr.startTime = null;
    _chr.savedMs = 0;
    _chr.laps = [];
    setRunning(false);
    setMs(0);
    setLaps([]);
  }

  function lap() {
    if (!_chr.running) return;
    const current = _chr.savedMs + (Date.now() - _chr.startTime);
    _chr.laps = [..._chr.laps, current];
    setLaps([..._chr.laps]);
  }

  const { m, s, cs } = fmtMSms(ms);
  const status = running ? "EN COURS" : ms === 0 ? "PRÊT" : "PAUSE";
  const fontSize = circleSize < 170 ? "text-3xl" : circleSize > 300 ? "text-6xl" : "text-4xl";

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

      <div className="w-full max-w-xs overflow-y-auto" style={{ height: "18vh" }}>
        <div className="space-y-1">
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
      </div>
    </div>
  );
}

// ─── MINUTEUR ─────────────────────────────────────────────────────────────────

function Minuteur({ circleSize }) {
  const [mins, setMins] = useState(_min.mins);
  const [secs, setSecs] = useState(_min.secs);
  const [running, setRunning] = useState(_min.running);
  const [remaining, setRemaining] = useState(() => {
    if (_min.running) return Math.max(0, _min.endTime - Date.now());
    if (_min.savedMs !== null) return _min.savedMs;
    return null;
  });

  const rafRef = useRef(null);

  const totalMs = (mins * 60 + secs) * 1000;
  const currentMs = remaining ?? totalMs;
  const currentSec = Math.ceil(currentMs / 1000);
  const progress = totalMs === 0 ? 1 : Math.max(0, currentMs / totalMs);
  const finished = !_min.running && remaining !== null && remaining <= 0;
  const status = finished ? "TERMINÉ !" : running ? "EN COURS" : remaining !== null ? "PAUSE" : "PRÊT";
  const fontSize = circleSize < 170 ? "text-3xl" : circleSize > 300 ? "text-6xl" : "text-4xl";

  const tick = useCallback(() => {
    // Toujours lire depuis l'état global (la phase peut avoir été modifiée par l'audio tick)
    if (!_min.running) {
      setRunning(false);
      setRemaining(r => (r !== null && r > 0) ? r : 0);
      return;
    }
    const left = _min.endTime - Date.now();
    setRemaining(Math.max(0, left));
    if (left > 0) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      setRunning(false);
      setRemaining(0);
    }
  }, []);

  // Remonte : re-sync si le minuteur tournait pendant la navigation
  useEffect(() => {
    if (_min.running) {
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  // Détecte la fin déclenchée par l'audio interval quand on revient sur la page
  useEffect(() => {
    const id = setInterval(() => {
      if (!_min.running && running) {
        setRunning(false);
        setRemaining(0);
      }
    }, 300);
    return () => clearInterval(id);
  }, [running]);

  function toggle() {
    unlockAudio();
    if (finished) return;
    if (_min.running) {
      cancelAnimationFrame(rafRef.current);
      _min.savedMs = Math.max(0, _min.endTime - Date.now());
      _min.running = false;
      setRunning(false);
    } else {
      if (totalMs === 0) return;
      const startMs = _min.savedMs ?? totalMs;
      _min.endTime = Date.now() + startMs;
      _min.savedMs = null;
      _min.running = true;
      _min.beeped = new Set();
      ensureAudioTick();
      setRunning(true);
      rafRef.current = requestAnimationFrame(tick);
    }
  }

  function reset() {
    unlockAudio();
    cancelAnimationFrame(rafRef.current);
    _min.endTime = null;
    _min.savedMs = null;
    _min.running = false;
    _min.beeped = new Set();
    setRunning(false);
    setRemaining(null);
  }

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
          <Spinner label="MIN" value={mins} onChange={v => { _min.mins = v; setMins(v); reset(); }} max={99} unit="min" />
          <div className="flex items-center h-11 mt-6 text-xl font-bold text-gray-300 dark:text-gray-600">:</div>
          <Spinner label="SEC" value={secs} onChange={v => { _min.secs = v; setSecs(v); reset(); }} max={59} step={5} unit="sec" />
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
  const [prep,  setPrep]  = useState(_tab.prep);
  const [work,  setWork]  = useState(_tab.work);
  const [rest,  setRest]  = useState(_tab.rest);
  const [tours, setTours] = useState(_tab.tours);

  const [running, setRunning] = useState(_tab.running);
  const [phase,   setPhase]   = useState(_tab.phase);
  const [leftMs,  setLeftMs]  = useState(_tab.running ? Math.max(0, _tab.endTime - Date.now()) : 0);
  const [tour,    setTour]    = useState(_tab.tour);

  const rafRef = useRef(null);

  const totalWork = work * tours;
  const totalRest = rest * Math.max(0, tours - 1);
  const totalSec  = prep + totalWork + totalRest;

  function fmtT(s) { return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; }

  const leftSec = Math.ceil(leftMs / 1000);
  const phaseDurMs = _tab.phaseDurMs || 1;
  const progress = phase === PHASE.DONE ? 1
    : phase === null ? 1
    : Math.max(0, leftMs / phaseDurMs);

  const fontSize = circleSize < 170 ? "text-3xl" : circleSize > 300 ? "text-6xl" : "text-4xl";

  // rAF tick : lit toujours depuis l'état global (transitions gérées par l'audio interval)
  const tick = useCallback(() => {
    const gPhase   = _tab.phase;
    const gRunning = _tab.running;
    const gTour    = _tab.tour;

    setPhase(gPhase);
    setTour(gTour);
    setRunning(gRunning);

    if (!gRunning) return;

    const left = _tab.endTime - Date.now();
    setLeftMs(Math.max(0, left));
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // Remonte : re-sync si le tabata tournait pendant la navigation
  useEffect(() => {
    if (_tab.running) {
      setPhase(_tab.phase);
      setTour(_tab.tour);
      setLeftMs(Math.max(0, _tab.endTime - Date.now()));
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  function start() {
    unlockAudio();
    if (_tab.running) return;
    let initialPhase, durSec, initialTour;
    if (_tab.phase === null) {
      initialPhase = PHASE.PREP; durSec = _tab.prep; initialTour = 1;
    } else {
      initialPhase = _tab.phase;
      durSec = Math.max(1, Math.ceil((_tab.endTime - Date.now()) / 1000));
      initialTour = _tab.tour;
    }
    _tab.beeped = new Set();
    const durMs = durSec * 1000;
    _tab.phase = initialPhase;
    _tab.endTime = Date.now() + durMs;
    _tab.tour = initialTour;
    _tab.phaseDurMs = durMs;
    _tab.running = true;
    ensureAudioTick();
    setPhase(initialPhase);
    setTour(initialTour);
    setRunning(true);
    setLeftMs(durMs);
    rafRef.current = requestAnimationFrame(tick);
  }

  function pause() {
    unlockAudio();
    cancelAnimationFrame(rafRef.current);
    _tab.endTime = Date.now() + leftMs;
    _tab.running = false;
    setRunning(false);
  }

  function reset() {
    unlockAudio();
    cancelAnimationFrame(rafRef.current);
    _tab.running = false;
    _tab.phase = null;
    _tab.endTime = null;
    _tab.tour = 0;
    _tab.phaseDurMs = 1;
    _tab.beeped = new Set();
    setRunning(false);
    setPhase(null);
    setLeftMs(0);
    setTour(0);
  }

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

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
      <div className="grid grid-cols-4 gap-2 w-full max-w-xs">
        <Spinner label="Prépa"   value={prep}  onChange={v => { _tab.prep  = v; setPrep(v);  reset(); }} max={60}  unit="s" />
        <Spinner label="Travail" value={work}  onChange={v => { _tab.work  = v; setWork(v);  reset(); }} max={300} step={5} unit="s" />
        <Spinner label="Repos"   value={rest}  onChange={v => { _tab.rest  = v; setRest(v);  reset(); }} max={120} step={5} unit="s" />
        <Spinner label="Tours"   value={tours} onChange={v => { _tab.tours = v; setTours(v); reset(); }} min={1}   max={30} unit="×" />
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

let _activeMode = "chrono";

export default function Timers() {
  const [mode, setMode] = useState(_activeMode);

  function switchMode(id) { _activeMode = id; setMode(id); }
  const circleSize = useTimerSize();

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

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={isMobile ? {
        position: "fixed",
        left: 0,
        right: 0,
        top: "56px",
        bottom: "calc(80px + env(safe-area-inset-bottom, 0px))",
      } : {
        minHeight: "calc(100vh - 0px)",
      }}
    >
      {/* Sélecteur PC : bandeau classique */}
      {!isMobile && (
        <div className="flex-none flex w-full glass-nav border-b">
          {MODES.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => switchMode(id)}
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
      )}

      {/* Sélecteur mobile : 3 boutons style Programme */}
      {isMobile && (
        <div className="flex-none flex gap-2 px-4 pt-3 pb-1">
          {MODES.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => switchMode(id)}
              className={clsx(
                "flex-1 flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl border text-xs font-semibold transition-all",
                mode === id
                  ? "border-accent bg-accent/10 text-accent dark:bg-accent/20"
                  : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300"
              )}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 flex items-center justify-center px-4 py-4 overflow-hidden">
        <div className="w-full flex flex-col items-center">
          {mode === "chrono"   && <Chronometre  circleSize={circleSize} />}
          {mode === "minuteur" && <Minuteur      circleSize={circleSize} />}
          {mode === "tabata"   && <Tabata        circleSize={circleSize} />}
        </div>
      </div>
    </div>
  );
}
