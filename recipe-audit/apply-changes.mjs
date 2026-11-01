#!/usr/bin/env node
// Applies recipe audit results (recipe-audit/changes-batch-*.json) to src/App.jsx.
//
//   node recipe-audit/apply-changes.mjs --check   validate only, change nothing
//   node recipe-audit/apply-changes.mjs --apply   edit MEALS and CUISINE_MAP in src/App.jsx
//
// Optional: --app <path> to target a different file (used for testing).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const mode = args.includes("--apply") ? "apply" : args.includes("--check") ? "check" : null;
const appPath = args.includes("--app") ? args[args.indexOf("--app") + 1] : path.join(here, "..", "src", "App.jsx");
const changesDir = args.includes("--changes") ? args[args.indexOf("--changes") + 1] : here;
if (!mode) {
  console.log("Usage: node recipe-audit/apply-changes.mjs --check | --apply");
  process.exit(1);
}

const PROTEINS = ["beef", "chicken", "seafood", "plant-based", "pork", "breakfast"];
const CUISINES = ["american", "mexican", "italian", "asian", "indian", "mediterranean", "french", "middleeastern"];
const INT_FIELDS = ["cal", "satFat", "time", "servings"];
const STRING_FIELDS = ["name", "desc", "tip", "tip2"];
const ARRAY_FIELDS = ["ingredients", "recipe", "recipe_detailed"];
const ALLOWED = new Set(["protein", "cuisine", ...INT_FIELDS, ...STRING_FIELDS, ...ARRAY_FIELDS]);

// ── Read App.jsx ──────────────────────────────────────────────────────────────
let src = fs.readFileSync(appPath, "utf8");

function findBlock(startRe, endRe) {
  const start = src.search(startRe);
  if (start < 0) throw new Error(`Could not find ${startRe} in ${appPath}`);
  const rest = src.slice(start);
  const endMatch = rest.match(endRe);
  const end = start + endMatch.index + endMatch[0].length;
  return { start, end, text: src.slice(start, end) };
}

const mealsBlock = findBlock(/^const MEALS = \[/m, /\n\];/);
const MEALS = Function(`${mealsBlock.text}; return MEALS;`)();
const cuisineBlock = findBlock(/^[ \t]*const CUISINE_MAP=\{/m, /\n[ \t]*\};/);
const CUISINE_MAP = Function(`${cuisineBlock.text}; return CUISINE_MAP;`)();
const byId = new Map(MEALS.map(m => [m.id, m]));

// ── Read change files ─────────────────────────────────────────────────────────
const files = fs.readdirSync(changesDir).filter(f => /^changes-batch-.*\.json$/.test(f)).sort();
if (!files.length) {
  console.log(`No changes-batch-*.json files found in ${changesDir}`);
  process.exit(1);
}

const errors = [];
const warnings = [];
const changes = new Map(); // id -> merged set
const flags = [];

for (const f of files) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(changesDir, f), "utf8"));
  } catch (e) {
    errors.push(`${f}: not valid JSON (${e.message})`);
    continue;
  }
  const list = Array.isArray(data.changes) ? data.changes : [];
  console.log(`${f}: ${list.length} changes, ${(data.flags || []).length} flags`);
  for (const fl of data.flags || []) flags.push({ file: f, ...fl });

  for (const c of list) {
    const where = `${f} id ${c.id}`;
    const meal = byId.get(c.id);
    if (!meal) { errors.push(`${where}: no recipe with this id`); continue; }
    const set = c.set || {};
    for (const [k, v] of Object.entries(set)) {
      if (k === "id" || k === "premium") { errors.push(`${where}: "${k}" must not be changed`); continue; }
      if (!ALLOWED.has(k)) { errors.push(`${where}: unknown field "${k}"`); continue; }
      if (INT_FIELDS.includes(k) && !(Number.isInteger(v) && v >= 0)) errors.push(`${where}: ${k} must be a whole number, got ${JSON.stringify(v)}`);
      if (STRING_FIELDS.includes(k) && (typeof v !== "string" || !v.trim())) errors.push(`${where}: ${k} must be non-empty text`);
      if (ARRAY_FIELDS.includes(k) && !(Array.isArray(v) && v.length && v.every(s => typeof s === "string" && s.trim())))
        errors.push(`${where}: ${k} must be a non-empty list of text`);
      if (k === "protein" && !PROTEINS.includes(v)) errors.push(`${where}: protein "${v}" is not one of ${PROTEINS.join(", ")}`);
      if (k === "cuisine" && !CUISINES.includes(v)) errors.push(`${where}: cuisine "${v}" is not one of ${CUISINES.join(", ")}`);
      if (k === "ingredients" && Array.isArray(v)) {
        for (const ing of v) {
          if (/^(one|two|three|four|five|six|a|an)\s/i.test(ing))
            warnings.push(`${where}: "${ing}" starts with a word, so it won't scale; use a number`);
        }
      }
    }
    if (changes.has(c.id)) warnings.push(`${where}: also changed in an earlier file; fields are merged, later wins`);
    changes.set(c.id, { ...(changes.get(c.id) || {}), ...set });
  }
}

// Renames must stay unique
const finalNames = new Map();
for (const m of MEALS) {
  const name = changes.get(m.id)?.name ?? m.name;
  if (finalNames.has(name)) errors.push(`Name "${name}" would be used by ids ${finalNames.get(name)} and ${m.id}`);
  finalNames.set(name, m.id);
}

// Coverage
const missingSatFat = MEALS.filter(m => m.satFat == null && changes.get(m.id)?.satFat == null);
const missingCuisine = MEALS.filter(m => !(changes.get(m.id)?.cuisine ?? CUISINE_MAP[m.name]));

