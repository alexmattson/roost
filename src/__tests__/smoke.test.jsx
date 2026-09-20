import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from '../App.jsx';

/* Mounts the whole app against seeded storage — session + cached data — so the
   dashboard renders for real (effects, memoised derivations, every page), which
   the build alone can't prove. */

const nowSec = Math.floor(Date.now() / 1000);
const daysAgo = (d) => nowSec - d * 86400;

// A real JWT with a future expiry, so the session isn't dropped as stale on load.
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const token = `x.${b64url({ username: 'tester', exp: Math.floor(Date.now() / 1000) + 9999, '@app-claim/@sandpiper/permissions': { accounts: ['acct-1'] } })}.y`;

const session = {
  sandpiperToken: token, accounts: ['acct-1'], username: 'tester',
  accountId: 'acct-1', quailAuth: 'Basic x', quailEmail: 'v@x.com'
};

const items = [
  { id: 'a1', inventoryNumber: '0100', description: 'Vintage oak chair', acquired: daysAgo(200), originalCost: 4000, totalCost: 4000, askingPrice: 12000, sold: daysAgo(5), soldPrice: 11000, consignmentPaid: 1650, cardFees: 200, soldStore: 's1', soldBooth: 'b1', barcodeCreated: true },
  { id: 'a2', inventoryNumber: '0101', description: 'Brass lamp', acquired: daysAgo(400), originalCost: 2000, totalCost: 2000, askingPrice: 8000, barcodeCreated: false },
  { id: 'a3', inventoryNumber: '0102', description: 'Wicker basket', acquired: daysAgo(10), originalCost: 0, totalCost: 0, askingPrice: 0, barcodeCreated: false },
  // Sold on a direct (non-Quail) channel — Facebook Marketplace.
  { id: 'a4', inventoryNumber: '0200', description: 'Retro Teak Sideboard', acquired: daysAgo(60), originalCost: 5000, totalCost: 5000, askingPrice: 20000, sold: daysAgo(3), soldPrice: 18000, consignmentPaid: 0, cardFees: 0, soldStore: 'fb', soldBooth: 'fbB', barcodeCreated: true }
];

const qtime = (d) => new Date(daysAgo(d) * 1000).toISOString().slice(0, 19).replace('T', ' ');
const quail = {
  sales: [
    { item: { id: 't1', boothId: 'qb1', timestamp: qtime(5), inventory: '0100', description: 'Vintage oak chair', quantity: 1, listPrice: 110, salePrice: 110, taxAmount: 880, discountAmount: 0, consignmentAmount: 1650, cardFeeAmount: 200, category: 'Furniture', storeName: 'Main', boothNumber: 'A1' }, payments: [{ transactionId: 9001, method: 'card' }] },
    { item: { id: 't2', boothId: 'qb1', timestamp: qtime(2), inventory: '0101', description: 'Brass lamp', quantity: 1, listPrice: 75, salePrice: 75, taxAmount: 600, discountAmount: 0, consignmentAmount: 1125, cardFeeAmount: 150, category: 'Lighting', storeName: 'Main', boothNumber: 'A1' }, payments: [{ transactionId: 9002, method: 'cash' }] }
  ],
  booths: [{ boothId: 'qb1', name: 'A1' }],
  rent: [{ boothId: 'qb1', month: new Date().toISOString().slice(0, 7), cents: 68200 }],
  email: 'v@x.com', tz: 'America/Los_Angeles', fetchedAt: Date.now()
};

const venues = {
  stores: {
    s1: { name: 'Main St', city: 'Portland', state: 'OR', externalId: 'qs1' },
    fb: { name: 'Facebook Marketplace', city: null, state: null, externalId: null }
  },
  booths: {
    b1: { name: 'A1', storeId: 's1', consignmentRate: 0.15, externalId: 'qb1' },
    fbB: { name: 'FB', storeId: 'fb', consignmentRate: 0, externalId: null }
  },
  rawStores: {
    s1: { id: 's1', name: 'Main St', city: 'Portland', state: 'OR', externalId: 'qs1' },
    fb: { id: 'fb', name: 'Facebook Marketplace', externalId: null }
  },
  rawBooths: {
    b1: { id: 'b1', name: 'A1', storeId: 's1', consignmentRate: 1500, externalId: 'qb1' },
    fbB: { id: 'fbB', name: 'FB', storeId: 'fb', consignmentRate: 0, externalId: null }
  },
  errors: []
};

