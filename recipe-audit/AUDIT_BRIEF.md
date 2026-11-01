# Forknight recipe audit brief

> **Scope: recipe content only.** Your only task is to review the recipe data in the uploaded
> batch files: ingredients, steps, calories, saturated fat, times, cuisines and tips. Do not review or comment
> on code, authentication, security, Supabase, the database or anything else about the app,
> even if earlier conversations or project files mention them.

Paste this brief into a new chat, then upload **one batch file at a time**:

| File | Proteins | Recipes |
|---|---|---|
| `batch-1-beef-pork.json` | beef, pork | 66 |
| `batch-2-chicken-seafood.json` | chicken, seafood | 66 |
| `batch-3-plant-based-breakfast.json` | plant-based, breakfast | 78 |

`recipes-overview.csv` is a one-line-per-recipe summary of all 210, useful for spotting
cross-batch problems (near-duplicate dishes, odd calorie/time values).

---

## Context

Forknight is a weekly dinner-planning app for couples and families. Each recipe below is
shown to users as a meal card. Users scale the servings and build a grocery list from the
ingredients. The recipes are hard-coded in the app, so every change you suggest will be
copied back into code.

## What each field means

| Field | Used for | Rules |
|---|---|---|
| `id` | Permanent ID, saved in users' plans | **Never change.** |
| `name` | Card title, and the key for cuisine lookup | Keep unique. Renaming is fine if needed, but call it out. |
| `protein` | Filter tab | One of: `beef`, `chicken`, `seafood`, `plant-based`, `pork`, `breakfast` |
| `cuisine` | Cuisine filter | One of: `american`, `mexican`, `italian`, `asian`, `indian`, `mediterranean`, `french`, `middleeastern`. `null` means the recipe is missing from the cuisine map and never shows up when a cuisine is selected. |
| `cal` | Calories **per serving** | Integer |
| `satFat` | Saturated fat in grams **per serving**, shown on the meal card | Integer. **New field, missing from every recipe; add it to all of them.** |
| `time` | Total minutes, active plus passive | Integer, realistic for a home cook |
| `servings` | Base serving count the ingredient amounts are written for | Integer |
| `desc` | One-line card subtitle | Must match what the recipe actually makes |
| `ingredients` | Shopping list and scaling | See **Ingredient format** below |
| `recipe` | Short steps (quick view) | Must agree with `ingredients` and `recipe_detailed` |
| `recipe_detailed` | Long steps (detailed view) | Same dish as `recipe`, not a different variation |
| `tip`, `tip2` | Cooking tips shown on the card | Should be specific to this dish, correct, and not repeat each other |
| `premium` | `true` means a paid-tier recipe | Don't change; just flag if it looks wrong |

### Ingredient format (important)

The app scales a quantity only when the string **starts with a number**:
`1.5 lb ground beef`, `1/2 cup rice`, `1 1/2 tbsp soy sauce`.
`Salt & pepper` or `Fresh basil` (no number) are fine; they just don't scale.
Don't write `One onion` or `a pinch of salt` for things that should scale. Prefer
`1 onion, diced`. Keep one ingredient per string.

## What to check, per recipe

1. **Internal consistency.** Every ingredient used in the steps appears in `ingredients`,
   and vice versa. `desc`, `recipe` and `recipe_detailed` describe the same dish.
   Example already spotted: *Skillet Beef & Broccoli* (id 1) lists "Cauliflower rice to serve"
   but the description and steps say jasmine rice.
2. **Quantities.** Amounts make sense for `servings` (for example, 1.5 lb of meat for 6 servings
   is light).
3. **Food safety.** Cooking temperatures and times are safe (poultry 165°F, ground meat 160°F,
   pork 145°F with rest, fish 145°F), and nothing advises unsafe handling.
4. **Calories and time.** `cal` per serving is plausible for the ingredients
   and portion. `time` includes marinating, simmering and resting when the steps require them.
5. **Saturated fat (every recipe).** Estimate `satFat` from the ingredient list divided by
   `servings`, using standard nutrition values (USDA-style). Round to the nearest whole gram.
   Butter, cheese, cream, coconut milk, fatty cuts and skin-on poultry are the big
   contributors. It's an estimate, so be consistent across recipes rather than exact. If
   `cal` looks inconsistent with the same ingredients, fix or flag it too.
6. **Classification.** `protein` is right, and `cuisine` is filled in and accurate.
7. **Writing.** Typos, unclear steps, inconsistent units (`425F` vs `425°F`), missing oven
   temperatures, and steps that reference something never prepped.
8. **Duplicates.** Recipes that are effectively the same dish as another one.

Already known, from the export itself (`recipes.json`):

- **57 recipes have no cuisine (`cuisine: null`).** Please assign one.
- **Three names are listed twice in the cuisine map with different values.** The app currently uses the second value:

  | Recipe | First value | Second value (used now) |
  |---|---|---|
  | Chicken Parmesan | american | italian |
  | Chicken Fried Rice | american | asian |
  | Lentil Bolognese | italian | mediterranean |

  Say which value is correct for each.

## Output format

For each batch, reply with two things.

**1. A short findings summary.** Group it by severity:

- **Safety:** anything that could make someone sick.
- **Wrong:** the recipe doesn't work as written.
- **Inconsistent:** fields disagree with each other.
- **Polish:** typos, wording, units.

**2. A JSON code block of changes**, containing only the fields that change:

```json
{
  "batch": 1,
  "changes": [
    {
      "id": 1,
      "reason": "Ingredients said cauliflower rice; desc and steps say jasmine rice",
      "set": {
        "ingredients": ["1.5 lb beef sirloin, thinly sliced", "...full new array..."],
        "satFat": 5
      }
    },
    {
      "id": 2,
      "reason": "Missing cuisine; added sat fat",
      "set": { "cuisine": "mexican", "satFat": 7 }
    }
  ],
  "flags": [
    { "id": 7, "note": "Looks nearly identical to id 45; consider removing one" }
  ]
}
```

Rules for the changes block:

- When changing an array field (`ingredients`, `recipe`, `recipe_detailed`), give the **whole
  new array**, not a diff.
- **Every recipe in the batch needs an entry with at least `satFat`**, even if nothing
  else changes. A batch with 66 recipes should have 66 entries in `changes`.
- Never include `id` inside `set`, and never change `premium`.
- If the JSON is too long for one reply, split it into parts (`"part": 1`, `"part": 2`, ...)
  and keep each part valid JSON on its own.
- Put judgment calls that need a human decision in `flags`, not in `changes`.
- Keep the voice of the existing tips and steps: friendly, direct, practical.

## Bringing the results back (for you, not the auditing chat)

1. Copy each batch's JSON block into a file in this `recipe-audit` folder:
   `changes-batch-1.json`, `changes-batch-2.json`, `changes-batch-3.json`.
   If a batch came back in parts, save them as `changes-batch-1-part-1.json` and so on.
2. Check that the files are valid and complete, without changing anything:
   ```bash
   node recipe-audit/apply-changes.mjs --check
   ```
   This lists any problems (unknown ids, bad cuisine or protein values, missing `satFat`,
   ingredients that won't scale) and how many recipes each file covers.
3. Apply them, either by asking Claude Code to "apply the recipe audit changes" or yourself:
   ```bash
   node recipe-audit/apply-changes.mjs --apply
   ```
   This edits `src/App.jsx` (recipes and the cuisine map) and prints a summary. Review it
   with `git diff`, then build and deploy as usual. `git checkout src/App.jsx` undoes it.
4. Read the `flags` from each batch yourself. They're decisions the script doesn't make.
