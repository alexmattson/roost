import { Card } from '../components/ui.jsx';

/**
 * Marks a page whose React port is still in progress. The pure logic behind it
 * (analytics, reconcile, stock, charts) is already in src/lib and reused; what
 * remains is the component layer. The live app on `main` still serves the full
 * vanilla version of this page.
 */
export function Placeholder({ title, subtitle }) {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <Card style={{ padding: '28px 22px', textAlign: 'center' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 17 }}>{title}</h2>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>{subtitle}</p>
        <p style={{ margin: '14px 0 0', color: 'var(--faint)', fontSize: 12 }}>
          This page is being ported to React. Its logic already lives in <code>src/lib</code>;
          the component layer is next.
        </p>
      </Card>
    </div>
  );
}
