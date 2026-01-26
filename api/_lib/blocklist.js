function normalizeForCompare(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[„”"“”'’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCsvEnv(name) {
  const raw = process.env[name];
  if (!raw) return [];
  return Array.from(
    new Set(
      String(raw)
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  );
}

export function getBlockedTitleSubstrings() {
  return parseCsvEnv("BLOCKED_TITLE_SUBSTRINGS");
}

export function getBlockedSourceHosts() {
  return parseCsvEnv("BLOCKED_SOURCE_HOSTS").map((h) => h.toLowerCase());
}

function hostMatches(blockedHost, actualHost) {
  if (!blockedHost || !actualHost) return false;
  const b = String(blockedHost).toLowerCase();
  const a = String(actualHost).toLowerCase();
  if (a === b) return true;
  // Allow blocking parent domain (e.g. "example.com" blocks "m.example.com")
  return a.endsWith(`.${b}`);
}

export function isBlockedSourceUrl(sourceUrl) {
  const blocked = getBlockedSourceHosts();
  if (!blocked.length) return { blocked: false, reason: null };
  let host = "";
  try {
    host = new URL(String(sourceUrl)).hostname.toLowerCase();
  } catch {
    host = "";
  }
  if (!host) return { blocked: false, reason: null };
  const hit = blocked.find((b) => hostMatches(b, host));
  if (!hit) return { blocked: false, reason: null };
  return { blocked: true, reason: `Blocked host: ${hit}` };
}

export function isBlockedTitle(title) {
  const parts = getBlockedTitleSubstrings();
  if (!parts.length) return { blocked: false, reason: null };

  const tNorm = normalizeForCompare(title);
  if (!tNorm) return { blocked: false, reason: null };

  for (const p of parts) {
    const pNorm = normalizeForCompare(p);
    if (!pNorm) continue;
    if (tNorm.includes(pNorm)) {
      return { blocked: true, reason: `Blocked title match: ${p}` };
    }
  }
  return { blocked: false, reason: null };
}

