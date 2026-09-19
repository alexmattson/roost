import { PALETTE } from '../lib/charts.js';

/* Small, presentational primitives built on the shared design tokens in
   theme.css. Everything visual routes through these so the app reads as one
   system. */

export function Button({ variant = 'default', small, className = '', children, ...rest }) {
  const cls = ['btn',
    variant === 'primary' && 'primary',
    variant === 'ghost' && 'ghost',
    small && 'small',
    className].filter(Boolean).join(' ');
  return <button className={cls} {...rest}>{children}</button>;
}

export function IconButton({ className = '', children, ...rest }) {
  return <button className={`icon-btn ${className}`} {...rest}>{children}</button>;
}

export function Card({ className = '', children, ...rest }) {
  return <div className={`card ${className}`} {...rest}>{children}</div>;
}

export function CardHead({ title, hint, children }) {
  return (
    <div className="card-head">
      <h2>{title}</h2>
      {hint && <span className="hint">{hint}</span>}
      {children}
    </div>
  );
}

export function Pill({ tone, className = '', dataMatch, children }) {
  return (
    <span className={`pill ${tone || ''} ${className}`.trim()} data-match={dataMatch}>{children}</span>
  );
}

// Resolved at render, not snapshotted — PALETTE is mutated in place by the
// theme's refreshPalette(), so the accent tracks light/dark.
const STATUS_KEY = { good: 'green', watch: 'brass', alert: 'red' };

/**
 * A KPI tile. `status` (good | watch | alert) drives the accent; `hero` swaps
 * the thin stripe for the filled accent card used for the headline figures.
 */
export function Kpi({ label, value, sub, status, hero, exact, valueClass = '' }) {
  const accent = status ? PALETTE[STATUS_KEY[status]] : 'transparent';
  const cls = ['kpi', status && `is-${status}`, hero && 'kpi-hero'].filter(Boolean).join(' ');
  return (
    <div className={cls} style={{ '--accent': accent }}>
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${valueClass}`} title={exact || undefined}>{value}</div>
      <div className="kpi-sub">{sub || ' '}</div>
    </div>
  );
}

export function Banner({ kind = 'info', children, onClose }) {
  if (!children) return null;
  return (
    <div className={`banner ${kind}`}>
      <span>{children}</span>
      {onClose && <button className="banner-x" onClick={onClose} aria-label="Dismiss">×</button>}
    </div>
  );
}
