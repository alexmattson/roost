import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * One toast/notification system for the whole app. Notifications overlay the
 * layout (a fixed viewport portalled to <body>) rather than pushing content
 * around, and every success/error/info message is funnelled through here.
 *
 * useToast() returns a `toast(kind, text, ms)` function with the same shape the
 * old per-page `flash(kind, text, ms)` helpers had — `ms` omitted uses a sane
 * default, `ms === 0` makes it sticky (manual dismiss). kind is 'ok' | 'error'
 * | 'info'.
 */

const ToastContext = createContext(null);
const KIND = { ok: 'ok', error: 'error', info: 'info' };
const ICON = { ok: '✓', error: '!', info: 'i' };
const DEFAULT_MS = 3200;

let seq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const tm = timers.current.get(id);
    if (tm) { clearTimeout(tm); timers.current.delete(id); }
  }, []);

  const toast = useCallback((kind, text, ms) => {
    const body = text == null ? '' : String(text);
    if (!body.trim()) return null;
    const id = ++seq;
    const k = KIND[kind] || 'info';
    setToasts((list) => [...list, { id, kind: k, text: body }]);
    const duration = ms === undefined ? DEFAULT_MS : ms;
    if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration));
    return id;
  }, [dismiss]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts, onDismiss }) {
  if (typeof document === 'undefined' || !toasts.length) return null;
  return createPortal(
    <div className="toast-viewport" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role="status">
          <span className="toast-ico" aria-hidden="true">{ICON[t.kind]}</span>
          <span className="toast-text">{t.text}</span>
          <button className="toast-x" onClick={() => onDismiss(t.id)} aria-label="Dismiss notification">×</button>
        </div>
      ))}
    </div>,
    document.body
  );
}

export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error('useToast must be used within a ToastProvider');
  return toast;
}