const cache = { items, quail, venues, meta: { fetchedAt: Date.now(), count: items.length, user: 'tester', quailError: null } };

function seed(mode) {
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('roost_web_session', JSON.stringify(session));
  localStorage.setItem('roost_web_cache', JSON.stringify(cache));
  if (mode) localStorage.setItem('sp_mode', mode);
}

describe('Roost app', () => {
  beforeEach(() => { document.documentElement.dataset.theme = 'dark'; });

  it('renders the Home briefing with take-home', async () => {
    seed('home');
    render(<App />);
    expect(await screen.findByText(/taken home in/i)).toBeTruthy();
  });

  it('renders the celebratory new-sales sync card', async () => {
    seed('home');
    render(<App />);
    // 0101 sold in Quail but unsold in Sandpiper → a fixable new sale.
    expect(await screen.findByText(/new sale/i)).toBeTruthy();
  });

  it('renders Analyze Overview with KPI tiles', async () => {
    seed('analyze');
    render(<App />);
    expect(await screen.findByText('Take-home')).toBeTruthy();
    expect(await screen.findByText('Net profit')).toBeTruthy();
  });

  it('renders the Catalog table with sortable headers', async () => {
    seed('analyze');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Catalog' }));
    // The categories table is the shared SortableTable — headers are clickable.
    const header = await screen.findByText('Sell-through');
    expect(header.closest('th').className).toContain('sortable');
    fireEvent.click(header); // sort by it — must not throw
    expect(await screen.findByText('Category')).toBeTruthy();
  });

  it('shows channels and opens the manage-channels screen', async () => {
    seed('analyze');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Channels' }));
    expect(await screen.findByText('Sales by channel')).toBeTruthy();
    // The direct channel (Facebook booth) appears with a Direct type badge.
    expect((await screen.findAllByText('FB')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Direct')).length).toBeGreaterThan(0);
    // Manage screen opens.
    fireEvent.click(screen.getAllByRole('button', { name: 'Manage channels' })[0]);
    expect(await screen.findByText(/Create an unlinked store/i)).toBeTruthy();
    expect((await screen.findAllByText('Facebook Marketplace')).length).toBeGreaterThan(0);
  });

  it('renders the Sync page anomalies table', async () => {
    seed('records');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Sync/i }));
    expect(await screen.findByText('Anomalies')).toBeTruthy();
  });

  it('renders the Inventory table', async () => {
    seed('records');
    render(<App />);
    expect(await screen.findByText('Vintage oak chair')).toBeTruthy();
  });

  it('renders POS sales with sortable headers', async () => {
    seed('records');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'POS sales' }));
    expect(await screen.findByText('Point-of-sale ledger')).toBeTruthy();
    const netPayout = await screen.findByText('Net payout');
    fireEvent.click(netPayout);                 // sort by it — must not throw
    expect(await screen.findByText('Brass lamp')).toBeTruthy();
  });

  it('opens Print tags and switches stock', async () => {
    seed('records');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Print tags' }));
    // Config sheet is up: printer-type picker + a Print action.
    expect(await screen.findByText('Printer type')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /^Print$/ })).toBeTruthy();
    // Sheet family + size options render, and switching to A4 changes them.
    expect(await screen.findByText('2-5/8" × 1"')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^A4/ }));
    expect(await screen.findByText('38 × 21mm')).toBeTruthy();
    // Label printer stock.
    fireEvent.click(screen.getByText('Label'));
    expect(await screen.findByText('2.4" × 1.1"')).toBeTruthy();
    // The Booth field is populated from the same venue data as the Venues tab.
    expect(await screen.findByText('Booth')).toBeTruthy();
    expect((await screen.findAllByRole('option', { name: 'A1' })).length).toBeGreaterThan(0);
  });

  it('selects inventory items to print', async () => {
    seed('records');
    render(<App />);
    // Tick one item; the Print tags button reflects the selection count.
    const box = await screen.findByLabelText('Select #0100');
    fireEvent.click(box);
    expect(await screen.findByRole('button', { name: 'Print tags (1)' })).toBeTruthy();
    // Unticking resets the count.
    fireEvent.click(box);
    expect(await screen.findByRole('button', { name: 'Print tags' })).toBeTruthy();
  });

  it('opens the Add stock sheet from Home', async () => {
    seed('home');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add stock' }));
    expect(await screen.findByText(/Split across rows/i)).toBeTruthy(); // the sheet is open
  });
});
