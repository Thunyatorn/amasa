// A neutral stand-in for a celebrity photo (used when the photo file isn't on this machine, e.g. a
// public deployment that doesn't ship the photos). It shows initials only: no likeness.

const escapeXml = (text: string) => text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

export function initialsOf(name: string): string {
  const words = name.split(/[\s.-]+/).filter((w) => /^\p{L}/u.test(w));
  const letters = [words[0], words.length > 1 ? words[words.length - 1] : undefined].flatMap((w) => (w ? [[...w][0]!] : []));
  return (letters.join("") || "?").toUpperCase();
}

export function placeholderSvg(name: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="${escapeXml(name)}">`
    + `<rect width="160" height="160" fill="#e8eaee"/>`
    + `<text x="80" y="80" text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif" font-size="56" font-weight="600" fill="#5a5f67">${escapeXml(initialsOf(name))}</text>`
    + `</svg>`;
}
