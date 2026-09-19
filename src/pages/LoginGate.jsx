import { useState } from 'react';
import { useData } from '../store/data.jsx';
import { Brand } from '../components/Brand.jsx';
import { Button } from '../components/ui.jsx';

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
    <section className="login-gate">
      <div className="login-card">
        <div className="login-brand"><Brand /><h1>Roost</h1></div>
        <p className="login-lead">Connect your Sandpiper and Quail accounts to open your dashboard.</p>

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

        {error && <p className="login-error">{error}</p>}
        <Button variant="primary" className="login-submit" disabled={!status.sandpiper.connected} onClick={onEnter}>
          Enter Roost
        </Button>

        <p className="login-foot">Roost talks to Sandpiper and Quail directly from your browser. It is not affiliated with either.</p>
      </div>
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
