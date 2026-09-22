import { useState } from 'react';
import { useData } from '../store/data.jsx';
import { Brand } from '../components/Brand.jsx';
import { Button } from '../components/ui.jsx';
import heroImg from '../assets/login-hero.jpg';

/** Connect each system on its own, both with a plain email and password. */
export function LoginGate({ onEnter }) {
  const { status, connectSandpiper, connectQuail } = useData();
  const [error, setError] = useState('');
  const [spBusy, setSpBusy] = useState(false);
  const [qBusy, setQBusy] = useState(false);
  const [sp, setSp] = useState({ username: '', password: '' });
  const [q, setQ] = useState({ email: '', password: '' });

  const runSandpiper = async () => {
    setError(''); setSpBusy(true);
    try {
      await connectSandpiper({ username: sp.username.trim(), password: sp.password });
      setSp((s) => ({ ...s, password: '' }));
    } catch (e) { setError(e.message || String(e)); }
    finally { setSpBusy(false); }
  };

  const runQuail = async () => {
    setError(''); setQBusy(true);
    try {
      await connectQuail({ email: q.email.trim(), password: q.password });
      setQ((s) => ({ ...s, password: '' }));
    } catch (e) { setError(e.message || String(e)); }
    finally { setQBusy(false); }
  };

  const onKey = (fn) => (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } };

  return (
    <section className="auth">
      <div className="auth-side">
        <div className="auth-brand"><Brand /><span>Roost</span></div>

        <div className="auth-form">
          <h1 className="auth-title">Welcome to Roost</h1>
          <p className="auth-sub">Connect Sandpiper and Quail to open your dashboard.</p>

          <SystemRow name="Sandpiper" connected={status.sandpiper.connected} who={status.sandpiper.user}>
            <input type="email" placeholder="Email" autoComplete="username" aria-label="Sandpiper email"
              value={sp.username} onChange={(e) => setSp({ ...sp, username: e.target.value })} onKeyDown={onKey(runSandpiper)} />
            <input type="password" placeholder="Password" autoComplete="current-password" aria-label="Sandpiper password"
              value={sp.password} onChange={(e) => setSp({ ...sp, password: e.target.value })} onKeyDown={onKey(runSandpiper)} />
            <Button small onClick={runSandpiper} disabled={spBusy}>{spBusy ? 'Connecting…' : 'Connect'}</Button>
          </SystemRow>

          <SystemRow name="Quail" connected={status.quail.connected} who={status.quail.email}>
            <input type="email" placeholder="Vendor email" autoComplete="off" aria-label="Quail vendor email"
              value={q.email} onChange={(e) => setQ({ ...q, email: e.target.value })} onKeyDown={onKey(runQuail)} />
            <input type="password" placeholder="Password" autoComplete="off" aria-label="Quail password"
              value={q.password} onChange={(e) => setQ({ ...q, password: e.target.value })} onKeyDown={onKey(runQuail)} />
            <Button small onClick={runQuail} disabled={qBusy}>{qBusy ? 'Connecting…' : 'Connect'}</Button>
          </SystemRow>

          {error && <p className="auth-error">{error}</p>}
          <Button variant="primary" className="auth-submit" disabled={!status.sandpiper.connected} onClick={onEnter}>
            Enter Roost
          </Button>

          <p className="auth-foot">Roost talks to Sandpiper and Quail directly from your browser — not affiliated with either.</p>
        </div>
      </div>

      <aside className="auth-hero" aria-hidden="true" style={{ backgroundImage: `linear-gradient(165deg, rgba(246,199,61,.16) 0%, rgba(243,190,55,.26) 46%, rgba(196,136,22,.84) 100%), url(${heroImg})` }}>
        <div className="hero-tag">Inventory &amp; register,<br />reconciled.</div>

        <div className="hero-card hero-a">
          <div className="hero-label">Taken home</div>
          <div className="hero-num">$4,820</div>
          <svg className="hero-spark" viewBox="0 0 120 34" preserveAspectRatio="none">
            <path d="M2 26 C18 26 22 12 38 14 S64 30 78 20 100 6 118 9" fill="none" stroke="#2a2205" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </div>

        <div className="hero-chip">✦ New sale · $65</div>

        <div className="hero-card hero-b">
          <div className="hero-row"><span className="hero-dot" />Booth AGM<b>92%</b></div>
          <div className="hero-row"><span className="hero-dot alt" />Facebook<b>$1.2k</b></div>
        </div>
      </aside>
    </section>
  );
}

function SystemRow({ name, connected, who, children }) {
  return (
    <div className={`sys-row ${connected ? 'connected' : ''}`}>
      <div className="sys-head">
        <span className="sys-name">{name}</span>
        <span className="sys-status" data-state={connected ? 'on' : 'off'}>
          {connected ? (who ? `Connected · ${who}` : 'Connected') : 'Not connected'}
        </span>
      </div>
      <div className="sys-actions">{children}</div>
    </div>
  );
}
