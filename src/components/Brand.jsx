/** The Roost nest mark. Mirrors icons/icon*.png; amber carves the gaps so the
 *  eggs don't merge into one white mass. */
export function Brand({ className = 'mark' }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="15.5" fill="#e09322" />
      <ellipse cx="16" cy="20.16" rx="12.16" ry="7.81" fill="#fff" />
      <ellipse cx="16" cy="17.28" rx="8.58" ry="5.76" fill="#e09322" />
      <ellipse cx="12.74" cy="15.58" rx="2.97" ry="2.81" fill="#e09322" />
      <ellipse cx="12.74" cy="15.58" rx="2.37" ry="2.21" fill="#fff" />
      <ellipse cx="19.26" cy="15.58" rx="2.97" ry="2.81" fill="#e09322" />
      <ellipse cx="19.26" cy="15.58" rx="2.37" ry="2.21" fill="#fff" />
      <ellipse cx="16" cy="14.56" rx="3.06" ry="2.90" fill="#e09322" />
      <ellipse cx="16" cy="14.56" rx="2.46" ry="2.30" fill="#fff" />
    </svg>
  );
}
