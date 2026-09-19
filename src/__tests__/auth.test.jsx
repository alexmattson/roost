import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App.jsx';
import { signOutWeb } from '../lib/webbackend.js';

/* The auth gate: a fresh connect must leave you on the login screen until you
   press Enter Roost, and signing out must return you to it. */

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const jwt = `x.${b64url({ username: 'tester', exp: Math.floor(Date.now() / 1000) + 9999, '@app-claim/@sandpiper/permissions': { accounts: ['acct-1'] } })}.y`;

const ok = (body) => ({ ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(body) });

function mockFetch() {
  global.fetch = vi.fn(async (url) => {
    const p = new URL(url).pathname;
    if (p === '/api/login/do-login') return ok({ jwtToken: jwt });
    if (p.startsWith('/api/stores/')) return ok([]);
    if (p.startsWith('/api/booths/')) return ok([]);
    if (p.endsWith('/items')) return ok([]);
    return { ok: false, status: 404, statusText: 'NF', text: async () => '' };
  });
}

describe('auth gate', () => {
  beforeEach(() => { signOutWeb(); localStorage.clear(); sessionStorage.clear(); document.documentElement.dataset.theme = 'dark'; mockFetch(); });

  it('stays on the login screen after connecting, until Enter Roost', async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Sandpiper email'), { target: { value: 'me@x.com' } });
    fireEvent.change(screen.getByLabelText('Sandpiper password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Connect' })[0]); // Sandpiper row

    // Connected, but still on the gate — the Enter button becomes enabled.
    const enter = await screen.findByRole('button', { name: 'Enter Roost' });
    await waitFor(() => expect(enter.disabled).toBe(false));
    expect(screen.queryByText('Fetch latest data')).toBeNull(); // dashboard not shown yet

    fireEvent.click(enter);
    expect(await screen.findByText('Fetch latest data')).toBeTruthy(); // now in the dashboard
  });

  it('returns to the login screen on sign out', async () => {
    // Seed a live session + cache so the app opens on the dashboard.
    localStorage.setItem('roost_web_session', JSON.stringify({ sandpiperToken: jwt, accounts: ['acct-1'], username: 'tester', accountId: 'acct-1', quailAuth: null, quailEmail: null }));
    localStorage.setItem('roost_web_cache', JSON.stringify({ items: [], quail: null, venues: { stores: {}, booths: {} }, meta: { fetchedAt: Date.now(), count: 0 } }));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Enter Roost' })).toBeTruthy();
  });

  it('persists a stored session — opens the dashboard without logging in', async () => {
    localStorage.setItem('roost_web_session', JSON.stringify({ sandpiperToken: jwt, accounts: ['acct-1'], username: 'tester', accountId: 'acct-1', quailAuth: null, quailEmail: null }));
    localStorage.setItem('roost_web_cache', JSON.stringify({ items: [], quail: null, venues: { stores: {}, booths: {} }, meta: { fetchedAt: Date.now(), count: 0 } }));
    render(<App />);
    expect(await screen.findByText('Fetch latest data')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enter Roost' })).toBeNull();
  });

  it('drops an expired token and shows the login gate', async () => {
    const expired = `x.${b64url({ username: 'tester', exp: Math.floor(Date.now() / 1000) - 10, '@app-claim/@sandpiper/permissions': { accounts: ['acct-1'] } })}.y`;
    localStorage.setItem('roost_web_session', JSON.stringify({ sandpiperToken: expired, accounts: ['acct-1'], username: 'tester', accountId: 'acct-1' }));
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Enter Roost' })).toBeTruthy();
  });
});
