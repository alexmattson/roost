/**
 * Shared shell for the app's records tables (Inventory, POS sales, Sync), so
 * they all read as one design: a single white card, a toolbar of pill filters
 * and a pill search on top, and — when a table has row actions — an action
 * group tucked into the top-right "cutout". Pages pass their filters/search/
 * actions and render their own table body as children.
 */

/** A pill-shaped <select> for a table filter. */
export function FilterPill({ children, className = '', ...props }) {
  return <select className={`rec-pill ${className}`.trim()} {...props}>{children}</select>;
}

const SearchGlyph = () => (
  <svg className="rec-search-ico" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="m20 20-3.2-3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** The pill search box that fills the toolbar. */
export function SearchPill({ className = '', ...props }) {
  return (
    <label className={`rec-search ${className}`.trim()}>
      <SearchGlyph />
      <input type="search" className="rec-search-input" {...props} />
    </label>
  );
}

/**
 * The white records card + toolbar. `filters` (pill selects) and `search` sit
 * on the left; `actions` render in the top-right cutout. Everything below the
 * toolbar — the delete/fix bar, the table-scroll, any modal — is `children`.
 */
export function RecordsCard({ filters, search, actions, className = '', children }) {
  const hasToolbar = filters || search || actions;
  return (
    <div className={`card records-card ${className}`.trim()}>
      {hasToolbar && (
        <div className="rec-head">
          <div className="rec-filters">{filters}{search}</div>
          {actions && <div className="rec-actions">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
