const SURNAME_PARTICLES = new Set([
  "da",
  "de",
  "del",
  "della",
  "di",
  "dos",
  "du",
  "la",
  "le",
  "van",
  "von",
]);

/**
 * Keeps pitch labels compact while retaining a stable, recognizable surname.
 */
export function compactPlayerName(name) {
  if (typeof name !== "string") {
    throw new TypeError("Player names must be strings.");
  }

  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    throw new TypeError("Player names must not be empty.");
  }
  if (parts.length === 1) {
    return parts[0];
  }

  let surnameStart = parts.length - 1;
  while (
    surnameStart > 0 &&
    SURNAME_PARTICLES.has(parts[surnameStart - 1].toLocaleLowerCase("en"))
  ) {
    surnameStart -= 1;
  }

  const initials = parts
    .slice(0, surnameStart)
    .map((part) => `${Array.from(part)[0]}.`)
    .join(" ");
  const surname = parts.slice(surnameStart).join(" ");

  return initials ? `${initials} ${surname}` : surname;
}
