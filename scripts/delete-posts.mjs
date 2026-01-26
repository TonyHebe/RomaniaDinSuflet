import fs from "node:fs/promises";
import { getPool } from "../api/_lib/db.js";

const DEFAULT_TITLES = [
  "Polaroid din 2004: Alina Vindican, înainte să devină „Alina Borcea” și să afle că viața are VIP + prelungiri",
  "Cristi Chivu, ales să poarte torța olimpică la Milano. Anunțul făcut de organizatori",
  "EXCLUSIV CUTIA NEAGRĂ Camarila lui Ilie Bolojan, anchetă zdrobitoare. Cel mai bogat baron PNL din cel mai sărac judeţ al ţării, abonat la contracte cu statul",
  "Valentino Garavani a fost condus pe ultimul drum. Anne Hathaway și Anna Wintour, printre vedetele prezente la funeralii",
  "O badantă a găsit un bon poștal vechi în casa bătrânei pe care o îngrijește. A rămas fără cuvinte când a aflat cât valorează",
  "Adolescentă de 15 ani, dispariție inexplicabilă! Ghiozdanul",
  "Doliu în PSD! Neculai Soceanu, fostul primar al comunei Roșiori, găsit mort în casă",
  "Cine e fosta soție a lui Abush, de fapt. Andreea Bostănică, adevărul gol-goluț despre Doinița Lazarenco: ”Dansam cu ea la ziua mea de naștere”",
  "Bisoi Petruț și-a recuperat permisul de conducere, dar a primit o nouă lovitură. Ce a pățit vloggerul",
  "De ce nu se ține pâinea în frigider. Cum ne afectează sănătatea",
  "Valentino Garavani și Giancarlo Giammetti: o viață împărtășită între iubire, muncă și tăceri alese",
  "Ilie Bolojan vorbeşte de sărăcie doar când vrea: \"România are bani să aloce pentru un proiect sau altul un miliard de dolari, dar fiecare leu trebuie clar justificat\"",
  "Elevul de 13 ani acuzat că și-a ucis prietenul de 15 ani ar fi consumat droguri",
  "Ilie Bolojan explică \"nemţeşte\" de ce a tăiat banii pentru mame şi persoanele cu handicap",
  "Ilie Bolojan nu mai amână concedierile din aparatul de stat: „Trebuie să ai un salariu care să reflecte aportul pe care îl aduci. E o problemă reală care vine din spate”",
  "Ilie Bolojan, cu demisia pe masă: „Fiecare partid face ce doreşte, însă stabilitatea Guvernului este importantă în această perioadă\"",
];

function parseArgs(argv) {
  const args = {
    titles: [],
    titlesFile: null,
    useDefaultList: false,
    contains: false,
    yes: false,
    dryRun: true,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--title" && argv[i + 1]) {
      args.titles.push(argv[i + 1]);
      i += 1;
    } else if (a === "--titles-file" && argv[i + 1]) {
      args.titlesFile = argv[i + 1];
      i += 1;
    } else if (a === "--use-default-list") {
      args.useDefaultList = true;
    } else if (a === "--contains") {
      args.contains = true;
    } else if (a === "--yes") {
      args.yes = true;
      args.dryRun = false;
    } else if (a === "--dry-run") {
      args.dryRun = true;
      args.yes = false;
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    }
  }

  return args;
}

function normalizeStringArray(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((v) => String(v || "").trim())
        .filter(Boolean),
    ),
  );
}

function usage() {
  console.log(`
Delete unwanted posts from the 'articles' table.

Examples:
  node scripts/delete-posts.mjs --use-default-list --dry-run
  node scripts/delete-posts.mjs --use-default-list --yes
  node scripts/delete-posts.mjs --title "Exact title here" --dry-run
  node scripts/delete-posts.mjs --titles-file ./titles.txt --contains --yes

Flags:
  --use-default-list   Use the built-in title list (from the issue)
  --title "..."        Add one exact title (repeatable)
  --titles-file PATH   Newline-separated titles
  --contains           Match by substring (ILIKE %...%) instead of exact title
  --dry-run            Only list matches (default)
  --yes                Actually delete matches
`);
}

const args = parseArgs(process.argv);
if (args.help) {
  usage();
  process.exit(0);
}

let titles = [];
if (args.useDefaultList) titles.push(...DEFAULT_TITLES);
if (args.titles?.length) titles.push(...args.titles);
if (args.titlesFile) {
  const raw = await fs.readFile(args.titlesFile, "utf8");
  const fromFile = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  titles.push(...fromFile);
}
titles = normalizeStringArray(titles);

if (!titles.length) {
  console.error("No titles provided. Use --use-default-list or --title/--titles-file.");
  usage();
  process.exit(2);
}

const pool = getPool();
const patterns = args.contains ? titles.map((t) => `%${t}%`) : titles;

const selectSql = args.contains
  ? `
      select slug, title, published_at as "publishedAt", category
      from articles
      where title ilike any($1::text[])
      order by published_at desc
    `
  : `
      select slug, title, published_at as "publishedAt", category
      from articles
      where title = any($1::text[])
      order by published_at desc
    `;

const { rows: matches } = await pool.query(selectSql, [patterns]);

console.log(`Matched ${matches.length} article(s).`);
for (const m of matches) {
  console.log(`- ${m.slug} | ${m.publishedAt} | ${m.title}`);
}

if (args.dryRun) {
  console.log("Dry run: no deletions performed. Re-run with --yes to delete.");
  process.exit(0);
}

const deleteSql = args.contains
  ? `
      delete from articles
      where title ilike any($1::text[])
      returning slug, title
    `
  : `
      delete from articles
      where title = any($1::text[])
      returning slug, title
    `;

const { rows: deleted } = await pool.query(deleteSql, [patterns]);
console.log(`Deleted ${deleted.length} article(s).`);
for (const d of deleted) {
  console.log(`- ${d.slug} | ${d.title}`);
}

