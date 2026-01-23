export function slugify(input) {
  const s = String(input || "").trim();
  if (!s) return "articol";

  // Normalize diacritics (Ș/Ț/etc) then clean.
  const normalized = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove combining marks
    .replace(/[’'"]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  return normalized || "articol";
}

