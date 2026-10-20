// Usage: node export-recipes.mjs <App.jsx> <outDir>
import fs from "node:fs";
import path from "node:path";

const [, , appPath, outDir] = process.argv;
const src = fs.readFileSync(appPath, "utf8");
const lines = src.split("\n");

// Grab a top-level literal starting at the line matching `startRe`, ending at the
// first line (after it) that matches `endRe`.
function grab(startRe, endRe) {
  const start = lines.findIndex(l => startRe.test(l));
  if (start < 0) throw new Error(`not found: ${startRe}`);
  let end = start + 1;
  while (!endRe.test(lines[end])) end++;
  return { start, end, text: lines.slice(start, end + 1).join("\n") };
}

const mealsBlock = grab(/^const MEALS = \[/, /^\];/);
const MEALS = Function(`${mealsBlock.text}; return MEALS;`)();

const cuisineBlock = grab(/^\s*const CUISINE_MAP=\{/, /^\s*\};/);
const CUISINE_MAP = Function(`${cuisineBlock.text}; return CUISINE_MAP;`)();

// Duplicate keys in CUISINE_MAP (JS keeps the last one silently)
const keyRe = /"([^"]+)":"([a-z]+)"/g;
const seen = {};
const cuisineDuplicates = [];
for (const m of cuisineBlock.text.matchAll(keyRe)) {
  const [, name, cuisine] = m;
  if (seen[name] !== undefined) cuisineDuplicates.push({ name, values: [seen[name], cuisine] });
  seen[name] = cuisine;
}

const recipes = MEALS.map(m => ({ ...m, cuisine: CUISINE_MAP[m.name] ?? null }));

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "recipes.json"),
  JSON.stringify(
    {
      exportedFrom: `src/App.jsx lines ${mealsBlock.start + 1}-${mealsBlock.end + 1} (MEALS) and CUISINE_MAP`,
      count: recipes.length,
      cuisineMapDuplicates: cuisineDuplicates,
      cuisineMapNamesWithNoRecipe: Object.keys(CUISINE_MAP).filter(n => !MEALS.some(m => m.name === n)),
      recipes,
    },
    null,
    2
  )
);

// Quick overview table
const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csv = [
  ["id", "name", "protein", "cuisine", "cal", "time", "servings", "ingredients", "steps", "detailed_steps", "desc"].join(","),
  ...recipes.map(r =>
    [r.id, esc(r.name), r.protein, r.cuisine ?? "", r.cal, r.time, r.servings,
     r.ingredients?.length ?? 0, r.recipe?.length ?? 0, r.recipe_detailed?.length ?? 0, esc(r.desc)].join(",")
  ),
].join("\n");
fs.writeFileSync(path.join(outDir, "recipes-overview.csv"), csv);

const fields = [...new Set(MEALS.flatMap(Object.keys))];
const ids = MEALS.map(m => m.id);
console.log(JSON.stringify({
  count: MEALS.length,
  fields,
  duplicateIds: ids.filter((id, i) => ids.indexOf(id) !== i),
  duplicateNames: MEALS.map(m => m.name).filter((n, i, a) => a.indexOf(n) !== i),
  missingCuisine: recipes.filter(r => !r.cuisine).length,
  cuisineDuplicates: cuisineDuplicates.length,
  proteins: [...new Set(MEALS.map(m => m.protein))],
}, null, 1));