console.log(`\n${changes.size} of ${MEALS.length} recipes have changes.`);
if (missingSatFat.length) warnings.push(`${missingSatFat.length} recipes still have no satFat (e.g. ids ${missingSatFat.slice(0, 8).map(m => m.id).join(", ")})`);
if (missingCuisine.length) warnings.push(`${missingCuisine.length} recipes still have no cuisine (e.g. ids ${missingCuisine.slice(0, 8).map(m => m.id).join(", ")})`);

if (warnings.length) console.log(`\nWarnings (${warnings.length}):\n  ` + warnings.join("\n  "));
if (flags.length) console.log(`\nFlags for you to decide (${flags.length}):\n  ` + flags.map(f => `id ${f.id}: ${f.note}`).join("\n  "));
if (errors.length) {
  console.log(`\nErrors (${errors.length}), nothing applied:\n  ` + errors.join("\n  "));
  process.exit(1);
}
if (mode === "check") {
  console.log("\nCheck passed. Run with --apply to update src/App.jsx.");
  process.exit(0);
}

// ── Apply: rewrite changed meal objects in place ─────────────────────────────
// Find each top-level { ... } in the MEALS array, skipping braces inside strings.
function objectSpans(text) {
  const spans = [];
  let depth = 0, inStr = null, start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "/" && text[i + 1] === "/") { i = text.indexOf("\n", i); if (i < 0) break; continue; }
    if (ch === "[" || ch === "{") {
      if (ch === "{" && depth === 1) start = i;
      depth++;
    } else if (ch === "]" || ch === "}") {
      depth--;
      if (ch === "}" && depth === 1) spans.push([start, i + 1]);
    }
  }
  return spans;
}

const SCALAR_ORDER = ["id", "name", "protein", "cal", "satFat", "time", "servings", "premium"];
function serialize(meal) {
  const keys = Object.keys(meal).filter(k => k !== "cuisine");
  const scalars = SCALAR_ORDER.filter(k => keys.includes(k));
  const rest = keys.filter(k => !SCALAR_ORDER.includes(k));
  const head = scalars.map(k => `${k}:${JSON.stringify(meal[k])}`).join(", ");
  const body = rest.map(k => `    ${k}:${JSON.stringify(meal[k])},`).join("\n");
  return `{ ${head},\n${body}\n  }`;
}

let mealsText = mealsBlock.text;
const spans = objectSpans(mealsText);
let rewritten = 0;
for (const [s, e] of spans.reverse()) {
  const objText = mealsText.slice(s, e);
  const id = Number(objText.match(/id:\s*(\d+)/)?.[1]);
  const set = changes.get(id);
  if (!set) continue;
  const { cuisine: _c, ...fields } = set;
  if (!Object.keys(fields).length) continue;
  const updated = { ...byId.get(id), ...fields };
  mealsText = mealsText.slice(0, s) + serialize(updated) + mealsText.slice(e);
  rewritten++;
}

// ── Apply: regenerate CUISINE_MAP from final names and cuisines ──────────────
const indent = cuisineBlock.text.match(/^[ \t]*/)[0];
const groups = Object.fromEntries(CUISINES.map(c => [c, []]));
for (const m of MEALS) {
  const set = changes.get(m.id) || {};
  const cuisine = set.cuisine ?? CUISINE_MAP[m.name];
  if (cuisine) groups[cuisine].push(set.name ?? m.name);
}
const LABELS = { american: "American", mexican: "Mexican/Latin", italian: "Italian", asian: "Asian",
  indian: "Indian", mediterranean: "Mediterranean", french: "French", middleeastern: "Middle Eastern" };
const mapBody = CUISINES.filter(c => groups[c].length).map(c =>
  `${indent}  // ${LABELS[c]}\n` + groups[c].map(n => `${indent}  ${JSON.stringify(n)}:${JSON.stringify(c)},`).join("\n")
).join("\n");
const newCuisineText = `${indent}const CUISINE_MAP={\n${mapBody}\n${indent}};`;

// Replace later block first so earlier offsets stay valid
src = src.slice(0, cuisineBlock.start) + newCuisineText + src.slice(cuisineBlock.end);
src = src.slice(0, mealsBlock.start) + mealsText + src.slice(mealsBlock.end);
fs.writeFileSync(appPath, src);

// Sanity check: re-read and confirm every change landed
const after = fs.readFileSync(appPath, "utf8");
const MEALS2 = Function(`${after.slice(after.search(/^const MEALS = \[/m)).match(/^const MEALS = \[[\s\S]*?\n\];/)[0]}; return MEALS;`)();
const MAP2 = Function(`${after.slice(after.search(/^[ \t]*const CUISINE_MAP=\{/m)).match(/^[ \t]*const CUISINE_MAP=\{[\s\S]*?\n[ \t]*\};/)[0]}; return CUISINE_MAP;`)();
let mismatches = 0;
for (const [id, set] of changes) {
  const m = MEALS2.find(x => x.id === id);
  for (const [k, v] of Object.entries(set)) {
    const actual = k === "cuisine" ? MAP2[m.name] : m[k];
    if (JSON.stringify(actual) !== JSON.stringify(v)) { mismatches++; console.log(`  mismatch id ${id} ${k}`); }
  }
}
console.log(`\nApplied: rewrote ${rewritten} recipes, cuisine map now covers ${Object.keys(MAP2).length} of ${MEALS2.length}.`);
console.log(mismatches ? `${mismatches} fields did not apply as expected; review with git diff.` : "All changes verified. Review with git diff, then build.");
