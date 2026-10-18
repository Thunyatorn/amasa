export type ShoppingCategory = "actors" | "musicians" | "athletes";

const names: Record<ShoppingCategory, string> = { actors: "Actors", musicians: "Musicians", athletes: "Athletes" };

// Intentionally generic line drawings: these represent a category, never a particular person.
export function CategoryIllustration({ category }: { category: ShoppingCategory }) {
  return <figure className={`category-illustration category-${category}`}>
    <svg viewBox="0 0 320 180" fill="none" aria-hidden="true" focusable="false">
      <path d="M35 147h250" stroke="currentColor" opacity=".15" />
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {category === "actors" ? <>
          <path d="M100 80h120v62H100z" fill="var(--illustration-fill)" />
          <path d="m100 80 116-26 4 18-116 26M122 75l14-18m18 11 14-18m18 11 14-18M100 100h120" />
        </> : category === "musicians" ? <>
          <path d="M146 40h28v54a14 14 0 0 1-28 0Z" fill="var(--illustration-fill)" />
          <path d="M132 86a28 28 0 0 0 56 0M160 114v24m-20 0h40M152 56h16m-16 14h16" />
        </> : <>
          <path d="M128 46h64v28a32 32 0 0 1-64 0Z" fill="var(--illustration-fill)" />
          <path d="M128 54h-18a16 16 0 0 0 18 24m64-24h18a16 16 0 0 1-18 24M160 106v18m-22 14h44l-6-14h-32Z" />
        </>}
      </g>
    </svg>
    <figcaption>{names[category]} · Category illustration</figcaption>
  </figure>;
}
