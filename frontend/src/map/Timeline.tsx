import { useEffect, useState } from 'react';
import { addYears, formatYear, fromAstro, MAX_YEAR, MIN_YEAR, toAstro } from '../years';
import { YearInput } from '../components/YearInput';

interface Props {
  year: number;
  onChange: (year: number) => void;
}

const MIN_ASTRO = toAstro(MIN_YEAR);
const MAX_ASTRO = toAstro(MAX_YEAR);
const TICKS = [-3000, -2500, -2000, -1500, -1000, -500, 1, 500, 1000, 1500, 2000];
const SPEEDS = [1, 5, 10, 50];

const percent = (year: number) => ((toAstro(year) - MIN_ASTRO) / (MAX_ASTRO - MIN_ASTRO)) * 100;

export function Timeline({ year, onChange }: Props) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      const next = addYears(year, speed);
      onChange(next);
      if (next >= MAX_YEAR) setPlaying(false);
    }, 250);
    return () => clearInterval(timer);
  }, [playing, speed, year, onChange]);

  const step = (n: number) => onChange(addYears(year, n));

  return (
    <div className="timeline">
      <div className="timeline__controls">
        <button onClick={() => step(-100)} title="-100 ans">«</button>
        <button onClick={() => step(-10)} title="-10 ans">‹‹</button>
        <button onClick={() => step(-1)} title="-1 an">‹</button>
        <span className="timeline__year">{formatYear(year)}</span>
        <button onClick={() => step(1)} title="+1 an">›</button>
        <button onClick={() => step(10)} title="+10 ans">››</button>
        <button onClick={() => step(100)} title="+100 ans">»</button>
        <button className="timeline__play" onClick={() => setPlaying((p) => !p)} title="Lecture">
          {playing ? '⏸' : '▶'}
        </button>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="Années par pas">
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s} an{s > 1 ? 's' : ''} / pas
            </option>
          ))}
        </select>
        <span className="timeline__goto">
          Aller à <YearInput value={year} onChange={(y) => y !== null && onChange(y)} />
        </span>
      </div>
      <div className="timeline__track">
        <input
          type="range"
          min={MIN_ASTRO}
          max={MAX_ASTRO}
          value={toAstro(year)}
          onChange={(e) => onChange(fromAstro(Number(e.target.value)))}
        />
        <div className="timeline__ticks">
          {TICKS.map((t) => (
            <button key={t} style={{ left: `${percent(t)}%` }} onClick={() => onChange(t)}>
              {t < 0 ? `${-t} av.` : t}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
