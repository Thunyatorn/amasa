export type ShoppingCategory = "running-shoes" | "groceries" | "household";

const names = { "running-shoes": "Running shoes", groceries: "Groceries", household: "Household" };

// Intentionally generic line drawings: these represent a category, never a catalog product.
export function CategoryIllustration({ category }: { category: ShoppingCategory }) {
  return <figure className={`category-illustration category-${category}`}>
    <svg viewBox="0 0 320 180" fill="none" aria-hidden="true" focusable="false">
      <path d="M35 147h250" stroke="currentColor" opacity=".15" />
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {category === "running-shoes" ? <>
          <path d="M58 117 65 76l29 13 28-35 42 31c18 14 35 19 64 21 16 1 30 10 32 22H76c-10 0-16-3-18-11Z" fill="var(--illustration-fill)" />
          <path d="m58 117-2 15c10 8 30 10 55 10h143l8-14H76c-10 0-16-3-18-11ZM95 89l28 19 43-23M122 64l-12 15m26-5-12 15m26-5-12 15M66 99l28 9M180 104l-18 23" />
          <path d="M79 137h18m12 0h18m12 0h18m12 0h18m12 0h18m12 0h18" opacity=".4" />
        </> : category === "groceries" ? <>
          <path d="m94 87 12 57h109l13-57Z" fill="var(--illustration-fill)" />
          <path d="M89 86h144v9H89zM127 108l4 24m29-24v24m31-24-4 24M121 85l23-37m55 37-23-37" />
          <path d="m105 84-9-26c-5-17 4-33 12-28 6-12 18-3 17 9 14 0 15 13 8 22l-13 23M173 85c-9-15-3-31 10-30 13-13 31-2 27 13 10 6 9 14 6 17M181 53c-3-14 3-20 13-21" />
        </> : <>
          <path d="M88 74h56v69H88zM92 57h48v17H92zM103 44h26v13h-26zM129 44h21v9h-21" fill="var(--illustration-fill)" />
          <path d="M101 94h30v28h-30zM181 83h42l13 60h-68zM187 68h30v15h-30zM193 55h18v13h-18zM211 55h26v10h-10l-10 10M181 108h42M67 143h185" />
        </>}
      </g>
    </svg>
    <figcaption>{names[category]} · Category illustration</figcaption>
  </figure>;
}
