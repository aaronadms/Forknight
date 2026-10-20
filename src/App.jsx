import { useState, useMemo, useEffect, useRef, createContext, useContext } from "react";
import { createPortal } from "react-dom";

// ── Theme ─────────────────────────────────────────────────────────────────────
const THEME_KEY="forknight_theme";
const THEMES={
  light:{
    bg:"#EDEEE8",        // page background - slightly darker, green-tinted
    card:"#F8F9F3",      // card surface - warm white with slight green tint
    cardAlt:"#F8F8F3",   // alternate card / subtle surface
    border:"#E2E2DC",    // dividers
    text:"#1A1A1A",      // primary text
    textSub:"#555555",   // secondary body text
    muted:"#888888",     // labels, placeholders
    mutedBg:"#D0D0C8",   // inactive dots, slider track
    accent:"#FF6B35",    // orange CTA
    accentTint:"#FFF0EB",// tinted accent surface
    leftover:"#F4F5EF",  // leftover row bg - lighter than bg for contrast
    green:"#5A7A5A",     // success / leftovers active - desaturated
    greenTint:"#EAF3EA", // green tinted surface
    error:"#E05050",     // error text
    errorTint:"#FFF5F5", // error tinted surface
    star:"#C9A84C",      // star/gold
    daypast:"#AAAAAA",   // past day chip
    subtle:"#EEEEE8",    // chip / pill bg
    chipText:"#555555",  // chip text
    overlay:"rgba(0,0,0,0.45)", // modal backdrop
    cancelBtn:"#E8E8E0", // cancel button bg
    inputBorder:"#E2E2DC",
    sage:"#A8BEA8",      // sage green - today card border (lighter/softer in light mode)
    alona:"#C0785A",
    aaron:"#5A8FAA",
  },
  dark:{
    bg:"#0D0D0B",        // true OLED black
    card:"#1A1A18",      // elevated surface (just visible on OLED)
    cardAlt:"#222220",   // more elevated surface
    border:"#2C2C2A",    // subtle divider
    text:"#E8E8E2",      // primary text (slightly warm white)
    textSub:"#9A9A94",   // secondary body text
    muted:"#606060",     // labels, placeholders
    mutedBg:"#2E2E2C",   // inactive dots, slider track
    accent:"#FF6B35",    // orange - stays same
    accentTint:"#2A1608",// dark tinted accent surface (very subtle)
    leftover:"#161614",  // leftover row bg
    green:"#5A8F5A",     // success - desaturated
    greenTint:"#0D2010", // very dark green tint
    error:"#E05050",     // error text
    errorTint:"#200A0A", // dark error tint
    star:"#C9A84C",      // star
    daypast:"#444440",   // past day chip (dark, not white)
    subtle:"#222220",    // chip / pill bg
    chipText:"#9A9A94",  // chip text
    overlay:"rgba(0,0,0,0.72)", // darker overlay for OLED
    cancelBtn:"#2A2A28", // cancel button bg
    inputBorder:"#2C2C2A",
    sage:"#5A7A5A",      // sage green - today card border (desaturated for dark)
    alona:"#C0785A",
    aaron:"#5A8FAA",
  },
};
function getSystemTheme(){ return window.matchMedia?.("(prefers-color-scheme: dark)").matches?"dark":"light"; }
function getEffectiveTheme(pref){ return pref==="system"?getSystemTheme():(pref||"light"); }
const ThemeCtx=createContext(THEMES.light);
const useC=()=>useContext(ThemeCtx);

// ── Premium context ───────────────────────────────────────────────────────────
const PremiumCtx=createContext({isPremium:true,showPremiumUi:false,tier:"free"});
const usePremium=()=>useContext(PremiumCtx);
import { supabase } from "./supabaseClient.js";
import {
  Utensils, Beef, Bird, Fish, Leaf, Shuffle, RefreshCw, Pencil, RotateCcw,
  ChefHat, ShoppingCart, Share2, MessageCircle, Link2, Check,
  X, Clock, Users, ArrowLeftRight, Flame,
  BookOpen, CloudOff, Loader2, Save, Upload, ChevronDown,
  CalendarDays, StickyNote, UtensilsCrossed, Soup, Search, Star, User,
  LogOut, Trash2, UserMinus, Timer, Ham, SortDesc, Moon, Sun, SunMoon, Egg, WifiOff
} from "lucide-react";

// ── Favorites & usage tracking (localStorage, persists across sessions) ────────
const RATING_KEY="forknight_ratings";  // Map of meal id -> rating 1-5
const getUseKey=(householdId)=>`forknight_usage_${householdId||"local"}`;

function loadRatings(){ try{ const r=JSON.parse(localStorage.getItem(RATING_KEY)||"{}"); const n={};Object.entries(r).forEach(([k,v])=>{n[Number(k)]=Number(v);});return n; }catch{ return {}; } }
function saveRatings(m){ try{ localStorage.setItem(RATING_KEY,JSON.stringify(m)); }catch{} }
function loadUsage(householdId){ try{ return JSON.parse(localStorage.getItem(getUseKey(householdId))||"{}"); }catch{ return {}; } }
function saveUsage(m,householdId){ try{ localStorage.setItem(getUseKey(householdId),JSON.stringify(m)); }catch{} }
function recordUsage(mealId,householdId){
  const u=loadUsage(householdId); u[mealId]=(u[mealId]||0)+1; saveUsage(u,householdId);
}
function setRating(mealId, stars){
  const m=loadRatings();
  if(stars===0||stars===m[mealId]) delete m[mealId]; else m[mealId]=stars;
  saveRatings(m); return m;
}


const DAY_COOK = {
  Sunday:"Alona", Monday:"Alona", Tuesday:"Alona",
  Wednesday:"Alona", Thursday:"Aaron", Friday:"Aaron", Saturday:"Alona",
};

// C is accessed via useC() in components, or falls back to light theme for module-level functions
const C = THEMES.light; // module-level fallback for non-component usage

const PROTEIN_META = {
  all:          { Icon: Utensils,       label:"All" },
  beef:         { Icon: Beef,           label:"Beef" },
  chicken:      { Icon: Bird,           label:"Chicken" },
  seafood:      { Icon: Fish,           label:"Seafood" },
  pork:         { Icon: Ham,            label:"Pork" },
  "plant-based":{ Icon: Leaf,           label:"Meatless" },
  breakfast:    { Icon: Egg,            label:"Breakfast" },
};
const PROTEINS = Object.keys(PROTEIN_META);
// DAYS: canonical 7-day name array , used only for cookAssignment/schedule (day-of-week)
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
// WINDOW_DATES: the 7 ISO dates for each week , used for plan data keys
// Generated fresh each render via getWindowDates(weekOffset)

// ── Fraction-aware recipe scaler ─────────────────────────────────────────────
const FRAC_MAP={0.25:"1/4",0.333:"1/3",0.5:"1/2",0.667:"2/3",0.75:"3/4",0.125:"1/8",0.375:"3/8",0.625:"5/8",0.875:"7/8"};
function toFrac(n){
  const whole=Math.floor(n),rem=Math.round((n-whole)*1000)/1000;
  if(rem===0)return String(whole);
  const f=FRAC_MAP[Math.round(rem*1000)/1000];
  if(f)return whole>0?`${whole} ${f}`:f;
  return parseFloat(n.toFixed(1)).toString();
}
function parseQty(str){
  const m=str.match(/^(\d+)\s+(\d+)\/(\d+)|^(\d+)\/(\d+)|^(\d*\.?\d+)/);
  if(!m)return null;
  if(m[1]!==undefined)return{val:parseInt(m[1])+parseInt(m[2])/parseInt(m[3]),len:m[0].length};
  if(m[4]!==undefined)return{val:parseInt(m[4])/parseInt(m[5]),len:m[0].length};
  if(m[6]!==undefined)return{val:parseFloat(m[6]),len:m[0].length};
  return null;
}
function scaleIngredient(ing, factor){
  if(Math.abs(factor-1)<0.01)return ing; // no-op for 1x
  const p=parseQty(ing.trim());
  if(!p)return ing;
  const scaled=p.val*factor;
  const rest=ing.slice(p.len);
  // Whole proteins and eggs must be whole numbers , round up
  const isWholeUnit=/\b(egg|chicken|drumstick|thigh|breast|chop|steak|cutlet|fillet|filet|rack|rib|wing|leg|shank)s?\b/i.test(rest);
  const final=isWholeUnit?Math.ceil(scaled):scaled;
  return toFrac(final)+rest;
}
// Legacy 2x helpers kept for compatibility
function doubleIngredient(ing){return scaleIngredient(ing,2);}
function doubleIngredients(ings){return ings.map(doubleIngredient);}
function scaleIngredients(ings,factor){return ings.map(i=>scaleIngredient(i,factor));}
function scaleStep(step,factor){
  if(Math.abs(factor-1)<0.01)return step;
  return step.replace(/\b(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)(?=\s*(cup|tbsp|tsp|lb|oz|qt|pint|gallon|clove|stick|piece|slice|pound|ounce|quart|can|jar|bag))/gi,(m)=>{
    const p=parseQty(m);return p?toFrac(p.val*factor):m;
  });
}

// All meals can be leftovers; meals serving <6 get their recipe doubled
function canBeLeftover(meal){return !!meal;}
function needsDoubling(meal){return meal&&!meal.isCustom&&meal.servings<6;}

const MEALS = [
  // ── BEEF ──────────────────────────────────────────────────────────────────
  { id:1,  name:"Skillet Beef & Broccoli",       protein:"beef",        cal:480, time:15, servings:6,
    desc:"Beef strips, crisp broccoli, garlic-ginger sauce over steamed jasmine rice",
    ingredients:["1.5 lb beef sirloin, thinly sliced","4 cups broccoli florets","4 cloves garlic, minced","1 tbsp fresh ginger","4 tbsp low-sodium soy sauce","1.5 tbsp sesame oil","1 tbsp cornstarch","3 tbsp olive oil","Cauliflower rice to serve"],
    recipe:["Toss beef with cornstarch, soy sauce, sesame oil. Marinate 5 min.","Heat oil in large skillet on high. Sear beef 2-3 min. Remove.","Add broccoli, garlic, ginger. Stir fry 3 min.","Return beef, toss 1 min. Serve over steamed jasmine rice."],
    tip:"Slice the beef paper-thin against the grain and freeze for 15 minutes first - it cuts much easier and stays tender under high heat.",
    tip2:"The key to stir-fry is not moving things. Let the beef sit untouched for 60 seconds before tossing — that contact with the hot pan builds the caramelized crust.",
    recipe_detailed:["If the beef isn't already sliced, place it in the freezer for 15 min — it firms up and slices much thinner. Cut across the grain (perpendicular to the muscle fibers) into strips about ¼-inch thick. Thin slices mean fast searing and tender results.","In a bowl, toss the beef with cornstarch, soy sauce, and sesame oil. The cornstarch forms a light crust and helps thicken the sauce later. Let it sit 5 min while you prep everything else.","Heat a large skillet or wok over high heat until very hot — a drop of water should evaporate immediately. Add oil, then the beef in a single layer. Don't crowd the pan or it steams instead of sears. Cook 60 seconds without touching, then toss once more for 30 seconds. Remove to a plate — it'll finish cooking when you return it.","Add broccoli, garlic, and ginger to the same pan. Stir fry 3 min — the broccoli should be bright green and just tender but still have a snap.","Return the beef to the pan and add any sauce. Toss everything together for 1 min until the sauce thickens and coats the beef. Serve immediately over steamed jasmine rice."]},
  { id:2,  name:"Taco Bowl",                     protein:"beef",        cal:520, time:15, servings:6,
    desc:"Seasoned ground beef, black beans, pico, avocado, romaine",
    ingredients:["1.5 lb ground beef (90/10)","2 cans black beans, drained","1.5 cups pico de gallo","3 avocados, sliced","6 cups romaine, chopped","1.5 tbsp taco seasoning","Lime wedges"],
    recipe:["Brown ground beef, drain fat.","Add taco seasoning + 2 tbsp water, stir 1 min.","Divide romaine into bowls. Add beef, beans, pico, avocado.","Squeeze fresh lime over everything."],
    tip:"Toast the taco seasoning in a dry pan for 30 seconds before adding meat. The heat blooms the spices and deepens the flavor significantly.",
    tip2:"Let the beef sit in the pan undisturbed for 30 seconds at a time — you want a browned crust, not steamed grey meat. Crowded pan means no crust.",
    recipe_detailed:["Heat oil in a large skillet over medium-high. Add onion and cook 3 min until softened. Add ground beef, breaking it into small pieces. Cook 6-8 min without stirring too often — you want browning, not grey crumbles.","Drain off excess fat, leaving a thin film. Add taco seasoning and a splash of water, stir to coat. Cook 1-2 min until the water evaporates and the spices cling to the meat.","Warm the rice and build bowls: rice first, then beef, then toppings. For guac, mash avocado with lime juice and salt — taste as you go, it should be bright and a little salty.","Top each bowl with salsa, sour cream, shredded cheese, and a squeeze of lime. Eat while the beef is hot."]},
  { id:4,  name:"Sheet Pan Flank Steak",          protein:"beef",        cal:390, time:20, servings:6,
    desc:"Marinated flank steak, roasted asparagus, lemon",
    ingredients:["2 lb flank steak","2 bunches asparagus, trimmed","4 tbsp olive oil","5 cloves garlic, minced","2 lemons, zested and juiced","1.5 tsp smoked paprika","Salt & pepper"],
    recipe:["Preheat oven to 425°F. Mix oil, garlic, lemon zest, paprika.","Coat steak and asparagus. Place on sheet pan.","Roast 12-15 min for medium-rare. Rest steak 5 min.","Slice and serve with asparagus and lemon juice."],
    tip:"Let the steak rest at room temperature 20 minutes before cooking. Cold meat seizes up and cooks unevenly. Resting after is equally important - don't skip it.",
    tip2:"Slice across the grain — look for the direction the muscle fibers run, then cut perpendicular to them. Cutting with the grain gives you chewy, stringy steak. Against it: tender every time.",
    recipe_detailed:["Preheat oven to 425F and line a sheet pan with foil. Pat the flank steak dry with paper towels — moisture prevents browning. Season all sides generously with salt, pepper, and any rub.","Toss vegetables in oil, salt, and pepper and spread on one side of the pan. Place the steak on the other side.","Roast 10-14 min depending on thickness. For medium-rare, pull it when a meat thermometer reads 130F — it will climb to 135F as it rests. Flank steak goes from perfect to tough quickly, so check early.","Rest the steak on a cutting board for at least 5 min before cutting. Slice thin against the grain and fan over the roasted vegetables."]},
  { id:7,  name:"Zucchini Noodle Bolognese",      protein:"beef",        cal:560, time:20, servings:6,
    desc:"Rich meat sauce over spiralized zucchini",
    ingredients:["1.5 lb ground beef","5 medium zucchini, spiralized","1 can crushed tomatoes","1 onion, diced","4 cloves garlic","1 tsp Italian seasoning","Fresh basil","Parmesan to serve"],
    recipe:["Sauté onion 3 min. Add garlic 1 min.","Add beef, brown fully. Drain fat.","Add tomatoes and seasoning. Simmer 10 min.","Sauté zucchini noodles 2 min. Top with sauce, basil, parmesan."],
    tip:"Add a parmesan rind to the tomato sauce while it simmers. Remove before serving - it adds a savory depth you can't get any other way.",
    tip2:"Zucchini noodles release a lot of water as they cook. Toss them in the hot sauce for no more than 2 min — any longer and your sauce turns into soup.",
    recipe_detailed:["Heat oil in a large skillet over medium-high. Add onion, carrot, and celery and cook 5-7 min until softened. Add garlic, cook 1 min.","Add ground beef and cook 6-8 min, breaking into fine crumbles, until browned with no pink remaining. Drain excess fat — leave a thin layer for flavor.","Pour in crushed tomatoes, tomato paste, and herbs. Stir well, reduce heat to low, and simmer 20-25 min uncovered. The sauce should thicken and deepen in color.","Spiralize the zucchini into noodles. Add them to the sauce and toss gently for 1-2 min — just until warmed through. Season and serve immediately topped with Parmesan."]},
  { id:10, name:"Korean Beef Bowl",             protein:"beef",        cal:520, time:25, servings:6,
    desc:"Tender strips of Mongolian-style beef in a sweet-savory soy-ginger glaze over jasmine rice with green onions",
    ingredients:["1.5 lb flank steak, thinly sliced against the grain","0.25 cup cornstarch","0.5 cup low-sodium soy sauce","0.5 cup brown sugar","1 tbsp hoisin sauce","4 cloves garlic, minced","1 tbsp fresh ginger, grated","0.25 tsp red pepper flakes","0.25 cup vegetable oil","3 cups jasmine rice, cooked","4 green onions, sliced","Sesame seeds"],
    recipe:["Toss sliced flank steak with cornstarch to coat. Shake off excess.","Whisk soy sauce, brown sugar, hoisin, garlic, ginger, and red pepper flakes together.","Heat oil in wok over high heat. Sear beef in batches 1-2 min per side until caramelized. Remove and drain oil.","Return beef to pan, pour sauce over, toss 1-2 min until thickened and glossy.","Serve over jasmine rice topped with green onions and sesame seeds."],
    tip:"Slice flank steak partially frozen for ultra-thin strips. High heat in batches gives caramelized beef, not steamed.",
    tip2:"Sear in batches — never more than a single layer of beef in the pan. Crowding drops the pan temperature and the beef steams grey instead of caramelizing.",
    recipe_detailed:["Slice the flank steak as thin as possible against the grain. If it is hard to slice thin, freeze for 20 min first — it firms up and cuts cleanly.","Toss sliced beef with cornstarch to coat lightly. This helps it caramelize and thickens the sauce later. Shake off any excess.","Whisk together soy sauce, brown sugar, hoisin, garlic, ginger, and red pepper flakes. Taste — it should be salty-sweet with a little heat.","Heat oil in a wok or large skillet over the highest heat your stove has. Add beef in a single layer, sear 60 seconds, toss briefly and cook 30 more seconds. Remove and repeat with remaining beef. Return all beef, pour sauce over, toss 1-2 min until glossy and thickened. Serve over jasmine rice with green onions and sesame seeds."]},

  { id:43, name:"Egg Roll in a Bowl",             protein:"beef",        cal:360, time:12, servings:6,
    desc:"Ground beef, coleslaw mix, soy-ginger sauce",
    ingredients:["1.5 lb ground beef","2 bags (14 oz each) coleslaw mix","4 tbsp low-sodium soy sauce","1.5 tbsp sesame oil","1.5 tbsp fresh ginger","4 cloves garlic","3 green onions","Sriracha to taste"],
    recipe:["Brown beef in large skillet. Drain.","Add garlic and ginger, cook 1 min.","Add coleslaw mix, stir fry 3-4 min.","Add soy sauce and sesame oil. Toss. Top with green onion."],
    tip:"Press the coleslaw mix gently with a paper towel before adding it to the pan to remove excess moisture. Drier cabbage browns better and soaks up the sauce.",
    tip2:"The coleslaw mix finishes cooking in about 3 min — you want it wilted but still with a little bite, not completely collapsed. Taste a strand before pulling it off the heat.",
    recipe_detailed:["Heat oil in a large skillet or wok over medium-high. Add garlic and ginger and stir 30 seconds until fragrant. Add ground beef and cook 6 min, breaking into crumbles, until browned.","Drain excess fat, leaving a thin layer. Push the beef to the sides. Add the coleslaw mix to the center and stir fry 2-3 min until just wilted but still slightly crisp.","Mix in soy sauce, sesame oil, and rice vinegar. Toss everything together and cook 1 more minute. Taste and adjust seasoning.","Serve topped with sliced green onions, sriracha, and a drizzle of sesame oil. Optionally top with a fried egg."]},
  { id:51, name:"Beef & Cabbage Stir Fry",        protein:"beef",        cal:380, time:12, servings:6,
    desc:"Ground beef, shredded cabbage, soy-ginger sauce",
    ingredients:["1.5 lb ground beef","6 cups shredded cabbage","4 tbsp low-sodium soy sauce","1.5 tbsp fresh ginger","3 cloves garlic","1.5 tsp sesame oil","Green onions","Sesame seeds"],
    recipe:["Brown beef in large skillet. Drain.","Add garlic and ginger, stir 1 min.","Add cabbage, cook 3-4 min until slightly wilted.","Add soy sauce and sesame oil. Top with green onion and sesame seeds."],
    tip:"Add a splash of rice vinegar right at the end of cooking. The acidity cuts through the richness and brightens everything without tasting sour.",
    tip2:"Add the cabbage in batches if your pan is small — let each batch wilt slightly before adding more. Trying to fit it all at once drops the pan temp and it steams instead of stir fries.",
    recipe_detailed:["Slice beef thin against the grain. Toss with soy sauce and a pinch of cornstarch. Set aside while you prep everything else — stir fry moves fast.","Heat a wok or large skillet over high heat until smoking. Add oil, then beef in a single layer. Sear 60 seconds without touching, then toss for 30 seconds. Remove to a plate.","In the same pan add garlic and ginger and stir 30 seconds. Add cabbage and stir fry 3-4 min until wilted and edges begin to char slightly.","Return beef to the pan. Add sauce, toss everything together for 1 min until coated. Serve over rice with a drizzle of sesame oil."]},
  { id:60, name:"Campechano Street Tacos",        protein:"beef",        cal:410, time:25, servings:6,
    desc:"Grilled carne asada + chorizo blend, corn tortillas, onion, cilantro, salsa verde",
    ingredients:["1 lb skirt steak","1/2 lb Mexican chorizo","12 small corn tortillas","1 white onion, finely diced","1 bunch fresh cilantro, chopped","2 limes, cut in wedges","1 cup salsa verde","1 tsp cumin","Salt","Olive oil"],
    recipe:["Season skirt steak with cumin and salt. Grill or sear on cast iron 3-4 min per side.","Cook chorizo in a separate skillet, breaking up, 5 min. Drain excess fat.","Rest steak 3 min, then chop into small pieces. Mix with chorizo.","Warm tortillas on the grill or dry skillet. Double up each taco.","Fill with meat blend. Top with onion, cilantro, squeeze of lime, salsa verde."],
    tip:"For campechano, the chorizo fat is the sauce. Don't drain it - mix the chopped steak directly into the chorizo drippings so the meat absorbs every bit of flavor.",
    tip2:"Double up your tortillas — street tacos always use two corn tortillas per taco. Warm them directly on a gas burner or in a dry skillet until charred in spots. The char is flavor.",
    recipe_detailed:["If using steak, slice thin against the grain and season generously with salt, pepper, and cumin. If using chorizo, remove from casing and crumble.","Heat a cast iron or heavy skillet over high heat until very hot. Add a thin film of oil. Cook steak in batches 1-2 min per side for medium, or cook chorizo until crispy and rendered.","Warm tortillas directly over a gas flame for 20 seconds per side, or in a dry skillet. Stack two per taco and fill with the hot meat.","Top immediately with diced white onion, fresh cilantro, a squeeze of lime, and salsa. Eat while hot — corn tortillas toughen as they cool."]},
  { id:61, name:"Meatloaf & Roasted Veggies",     protein:"beef",        cal:430, time:60, servings:6,
    desc:"Classic meatloaf with ketchup glaze, roasted green beans and carrots",
    ingredients:["2 lb ground beef (80/20)","1/2 cup almond flour or breadcrumbs","2 eggs","1/3 cup milk","1 small onion, grated","3 cloves garlic, minced","2 tbsp Worcestershire sauce","1 tsp Italian seasoning","Salt & pepper","For glaze: 3 tbsp ketchup, 1 tbsp brown sugar, 1 tsp mustard","2 cups green beans","2 cups carrots, sliced","Olive oil"],
    recipe:["Preheat oven to 375°F. Mix beef, flour, eggs, milk, onion, garlic, Worcestershire, seasoning.","Form into loaf on a parchment-lined pan.","Mix ketchup, brown sugar, mustard. Spread over top.","Roast vegetables alongside with olive oil and salt.","Bake 50-55 min until internal temp reaches 160°F. Rest 10 min before slicing."],
    tip:"Mix the meatloaf by hand just until combined. Overworking develops the gluten in the binders and results in a dense, tough loaf instead of a tender one.",
    tip2:"Don't overmix the meatloaf. Mix just until everything is combined — overworking the meat makes it dense and tough. Use your hands and stop as soon as no dry spots remain.",
    recipe_detailed:["Preheat oven to 375F. In a large bowl, mix ground beef, onion, garlic, egg, breadcrumbs, Worcestershire, salt, and pepper. Use your hands and mix only until just combined.","Shape into a loaf on a foil-lined baking sheet. Mix ketchup with a little brown sugar and brush half over the top.","Toss vegetables with oil, salt, and pepper and spread around the loaf.","Bake 45-55 min. At 30 min, brush on the rest of the glaze. The meatloaf is done when an instant-read thermometer reads 160F in the center. Let it rest 10 min before slicing."]},
  { id:62, name:"Smash Burgers",                  protein:"beef",        cal:380, time:20, servings:6,
    desc:"Crispy-edged smashed beef patties, melted cheese, lettuce wrap or bun",
    ingredients:["1.5 lb ground beef (80/20), formed into 6 loose balls","6 slices American or cheddar cheese","1 head butter lettuce (or 6 buns)","1 tomato, sliced","Pickles","Mustard, ketchup, mayo","Salt & pepper"],
    recipe:["Heat cast iron skillet or griddle over high heat until very hot.","Place beef ball on skillet. Immediately smash flat with spatula. Season with salt and pepper.","Cook 2-3 min until edges are crispy and brown. Flip.","Add cheese immediately. Cook 1 more min.","Serve in lettuce wraps or buns with sliced tomato, pickles, and your choice of mustard, ketchup, or mayo."],
    tip:"Use 80/20 beef for smash burgers - not leaner. The fat is what creates the lacy, crispy edges when smashed against a screaming hot surface. Leaner beef won't do this.",
    tip2:"Use an 80/20 beef blend — the fat is essential. Leaner beef makes a dry, crumbly smash burger. The fat renders into the patty as it cooks and that is where the flavor lives.",
    recipe_detailed:["Divide the ground beef into loose, rough balls — do not pack them tightly. About 3-4 oz each. Keep them cold until ready to cook.","Heat a cast iron skillet or griddle over the highest heat possible for 3-5 min until screaming hot. Add a thin layer of oil or butter.","Place a beef ball on the hot surface and immediately smash it flat with a spatula. Press hard — you want it thin, maybe a quarter inch. Season the top with salt and pepper.","Cook 2-3 min undisturbed until the edges look brown and lacy and the top is no longer pink. Flip once, add cheese immediately, and cook 30-60 more seconds. Build the burger on a toasted bun and serve immediately."]},
  { id:63, name:"Smoked Ribs",                    protein:"beef",        cal:400, time:300, servings:6,
    desc:"Slow-smoked baby back ribs with dry rub, served with coleslaw",
    ingredients:["2 racks baby back ribs","2 tbsp smoked paprika","1 tbsp garlic powder","1 tbsp onion powder","1 tbsp brown sugar","1 tsp cayenne","1 tsp black pepper","1 tbsp salt","Your favorite BBQ sauce","4 cups coleslaw mix","2 tbsp apple cider vinegar","Olive oil"],
    recipe:["Mix all dry rub spices. Remove membrane from back of ribs. Coat generously with rub.","Smoke at 225°F for 4-5 hours (or bake wrapped in foil at 275°F for 3 hours).","Unwrap last 30 min and brush with BBQ sauce.","Rest 10 min before cutting into individual ribs.","Toss coleslaw with vinegar, olive oil, salt. Serve alongside."],
    tip:"The membrane on the back of the ribs must come off. Slide a butter knife under the corner, grab with a paper towel, and pull in one motion. It keeps the ribs from getting tough.",
    tip2:"The 3-2-1 method: 3 hours smoke unwrapped, 2 hours wrapped in foil, 1 hour unwrapped with sauce to set the bark. The foil phase is what separates fall-off-bone from chewy.",
    recipe_detailed:["Remove the membrane from the back of the ribs by sliding a butter knife under it and pulling with a paper towel for grip. This lets smoke and seasoning penetrate both sides.","Rub all surfaces generously with your seasoning blend. Let sit at room temperature 30 min, or refrigerate overnight for deeper flavor.","Set up your grill or smoker for indirect heat at 225-250F. Add wood chips. Place ribs bone-side down and smoke 3 hours.","Wrap tightly in foil with a splash of apple juice or butter inside. Cook wrapped 2 hours. Unwrap, brush with sauce, and cook 1 hour more. Ribs are done when the meat pulls back from the bone ends and a toothpick slides in with no resistance."]},
  // ── CHICKEN ───────────────────────────────────────────────────────────────
  { id:11, name:"Lemon Herb Chicken Thighs",     protein:"chicken",     cal:510, time:20, servings:6,
    desc:"Juicy bone-in thighs, roasted lemon, fresh herbs",
    ingredients:["6 bone-in chicken thighs","2 lemons, sliced","5 cloves garlic","3 tbsp olive oil","1 tsp rosemary","1 tsp thyme","Salt & pepper","Mixed greens to serve"],
    recipe:["Preheat oven to 425°F. Season chicken with rosemary, thyme, salt, and pepper.","Sear thighs skin-down 4 min until golden. Flip.","Add lemon slices and garlic. Roast 12-14 min.","Rest 3 min. Serve with mixed greens."],
    tip:"Score the skin lightly with a sharp knife before searing. It renders the fat more evenly and gives you cracklier skin without curling.",
    tip2:"Bone-in, skin-on thighs are much more forgiving than breasts — done between 165-185F and the fat keeps them moist even if you run a few minutes long. Internal temp is your best guide.",
    recipe_detailed:["Pat chicken thighs completely dry with paper towels on all sides — dry skin crisps, wet skin steams. Season generously with salt, pepper, and herbs on both sides.","Heat an oven-safe skillet over medium-high heat. Add oil. Place thighs skin-side down and don't touch them for 7-8 min. They release when the skin is golden and crispy. Flip and cook 2 min on the other side.","Add garlic, lemon slices, and herbs to the pan. Transfer to a 400F oven and roast 18-22 min until a thermometer in the thickest part reads 165F.","Let rest 5 min before serving. Spoon the pan juices over the chicken — they are the sauce."]},
  { id:12, name:"Chicken Fajita Bowls",          protein:"chicken",     cal:420, time:15, servings:6,
    desc:"Sizzled chicken strips, peppers & onions, avocado, lime crema",
    ingredients:["2 lb chicken breast, sliced","3 bell peppers, sliced","2 onions, sliced","3 avocados","3/4 cup Greek yogurt","2 limes","3 tbsp fajita seasoning","Olive oil"],
    recipe:["Season chicken with fajita seasoning.","Sear chicken 6-7 min. Set aside.","Cook peppers and onion 5 min until charred.","Mix yogurt with lime for crema. Build bowls."],
    tip:"Don't move the chicken for the first 4 minutes. It will release naturally when the crust is ready - forcing it tears the skin and loses the sear.",
    tip2:"Resting the chicken after cooking is what keeps it juicy. Cut too soon and all the juices run onto your cutting board instead of staying in the meat.",
    recipe_detailed:["Slice chicken into strips and toss with fajita seasoning, oil, and lime juice. If you have time, marinate 15-30 min.","Heat a large cast iron skillet over high heat until very hot. Add chicken in a single layer — do not stir for 2 min, let it get a char on one side. Flip and cook 2 more min. Remove to a plate and rest.","In the same pan, add a little more oil and cook sliced peppers and onions over high heat 4-5 min until charred in spots, not just softened.","Slice the rested chicken and add back to the pepper mixture. Toss briefly. Serve over rice or in bowls with guac, sour cream, salsa, and warm tortillas."]},
  { id:14, name:"Chicken & Veggie Sheet Pan",    protein:"chicken",     cal:530, time:25, servings:6,
    desc:"Chicken thighs, broccoli, bell pepper, garlic, paprika",
    ingredients:["6 boneless chicken thighs","4 cups broccoli florets","3 bell peppers, chopped","4 tbsp olive oil","1 tsp garlic powder","1 tsp onion powder","1 tsp paprika","Salt & pepper"],
    recipe:["Preheat oven to 425°F. Toss everything with oil and spices.","Arrange in single layer on sheet pan.","Roast 20-22 min, flipping veggies halfway.","Chicken should hit 165°F internal."],
    tip:"Dry the chicken thighs completely with paper towels before seasoning. Surface moisture is the enemy of browning.",
    tip2:"Denser vegetables like carrots and potatoes take longer than chicken. Give them a 10-min head start, or cut them smaller than softer veg so everything finishes at the same time.",
    recipe_detailed:["Preheat oven to 425F. Line a large sheet pan with foil. Pat chicken dry and season with salt, pepper, and your seasoning blend.","Cut denser vegetables smaller than quick-cooking ones. Toss all vegetables in oil, salt, and pepper so each piece is lightly coated.","Spread vegetables on the pan in a single layer with space between pieces — crowding causes steaming, not roasting. Place chicken skin-side up on top of or between the vegetables.","Roast 25-35 min until the chicken reaches 165F and the vegetables are golden with some caramelized edges. Rotate the pan halfway through for even cooking."]},
  { id:16, name:"Chicken Zoodle Soup",           protein:"chicken",     cal:460, time:20, servings:6,
    desc:"Hearty broth, shredded chicken, zucchini noodles, carrots",
    ingredients:["3 cups cooked shredded chicken","6 cups chicken broth","4 medium zucchini, spiralized","3 carrots, sliced","4 stalks celery, sliced","4 cloves garlic","1 tsp thyme","Fresh parsley"],
    recipe:["Bring broth to simmer. Add carrots, celery, garlic.","Cook 8 min until almost tender.","Add chicken and thyme. Simmer 3 min.","Add zucchini noodles, cook 2 min. Season and serve topped with fresh parsley."],
    tip:"Add the zucchini noodles in the last 90 seconds only. Overcooked zucchini releases water that dilutes your broth. Pull them while they still have bite.",
    tip2:"Add zucchini noodles only at the very end — they need just 1-2 min and release water rapidly. Add them too early and they turn mushy and water down the broth.",
    recipe_detailed:["Heat oil in a large pot over medium. Add onion, carrots, and celery and cook 5-6 min until softened. Add garlic, cook 1 min.","Add chicken broth and bring to a boil. Add chicken breasts or thighs whole — they poach gently and stay juicy. Reduce to a simmer and cook 15-18 min until cooked through.","Remove chicken and shred with two forks. Return shredded chicken to the pot. Add herbs and season well with salt and pepper. Taste the broth and adjust.","Add zucchini noodles and simmer 1-2 min until just softened. Serve immediately — don't let the soup sit with the zoodles or they turn to mush."]},
  { id:18, name:"Coconut Curry Chicken",         protein:"chicken",     cal:390, time:20, servings:6,
    desc:"Light coconut milk curry, chicken, spinach, jasmine rice",
    ingredients:["2 lb chicken breast, cubed","2 cans light coconut milk","4 cups baby spinach","3 tbsp red curry paste","1.5 tbsp fish sauce","2 limes, juiced","3 cloves garlic","1 tsp ginger","Jasmine rice","Cilantro"],
    recipe:["Sauté garlic and ginger 1 min. Add curry paste 1 min.","Add chicken, cook 5 min.","Pour in coconut milk and fish sauce. Simmer 8 min.","Stir in spinach and lime. Serve over steamed jasmine rice, topped with cilantro."],
    tip:"Fry the curry paste in oil for a full minute until it darkens slightly and smells fragrant. This is called 'killing the paste' - raw paste tastes tinny.",
    tip2:"Add spinach right at the end and remove the pan from heat. Residual warmth wilts it perfectly in 60 seconds — cooking it longer makes it slimy and dull.",
    recipe_detailed:["Heat oil in a large pan over medium heat. Add garlic and ginger and cook 1 min, stirring, until fragrant but not browned. Add the curry paste and let it fry in the oil for a full minute, stirring constantly — it should darken slightly and smell toasty. This step is called blooming and it's what makes curry taste deep instead of flat.","Add the chicken pieces and cook 5–6 min, turning occasionally, until the outside is opaque and lightly golden. It doesn't need to be cooked through yet — it'll finish in the sauce.","Pour in the coconut milk and fish sauce. Stir to combine, scraping up any bits from the bottom. Bring to a gentle simmer (small bubbles, not a rolling boil) and cook 8 min. The chicken is done when it's no longer pink inside — cut the thickest piece to check.","Squeeze in the lime juice and stir in the spinach. Remove the pan from heat and let the residual warmth wilt the spinach for 60 seconds — it should turn bright green and just collapse. Serve over steamed jasmine rice."]},
  { id:20, name:"Teriyaki Chicken Bowls",        protein:"chicken",     cal:500, time:15, servings:6,
    desc:"Teriyaki glazed chicken, edamame, cucumber, brown rice",
    ingredients:["2 lb chicken thighs","4 tbsp low-sodium soy sauce","1.5 tbsp honey","1.5 tbsp rice vinegar","1.5 tsp sesame oil","3 cups edamame","2 cucumbers, sliced","3 cups cooked brown rice","Sesame seeds"],
    recipe:["Mix soy sauce, honey, vinegar, sesame oil for glaze.","Cook chicken 6-7 min per side. Add glaze last 2 min.","Slice chicken. Build bowls with rice, edamame, cucumber.","Top with sesame seeds."],
    tip:"Pound the chicken to even thickness before cooking. Thick and thin spots cook at different rates - evening them out gets you perfect doneness edge to edge.",
    tip2:"Homemade teriyaki is just soy sauce, mirin, and sugar reduced in a pan — it takes 3 min and is dramatically better than bottled. Make a double batch and keep it in the fridge.",
    recipe_detailed:["For teriyaki sauce: combine soy sauce, mirin, sugar, and a little cornstarch in a small saucepan. Bring to a simmer over medium heat, stirring until the sugar dissolves and it thickens slightly — about 3 min. Set aside.","Pat chicken thighs dry. Heat oil in a skillet over medium-high. Cook chicken skin-side down 5-6 min until deeply golden, then flip and cook 4 more min.","Pour the teriyaki sauce over the chicken and let it simmer and reduce 2-3 min, spooning it over the chicken as it thickens. It should be sticky and coat the back of a spoon.","Slice chicken and serve over steamed rice. Spoon extra sauce over everything. Top with sliced green onions and sesame seeds."]},
  { id:44, name:"Chicken Cauliflower Fried Rice", protein:"chicken",   cal:410, time:15, servings:6,
    desc:"Riced cauliflower, chicken, egg, peas, carrots, soy sauce",
    ingredients:["2 cups cooked chicken, diced","3 cups jasmine rice, cooked","3 eggs, beaten","1.5 cups frozen peas & carrots","4 tbsp low-sodium soy sauce","3 cloves garlic","1.5 tsp sesame oil","Green onions"],
    recipe:["Heat oil in wok on high. Add jasmine rice, cook 3 min.","Push aside. Scramble eggs in center, mix together.","Add chicken, peas & carrots, garlic. Stir fry 3 min.","Add soy sauce and sesame oil. Top with green onion."],
    tip:"The secret to fried rice is day-old cooked rice. Freshly cooked rice is too wet and clumps. If you don't have day-old, spread it on a sheet pan to cool and dry for 30 minutes.",
    tip2:"Squeeze as much water out of the riced cauliflower as you can in a clean dish towel before cooking. Excess water makes it steam and clump. The drier it is, the more it mimics fried rice.",
    recipe_detailed:["Pulse cauliflower in a food processor until it resembles rice. Spread on a towel and squeeze firmly to remove excess moisture — this step is critical for texture.","Season and cook chicken in a hot skillet with oil until cooked through, 6-8 min. Remove and dice into small pieces.","In the same pan over high heat, add sesame oil. Add garlic and ginger, stir 30 sec. Add cauliflower rice and stir fry 5 min — let it sit in contact with the pan for 30 seconds at a time to develop color.","Push everything to the sides. Scramble eggs in the center, then mix through. Add chicken, soy sauce, and any vegetables. Toss and cook 2 more min. Top with green onions."]},
  { id:46, name:"One-Pan Chicken & Mushrooms",   protein:"chicken",     cal:440, time:20, servings:6,
    desc:"Chicken thighs braised with mushrooms, thyme, dijon broth",
    ingredients:["6 boneless chicken thighs","3 cups cremini mushrooms, sliced","1.5 cups chicken broth","3 tbsp dijon mustard","1 tsp fresh thyme","4 cloves garlic","2 tbsp olive oil","Fresh parsley"],
    recipe:["Sear chicken 5 min per side. Remove.","Sauté mushrooms and garlic 4 min.","Whisk broth and dijon. Pour in, scrape pan.","Return chicken with thyme. Simmer 8 min. Top with parsley."],
    tip:"After adding the dijon broth, scrape the fond (browned bits) from the bottom of the pan immediately. That's where the depth of flavor is stored.",
    tip2:"Don't salt mushrooms at the start — it draws out water and they steam instead of brown. Cook them dry until the liquid evaporates, then season. That is when they start to brown.",
    recipe_detailed:["Pat chicken dry and season all sides. Heat oil in a large skillet over medium-high. Sear chicken skin-side down 6-7 min without moving until deeply golden. Flip and cook 3 min. Remove to a plate.","Add mushrooms to the same pan in a single layer. Don't stir for 3 min — let them brown on one side. Toss and cook another 2 min. Now season with salt.","Add garlic and thyme and stir 1 min. Add broth and scrape up the browned bits from the bottom. Bring to a simmer.","Return chicken to the pan, nestle into the sauce. Cover and cook over low heat 12-15 min until chicken reaches 165F. Stir in butter and cream if using, taste and adjust seasoning."]},
  { id:53, name:"Chicken Shawarma Bowls",        protein:"chicken",     cal:360, time:20, servings:6,
    desc:"Spiced chicken, romaine, tomato, tzatziki, tahini",
    ingredients:["2 lb chicken thighs","1 tsp cumin","1 tsp coriander","1 tsp paprika","1/2 tsp turmeric","4 cloves garlic","3 tbsp olive oil","6 cups romaine","2 cups cherry tomatoes","3/4 cup tzatziki","3 tbsp tahini","2 lemons"],
    recipe:["Mix spices, garlic, oil. Coat chicken.","Sear 6-7 min per side.","Rest 3 min, then slice.","Build bowls with romaine and cherry tomatoes, then top with sliced chicken. Drizzle with tzatziki, tahini, and lemon."],
    tip:"Marinate the chicken overnight if you can. Shawarma spices need time to penetrate - even 4 hours makes a noticeable difference in depth of flavor.",
    tip2:"The longer the chicken marinates the better — the acid in lemon juice tenderizes the meat and the spices penetrate deeply. Even 30 min makes a difference; overnight is transformative.",
    recipe_detailed:["Mix together all the shawarma spices with olive oil and lemon juice. Toss chicken thighs to coat completely. Marinate at least 30 min, up to overnight in the fridge.","Cook in a hot skillet over medium-high heat or under a broiler 5-7 min per side until cooked through and charred in spots. The spices should form a dark, fragrant crust.","Rest the chicken 5 min, then slice thin. While it rests, warm pita and prepare toppings: chopped cucumber, tomato, red onion, and parsley.","Build bowls: rice or pita base, sliced chicken, toppings, a generous drizzle of garlic sauce or tzatziki, and a squeeze of lemon."]},
  { id:64, name:"Hot Wings",                     protein:"chicken",     cal:500, time:45, servings:6,
    desc:"Crispy baked wings, classic buffalo sauce, celery & blue cheese dip",
    ingredients:["4 lb chicken wings, split at joint","1 tbsp baking powder","1 tsp garlic powder","Salt & pepper","1/2 cup hot sauce (Frank's RedHot)","4 tbsp butter","1 tsp Worcestershire sauce","Celery stalks","1/2 cup blue cheese or ranch dressing"],
    recipe:["Pat wings completely dry. Toss with baking powder, garlic powder, salt, pepper.","Arrange on wire rack over baking sheet. Refrigerate uncovered 1 hr (or overnight).","Bake at 425°F for 45-50 min, flipping halfway, until very crispy.","Melt butter, stir in hot sauce and Worcestershire for buffalo sauce.","Toss wings in sauce. Serve with celery and blue cheese or ranch."],
    tip:"Baking powder on the wings draws out moisture and creates a porous surface that fries up incredibly crispy in the oven - it's the secret to oven wings that actually crunch.",
    tip2:"The secret to crispy baked wings: baking powder in the coating. It raises the pH of the skin and makes it blister and crisp in the oven in a way plain flour cannot.",
    recipe_detailed:["Pat wings completely dry — any moisture is the enemy of crispy skin. Toss with baking powder, salt, and pepper. No flour needed — the baking powder is the crispiness trick.","Arrange on a wire rack set over a foil-lined baking sheet. This lets hot air circulate under the wings. Bake at 425F for 45-50 min, flipping halfway, until deeply golden and the skin is blistered.","While wings bake, melt butter in a saucepan and whisk in hot sauce. Taste and adjust — more butter for mild, more sauce for hot.","Toss the hot wings immediately in the sauce so it clings while they are hot. Serve with blue cheese or ranch and celery sticks."]},
  { id:68, name:"Blackened Chicken Greek Salad", protein:"chicken",     cal:320, time:15, servings:3,
    desc:"Cajun-spiced crispy chicken over romaine, feta, olives, cucumber, red onion, oregano dressing",
    ingredients:["4 chicken breasts","2 tsp smoked paprika","1 tsp garlic powder","1 tsp onion powder","1 tsp cayenne","1 tsp dried thyme","Salt & pepper","2 tbsp olive oil","6 cups romaine, chopped","1 cup cherry tomatoes, halved","1 cucumber, diced","1/2 red onion, thinly sliced","3/4 cup kalamata olives","3/4 cup crumbled feta","For dressing: 3 tbsp olive oil, 1.5 tbsp red wine vinegar, 1 tsp dried oregano, salt & pepper"],
    recipe:["Mix paprika, garlic powder, onion powder, cayenne, thyme, salt, pepper. Coat chicken well on all sides.","Heat olive oil in cast iron skillet over high heat until smoking. Sear chicken 4-5 min per side until blackened and cooked through (165°F internal). Rest 3 min.","Whisk dressing ingredients together.","Build salad: romaine, tomatoes, cucumber, red onion, olives, feta.","Slice chicken and lay over salad. Drizzle dressing over everything."],
    tip:"Cast iron is essential for proper blackening - you need sustained, intense heat that most pans can't hold. Get it smoking hot, add no oil to the pan, and don't touch the chicken.",
    tip2:"Blackening is not burning — it is a controlled char from the spice crust. Use a cast iron over very high heat and don't be scared when it smokes. Open a window and let it happen.",
    recipe_detailed:["Mix blackening spices: paprika, cayenne, garlic powder, thyme, oregano, salt, and pepper. Coat chicken on all sides — press the spices in gently.","Heat a cast iron skillet over high heat for 3-4 min until very hot. Add a thin film of oil. Add chicken and cook 4-5 min per side — it will smoke significantly and the crust will turn very dark. That is correct.","Rest the chicken 5 min then slice. While resting, assemble the salad: romaine, cucumber, tomatoes, Kalamata olives, red onion, pepperoncini, and crumbled feta.","Top the salad with sliced chicken and dress with olive oil, red wine vinegar, salt, and oregano. Serve with pita bread."]},
  { id:65, name:"Zuppa Toscana",                 protein:"chicken",     cal:410, time:30, servings:6,
    desc:"Creamy Italian sausage soup with kale, potatoes, and a touch of cream",
    ingredients:["1.5 lb Italian sausage (mild or spicy)","4 cups kale, stems removed, chopped","3 medium potatoes, thinly sliced or diced","1 onion, diced","5 cloves garlic, minced","4 cups chicken broth","2 cups heavy cream or coconut cream","Red pepper flakes","Salt & pepper","Parmesan to serve"],
    recipe:["Brown sausage in a large pot, breaking it up. Remove, leave drippings.","Sauté onion in drippings 4 min. Add garlic and red pepper flakes 1 min.","Add broth and potatoes. Bring to boil, simmer 10-12 min until potatoes are tender.","Return sausage. Stir in cream and kale.","Simmer 5 min until kale wilts. Season. Serve with parmesan."],
    tip:"Don't drain all the drippings after browning the sausage , leave a thin layer. That's where the soup's depth of flavor lives.",
    tip2:"Kale goes in last for a reason. Add it too early and it turns army-green and bitter. Those final 5 minutes give you bright, silky leaves.",
    recipe_detailed:["Heat a large pot over medium-high heat. Add the sausage and cook 6-8 min, breaking it into small crumbles with a wooden spoon until no pink remains and the edges are starting to crisp. Use a slotted spoon to transfer to a plate , leave the drippings in the pot.","Reduce heat to medium. Add the onion and cook 4-5 min, stirring occasionally, until softened and translucent. Add garlic and red pepper flakes and stir 1 min , you'll smell them turn fragrant.","Pour in the broth and add the potatoes. Raise heat to bring to a boil, then reduce to a gentle simmer. Cook 10-12 min until a fork slides through a potato slice without resistance.","Return the sausage to the pot. Pour in the cream and add the kale. Stir to combine.","Simmer 4-5 min until the kale wilts and turns deep green. Taste and season with salt and pepper. Ladle into bowls and top generously with Parmesan."]},
  // ── SALMON ────────────────────────────────────────────────────────────────
  { id:24, name:"Honey-Dijon Salmon Sheet Pan",  protein:"seafood",      cal:340, time:20, servings:6,
    desc:"Glazed salmon, asparagus, lemon, roasted together",
    ingredients:["6 salmon fillets","2 bunches asparagus, trimmed","3 tbsp honey","3 tbsp dijon mustard","1.5 tbsp olive oil","2 lemons, sliced","Salt & pepper"],
    recipe:["Preheat oven to 400°F. Mix honey, dijon, salt.","Place salmon and asparagus on sheet pan. Brush salmon with glaze.","Add lemon slices. Roast 14-16 min."],
    tip:"Bring salmon to room temperature 15 minutes before cooking. Cold fish from the fridge cooks unevenly and often sticks to the pan.",
    tip2:"The salmon is done when it flakes easily with a fork at the thickest part and has turned from translucent to opaque. It should still look slightly darker in the very center — that's perfect. If it's completely uniform it's overdone.",
    recipe_detailed:["Take the salmon out of the fridge 15 min before cooking so it comes closer to room temperature — this helps it cook evenly. Preheat your oven to 400°F and line a sheet pan with foil for easy cleanup.","In a small bowl, mix honey, dijon mustard, salt, and a crack of pepper. Taste it — it should be balanced, slightly sweet and tangy.","Place salmon fillets skin-side down on one side of the sheet pan and asparagus on the other. Spoon or brush the glaze generously over the top of each salmon fillet. Lay lemon slices over the asparagus and a couple on the salmon.","Roast 14–16 min. The salmon is done when it flakes easily with a fork at the thickest part and has turned from translucent to opaque — it should still look slightly darker in the very center. The asparagus should be tender with slightly charred tips."]},
  { id:26, name:"Teriyaki Salmon & Broccoli",    protein:"seafood",      cal:310, time:15, servings:6,
    desc:"Teriyaki glazed salmon, steamed broccoli, sesame seeds",
    ingredients:["6 salmon fillets","4 cups broccoli florets","4 tbsp low-sodium soy sauce","1.5 tbsp honey","1.5 tbsp rice vinegar","1.5 tsp sesame oil","Sesame seeds","Green onion"],
    recipe:["Mix soy sauce, honey, vinegar, sesame oil for glaze.","Sear salmon 3 min, flip. Pour glaze over, cook 3 min more.","Steam broccoli 4 min.","Serve with remaining glaze, sesame seeds, green onion."],
    tip:"Apply the teriyaki glaze in the last 2-3 minutes only. Sugar burns quickly - glazing too early results in bitterness instead of caramelization.",
    tip2:"Salmon goes from perfect to dry fast. The center should still look slightly translucent when you pull it — it finishes cooking from residual heat as it rests. Uniformly opaque all the way through means overdone.",
    recipe_detailed:["Pat salmon dry and season with salt and pepper. Make teriyaki sauce: whisk together soy sauce, mirin, sugar, and a little cornstarch. Bring to a simmer in a small pan 2-3 min until slightly thickened.","Heat oil in an oven-safe skillet over medium-high. Place salmon skin-side up and cook 3 min undisturbed to build a crust. Flip to skin-side down.","Brush teriyaki sauce over the salmon. Add broccoli florets around the pan with a splash of water. Cover and cook 4-5 min until broccoli is bright green and salmon flakes at the edges but looks slightly darker in the center.","Serve over steamed rice with extra sauce and sesame seeds."]},
  { id:29, name:"Salmon Patties & Coleslaw",     protein:"seafood",      cal:330, time:15, servings:6,
    desc:"Canned salmon patties, tangy coleslaw, lemon-dill yogurt sauce",
    ingredients:["3 cans (14.75 oz) wild salmon, drained","2 eggs","3 tbsp almond flour","1.5 tsp dijon mustard","4 cups coleslaw mix","3 tbsp apple cider vinegar","3/4 cup Greek yogurt","1.5 tbsp fresh dill","2 lemons"],
    recipe:["Mix salmon, egg, almond flour, dijon. Form patties.","Pan-fry in olive oil 3-4 min per side until golden.","Toss coleslaw with vinegar and salt.","Mix yogurt, dill, lemon juice for sauce. Serve everything together."],
    tip:"Refrigerate the formed salmon patties for 15 minutes before frying. Chilling helps them hold together and prevents crumbling in the pan.",
    tip2:"Chill the formed patties in the fridge for 15 min before frying — the binders set up and the patties hold together much better when they have had time to firm up.",
    recipe_detailed:["Drain canned salmon thoroughly and pick out any bones. In a bowl, flake the salmon and mix with egg, breadcrumbs, diced onion, mustard, lemon juice, and seasoning. Don't overmix — just combine.","Form into patties about 3/4-inch thick. Place on a plate, cover, and refrigerate 15 min. This helps them hold together when frying.","Meanwhile, make coleslaw: shred cabbage and carrot, toss with mayo, vinegar, sugar, salt, and pepper. Taste and adjust — it should be tangy and creamy.","Heat oil in a skillet over medium-high. Cook patties 3-4 min per side until golden brown. Serve with coleslaw on the side or on a bun."]},
  { id:23, name:"Garlic Butter Salmon",          protein:"seafood",      cal:320, time:15, servings:3,
    desc:"Pan-seared salmon, garlic butter sauce, crispy green beans",
    ingredients:["4 salmon fillets","3 cups green beans, trimmed","4 tbsp butter","5 cloves garlic, minced","1 lemon, juiced","Fresh parsley","Salt & pepper"],
    recipe:["Season salmon with salt and pepper.","Sear skin-up in hot skillet 4 min per side. Remove.","Add butter and garlic. Cook 1 min.","Add green beans, toss 3 min. Return salmon, add lemon, parsley."],
    tip:"Tilt the pan and baste the salmon repeatedly with the garlic butter in the last minute. This is called arroser - it infuses flavor into every layer of the fish.",
    tip2:"Baste constantly in the last 2 minutes — spoon the hot garlic butter over the top of the salmon repeatedly. This bastes the top without needing to flip and creates incredible flavor.",
    recipe_detailed:["Pat salmon dry. Season generously. Heat oil in a heavy skillet over medium-high until shimmering.","Place salmon skin-side up. Cook 4 min without moving — a proper crust should form. Flip to skin-side down.","Reduce heat to medium. Add butter and garlic to the pan. As the butter melts and foams, continuously spoon it over the top of the salmon for 2-3 min. The salmon is done when it flakes easily at the thickest part and the center is slightly darker.","Add lemon juice to the butter in the pan, stir, and pour over the salmon. Garnish with fresh parsley."]},
  { id:25, name:"Salmon Taco Bowls",             protein:"seafood",      cal:360, time:15, servings:3,
    desc:"Spiced salmon, cabbage slaw, avocado, mango salsa, chipotle lime crema",
    ingredients:["1.5 lb salmon fillet","3 cups shredded cabbage","2 avocados, sliced","1 can (7 oz) chipotles in adobo sauce","1/2 cup sour cream","1 tsp Tajin seasoning","2 limes","1 tsp chili powder","1 tsp cumin","Salt","Fresh cilantro","Optional: chopped chipotles from can for topping"],
    recipe:["Make chipotle lime crema: whisk sour cream with 1-2 tbsp adobo sauce from the can and Tajin seasoning. Taste and adjust — should be smoky, tangy, and lightly spicy. Optionally chop a chipotle pepper and stir it in for more heat.","Season salmon with chili powder, cumin, salt. Pan-sear 4 min per side until cooked through. Flake into large chunks.","Quick slaw: toss cabbage with lime juice and a pinch of salt. Let sit 5 min.","Build bowls: slaw base, salmon chunks, avocado slices. Drizzle generously with crema. Add chopped chipotles on top if desired. Finish with fresh cilantro and lime."],
    tip:"For the best slaw, squeeze the lime over the cabbage and let it sit 10 minutes before serving. The acid gently wilts the cabbage so it's tender but still has crunch.",
    tip2:"For the avocado crema, blend avocado with lime juice, a little garlic, and sour cream until smooth. The lime juice prevents browning and the crema keeps in the fridge for 2 days — make extra.",
    recipe_detailed:["Season salmon with chili powder, cumin, garlic powder, salt, and a drizzle of oil. Cook in a hot skillet 3-4 min per side until cooked through with a slight char. Break into large chunks.","Warm corn tortillas or cook rice for bowl base. Shred purple cabbage and toss with lime juice and a pinch of salt.","Make chipotle lime crema first so it can chill: whisk sour cream with 1-2 tbsp of the adobo sauce from the can (that thick, smoky liquid, not just the peppers) and Tajin seasoning. Taste — it should be smoky, tangy, and lightly spicy. Stir in a squeeze of lime. Want more heat? Chop a chipotle pepper from the can and mix it in.","Assemble: base, salmon chunks, slaw, diced mango or pico de gallo, crema, and pickled jalapenos. Finish with fresh cilantro and lime wedges."]},
  // ── BEANS / PLANT-BASED ───────────────────────────────────────────────────
  { id:31, name:"Black Bean Tacos",              protein:"plant-based",       cal:340, time:10, servings:6,
    desc:"Spiced black beans, corn tortillas, avocado, pickled onion, cilantro",
    ingredients:["3 cans black beans, drained","12 small corn tortillas","3 avocados","1 red onion, thinly sliced","1/3 cup lime juice","1 tsp cumin","1 tsp chili powder","Fresh cilantro","Salsa"],
    recipe:["Quick-pickle onion in lime juice and salt 10 min.","Heat beans with cumin, chili powder, salt. Mash slightly.","Warm tortillas in dry skillet.","Fill with beans, avocado, pickled onion, cilantro, salsa."],
    tip:"Quick-pickle the onions for at least 15 minutes - longer is better. The lime juice turns them bright pink and mellows their raw sharpness into something sweet and tangy."},
  { id:32, name:"Chickpea Tikka Masala",         protein:"plant-based",       cal:360, time:20, servings:6,
    desc:"Chickpeas in rich tomato-spiced sauce, spinach, jasmine rice",
    ingredients:["3 cans chickpeas, drained","2 cans crushed tomatoes","4 cups baby spinach","1 onion, diced","5 cloves garlic","1.5 tbsp ginger","3 tbsp tikka masala spice","3/4 cup coconut milk","Cauliflower rice","Fresh cilantro"],
    recipe:["Sauté onion until golden, 5 min. Add garlic and ginger 1 min.","Add tikka masala spice, toast 30 sec.","Add tomatoes and chickpeas. Simmer 10 min.","Stir in coconut milk and spinach. Serve over cauliflower rice, topped with fresh cilantro."],
    tip:"Add a small pinch of sugar to the tikka sauce. It balances the acidity of the tomatoes and rounds out the spice blend without making it sweet.",
    tip2:"Toast the spices dry for 30 seconds before adding liquid. You'll know they're ready when the kitchen smells incredible — that's the volatile oils releasing. Don't walk away during this step, they burn fast.",
    recipe_detailed:["Heat oil in a large pan over medium heat. Add the onion and cook 5–6 min, stirring occasionally, until golden and soft — not just translucent, you want some color here. It builds sweetness.","Add garlic and ginger and stir 1 min until fragrant. Add the tikka masala spice blend and toast it in the oil for 30 seconds, stirring constantly. The kitchen should smell incredible. Don't walk away — spices burn fast and turn bitter.","Pour in the crushed tomatoes and add the chickpeas. Stir to combine and bring to a simmer. Add a small pinch of sugar. Cook 10 min, stirring occasionally, until the sauce thickens and the color deepens to a rich orange-red.","Stir in coconut milk and spinach. Cook 2–3 min until the spinach wilts and the sauce is creamy and uniform. Taste and adjust salt. Serve over basmati rice with naan for scooping."]},
  { id:33, name:"Lentil Veggie Soup",            protein:"plant-based",       cal:280, time:25, servings:6,
    desc:"Red lentils, kale, carrots, tomatoes, cumin-turmeric broth",
    ingredients:["2 cups red lentils","5 cups kale, chopped","3 carrots, diced","1 can diced tomatoes","1 onion, diced","5 cloves garlic","1.5 tsp cumin","1.5 tsp turmeric","1 tsp coriander","6 cups vegetable broth","Lemon to finish"],
    recipe:["Sauté onion and carrots 5 min. Add garlic and spices 1 min.","Add lentils, tomatoes, broth. Bring to boil.","Simmer 15 min until lentils are soft.","Stir in kale 3 min. Season and squeeze lemon over top."],
    tip:"Red lentils break down completely as they cook, naturally thickening the soup. If it gets too thick, thin with a splash of water - don't add more broth, which concentrates salt.",
    tip2:"Red lentils dissolve completely as they cook — that is by design. They are the thickener. Green or brown lentils hold their shape if you prefer texture; just add 10 more min of simmering.",
    recipe_detailed:["Heat oil in a large pot over medium. Cook onion, carrot, and celery 5-6 min until softened. Add garlic, cook 1 min.","Add cumin, coriander, and smoked paprika. Stir for 30 seconds until fragrant. Add diced tomatoes, lentils, and broth. Stir to combine.","Bring to a boil, then reduce to a simmer. Cook 20-25 min, stirring occasionally, until lentils are completely soft and have dissolved into the broth, thickening it.","Add any leafy greens and stir until wilted. Squeeze lemon juice in at the end — it brightens the whole soup. Season with salt and pepper."]},
  { id:39, name:"Three Bean Chili",              protein:"plant-based",       cal:310, time:25, servings:6,
    desc:"Black, kidney & pinto beans, tomatoes, peppers, chili spices",
    ingredients:["1 can black beans","1 can kidney beans","1 can pinto beans","1 can diced tomatoes","1 can tomato sauce","2 bell peppers, diced","1 onion, diced","3 cloves garlic","2 tbsp chili powder","1 tsp cumin","1 tsp smoked paprika"],
    recipe:["Sauté onion and peppers 5 min. Add garlic and spices 1 min.","Add all beans (drained), tomatoes, tomato sauce.","Simmer 15 min, stirring occasionally.","Season. Serve with avocado, sour cream, cilantro."],
    tip:"Let the chili sit for 15 minutes off heat before serving. Like any braise, resting allows the flavors to settle and meld - it genuinely tastes better.",
    tip2:"Don't rush the spices — add them to the hot fat and stir for a full 30-60 seconds before adding liquid. This blooms them in oil, releasing the volatile flavor compounds that make chili taste complex instead of flat.",
    recipe_detailed:["Heat oil in a large pot over medium-high. Cook onion and peppers 5-6 min until softened. Add garlic, cook 1 min.","Add all the spices: chili powder, cumin, smoked paprika, oregano, and cayenne. Stir for 30-60 seconds in the hot oil until intensely fragrant.","Add drained beans, crushed tomatoes, and broth. Stir well. Bring to a boil, then reduce to a simmer.","Simmer uncovered 25-30 min, stirring occasionally, until the chili thickens and the flavors meld. Taste and adjust seasoning — chili often needs more salt and sometimes a splash of vinegar at the end. Serve with sour cream, shredded cheese, and warm cornbread."]},
  { id:35, name:"Plant-Based Taco Bowls",        protein:"plant-based", cal:370, time:12, servings:6,
    desc:"Plant-based ground, black beans, salsa, avocado, romaine",
    ingredients:["1.5 lb plant-based ground (Beyond/Impossible)","2 cans black beans, drained","3 avocados","6 cups romaine, chopped","1.5 cups salsa","1.5 tbsp taco seasoning","Lime wedges"],
    recipe:["Cook plant-based ground 5 min, breaking up.","Add taco seasoning + 2 tbsp water, stir 1 min.","Warm beans separately.","Build bowls: romaine, ground, beans, avocado, salsa, lime."],
    tip:"Cook plant-based meat on high heat without stirring for the first 2 minutes. It needs to develop a crust just like real beef, and won't if you stir constantly.",
    tip2:"Season the base heavily — whether it is lentils, cauliflower, or a blend, it needs to taste like taco meat on its own before it goes in the bowl. Bland filling makes a bland bowl.",
    recipe_detailed:["Cook your taco base: for lentils, simmer in broth with taco seasoning 20 min until soft. For cauliflower, roast at 425F with taco spices 20 min until caramelized. Season aggressively — it should taste boldly spiced on its own.","Warm black or pinto beans in a pan with cumin, garlic powder, and a pinch of salt. Smash a few beans for a creamier texture.","Cook rice and season with lime juice and fresh cilantro.","Build bowls: rice base, beans, taco filling, salsa, guacamole, shredded cabbage, pickled jalapenos, and sour cream or cashew cream. Squeeze lime over everything."]},
  // ── FAMILY CLASSICS ───────────────────────────────────────────────────────
  { id:66, name:"Lasagna with Salad",            protein:"beef",        cal:520, time:75, servings:6,
    desc:"Hearty layered lasagna with mild Italian sausage, ricotta, mozzarella, and a crisp side salad",
    ingredients:["1.5 lb mild Italian sausage, casings removed","12 lasagna noodles","2 cups ricotta cheese","2 cups shredded mozzarella","1/2 cup parmesan","1 egg","2 jars marinara sauce","2 cloves garlic","1 tsp Italian seasoning","Salt & pepper","For salad: romaine, cherry tomatoes, cucumber, Italian dressing"],
    recipe:["Preheat oven to 375°F. Brown beef with garlic, drain. Mix in marinara.","Cook noodles al dente. Drain.","Mix ricotta, egg, half the parmesan, Italian seasoning.","Layer in 9x13 pan: sauce, noodles, ricotta, beef, mozzarella. Repeat.","Top with remaining mozzarella and parmesan. Cover with foil.","Bake 45 min. Remove foil, bake 15 more min until bubbly. Rest 10 min before cutting.","Toss salad and serve alongside."],
    tip:"Rest the lasagna 15 minutes after pulling from the oven before cutting. The layers set during this time. Cutting immediately gives you a puddle; resting gives you clean squares.",
    tip2:"Let the baked lasagna rest 20 min before cutting. The layers need time to set so they don't collapse when sliced. Fresh-from-the-oven lasagna is molten and falls apart — rested lasagna holds in perfect squares.",
    recipe_detailed:["Make meat or vegetable sauce: brown protein or saute vegetables, add crushed tomatoes and herbs, and simmer 20 min until thick. Season well.","Make bechamel: melt butter, whisk in flour, cook 1 min, then gradually whisk in warm milk. Stir constantly until thick. Season with salt, nutmeg, and pepper.","Layer in a baking dish: sauce, lasagna sheets, bechamel, ricotta mixture if using, cheese. Repeat. Finish with bechamel and a generous layer of mozzarella and Parmesan.","Cover with foil and bake at 375F for 40 min. Remove foil and bake 20 more min until bubbling and golden. Rest 20 min before cutting."]},
  { id:67, name:"Homemade Pizza Night",          protein:"chicken",     cal:480, time:30, servings:3,
    desc:"Make-your-own pizza with your choice of toppings - everyone builds their own",
    ingredients:["2 pre-made pizza dough balls (or naan)","1.5 cups pizza sauce","2 cups shredded mozzarella","Toppings of choice: pepperoni, bell peppers, onion, mushrooms, olives","Olive oil","Garlic powder","Fresh basil","Red pepper flakes"],
    recipe:["Preheat oven to 475°F with a baking stone or sheet inside (gets it very hot).","Stretch or roll dough on a floured surface.","Brush with olive oil. Spread sauce, leaving 1\" border.","Add cheese and toppings.","Bake directly on hot stone/pan 10-12 min until crust is golden and cheese is bubbling.","Top with fresh basil before serving."],
    tip:"The hottest oven and hottest surface wins for pizza. Preheat your stone or pan inside the oven for 30 minutes. The immediate bottom heat is what creates a crispy base.",
    tip2:"Preheat your oven as high as it goes for at least 45 min with a pizza stone or inverted baking sheet inside. The burst of intense heat from the hot surface is what creates the blistered, crispy bottom that a cold pan never achieves.",
    recipe_detailed:["Make or use store-bought dough. Let dough rest at room temperature for 1 hour before stretching — cold dough is elastic and snaps back.","Stretch dough by hand on a lightly floured surface — don't use a rolling pin, it presses out the air bubbles that create airy crust. Work from the center outward.","Spread sauce very thinly — more sauce makes a soggy pizza. Add toppings, keeping cheese as the final layer. Don't overload.","Slide onto the preheated stone or pan and bake at the oven's highest setting 8-12 min until the crust is spotted with char and the cheese is bubbly and beginning to brown."]},
  // ── NEW CHICKEN ──────────────────────────────────────────────────────────
  { id:101, name:"Chicken Piccata",                 protein:"chicken", cal:390, time:20, servings:3,
    desc:"Pan-seared chicken in lemon-caper butter sauce, served with zucchini noodles",
    ingredients:["4 chicken breasts, pounded thin","3 tbsp capers","2 lemons, juiced","4 tbsp butter","1/2 cup chicken broth","3 cloves garlic","1/4 cup almond flour","Salt & pepper","4 medium zucchini, spiralized","Fresh parsley"],
    recipe:["Dredge chicken in almond flour, salt, pepper.","Sear in olive oil 4 min per side. Remove.","Add garlic, broth, lemon juice to pan. Simmer 2 min.","Add butter and capers. Return chicken, spoon sauce over.","Serve over zucchini noodles with parsley."],
    tip:"Pound the chicken between plastic wrap to a uniform quarter-inch thickness. Piccata needs thin, even cutlets - thick spots won't cook through by the time the crust is golden.",
    tip2:"The butter goes in last and off the heat. This is called mounting — swirling cold butter into a hot sauce to emulsify it and give it a glossy, velvety texture. If the pan is too hot, the butter breaks and turns greasy.",
    recipe_detailed:["Pound chicken breasts to an even half-inch thickness. Season with salt and pepper, then dredge in flour, shaking off excess.","Heat olive oil and butter in a skillet over medium-high until butter is foamy. Add chicken and cook 3-4 min per side until golden and cooked through. Remove to a plate.","In the same pan, add garlic and cook 30 seconds. Add white wine and lemon juice, scraping up any browned bits. Let it reduce by half, about 2 min.","Add capers and chicken broth. Simmer 2 min. Remove pan from heat and swirl in cold butter until the sauce is glossy and emulsified. Pour over chicken and top with fresh parsley."]},
  { id:102, name:"Chicken Marsala & Risotto",          protein:"chicken", cal:580, time:45, servings:4,
    desc:"Golden chicken cutlets in a rich mushroom-Marsala wine sauce, served alongside a classic parmesan risotto",
    ingredients:[
      "4 boneless skinless chicken breasts, pounded to 1/2 inch","Salt and black pepper","1/2 cup flour for dredging",
      "3 tbsp olive oil","3 tbsp unsalted butter","8 oz cremini or baby bella mushrooms, sliced","3 cloves garlic, minced",
      "3/4 cup dry Marsala wine","1/2 cup chicken broth","2 tbsp heavy cream","Fresh parsley, chopped",
      "For risotto: 1 1/2 cups Arborio rice","4 cups warm chicken broth","1 cup dry white wine",
      "1 shallot, minced","2 tbsp butter","1/2 cup parmesan, grated","Salt and white pepper",
    ],
    recipe:[
      "Start risotto first: melt butter in a wide pan over medium. Sauté shallot until soft, 3 min. Add Arborio, stir to coat, toast 1 min. Add white wine, stir until absorbed.",
      "Add warm broth to risotto one ladle at a time, stirring frequently, letting each addition absorb before adding the next. This takes 18-20 min. Finish with parmesan, season with salt and white pepper. Keep warm.",
      "While risotto cooks, season chicken and dredge in flour, shaking off excess. The flour coating is what gives the sauce its body.",
      "Heat olive oil in a large skillet over medium-high. Sear chicken 4-5 min per side until golden and cooked through (165°F). Do not move it while searing. Remove and rest on a plate.",
      "In the same pan, melt 1 tbsp butter. Add mushrooms, cook undisturbed 3-4 min until golden. Add garlic 1 min. Pour in Marsala , it will sizzle dramatically. Scrape up any browned bits.",
      "Add chicken broth and reduce sauce by half, about 3 min. Swirl in remaining butter and cream. Return chicken to pan, coat in sauce, simmer 2 min. Finish with parsley. Serve alongside risotto.",
    ],
    tip:"Never stir risotto constantly , stir frequently but let it rest between additions. Constant stirring overworks the starch and makes it gluey. Use dry Marsala not sweet , sweet makes the sauce cloying.",
    tip2:"For risotto, warm the broth before adding it. Cold broth shocks the rice and breaks the starchy creaminess you are building. Keep it in a pot on the adjacent burner on low the whole time.",
    recipe_detailed:["Pound chicken to even thickness, dredge in flour. Sear in hot oil 3-4 min per side until golden. Remove to a plate.","In the same pan, cook mushrooms 5 min until browned. Add Marsala wine and let it bubble and reduce by half — about 3 min. Add broth, simmer 3 min. Swirl in butter. Return chicken to the pan.","For risotto: saute shallot in butter until soft. Add arborio rice and stir 1 min until translucent at the edges. Add wine, stir until absorbed. Add warm broth one ladle at a time, stirring constantly and waiting until each addition is absorbed — about 20 min. Finish with butter and Parmesan.","Serve the chicken and Marsala sauce over the creamy risotto."]},
  { id:103, name:"Chicken Enchilada Bowl",           protein:"chicken", cal:420, time:20, servings:3,
    desc:"Shredded chicken, enchilada sauce, black beans, peppers, jasmine rice",
    ingredients:["2 cups shredded chicken","1 cup red enchilada sauce","1 can black beans, drained","2 bell peppers, diced and sautéed","3 cups jasmine rice, cooked","1 cup shredded Mexican cheese","Sour cream","Fresh cilantro","Lime wedges"],
    recipe:["Warm chicken in enchilada sauce over medium heat, 5 min.","Sauté peppers in olive oil until tender.","Cook jasmine rice per package instructions.","Build bowls: cauli rice, peppers, beans, chicken.","Top with cheese, sour cream, cilantro, and lime."],
    tip:"Char the bell peppers until slightly blackened before adding to the bowl. The smoky edges add complexity that makes the bowl taste slow-cooked rather than assembled.",
    tip2:"Toast the dried chiles briefly in a dry skillet before making the sauce — 30 seconds per side until they puff and become fragrant. It unlocks a deeper, more complex flavor than untoasted chiles.",
    recipe_detailed:["Season and cook chicken thighs in oil 6-7 min per side until cooked through and golden. Rest 5 min, then shred with two forks.","In the same pan, build the enchilada sauce: saute onion and garlic, add chili powder, cumin, and oregano, then crushed tomatoes and broth. Simmer 10 min. Blend if you want it smooth.","Toss shredded chicken with half the sauce. Build bowls: cilantro rice base, sauced chicken, pinto or black beans, and a ladle of extra sauce over the top.","Top with shredded cheese, sour cream, avocado, pickled jalapenos, and fresh cilantro."]},
  { id:104, name:"Garlic Herb Roasted Chicken",      protein:"chicken", cal:370, time:30, servings:6,
    desc:"Crispy-skinned thighs roasted with garlic, rosemary, and lemon over vegetables",
    ingredients:["6 bone-in chicken thighs","1 head garlic, cloves separated","2 sprigs rosemary","1 lemon, sliced","3 cups baby potatoes, halved","2 cups green beans","3 tbsp olive oil","Salt & pepper","1 tsp paprika"],
    recipe:["Preheat oven to 425°F. Toss potatoes and green beans with oil and salt.","Season chicken with paprika, salt, pepper.","Nestle chicken among vegetables. Add garlic and lemon.","Roast 25-30 min until skin is crispy and chicken hits 165°F.","Rest 5 min before serving."],
    tip:"Start the chicken skin-side down in a cold pan and bring the heat up gradually. This renders the fat slowly for the crispiest skin without burning.",
    tip2:"Roast the chicken breast-side up the whole time. Flipping risks tearing the skin. Instead, rotate the pan halfway through for even browning. The high heat is what crisps the skin.",
    recipe_detailed:["Pat the whole chicken dry inside and out — the most important step for crispy skin. Mix softened butter with garlic, herbs, salt, and pepper. Carefully loosen the skin over the breasts and rub butter directly onto the meat under the skin. Rub the rest all over the outside.","Truss the legs together with kitchen twine and tuck the wing tips under. Season the cavity with salt and stuff with lemon halves and fresh herbs.","Roast breast-side up at 425F for 60-80 min depending on size. The chicken is done when a thermometer in the thickest part of the thigh reads 165F and the juices run clear.","Let the chicken rest 10-15 min before carving — the juices redistribute as it rests. Carve and serve with pan drippings spooned over."]},
  { id:105, name:"Thai Basil Chicken",               protein:"chicken", cal:380, time:15, servings:6,
    desc:"Spicy ground chicken stir-fry with basil, fish sauce, and Thai chilies over rice",
    ingredients:["1.5 lb ground chicken","1 cup fresh Thai basil","4 cloves garlic","3 Thai chilies, minced","2 tbsp fish sauce","1 tbsp oyster sauce","1 tsp soy sauce","1 tsp honey","2 tbsp olive oil","3 cups jasmine rice, cooked"],
    recipe:["Heat oil in wok on high. Add garlic and chilies, 30 sec.","Add chicken, cook until no longer pink, 5 min.","Add fish sauce, oyster sauce, soy sauce, honey. Toss 1 min.","Remove from heat, fold in basil.","Serve over steamed jasmine rice, top with a fried egg if desired."],
    tip:"Thai basil is not the same as regular basil - don't substitute. Thai basil has a slightly anise-like flavor that makes this dish authentic. It's usually in the Asian section.",
    tip2:"Add the basil at the very end and off the heat — high heat destroys the volatile oils that give Thai basil its anise-like flavor. Thirty seconds of residual heat is all it needs to wilt beautifully.",
    recipe_detailed:["Mince or finely chop the chicken or use ground chicken. Prepare all aromatics before you start — Thai basil chicken cooks in about 5 min total.","Heat oil in a wok over very high heat. Add garlic and Thai chilis and stir fry 30 seconds. Add chicken and stir fry 3-4 min, breaking up any clumps, until cooked through and starting to crisp.","Add oyster sauce, fish sauce, and soy sauce. Toss to coat for 1 min. Remove from heat.","Add fresh Thai basil leaves and toss — residual heat wilts them in 30 seconds. Serve over jasmine rice, topped with a crispy fried egg if desired."]},
  { id:106, name:"Chicken Souvlaki Bowls",           protein:"chicken", cal:400, time:20, servings:6,
    desc:"Grilled marinated chicken over greens with tzatziki, cucumber, and tomato",
    ingredients:["1.5 lb chicken breast, cubed","3 tbsp olive oil","2 lemons, juiced","4 cloves garlic","1 tsp oregano","1 tsp cumin","Salt & pepper","4 cups romaine","1 cucumber, diced","1 cup cherry tomatoes","1/2 cup tzatziki"],
    recipe:["Marinate chicken in oil, lemon, garlic, oregano, cumin, salt 15 min.","Cook in hot skillet or on grill 6-8 min turning.","Assemble bowls: romaine, cucumber, tomato.","Top with chicken and drizzle tzatziki generously."],
    tip:"Soak wooden skewers 30 minutes before grilling. Dry skewers ignite and burn, making the food taste acrid. Or use metal skewers and skip the step entirely.",
    tip2:"If using wooden skewers, soak them in water for 30 min first so they do not catch fire on the grill. Metal skewers conduct heat and cook the chicken from the inside out — slightly faster.",
    recipe_detailed:["Cut chicken into 1.5-inch cubes. Toss with olive oil, lemon juice, garlic, dried oregano, salt, and pepper. Marinate at least 30 min.","Thread onto skewers, leaving a little space between pieces so they cook evenly.","Grill or cook in a hot grill pan 10-12 min, turning every few minutes, until cooked through with char marks.","Make tzatziki while the chicken cooks: stir together Greek yogurt, grated cucumber squeezed dry, garlic, dill, lemon juice, and salt. Serve chicken over rice or in pita with tzatziki, tomatoes, red onion, and Kalamata olives."]},
  { id:107, name:"Creamy Tuscan Chicken",            protein:"chicken", cal:450, time:20, servings:3,
    desc:"Pan chicken in a sun-dried tomato, spinach, and cream sauce",
    ingredients:["4 chicken breasts","3 cups baby spinach","1/2 cup sun-dried tomatoes, chopped","1 cup heavy cream","4 cloves garlic","1/2 cup chicken broth","1/3 cup parmesan","1 tsp Italian seasoning","2 tbsp olive oil","Salt & pepper"],
    recipe:["Season and sear chicken 5-6 min per side. Remove.","Sauté garlic 1 min. Add sun-dried tomatoes.","Pour in broth and cream. Add Italian seasoning. Simmer 3 min.","Stir in parmesan and spinach until wilted.","Return chicken, spoon sauce over."],
    tip:"Sun-dried tomatoes in oil are better here than dry-packed. The oil carries flavor and helps the sauce emulsify into something silky rather than broken.",
    tip2:"When you add cream to a hot pan, reduce the heat to medium-low. Cream scorches quickly over high heat and a broken sauce is hard to rescue.",
    recipe_detailed:["Pat chicken thighs dry and season. Sear in a hot oven-safe skillet 5-6 min per side until golden. Remove to a plate.","In the same pan over medium, saute garlic 1 min. Add sun-dried tomatoes and cook 1 min. Add spinach and stir until wilted.","Reduce heat to medium-low. Pour in heavy cream and chicken broth. Stir to combine and bring to a gentle simmer. Add Parmesan and stir until melted and the sauce coats the back of a spoon.","Return chicken to the pan, spoon sauce over, and simmer 5 min until heated through. Taste and season. Serve over pasta or with crusty bread."]},
  { id:108, name:"Honey Garlic Chicken Thighs",      protein:"chicken", cal:360, time:20, servings:6,
    desc:"Sticky honey-garlic glazed chicken thighs, broccoli, brown rice",
    ingredients:["6 boneless chicken thighs","4 cloves garlic, minced","3 tbsp honey","2 tbsp soy sauce","1 tbsp rice vinegar","4 cups broccoli florets","2 cups cooked brown rice","1 tsp sesame oil","Sesame seeds","Green onion"],
    recipe:["Mix honey, soy, garlic, vinegar for glaze.","Sear chicken 5-6 min per side. Drain excess fat.","Pour glaze in pan, cook 2 min until sticky.","Steam broccoli 4 min.","Serve over rice with broccoli, sesame seeds, green onion."],
    tip:"Don't add the glaze until the last 90 seconds. Honey burns fast. Let the chicken cook almost entirely through first, then glaze and let it caramelize just before resting.",
    tip2:"Watch the honey garlic sauce closely in the final minute — the sugar in honey burns fast. You want it thick and sticky, not burnt and bitter. Pull the pan off if it starts smoking.",
    recipe_detailed:["Pat chicken thighs dry and season with salt and pepper. Mix honey, soy sauce, and minced garlic in a small bowl.","Heat oil in an oven-safe skillet over medium-high. Sear thighs skin-side down 6-7 min until the skin is deeply golden and releases naturally. Flip and cook 3 min.","Pour the honey garlic glaze over the chicken. Let it bubble and reduce 1-2 min, spooning it over the chicken as it thickens. Watch it carefully — honey burns quickly.","Transfer to a 400F oven for 8-10 min until the chicken reaches 165F and the glaze is sticky and caramelized. Rest 3 min before serving."]},
  // ── NEW BEEF ─────────────────────────────────────────────────────────────
  { id:109, name:"Beef Bulgogi Bowls",               protein:"beef", cal:490, time:20, servings:6,
    desc:"Korean marinated beef, sesame, cucumber, kimchi over jasmine rice",
    ingredients:["1.5 lb beef sirloin, thinly sliced","4 tbsp soy sauce","1 tbsp sesame oil","1 tbsp honey","4 cloves garlic","1 tbsp ginger","1 pear, grated","3 cups jasmine rice, cooked","1 cucumber, sliced","Kimchi","Sesame seeds"],
    recipe:["Mix soy, sesame oil, honey, garlic, ginger, pear. Marinate beef 10+ min.","Cook beef in hot skillet in batches, 2-3 min. Don't overcrowd.","Cook jasmine rice per package instructions.","Build bowls: rice, beef, cucumber, kimchi.","Top with sesame seeds and green onion."],
    tip:"Grated Asian pear is a traditional tenderizer in bulgogi marinades - it contains enzymes that break down muscle fibers. Even 30 minutes makes the beef noticeably more tender.",
    tip2:"Asian pear or kiwi in the bulgogi marinade is not just for flavor — the natural enzymes tenderize the beef fibers as it sits. Even 30 min with pear makes a noticeable difference in texture.",
    recipe_detailed:["Slice beef ribeye or sirloin paper-thin against the grain. If it is hard to slice thin, freeze for 20 min first.","Mix marinade: soy sauce, brown sugar, sesame oil, grated Asian pear or kiwi, garlic, ginger, and black pepper. Toss beef in marinade and refrigerate at least 30 min, preferably 2 hours.","Cook in a very hot pan or grill pan in batches — don't crowd or it steams. Sear 1-2 min per side until caramelized at the edges and cooked through.","Serve over rice with stir-fried vegetables, kimchi, sliced green onion, and sesame seeds. A fried egg on top is traditional."]},
  { id:110, name:"Carne Guisada",                    protein:"beef", cal:420, time:45, servings:6,
    desc:"Tender Mexican beef stew with peppers, tomatoes, and cumin gravy",
    ingredients:["2 lb beef chuck, cubed","2 tomatoes, diced","2 jalapeños, diced","1 onion, diced","3 cloves garlic","1 tsp cumin","1 tsp chili powder","1 cup beef broth","2 tbsp olive oil","Salt & pepper","Tortillas or cauli rice to serve"],
    recipe:["Brown beef in batches in olive oil. Remove.","Sauté onion, jalapeño, garlic 4 min. Add spices 1 min.","Add tomatoes and broth. Return beef.","Simmer covered 30-35 min until tender.","Serve with warm tortillas or over cilantro-lime rice."],
    tip:"Cut the beef chuck into larger cubes than you think - 2 inches. Small pieces overcook and dry out during the braise. Large pieces break down properly and stay moist.",
    tip2:"Don't rush the browning step — deeply searing the beef on all sides builds a fond on the bottom of the pot that becomes the flavor base of the entire stew. Pale grey beef makes a pale grey stew.",
    recipe_detailed:["Cut beef chuck into 1.5-inch cubes. Pat dry and season generously. Brown in batches in a heavy pot over high heat until deeply seared on all sides — do not crowd the pan. Remove each batch.","In the same pot, saute onion, bell pepper, and garlic until softened. Add cumin, chili powder, and oregano, stir 1 min.","Add diced tomatoes, broth, and return the beef. Bring to a boil, then reduce to a very low simmer.","Braise covered 1.5-2 hours until the beef is fall-apart tender. Stir in a spoonful of masa harina dissolved in water to thicken. Serve with warm flour tortillas and rice."]},
  { id:111, name:"Beef Fajita Bowls",                protein:"beef", cal:430, time:15, servings:6,
    desc:"Sizzled skirt steak, charred peppers and onions, avocado, lime",
    ingredients:["1.5 lb skirt steak, sliced thin","3 bell peppers, sliced","1 large onion, sliced","2 tbsp fajita seasoning","2 avocados","1 lime","2 tbsp olive oil","3 cups jasmine rice, cooked","Sour cream","Salsa"],
    recipe:["Season steak with fajita seasoning.","Sear in hot skillet 2-3 min per side. Rest and slice.","In same pan, char peppers and onion 5 min.","Build bowls: cauli rice, steak, peppers, avocado.","Finish with lime, sour cream, and salsa."],
    tip:"Sear the beef in a single layer without moving it for at least 3 minutes. Resist the urge to stir. The crust is where the flavor lives, and it won't form if the meat steams.",
    tip2:"Marinate the steak in lime juice, oil, and cumin for at least 30 min but no more than 4 hours — beyond that, the acid starts to cook the surface of the meat and gives it an unpleasant mealy texture.",
    recipe_detailed:["Slice flank steak thin against the grain. Toss with lime juice, oil, cumin, garlic powder, and chili powder. Marinate 30 min to 4 hours.","Cook in a screaming hot cast iron pan in batches — 1-2 min per side maximum. The goal is char, not thorough cooking. The thin slices cook through in seconds. Rest 3 min before serving.","In the same pan, cook sliced peppers and onion over high heat 4-5 min until charred at the edges.","Build bowls: rice or lettuce base, beef and peppers, guacamole, pico de gallo, sour cream, and shredded cheese. Squeeze lime over everything."]},
  { id:112, name:"Birria-Style Beef Tacos",           protein:"beef", cal:510, time:60, servings:6,
    desc:"Braised chili-spiced beef, crispy fried tacos, consommé for dipping",
    ingredients:["2 lb beef chuck","3 dried guajillo chiles, soaked","2 dried ancho chiles, soaked","4 cloves garlic","1 tsp cumin","1 tsp oregano","2 cups beef broth","12 corn tortillas","1 cup Oaxacan or mozzarella cheese","White onion, cilantro, lime to serve"],
    recipe:["Blend soaked chiles, garlic, cumin, oregano, broth into sauce.","Brown beef, pour sauce over. Braise covered 45-50 min until shreddable.","Shred beef. Reserve braising liquid as consommé.","Dip tortillas in consommé, fill with beef and cheese, fry until crispy.","Serve with onion, cilantro, lime, and consommé for dipping."],
    tip:"The consommé dip is not optional. It's what transforms birria tacos from good to extraordinary. Dip the assembled taco briefly - just enough to coat, not soak.",
    tip2:"Dip the tortilla into the top of the consomme before frying — the fat that floats on top of the broth is where the color comes from. A properly dipped tortilla turns a deep, brilliant orange-red in the pan.",
    recipe_detailed:["Make the adobo: toast dried guajillo and ancho chiles in a dry pan 30 seconds per side. Remove stems and seeds, soak in hot water 15 min. Blend with garlic, oregano, cumin, and some soaking liquid.","Season beef chunks generously. Brown in batches in a Dutch oven. Add the chile sauce and enough broth to cover. Braise at 325F for 3 hours until pull-apart tender. Shred beef into the broth.","Dip corn tortillas into the top of the consomme. Cook in a hot dry skillet 1-2 min per side until crispy. Fill with shredded beef and cheese, fold in half.","Serve with a small bowl of warm consomme for dipping. Top tacos with white onion, fresh cilantro, and lime."]},
  // ── PORK ─────────────────────────────────────────────────────────────────
  { id:113, name:"Pork Carnitas Bowls",              protein:"pork", cal:440, time:20, servings:6,
    desc:"Crispy shredded pork over greens with pico, avocado, and lime crema",
    ingredients:["2 lb pork shoulder, cubed","1 orange, juiced","1 lime, juiced","4 cloves garlic","1 tsp cumin","1 tsp oregano","Salt & pepper","2 avocados","1 cup pico de gallo","1/2 cup Greek yogurt","4 cups romaine"],
    recipe:["Season pork. Cook in instant pot 25 min (or slow cooker 6-8 hrs) with OJ, lime, garlic.","Shred pork, spread on sheet pan, broil 3-4 min until crispy.","Mix yogurt with lime juice for crema.","Build bowls: romaine, carnitas, avocado, pico, crema."],
    tip:"The broil step at the end is what makes carnitas. Without crisping the edges under high heat, you just have pulled pork. The caramelized bits are the whole point.",
    tip2:"After the long braise, spread the pork on a sheet pan and broil it — 5 min is enough to caramelize the edges and create those crispy, charred bits that make carnitas special. Don't skip the broil.",
    recipe_detailed:["Cut pork shoulder into large chunks, season generously with salt, pepper, cumin, oregano, and garlic. Place in a Dutch oven or slow cooker with orange juice, lime juice, and diced onion.","Braise in a 325F oven 3-4 hours or slow cook on low 8 hours until the pork shreds easily when pressed.","Remove pork, shred roughly with two forks. Spread on a foil-lined sheet pan. Pour some cooking liquid over the meat. Broil 5-7 min until edges crisp and caramelize — watch closely.","Serve in bowls over cilantro rice with black beans, pico de gallo, shredded cheese, sour cream, and avocado. Squeeze lime over everything."]},
  { id:114, name:"Pork Tenderloin & Roasted Apples", protein:"pork", cal:390, time:25, servings:3,
    desc:"Herb-crusted pork tenderloin with caramelized apples and green beans",
    ingredients:["1.5 lb pork tenderloin","2 apples, cored and sliced","2 cups green beans","2 tbsp olive oil","1 tsp rosemary","1 tsp thyme","2 cloves garlic","1 tbsp honey","Salt & pepper"],
    recipe:["Preheat oven to 425°F. Rub tenderloin with oil, rosemary, thyme, garlic, salt.","Sear in oven-safe skillet 3 min per side.","Add apple slices and green beans around pork. Drizzle honey over apples.","Roast 14-16 min until pork hits 145°F. Rest 5 min.","Slice and serve with apples and green beans."],
    tip:"Pull the pork from the oven at 145°F and rest 5 minutes. USDA guidelines allow medium doneness - well-done pork tenderloin is dry and chalky.",
    tip2:"Pork tenderloin is very lean and overcooks fast. Pull it at 140-145F internal temp — it will look slightly pink in the center, which is safe and keeps it juicy. Cooking to 160F turns it grey and dry.",
    recipe_detailed:["Pat pork tenderloin dry and season generously. Sear in a hot oven-safe skillet with oil over medium-high heat, turning to brown all sides, about 6 min total.","Remove pork. In the same pan, add apple wedges and onion slices. Cook 2-3 min until starting to soften. Add a splash of apple cider or broth to deglaze.","Return pork to the pan on top of the apple mixture. Transfer to a 400F oven for 15-20 min until a thermometer reads 140-145F.","Rest pork 5 min before slicing — the temperature will rise to 145F as it rests. Slice into medallions and serve with the pan apples and any juices."]},
  { id:115, name:"Pork & Veggie Stir Fry",           protein:"pork", cal:370, time:15, servings:3,
    desc:"Ground pork, snap peas, bok choy, ginger-garlic sauce over cauli rice",
    ingredients:["1 lb ground pork","2 heads baby bok choy, halved","1.5 cups snap peas","3 cloves garlic","1 tbsp ginger","3 tbsp soy sauce","1 tbsp sesame oil","1 tsp honey","3 cups jasmine rice, cooked","Sesame seeds"],
    recipe:["Brown pork in a wok over high heat. Drain fat.","Add garlic and ginger 1 min.","Add bok choy and snap peas, stir fry 3 min.","Add soy sauce, sesame oil, honey. Toss 1 min.","Serve over steamed jasmine rice with sesame seeds."],
    tip:"Use medium-high heat and don't add the sauce until you've gotten good color on the vegetables. Sauce added too early steams everything and prevents browning.",
    tip2:"Freeze the pork loin for 20 min before slicing — it firms up and you can cut it much thinner than fully thawed meat. Thin slices cook in 2 min and stay tender.",
    recipe_detailed:["Slice pork thin against the grain. Toss with soy sauce, cornstarch, and a little sesame oil. Let sit 10 min.","Heat a wok over highest heat until smoking. Add oil, then pork in a single layer. Sear 60 seconds, toss, cook 30 more seconds. Remove — it should be just cooked through.","In the same wok, stir fry dense vegetables first 2 min, then softer ones 1 min. Add garlic and ginger.","Return pork. Add stir fry sauce. Toss everything 1 min until sauce thickens and coats. Serve over rice."]},
  { id:116, name:"Pork Chops & Mushroom Gravy",      protein:"pork", cal:450, time:20, servings:3,
    desc:"Pan-seared thick-cut pork chops in savory mushroom and herb gravy",
    ingredients:["4 thick-cut pork chops","2 cups cremini mushrooms, sliced","1 cup chicken broth","2 tbsp butter","3 cloves garlic","1 tsp thyme","1 tbsp Worcestershire sauce","Salt & pepper","Olive oil"],
    recipe:["Season pork chops well. Sear in hot skillet 4-5 min per side. Remove.","Sauté mushrooms 5 min. Add garlic and thyme 1 min.","Add broth and Worcestershire, scrape up bits. Simmer 3 min.","Swirl in butter, return chops, spoon gravy over. Serve."],
    tip:"Resist the urge to move the pork chops while searing. They'll release naturally when a proper crust has formed. Forcing them early tears the crust and loses the fond.",
    tip2:"Scraping up the browned bits (fond) when you add the broth is not optional — that's where the gravy's flavor is. Use a wooden spoon and really get in there.",
    recipe_detailed:["Pat the pork chops completely dry with paper towels — moisture is the enemy of a good sear. Season generously on both sides with salt and pepper. Dry surface + hot pan = crust.","Heat oil in a large skillet over medium-high until shimmering. Add the chops and don't touch them — let them sear 4–5 min. They'll release naturally when they've built a crust. Flip and sear the other side 3–4 min. They should be deep golden brown. Remove to a plate — they may not be fully cooked through yet and that's fine.","Reduce heat to medium. Add mushrooms to the same pan and cook 5 min without stirring much, letting them brown on one side before tossing. Add garlic and thyme and stir 1 min.","Pour in the broth and Worcestershire sauce. Use a wooden spoon to scrape up every bit of the browned residue from the bottom — that's concentrated flavor. Simmer 3 min until slightly reduced.","Swirl in the cold butter — this gives the gravy a glossy, velvety texture. Return the pork chops to the pan, spoon gravy generously over them, and let them rest in the sauce 2 min. The residual heat finishes cooking them through."]},
  { id:117, name:"Sausage & Pepper Skillet",         protein:"pork", cal:420, time:15, servings:6,
    desc:"Italian sausage, bell peppers, onions, marinara over zucchini noodles",
    ingredients:["1 lb Italian sausage, sliced","3 bell peppers, sliced","1 onion, sliced","1 cup marinara sauce","4 medium zucchini, spiralized","3 cloves garlic","2 tbsp olive oil","Italian seasoning","Parmesan to serve"],
    recipe:["Sear sausage slices until browned, 5 min. Remove.","Sauté peppers and onion 5 min. Add garlic 1 min.","Return sausage, add marinara and seasoning. Toss 2 min.","Sauté zucchini noodles 2 min separately.","Plate noodles, top with sausage mixture and parmesan."],
    tip:"Brown the sausage in a dry pan with no added oil - there's plenty of fat in the sausage itself. Rendering its own fat creates better browning than oil ever could.",
    tip2:"Brown the sausage slices in a single layer without stirring — those browned, caramelized cut faces are packed with flavor. Stirring constantly gives you grey sausage with no crust.",
    recipe_detailed:["Slice sausage into rounds. Heat oil in a large skillet over medium-high. Add sausage in a single layer cut-side down. Cook 3-4 min without stirring until deeply browned on one face. Flip and cook 2 min. Remove.","In the same pan, add sliced bell peppers and onion. Cook over medium-high heat 5-6 min until softened and charred at the edges — let them sit without stirring for 2 min at a time.","Add garlic, Italian seasoning, and crushed tomatoes if using. Stir and cook 2 min. Return sausage to the pan and toss everything together.","Serve over rice, pasta, or in hoagie rolls. Top with fresh basil."]},
  // ── NEW SALMON ───────────────────────────────────────────────────────────
  { id:118, name:"Miso-Glazed Salmon",               protein:"seafood", cal:290, time:15, servings:3,
    desc:"Umami-rich miso and honey glazed salmon, edamame, cucumber, sesame",
    ingredients:["4 salmon fillets","2 tbsp white miso paste","1 tbsp honey","1 tbsp soy sauce","1 tbsp rice vinegar","1 tsp sesame oil","1 cup shelled edamame","2 cucumbers, sliced","Sesame seeds","Green onion"],
    recipe:["Mix miso, honey, soy, vinegar, sesame oil for glaze.","Coat salmon with glaze.","Bake at 400°F 10-12 min or broil 6-8 min until caramelized.","Warm edamame.","Build bowls: cucumber, edamame, salmon. Top with sesame seeds and green onion."],
    tip:"White miso is mild and sweet. Red miso is more intense. Either works, but white gives you a more delicate glaze that pairs better with salmon without overpowering it.",
    tip2:"Watch the miso glaze closely after the 5-minute mark — the sugars in miso and mirin burn fast and go from perfectly caramelized to bitter in under a minute.",
    recipe_detailed:["Whisk together white miso paste, mirin, sake, and sugar until smooth. Spread generously over the salmon fillets. Marinate 30 min minimum — overnight makes it significantly better.","Preheat broiler to high. Line a baking sheet with foil and lightly oil it. Place salmon skin-side down.","Broil 6-8 min, watching closely after 5 min. The glaze should bubble and turn deep amber-brown in spots. The salmon is done when it flakes at the edges.","Serve over steamed rice with pickled ginger and a sprinkle of sesame seeds."]},
  { id:119, name:"Coconut Lime Salmon Bowls",        protein:"seafood", cal:340, time:15, servings:3,
    desc:"Baked salmon with coconut-lime marinade, mango, avocado, cilantro",
    ingredients:["4 salmon fillets","2 tbsp coconut milk","2 limes, juiced and zested","2 cloves garlic","1 tsp honey","1 mango, diced","2 avocados, sliced","3 cups jasmine rice, cooked","Fresh cilantro"],
    recipe:["Mix coconut milk, lime juice, garlic, honey. Marinate salmon 10 min.","Bake at 400°F 12-14 min.","Toss cauli rice with lime zest and cilantro.","Build bowls: rice, salmon, mango, avocado.","Squeeze extra lime over everything."],
    tip:"Line the baking dish with banana leaves or parchment before adding the marinated salmon. It prevents sticking and infuses a subtle grassy aroma into the fish.",
    tip2:"Add the lime juice at the end of simmering, not the beginning. Long cooking makes lime bitter. A squeeze at the very end keeps it bright, fresh, and acidic.",
    recipe_detailed:["Make the coconut lime broth: simmer coconut milk, a little broth, garlic, and ginger over medium heat 5 min.","Season salmon and nestle into the broth. Cover and poach gently over low heat 8-10 min until the salmon flakes easily. This gentle method keeps it incredibly moist.","Remove salmon. Squeeze lime juice into the broth, taste and season with salt.","Serve over jasmine rice. Ladle broth over the bowls, top with salmon, fresh cilantro, sliced green onion, and sliced chili."]},
  // ── SHRIMP ───────────────────────────────────────────────────────────────
  { id:120, name:"Garlic Butter Shrimp & Asparagus", protein:"seafood", cal:310, time:12, servings:3,
    desc:"Jumbo shrimp in garlic butter sauce with crispy roasted asparagus",
    ingredients:["1.5 lb large shrimp, peeled and deveined","1 bunch asparagus, trimmed","5 cloves garlic, minced","4 tbsp butter","1 lemon, juiced","Fresh parsley","Red pepper flakes","Salt & pepper"],
    recipe:["Roast asparagus at 425°F with olive oil and salt for 10 min.","Heat butter in skillet. Add garlic and red pepper flakes 1 min.","Add shrimp in single layer. Cook 2 min per side until pink.","Squeeze lemon over. Top with parsley.","Plate asparagus and shrimp together."],
    tip:"Pat the shrimp absolutely dry before seasoning. Wet shrimp steam instead of sear and will never develop color. A 2-minute pan-sear on dry shrimp beats 5 minutes on wet.",
    tip2:"Shrimp overcook in seconds. Once they curl into a C-shape and turn pink, they are done. An O-shape means overcooked. When in doubt, pull them 30 seconds early — they keep cooking in residual heat.",
    recipe_detailed:["Pat shrimp dry and season with salt, pepper, and paprika. Trim woody ends off asparagus.","Heat oil in a large skillet over high heat. Add asparagus and cook 3-4 min, tossing occasionally, until bright green and just tender. Remove to a plate.","In the same pan, melt butter over medium-high. Add garlic and cook 30 seconds until fragrant. Add shrimp in a single layer and cook 1-2 min per side until they curl into a C-shape and turn pink throughout.","Return asparagus to the pan. Add a squeeze of lemon and toss everything together. Serve over rice or pasta."]},
  { id:121, name:"Cajun Shrimp Bowls",               protein:"seafood", cal:380, time:12, servings:6,
    desc:"Spicy Cajun shrimp over jasmine rice with corn and avocado",
    ingredients:["1.5 lb large shrimp, peeled and deveined","2 tbsp Cajun seasoning","3 cups jasmine rice, cooked","1 cup corn","2 avocados, sliced","2 limes","Fresh cilantro","2 tbsp olive oil"],
    recipe:["Toss shrimp with Cajun seasoning.","Sear in hot skillet 2 min per side. Don't overcook.","Warm corn in same pan.","Build bowls: cauli rice, corn, shrimp, avocado.","Finish with lime juice and cilantro."],
    tip:"Don't overcook the shrimp - pull them the instant they curl into a C shape and turn opaque. Overcooked shrimp are rubbery in seconds. They carry over from the residual heat.",
    tip2:"Make the Cajun seasoning yourself: paprika, garlic powder, onion powder, cayenne, thyme, oregano, salt, and pepper. Store-bought blends often have too much salt and not enough heat.",
    recipe_detailed:["Toss shrimp with Cajun seasoning and a little oil so every shrimp is coated.","Heat a cast iron or heavy skillet over high heat until very hot. Add shrimp in a single layer — sear 1-2 min per side without stirring, until you see a slight char and they are cooked through. Work in batches if needed.","Cook rice according to package. Saute onion, pepper, and celery in the shrimp drippings for 3 min, then serve alongside.","Build bowls: rice, shrimp, corn, avocado, and black beans. Drizzle with remoulade or creamy Cajun sauce and top with green onions."]},
  { id:122, name:"Shrimp Tacos",                     protein:"seafood", cal:350, time:12, servings:6,
    desc:"Lime-marinated shrimp, cabbage slaw, avocado crema, corn tortillas",
    ingredients:["1.5 lb shrimp, peeled and deveined","8 small corn tortillas","2 cups shredded purple cabbage","1 lime, juiced","2 avocados","1/2 cup Greek yogurt","1 tsp cumin","1 tsp chili powder","Fresh cilantro"],
    recipe:["Season shrimp with cumin, chili powder, salt. Cook 2 min per side.","Toss cabbage with lime juice and salt.","Blend avocado with yogurt and lime for crema.","Warm tortillas. Build tacos: slaw, shrimp, crema, cilantro."],
    tip:"Season the shrimp aggressively. They cook fast and briefly, so there's limited time for flavors to develop. Season more than you think is right.",
    tip2:"For the slaw, salt the shredded cabbage and let it sit 10 min, then squeeze out the water before dressing. This wilts it slightly and keeps it crispy instead of making your taco soggy.",
    recipe_detailed:["Toss shrimp with chili powder, cumin, garlic powder, salt, and oil. Set aside while you prep everything else.","Make slaw: toss shredded cabbage with lime juice and a pinch of salt. Let sit 10 min, squeeze firmly, then toss with mayo, cilantro, and more lime.","Cook shrimp in a very hot pan 1-2 min per side until pink and just curled into a C. Don't crowd the pan. Remove immediately.","Warm corn tortillas. Fill with slaw, shrimp, avocado slices, and a drizzle of sriracha mayo or chipotle crema. Finish with fresh cilantro and lime."]},
  { id:123, name:"Shrimp Stir Fry",                  protein:"seafood", cal:330, time:12, servings:6,
    desc:"Shrimp, broccoli, snap peas, and bell pepper in ginger-garlic sauce",
    ingredients:["1.5 lb shrimp, peeled and deveined","3 cups broccoli florets","1.5 cups snap peas","2 bell peppers, sliced","3 cloves garlic","1 tbsp ginger","3 tbsp soy sauce","1 tbsp oyster sauce","1 tsp sesame oil","3 cups jasmine rice, cooked"],
    recipe:["Stir fry shrimp 2 min until pink. Remove.","Stir fry broccoli, snap peas, peppers 4 min.","Add garlic and ginger 1 min.","Add soy sauce, oyster sauce, sesame oil. Return shrimp. Toss.","Serve over steamed jasmine rice with sesame seeds."],
    tip:"Cook the shrimp separately and add at the very end. Adding shrimp too early means they're overcooked by the time the vegetables are ready.",
    tip2:"Shrimp go in last in a stir fry — they cook in 2-3 min and are easily overcooked. Cook all your vegetables first, then add shrimp as the very last step right before the sauce.",
    recipe_detailed:["Prep everything before you start cooking — stir fry moves fast. Defrost shrimp, pat dry, and season. Chop all vegetables into similar-sized pieces.","Heat a wok over the highest heat until smoking. Add oil and cook vegetables in order of density: hard veggies first, soft ones after 2 min.","Push vegetables to the sides. Add shrimp to the center and cook 1-2 min per side until pink and just curled. Add garlic and ginger and stir everything together.","Pour stir fry sauce over everything. Toss for 1 min until the sauce thickens and coats. Serve immediately over rice."]},
  { id:124, name:"Shrimp & Cauliflower Grits",       protein:"seafood", cal:360, time:20, servings:6,
    desc:"Spiced shrimp over creamy cauliflower grits with bacon and green onion",
    ingredients:["1.5 lb shrimp, peeled and deveined","4 strips bacon, chopped","1 large head cauliflower, riced fine","1/2 cup chicken broth","3 tbsp butter","1/3 cup parmesan","3 cloves garlic","1 tsp Cajun seasoning","Green onions","Lemon wedges"],
    recipe:["Cook bacon until crispy. Remove, reserve drippings.","Microwave or steam jasmine rice. Stir in butter, parmesan, broth until creamy. Season.","Sauté garlic in drippings 1 min. Add shrimp with Cajun seasoning. Cook 2 min per side.","Serve shrimp over cauliflower grits.","Top with bacon, green onion, and lemon."],
    tip:"The key to creamy cauliflower grits is cooking them with enough liquid and finishing with cold butter off heat. The cold fat emulsifies into the cauliflower for a silky texture.",
    tip2:"Season the grits water generously before cooking — bland water makes bland grits. The cauliflower absorbs whatever liquid it cooks in, so make it count.",
    recipe_detailed:["Rice cauliflower in a food processor. Cook in salted water or broth 5 min until soft. Drain well, then return to the pot and mash with butter, cream cheese, and Parmesan until creamy. Season aggressively.","Season shrimp with Cajun seasoning. Cook bacon in a skillet until crispy, remove. In the bacon fat, cook shrimp 1-2 min per side until pink. Remove.","In the same pan, saute onion, pepper, and garlic 3 min. Add shrimp back, squeeze lemon over everything, and toss.","Spoon cauliflower grits into bowls. Top with shrimp and vegetables, bacon crumbles, and sliced green onions."]},
  { id:125, name:"Coconut Shrimp Curry",              protein:"seafood", cal:390, time:20, servings:6,
    desc:"Juicy shrimp in a fragrant coconut curry sauce with spinach",
    ingredients:["1.5 lb shrimp, peeled and deveined","1 can coconut milk","3 cups baby spinach","2 tbsp red curry paste","1 tbsp fish sauce","1 lime, juiced","2 cloves garlic","1 tsp ginger","3 cups jasmine rice, cooked","Fresh cilantro"],
    recipe:["Sauté garlic and ginger 1 min. Add curry paste, toast 1 min.","Add coconut milk and fish sauce. Simmer 5 min.","Add shrimp, cook 3-4 min until pink.","Stir in spinach and lime juice until wilted.","Serve over steamed jasmine rice with cilantro."],
    tip:"Shrimp go into coconut curry at the very end - 3 minutes maximum. The residual heat in the sauce finishes them perfectly after you remove the pan from the burner.",
    tip2:"Taste the curry before adding the shrimp — this is your one chance to fix the balance. Needs more heat? Add chili. Too sharp? A pinch of sugar. Too flat? More fish sauce or salt.",
    recipe_detailed:["Heat oil in a large pan. Cook onion 4 min until soft, add garlic and ginger 1 min. Add curry paste and fry in the oil 1 min — it should smell fragrant and deepen in color.","Pour in coconut milk and fish sauce. Stir to combine and bring to a gentle simmer. Cook 8 min, tasting and adjusting. Add a pinch of sugar if needed.","Add shrimp to the simmering curry. Simmer 3-4 min until the shrimp are pink and curled. Don't overcook or they turn rubbery.","Squeeze lime juice in at the very end. Serve over jasmine rice with fresh cilantro and sliced chili."]},
  { id:126, name:"Shrimp Cobb Salad",                protein:"seafood", cal:280, time:10, servings:3,
    desc:"Grilled shrimp over romaine with bacon, egg, avocado, tomato, blue cheese",
    ingredients:["1 lb shrimp, peeled and deveined","4 cups romaine, chopped","4 strips bacon, cooked and crumbled","2 hard-boiled eggs, halved","1 avocado, sliced","1 cup cherry tomatoes","1/4 cup blue cheese crumbles","3 tbsp olive oil","1.5 tbsp red wine vinegar","Salt & pepper"],
    recipe:["Season shrimp. Grill or pan-sear 2 min per side.","Whisk olive oil, vinegar, salt, pepper for dressing.","Arrange romaine with rows of bacon, egg, avocado, tomatoes, blue cheese.","Top with shrimp. Drizzle dressing over."],
    tip:"Hard-boil eggs starting in cold water, bring to a boil, then 9 minutes exactly. Transfer immediately to ice water. The yolks will be fully set but still creamy, not chalky.",
    tip2:"Season the shrimp aggressively — they are the only warm element in a cold salad, so they need to stand out. Smoked paprika and a little cayenne do the job.",
    recipe_detailed:["Toss shrimp with smoked paprika, garlic powder, cayenne, salt, and oil. Cook in a hot pan 1-2 min per side until pink. Set aside.","Cook bacon until crispy, drain and crumble. Hard-boil eggs: 10 min from cold water, then ice bath immediately to stop cooking.","Arrange salad: chopped romaine as the base, then rows of halved cherry tomatoes, avocado, crumbled blue cheese, cucumber, bacon, and sliced egg.","Top with warm shrimp. Dress at the table so the lettuce stays crisp."]},
  { id:127, name:"Shrimp Lettuce Wraps",              protein:"seafood", cal:260, time:12, servings:3,
    desc:"Asian-seasoned shrimp, mango, cucumber, and sesame in butter lettuce cups",
    ingredients:["1 lb shrimp, peeled and deveined","1 head butter lettuce","1 mango, diced","1 cucumber, diced","2 tbsp soy sauce","1 tbsp sesame oil","1 tbsp rice vinegar","1 tsp honey","1 tsp ginger","Sesame seeds","Fresh mint"],
    recipe:["Mix soy, sesame oil, vinegar, honey, ginger for dressing.","Cook shrimp 2 min per side in a hot skillet. Cool slightly.","Separate lettuce into cups.","Fill each cup with shrimp, mango, cucumber.","Drizzle dressing, finish with sesame seeds and mint."],
    tip:"Keep the shrimp slightly underdone when you take them off the heat. They'll finish cooking from residual heat as they cool, and the texture in the wraps will be perfect.",
    tip2:"Butter lettuce cups need to be completely dry before filling — a drop of water and the wrap falls apart. Wash and dry the leaves well in advance and refrigerate them on paper towels.",
    recipe_detailed:["Cook shrimp in a hot pan with oil 1-2 min per side until pink. Roughly chop into bite-sized pieces. Season with salt, pepper, and a squeeze of lime.","Prepare fillings: shredded cabbage, julienned carrots, sliced cucumber, diced mango, fresh mint, and cilantro. Everything small enough to fit neatly in a lettuce cup.","Make the dipping sauce: whisk together lime juice, fish sauce, sugar, chili, and garlic — it should be sweet, sour, salty, and spicy.","Separate butter lettuce leaves and lay them out. Fill each with shrimp and toppings. Drizzle with sauce just before eating so the lettuce stays crisp."]},
  // ── RED BEANS & RICE ────────────────────────────────────────────────────
  { id:128, name:"Red Beans & Rice with Sausage",    protein:"plant-based", cal:420, time:30, servings:6,
    desc:"Creamy Louisiana red beans with Andouille sausage, the Holy Trinity, and rice",
    ingredients:["2 cans red kidney beans, drained","1 lb Andouille sausage, sliced","1 onion, diced","3 stalks celery, diced","1 green bell pepper, diced","4 cloves garlic","1 tsp thyme","1 tsp smoked paprika","1/2 tsp cayenne","2 bay leaves","2 cups chicken broth","3 cups cooked white or brown rice","Hot sauce to serve","Green onion to top"],
    recipe:["Sauté sausage until browned, 5 min. Remove.","In drippings, cook onion, celery, and bell pepper until soft, 6 min.","Add garlic, thyme, paprika, cayenne, bay leaves. Cook 1 min.","Add beans and broth. Simmer 15 min, smashing some beans for creaminess.","Return sausage, simmer 5 more min. Remove bay leaves. Serve over rice with hot sauce."],
    tip:"Smashing some beans against the pot is the difference between a watery dish and a creamy, restaurant-style red beans. Use the back of a spoon and press firmly against the pot wall.",
    tip2:"Smash some of the beans against the side of the pot toward the end. This releases starch and creates a thick, creamy sauce that coats the rice rather than sitting watery around it.",
    recipe_detailed:["Cook the Holy Trinity — onion, celery, and bell pepper — in oil 5-7 min until soft. Add garlic and Andouille sausage, cook 3 min until sausage starts to render.","Add drained beans, broth, bay leaves, thyme, and cayenne. Bring to a boil, then reduce to a low simmer. Cook 20-45 min depending on whether using canned or soaked dried beans.","In the last 10 min, smash some beans against the side of the pot until the sauce is thick and creamy. Season with salt, pepper, and a splash of hot sauce.","Serve over white rice. Top with sliced sausage and fresh green onions."]},
  { id:129, name:"Cajun Snow Crab Boil",              protein:"seafood", cal:520, time:60, servings:6,
    desc:"A festive Gulf Coast seafood boil - snow crab, shrimp, corn, and potatoes smothered in garlic butter",
    ingredients:["3 qts water","12 oz beer (optional)","3 tbsp Cajun seasoning","1 tbsp Old Bay seasoning","Hot sauce to taste","1 yellow onion, sliced","1 lemon, cut into wedges","12 oz andouille sausage, sliced","1 lb baby potatoes","1 lb snow crab leg clusters","1 lb jumbo shrimp, shell-on","4-6 ears corn (or mini ears)","1 cup unsalted butter","10 cloves garlic, minced","2 tbsp lemon juice","1 tbsp fresh parsley, chopped","1 tsp smoked paprika"],
    recipe:["Bring water and beer to a boil. Season with Cajun seasoning, Old Bay, and hot sauce. Add onion and lemon. Boil 15 min.","Add sausage and potatoes. Cook 15-20 min until potatoes are fork-tender.","Add crab, shrimp, and corn. Boil 5-7 min until shrimp are pink.","Melt butter in a saucepan over medium heat. Add garlic, lemon juice, Old Bay, parsley, Cajun seasoning, paprika, and hot sauce. Simmer 5-7 min.","Drain boil onto a foil-lined sheet pan. Pour garlic butter over everything and toss to coat. Serve immediately with lemon wedges."],
    tip:"Line your table with butcher paper and dump it all in the middle - the mess is half the fun. Disposable gloves make it even better.",
    tip2:"The secret is in the seasoned water — use so much seasoning that you can taste the salt and spice in the water itself before the crab goes in.",
    recipe_detailed:["Fill a large pot with water and bring to a boil. Add Cajun seasoning, Old Bay, salt, lemon halves squeezed in, garlic, and bay leaves. Taste the water — it should taste aggressively seasoned.","Add corn and potatoes first — they take longest. Boil 10 min. Add sausage and cook 5 more min.","Add crab clusters and cook 5-7 min until heated through. Drain everything and spread on a paper-covered table.","Melt butter with garlic and Old Bay for dipping. Serve with crusty bread. Eat with your hands."]},

  // ── Breakfast for dinner ──────────────────────────────────────────────────
  { id:130, name:"Shakshuka",                         protein:"breakfast", cal:310, time:25, servings:4,
    desc:"Eggs poached in a spiced tomato and pepper sauce - a Middle Eastern classic that's ready in one pan",
    ingredients:["2 tbsp olive oil","1 onion, diced","1 red bell pepper, diced","4 garlic cloves, minced","1 tsp cumin","1 tsp smoked paprika","1/2 tsp chili flakes","2 cans (14 oz) crushed tomatoes","6 eggs","Salt and pepper","Fresh parsley or cilantro","Crusty bread or pita to serve","Crumbled feta (optional)"],
    recipe:["Heat oil in a large skillet over medium. Cook onion and pepper until soft, 6 min.","Add garlic, cumin, paprika, and chili flakes. Cook 1 min.","Pour in crushed tomatoes. Season, simmer 10 min until thickened.","Make 6 wells in the sauce and crack an egg into each. Cover and cook 5-8 min until whites are set but yolks still runny.","Top with parsley and feta. Serve straight from the pan with bread."],
    tip:"Don't overcook the eggs - pull them when the whites are just set. Residual heat will finish the yolks.",
    tip2:"If your sauce looks too thin before adding the eggs, let it simmer uncovered an extra 3–5 min. Eggs need a thick sauce to nestle into — too thin and they spread and cook unevenly.",
    recipe_detailed:["Heat oil in a large, deep skillet or oven-safe pan over medium heat. Add the onion and pepper and cook 6–7 min, stirring occasionally, until fully softened and the onion is translucent. Don't rush this — soft vegetables are the base of the sauce.","Add garlic, cumin, paprika, and chili flakes. Stir constantly for 1 min — the spices will bloom in the oil and smell intensely fragrant. This is the flavor foundation of the dish.","Pour in the crushed tomatoes. Season with salt and pepper. Stir to combine and simmer over medium-low heat for 10 min, stirring occasionally, until the sauce thickens and deepens in color. It should be thick enough that a spoon dragged through holds a line for a moment.","Use the back of a spoon to make 6 shallow wells in the sauce. Crack one egg into each well, being careful not to break the yolks. Cover the pan with a lid and cook 5–8 min — check at 5 min. The whites should be fully set and opaque but the yolks should still be soft and jiggly when you gently shake the pan.","Remove from heat immediately and top with parsley, feta, and a drizzle of olive oil. Serve straight from the pan with crusty bread or pita for scooping."]},

  { id:131, name:"Breakfast Burritos",                protein:"breakfast", cal:490, time:20, servings:4,
    desc:"Scrambled eggs, crispy potatoes, sausage, and cheese wrapped in a warm flour tortilla",
    ingredients:["8 large eggs","1/2 lb breakfast sausage","2 cups frozen diced potatoes or hash browns","1/2 onion, diced","1 cup shredded cheddar","4 large flour tortillas","Salsa and sour cream to serve","Salt and pepper","Hot sauce optional"],
    recipe:["Cook sausage in a skillet, breaking it up, until browned. Remove.","Add potatoes and onion to the same skillet. Cook until golden and crispy, 8-10 min.","Whisk eggs with salt and pepper. Pour into the pan over the potatoes. Scramble until just set.","Return sausage to pan. Mix to combine.","Warm tortillas. Fill each with egg mixture and cheese. Roll tightly. Serve with salsa and sour cream."],
    tip:"Wrap the burritos in foil and you can make them ahead. They reheat perfectly in the oven at 350°F for 15 min.",
    tip2:"Toasting the burrito in a dry pan after wrapping seals it shut and adds a satisfying crispy exterior. It also prevents it from unwrapping as you eat.",
    recipe_detailed:["Cook sausage or bacon in a skillet, breaking it up. Remove and leave some fat in the pan.","Whisk eggs with a splash of milk, salt, and pepper. Add to the same pan over medium-low heat. Stir slowly with a spatula — you want large, soft curds. Pull off the heat while they look slightly underdone. Residual heat finishes them.","Warm flour tortillas. Layer down the center: eggs, meat, cheese, potatoes, salsa, and sour cream. Don't overfill or they won't wrap.","Fold sides in first, then roll tightly from the bottom up. Toast the burrito seam-side down in a dry pan 1-2 min per side until golden and sealed."]},

  { id:132, name:"French Toast Casserole",            protein:"breakfast", cal:430, time:40, servings:6,
    desc:"Thick-cut brioche soaked in a custard, baked until golden and served with maple syrup",
    ingredients:["1 loaf brioche or challah, cut thick","6 eggs","1 1/2 cups whole milk","1/2 cup heavy cream","3 tbsp sugar","2 tsp vanilla","1 1/2 tsp cinnamon","1/4 tsp nutmeg","2 tbsp butter","Powdered sugar to serve","Maple syrup to serve","Fresh berries to serve"],
    recipe:["Butter a 9x13 baking dish. Arrange bread slices overlapping in the dish.","Whisk eggs, milk, cream, sugar, vanilla, cinnamon, and nutmeg. Pour over bread. Press down gently.","Cover and refrigerate 30 min (or overnight).","Preheat oven to 350°F. Bake uncovered 35-40 min until golden and puffed.","Dust with powdered sugar. Serve with maple syrup and berries."],
    tip:"Using day-old bread is key - it absorbs the custard without going soggy. Brioche or challah make this genuinely special.",
    tip2:"The longer the bread soaks, the more custardy the interior. Assemble the night before and refrigerate — the bread fully saturates and you just bake it in the morning.",
    recipe_detailed:["Tear or slice bread into thick chunks. Day-old bread is better — it is drier and absorbs more custard without getting soggy.","Whisk together eggs, milk, cream, sugar, vanilla, cinnamon, and a pinch of salt.","Pour custard over bread in a baking dish. Press the bread down gently so every piece soaks up the liquid. Let soak 30 min minimum. Overnight is best.","Bake at 350F for 40-45 min until puffed, golden, and set in the center — a knife inserted in the middle should come out clean. Let rest 5 min before scooping. Serve with maple syrup."]},

  { id:133, name:"Chicken & Waffle Stack",            protein:"breakfast", cal:560, time:35, servings:4,
    desc:"Crispy fried chicken on golden Belgian waffles with maple syrup and hot sauce",
    ingredients:["4 boneless chicken thighs","1 cup buttermilk","1 cup flour","1 tsp garlic powder","1 tsp smoked paprika","Salt and pepper","Oil for frying","2 cups waffle mix","Eggs and oil per waffle mix instructions","Maple syrup","Hot sauce","Butter"],
    recipe:["Marinate chicken in buttermilk, salt, and pepper 20 min.","Mix flour with garlic powder, paprika, salt, and pepper. Dredge chicken pieces.","Fry in 350°F oil, 5-6 min per side until golden and cooked through. Drain on rack.","Make waffles per package instructions.","Stack waffles and chicken. Serve with maple syrup, butter, and hot sauce."],
    tip:"The contrast of the sweet syrup and the hot sauce is the whole point - don't skip either one.",
    tip2:"Fry the chicken at 325-350F — not higher. Too hot and the outside burns before the inside cooks. Use a thermometer; consistent oil temperature is the difference between crispy and greasy.",
    recipe_detailed:["Brine chicken pieces in buttermilk for at least 1 hour, preferably overnight. This tenderizes the meat and keeps it moist through frying.","Season flour generously with salt, pepper, garlic powder, paprika, and cayenne. Dredge chicken in the flour, back in buttermilk, then back in flour — the double dredge creates a thick, craggy crust.","Heat 2-3 inches of oil to 325-350F. Fry chicken in batches 12-15 min, turning once, until deep golden and a thermometer reads 165F. Drain on a wire rack.","Make waffles. Stack: waffle, chicken, waffle, chicken. Drizzle with maple syrup and hot sauce."]},

  { id:134, name:"Huevos Rancheros",                  protein:"breakfast", cal:370, time:20, servings:4,
    desc:"Fried eggs on warm corn tortillas with ranchero sauce, refried beans, and fresh toppings",
    ingredients:["8 eggs","8 corn tortillas","1 can refried beans","1 can diced tomatoes with green chiles","1 onion, diced","2 garlic cloves","1 jalapeño, diced","1 tsp cumin","1/2 cup chicken broth","Oil for frying","Avocado, sliced","Cotija cheese, crumbled","Cilantro and lime to serve"],
    recipe:["Make ranchero sauce: sauté onion, jalapeño, and garlic until soft. Add tomatoes, cumin, and broth. Simmer 10 min.","Warm refried beans. Lightly fry tortillas in oil until just crisp at edges.","Fry eggs sunny side up.","Spread beans on tortillas. Top with egg and ranchero sauce.","Finish with avocado, cotija, cilantro, and a squeeze of lime."],
    tip:"If you want to make this faster on a weeknight, use store-bought salsa instead of making the ranchero sauce from scratch.",
    tip2:"Simmer the ranchero sauce longer than you think — 15 min of simmering concentrates it from thin tomato liquid into a thick, deeply flavored sauce. Don't rush it.",
    recipe_detailed:["Make ranchero sauce: saute onion, jalapeno, and garlic in oil until soft. Add crushed tomatoes, cumin, chili powder, and salt. Simmer 12-15 min until thickened and the color deepens. Taste and adjust heat.","Warm corn tortillas in a dry skillet or directly over a gas flame. Keep warm wrapped in a towel.","Fry eggs in oil or butter over medium heat. For sunny-side: cover the pan with a lid and cook 2-3 min until whites are set and yolks are still runny.","Assemble: tortilla, spoonful of black beans, egg, ranchero sauce, crumbled cotija or feta, sliced avocado, and fresh cilantro."]},

  { id:135, name:"Hash Brown Egg Bake",               protein:"breakfast", cal:400, time:40, servings:6,
    desc:"A hearty one-dish dinner: crispy hash brown crust loaded with eggs, bacon, and cheese",
    ingredients:["1 bag (20 oz) frozen shredded hash browns, thawed","4 tbsp butter, melted","1 tsp garlic powder","Salt and pepper","6 eggs","1/2 cup milk","1 cup shredded cheddar","6 slices bacon, cooked and crumbled","3 green onions, sliced","1/2 cup sour cream to serve"],
    recipe:["Preheat oven to 400°F. Grease a 9x13 baking dish.","Toss hash browns with butter, garlic powder, salt, and pepper. Press into dish forming a crust. Bake 25 min until golden.","Whisk eggs with milk, salt, and pepper. Pour over crust. Scatter bacon and half the cheese.","Bake 15 min until eggs are set. Top with remaining cheese and melt 2 more min.","Garnish with green onions. Serve with sour cream."],
    tip:"Fully thaw the hash browns and squeeze out excess moisture - that's what gets you the crispy crust instead of a soggy mess.",
    tip2:"Press the hash brown layer firmly into the pan and bake it for 15 min before adding eggs. You want it golden and set, not soft — otherwise you get a mushy base instead of a crispy crust.",
    recipe_detailed:["Preheat oven to 400F. Squeeze all moisture out of shredded potatoes in a towel — really wring it out. Season with salt, pepper, and garlic powder.","Press hash brown mixture firmly into a greased baking dish or cast iron, making an even layer. Bake 15 min until the edges start to turn golden and the center is set.","Meanwhile, cook your mix-ins: saute sausage, peppers, onion, and any vegetables until cooked through.","Spread mix-ins over the hash brown crust. Make wells and crack eggs in. Season eggs. Scatter cheese over everything. Bake 12-15 min until whites are fully set. Let rest 5 min before slicing."]},

  { id:136, name:"Egg Fried Rice",                    protein:"breakfast", cal:390, time:15, servings:4,
    desc:"Quick weeknight fried rice loaded with eggs, vegetables, and soy sauce",
    ingredients:["3 cups cooked day-old rice","4 eggs, beaten","2 tbsp soy sauce","1 tbsp sesame oil","1 tbsp oyster sauce","3 garlic cloves, minced","1 cup frozen peas and carrots","4 green onions, sliced","2 tbsp vegetable oil","White pepper to taste","Sriracha to serve"],
    recipe:["Heat oil in a wok or large skillet over high heat.","Add garlic, cook 30 seconds. Add peas and carrots, stir fry 2 min.","Push vegetables to the side. Pour in eggs, scramble until just set.","Add rice. Toss everything together over high heat 2-3 min.","Add soy sauce, oyster sauce, sesame oil, and white pepper. Toss. Serve with sriracha."],
    tip:"Day-old refrigerated rice is mandatory - fresh rice is too wet and turns to mush. Make the rice the night before.",
    tip2:"Day-old cold rice is essential — freshly cooked rice is too moist and clumps. Spread leftover rice on a sheet pan and refrigerate uncovered overnight to dry it out. This single step is why restaurant fried rice beats home attempts.",
    recipe_detailed:["Use cold, day-old rice. Break up any clumps with your hands before adding to the pan.","Heat a wok or large pan over the highest heat you have. Add oil until shimmering. Add the cold rice and spread in an even layer. Don't stir for 1-2 min — let it crisp on the bottom. Toss and repeat.","Push rice to the sides. Add a little more oil to the center, then the eggs. Scramble until just barely set, then toss through the rice.","Add soy sauce, sesame oil, and any vegetables or protein. Toss everything over high heat for 1-2 min until fragrant. Finish with green onions."]},

  { id:137, name:"Smoked Salmon Frittata",            protein:"breakfast", cal:340, time:25, servings:4,
    desc:"A light oven-baked Italian egg dish with smoked salmon, cream cheese, and fresh dill",
    ingredients:["8 eggs","1/4 cup milk","4 oz smoked salmon, torn","3 oz cream cheese, dolloped","2 tbsp fresh dill","2 tbsp capers","1/2 red onion, thinly sliced","2 tbsp olive oil","Salt and pepper","Lemon wedges to serve"],
    recipe:["Preheat oven to 375°F. Whisk eggs with milk, salt, and pepper.","Heat olive oil in an oven-safe skillet. Cook red onion 3 min until soft.","Pour in egg mixture. Arrange salmon, cream cheese dollops, capers, and dill on top.","Cook on stove 2 min until edges set, then transfer to oven.","Bake 12-15 min until center is just set. Slice into wedges and serve with lemon."],
    tip:"Don't overbake - a frittata should still have a slight jiggle in the center when you pull it. It firms as it rests.",
    tip2:"Don't beat the eggs too aggressively — overbeaten eggs are rubbery. Whisk just until the yolks and whites are combined. Some visible streaks are fine; they even out during cooking.",
    recipe_detailed:["Preheat oven broiler to high. Whisk eggs with cream, salt, and pepper just until combined.","Heat an oven-safe skillet over medium. Add butter and cook shallots until soft, 2-3 min. Add capers and any other fillings.","Pour in the egg mixture. Cook undisturbed over medium-low for 4-5 min until the edges are set but the center is still slightly jiggly.","Scatter smoked salmon and cream cheese over the top. Transfer to the broiler for 2-3 min until just set and lightly golden. Watch closely — it goes from perfect to rubbery quickly. Slide onto a plate, top with fresh dill and lemon zest."]},

  { id:138, name:"Pancake Dinner Board",              protein:"breakfast", cal:460, time:25, servings:4,
    desc:"A fun spread of fluffy buttermilk pancakes with maple syrup, fruit, whipped cream, and bacon",
    ingredients:["2 cups all-purpose flour","2 tbsp sugar","2 tsp baking powder","1/2 tsp baking soda","1/2 tsp salt","2 cups buttermilk","2 eggs","4 tbsp butter, melted","8 slices bacon","Fresh berries","Whipped cream","Maple syrup","Powdered sugar"],
    recipe:["Cook bacon until crispy. Set aside.","Whisk dry ingredients. In another bowl, mix buttermilk, eggs, and melted butter. Combine wet and dry - don't overmix.","Heat a griddle to medium. Butter lightly. Pour 1/4 cup batter per pancake. Cook until bubbles form, flip, cook 1 min more.","Arrange on a large board or platter with bacon, berries, whipped cream, and syrup.","Serve immediately and let everyone build their own stack."],
    tip:"Lumpy batter is good batter - overmixing develops gluten and makes pancakes tough. Mix until just combined.",
    tip2:"Let the batter rest 5 min after mixing — the baking powder activates fully and the gluten relaxes, giving you fluffier, more tender pancakes. Don't skip this.",
    recipe_detailed:["Mix dry ingredients in one bowl. Mix wet ingredients in another. Combine wet into dry and stir until just combined — lumps are fine. Overmixing develops gluten and makes tough pancakes.","Let batter rest 5 min while you heat the griddle to medium. A drop of water should sizzle and dance. Lightly grease with butter.","Pour batter in circles. When bubbles form across the whole surface and the edges look matte, flip. Cook 1-2 min on the second side.","Build the board: stack pancakes in the center, surround with toppings — berries, sliced banana, whipped cream, maple syrup, chocolate chips, and powdered sugar. Let everyone customize."]},

  { id:139, name:"Biscuits & Gravy",                  protein:"breakfast", cal:520, time:30, servings:4,
    desc:"Southern-style fluffy biscuits smothered in creamy sausage gravy",
    ingredients:["2 cups all-purpose flour","1 tbsp baking powder","1 tsp salt","1/3 cup cold butter, cubed","3/4 cup buttermilk","1 lb breakfast sausage","3 tbsp flour","2 1/2 cups whole milk","Salt and black pepper to taste","Pinch of cayenne"],
    recipe:["Preheat oven to 450°F. Mix flour, baking powder, and salt. Cut in cold butter until crumbly. Add buttermilk, mix until just combined.","Drop biscuits onto a parchment-lined baking sheet. Bake 12-14 min until golden.","Cook sausage in a skillet over medium-high, breaking it up. Don't drain the fat.","Sprinkle flour over sausage. Stir and cook 1 min. Slowly whisk in milk. Simmer until thick, 4-5 min. Season generously.","Split biscuits and smother with gravy."],
    tip:"The fat from the sausage is what makes the gravy. Don't drain it - that's the flavor.",
    tip2:"Cold butter in biscuits is non-negotiable. Warm butter melts into the dough and you lose the flakiness. Freeze the butter and grate it in, or cut it in quickly and keep everything cold.",
    recipe_detailed:["For biscuits: mix flour, baking powder, salt. Cut in very cold butter until the mixture looks like coarse crumbs. Stir in cold buttermilk until just combined.","Turn out on a floured surface, pat to 1-inch thickness. Fold in half and pat again — this creates layers. Cut straight down with a sharp cutter, no twisting. Bake at 425F for 12-14 min until golden.","For gravy: cook sausage in a skillet until browned and crumbly. Sprinkle flour directly over the meat and stir 1-2 min to cook out the raw flour taste. Pour in milk slowly, stirring constantly to prevent lumps.","Simmer gravy 5 min until thick and creamy. Season aggressively with black pepper. Split biscuits and ladle gravy generously over."]},

  // ── Meatless / Vegetarian ─────────────────────────────────────────────────
  { id:140, name:"Saag Paneer",                       protein:"plant-based", cal:360, time:30, servings:4,
    desc:"Indian creamed spinach with golden pan-fried paneer cheese - rich, aromatic, and warming",
    ingredients:["400g paneer, cubed","1 lb fresh spinach or frozen spinach, thawed","1 onion, finely chopped","4 garlic cloves, minced","1 tbsp ginger, grated","2 tbsp ghee or oil","1 tsp cumin seeds","1 tsp garam masala","1 tsp turmeric","1/2 tsp chili powder","1/2 cup heavy cream or coconut cream","Salt to taste","Naan or basmati rice to serve"],
    recipe:["Pan-fry paneer cubes in ghee until golden on all sides. Set aside.","In the same pan, toast cumin seeds until fragrant. Add onion, cook until golden, 8 min.","Add garlic, ginger, turmeric, chili powder. Cook 2 min. Add spinach, cook until wilted.","Blend or mash the spinach mixture to a rough puree. Return to pan.","Add cream, garam masala, and paneer. Simmer 5 min. Serve with naan."],
    tip:"Blending half the spinach and leaving the rest chunky gives you the best texture - not too smooth, not too rough.",
    tip2:"Frying the paneer first until golden gives it a slightly firm exterior that holds up in the sauce. Skip this step and it turns soft and crumbly. Either is delicious, but golden paneer holds its shape.",
    recipe_detailed:["Cut paneer into cubes and pan-fry in oil over medium-high heat 2-3 min per side until golden. Remove and set aside.","Wilt spinach in the same pan with a splash of water. Once cooled, blend to a rough puree — some texture is nice.","In the same pan, heat ghee or oil. Add onion, cook 5 min until golden. Add garlic, ginger, and spices. Cook 1 min — they should smell intensely fragrant.","Add the spinach puree and cream. Simmer 5 min until the flavors meld. Fold in the paneer gently. Season with salt and a squeeze of lemon. Serve with basmati rice and warm naan."]},

  { id:141, name:"Mushroom Bourguignon",              protein:"plant-based", cal:320, time:45, servings:4,
    desc:"A hearty French stew with mushrooms, carrots, and red wine - vegetarian comfort at its finest",
    ingredients:["1 lb cremini mushrooms, halved","1 lb portobello mushrooms, cubed","2 carrots, sliced","1 onion, diced","3 garlic cloves","1 cup red wine","2 cups vegetable broth","2 tbsp tomato paste","1 tsp thyme","2 bay leaves","2 tbsp olive oil","2 tbsp flour","Salt and pepper","Mashed potatoes or crusty bread to serve"],
    recipe:["Heat oil in a Dutch oven. Brown mushrooms in batches over high heat until golden. Remove.","Cook onion and carrots until soft. Add garlic, tomato paste, and flour. Cook 1 min.","Pour in wine and deglaze. Add broth, thyme, and bay leaves. Simmer 10 min.","Return mushrooms. Simmer 20 min until sauce is rich and vegetables are tender.","Remove bay leaves. Serve over mashed potatoes."],
    tip:"Brown the mushrooms in batches over really high heat - crowding the pan steams them instead of browning them.",
    tip2:"Don't add salt to mushrooms at the start — it draws out water and they steam instead of sear. Cook them dry until the liquid evaporates, then season. That is when they start to brown.",
    recipe_detailed:["Heat oil and butter in a large Dutch oven over high heat. Add mushrooms in a single layer — work in batches. Cook without stirring 3-4 min until they release their liquid and it evaporates, then they start to brown. Season with salt once golden.","Remove mushrooms. In the same pot over medium, cook onion, carrot, and celery 5 min. Add garlic and tomato paste, cook 1 min.","Add red wine and let it bubble and reduce by half — about 5 min. Scrape up all the browned bits from the bottom. Add broth and herbs.","Return mushrooms to the pot. Simmer 20 min until sauce reduces and thickens. Stir in butter for gloss. Serve over mashed potatoes or with crusty bread."]},

  { id:142, name:"Korean Bibimbap (Veg)",             protein:"plant-based", cal:400, time:30, servings:4,
    desc:"Korean rice bowl topped with sautéed vegetables, a fried egg, and gochujang chili paste",
    ingredients:["3 cups cooked short-grain rice","2 cups spinach","1 cup bean sprouts","1 zucchini, julienned","1 carrot, julienned","1 cup shiitake mushrooms, sliced","4 eggs","2 tbsp sesame oil","2 tbsp soy sauce","2 tbsp gochujang","1 tbsp sesame seeds","2 garlic cloves","Salt"],
    recipe:["Blanch spinach and bean sprouts separately 1 min. Drain and season each with sesame oil, garlic, salt.","Sauté zucchini, carrot, and mushrooms separately with a little oil and soy. Each should be tender but not mushy.","Fry eggs sunny side up.","Divide warm rice into bowls. Arrange vegetables in sections. Top with egg and gochujang.","Drizzle with sesame oil and sesame seeds. Mix everything together before eating."],
    tip:"The whole point is to mix everything together - crack that egg yolk and stir until the rice turns a beautiful orange color.",
    tip2:"The crispy rice is the point of bibimbap. Heat the bowl or skillet until very hot before adding the rice, and let it sit undisturbed for 2-3 min to form a crust on the bottom. That crunch is what makes it.",
    recipe_detailed:["Prepare each vegetable separately: blanch or saute spinach, carrots, zucchini, and bean sprouts with a little sesame oil and garlic. Keep each component separate and seasoned.","Cook rice. Heat a stone bowl or cast iron skillet over high heat. Add sesame oil, then the rice, pressing it in. Let it sit undisturbed 2-3 min — you should hear it crackling as a crust forms.","Arrange vegetables in sections over the rice. Make a well in the center and add a fried or raw egg yolk. Add a spoonful of gochujang.","At the table, mix everything vigorously — the hot rice cooks the egg, the gochujang spreads through, and the crispy rice bits distribute throughout."]},


  { id:144, name:"Chana Masala",                      protein:"plant-based", cal:340, time:30, servings:4,
    desc:"Punjabi spiced chickpeas in a tangy tomato sauce - one of India's great street food dishes",
    ingredients:["2 cans (15 oz) chickpeas, drained","1 onion, finely chopped","3 tomatoes, diced (or 1 can)","4 garlic cloves, minced","1 tbsp ginger, grated","2 tbsp oil","1 tsp cumin seeds","1 tsp garam masala","1 tsp coriander","1 tsp turmeric","1/2 tsp chili powder","1 tsp amchur (dry mango powder) or lemon juice","Cilantro to top","Rice or roti to serve"],
    recipe:["Heat oil in a pan. Toast cumin seeds until they splutter.","Add onion, cook until dark golden, 10 min. Add garlic and ginger. Cook 2 min.","Add all spices except garam masala. Stir, add tomatoes. Cook until oil separates, 8 min.","Add chickpeas and 1/2 cup water. Simmer 10 min until sauce thickens.","Add garam masala and amchur. Stir. Serve with cilantro and rice."],
    tip:"Cooking the onions until they're truly golden (not just soft) is the foundation of the dish's depth. Don't rush this step.",
    tip2:"Mash about a quarter of the chickpeas against the side of the pot with a spoon partway through simmering. This thickens the sauce naturally and gives it body without any flour or cream.",
    recipe_detailed:["Heat oil in a large pot over medium. Cook onion 6-8 min until deeply golden. Add garlic and ginger, cook 1 min.","Add cumin seeds, coriander, turmeric, garam masala, and chili powder. Stir for 30 seconds — they should bloom and become intensely fragrant.","Add crushed tomatoes and a pinch of sugar. Cook 5 min until the tomatoes darken slightly. Add drained chickpeas and broth. Simmer 15 min.","Use the back of a spoon to mash about a quarter of the chickpeas against the pot's side to thicken the sauce. Add a squeeze of lemon. Serve over basmati rice with fresh cilantro."]},

  { id:145, name:"Caprese Gnocchi",                   protein:"plant-based", cal:440, time:20, servings:4,
    desc:"Pillowy potato gnocchi with cherry tomatoes, fresh mozzarella, and basil in a light sauce",
    ingredients:["1 lb potato gnocchi (store-bought)","2 cups cherry tomatoes, halved","8 oz fresh mozzarella, cubed","1/4 cup fresh basil","3 garlic cloves, minced","3 tbsp olive oil","1 tbsp balsamic glaze","Salt and pepper","Red pepper flakes"],
    recipe:["Cook gnocchi in salted boiling water until they float, about 2-3 min. Drain.","Heat olive oil in a large skillet over medium-high. Add garlic and cherry tomatoes. Cook until tomatoes begin to burst, 4-5 min.","Add gnocchi to the pan. Toss and let them get a little golden, 2 min.","Remove from heat. Fold in mozzarella and basil.","Season, drizzle with balsamic glaze, and serve immediately."],
    tip:"Let the gnocchi sit in the pan after adding them - don't stir immediately. That contact time is what gets you the golden crust.",
    tip2:"Pan-frying the gnocchi instead of boiling gives them a crispy shell and chewy interior. Use a non-stick pan and don't move them for 2 min per side.",
    recipe_detailed:["Pan-fry store-bought gnocchi directly in an oiled non-stick skillet over medium-high for 2-3 min per side until golden and crispy. No boiling needed.","In the same pan, heat olive oil and add halved cherry tomatoes. Cook 3-4 min until they burst and release their juices. Add garlic and cook 30 seconds.","Return gnocchi to the pan. Add fresh mozzarella and toss gently — you want it just barely melted.","Finish with torn fresh basil, a drizzle of good olive oil, and flaky salt. Serve immediately."]},

  { id:146, name:"Roasted Veggie Grain Bowl",         protein:"plant-based", cal:380, time:35, servings:4,
    desc:"A hearty bowl of farro or quinoa, roasted seasonal vegetables, tahini dressing, and chickpeas",
    ingredients:["1 1/2 cups farro or quinoa","1 head broccoli, cut into florets","2 cups cherry tomatoes","1 red onion, wedged","1 zucchini, sliced","1 can chickpeas, drained","3 tbsp olive oil","2 tsp za'atar or Italian seasoning","Salt and pepper","3 tbsp tahini","2 tbsp lemon juice","1 garlic clove, grated","2-3 tbsp water","Fresh parsley"],
    recipe:["Cook farro per package directions. Season with salt.","Toss vegetables and chickpeas with olive oil, za'atar, salt, and pepper on a baking sheet. Roast at 425°F, 25 min.","Whisk tahini, lemon juice, garlic, and water until smooth and pourable. Season with salt.","Build bowls: grain base, roasted veg and chickpeas, tahini drizzle.","Top with fresh parsley."],
    tip:"Za'atar on roasted vegetables is genuinely transformative - worth buying if you don't have it.",
    tip2:"Roast vegetables on a very hot pan at 425F with plenty of space between pieces. Crowding causes steaming — you want caramelization on the edges, not softened veg sitting in its own steam.",
    recipe_detailed:["Preheat oven to 425F. Cut vegetables into similar-sized pieces. Toss with olive oil, salt, and pepper. Spread in a single layer on a sheet pan — leave space between pieces.","Roast 25-30 min, flipping halfway, until edges are caramelized and vegetables are tender with some golden-brown spots.","Cook farro, quinoa, or your chosen grain. Season the warm grain with olive oil, lemon juice, and salt.","Build bowls: grain base, roasted vegetables, a dollop of hummus, sliced avocado. Top with seeds or nuts for crunch and drizzle with tahini dressing or lemon vinaigrette."]},

  { id:147, name:"Tofu Tikka Masala",                 protein:"plant-based", cal:350, time:30, servings:4,
    desc:"Crispy pan-fried tofu in a luscious tikka masala sauce - all the restaurant flavors, plant-based",
    ingredients:["1 block firm tofu, pressed and cubed","2 tbsp oil","1 onion, diced","3 garlic cloves","1 tbsp ginger","1 can (14 oz) crushed tomatoes","1 cup coconut cream","2 tbsp tikka masala or curry paste","1 tsp garam masala","1 tsp cumin","Salt","Rice to serve","Cilantro to top"],
    recipe:["Press tofu 15 min. Cube and pan-fry in oil until golden on all sides, 8-10 min. Set aside.","In the same pan, sauté onion until golden. Add garlic, ginger, and tikka paste. Cook 2 min.","Add crushed tomatoes. Simmer 8 min until thickened.","Add coconut cream, garam masala, cumin. Simmer 5 min. Fold in tofu.","Serve over rice with cilantro."],
    tip:"Pressing the tofu removes moisture so it crisps instead of steams. A clean dish towel and a heavy pan for 15 min does the job.",
    tip2:"Press the tofu for at least 30 min before cooking. Unpressed tofu holds water and won't crisp in the pan; pressed tofu sears beautifully.",
    recipe_detailed:["Press tofu: wrap in a clean towel, place something heavy on top, and let sit 30 min. Cut into cubes. Toss with oil and tikka seasoning.","Pan-fry tofu in a hot non-stick skillet 3-4 min per side until golden and slightly crispy on the outside. Remove and set aside.","In the same pan, saute onion 5 min until golden. Add garlic, ginger, and tikka masala spice blend, cook 1 min. Add crushed tomatoes, cook 8 min until thickened.","Stir in coconut milk and simmer 5 min. Add the tofu and warm through 2 min. Serve over basmati rice with naan and fresh cilantro."]},

  { id:148, name:"French Onion Soup",                 protein:"plant-based", cal:390, time:55, servings:4,
    desc:"Rich, deeply caramelized onion broth topped with crusty baguette and broiled Gruyère",
    ingredients:["3 lbs yellow onions, thinly sliced","4 tbsp butter","1 tbsp olive oil","1 tsp sugar","1/2 cup dry white wine or sherry","4 cups vegetable or beef broth","2 thyme sprigs","1 bay leaf","Salt and pepper","1 baguette, sliced","1 1/2 cups Gruyère, grated"],
    recipe:["Melt butter and oil in a Dutch oven over medium. Add onions and sugar. Cook, stirring every 5-10 min, for 45 min until deep golden brown.","Add wine and cook until absorbed. Add broth, thyme, and bay leaf. Simmer 15 min. Season.","Ladle soup into oven-safe bowls. Top with baguette slices and Gruyère.","Broil 3-4 min until cheese is bubbly and golden.","Serve immediately."],
    tip:"45 minutes for the onions is not an exaggeration. Rushing this step is the most common mistake. Low and slow is the only way.",
    tip2:"Truly caramelized onions take 45 min to 1 hour over low heat. If a recipe says 10 min, those are not caramelized — they are just cooked. The long, slow cook transforms them from sharp and pungent to sweet and deeply savory.",
    recipe_detailed:["Melt butter in a large heavy pot over medium-low. Add thinly sliced onions and a pinch of salt. Cook, stirring every 5-10 min, for 45-60 min until they shrink dramatically and turn deep amber-brown. Don't rush this.","Add garlic and thyme, cook 1 min. Deglaze with white wine or sherry, scraping up all the caramelized bits. Let the wine reduce almost completely.","Add beef broth and simmer 15-20 min. Season with salt and pepper — the broth should be deeply savory and sweet.","Ladle soup into oven-safe bowls. Top with toasted baguette slices and a very generous amount of Gruyere cheese. Broil 3-4 min until the cheese is melted, bubbly, and starting to brown."]},

  { id:149, name:"Spanakopita Bake",                  protein:"plant-based", cal:340, time:45, servings:6,
    desc:"Greek spinach and feta pie baked in crispy phyllo - easier than it looks and absolutely delicious",
    ingredients:["1 lb frozen spinach, thawed and squeezed dry","8 oz feta cheese, crumbled","3 eggs","1/4 cup fresh dill","3 green onions, sliced","1/4 tsp nutmeg","Salt and pepper","12 sheets phyllo dough, thawed","1/2 cup melted butter"],
    recipe:["Preheat oven to 375°F. Mix spinach, feta, eggs, dill, onions, nutmeg, salt, and pepper.","Brush a 9x13 baking dish with butter. Layer 6 phyllo sheets, brushing each with butter.","Spread spinach filling evenly.","Layer remaining 6 phyllo sheets on top, brushing each with butter. Score top into portions with a sharp knife.","Bake 40-45 min until deeply golden. Cool 10 min before cutting."],
    tip:"Squeeze the spinach as dry as you possibly can - excess water will make the bottom layers soggy.",
    tip2:"Brush every single layer of phyllo with butter — each buttered layer crisps separately and creates that signature shattering flakiness. A dry layer of phyllo turns into cardboard.",
    recipe_detailed:["Thaw phyllo dough completely before using. Keep it covered with a damp towel while you work — it dries out and becomes brittle within minutes of air exposure.","Squeeze all liquid from the wilted spinach — really wring it out. Mix squeezed spinach with crumbled feta, ricotta, eggs, onion, garlic, nutmeg, and salt.","Butter a baking dish. Layer 6-8 sheets of phyllo on the bottom, brushing each one generously with melted butter. Spread filling evenly. Layer 6-8 more sheets on top, each buttered.","Score the top layers with a sharp knife before baking. Bake at 375F for 35-40 min until deep golden brown."]},

  // ── New meals ─────────────────────────────────────────────────────────────
  { id:150, name:"Reverse-Sear Ribeye & Sweet Potato", protein:"beef", cal:680, time:55, servings:2,
    desc:"Gordon Ramsay-inspired reverse-sear ribeye with whipped sweet potato - the most foolproof steak method",
    ingredients:["2 bone-in ribeye steaks (1.5\"thick)","Kosher salt and black pepper","2 sprigs rosemary","4 garlic cloves, crushed","3 tbsp unsalted butter","2 tbsp neutral oil","2 large sweet potatoes","2 tbsp butter","1/4 cup warm cream","1/2 tsp smoked paprika","Flaky sea salt"],
    recipe:["Season steaks generously with kosher salt 45 min before cooking. Pat completely dry.","Preheat oven to 250°F. Place steaks on a wire rack over a baking sheet. Roast 25-35 min until internal temp reads 120°F (rare) or 125°F (medium-rare).","Pierce sweet potatoes, microwave 8-10 min. Scoop flesh, whip with butter, warm cream, paprika, and salt.","Heat cast iron ripping hot until smoking. Add oil. Sear steaks 60-90 sec per side until deep mahogany. Add butter, rosemary, garlic. Baste 30 sec.","Rest 5 min. Finish with flaky salt. Serve with whipped sweet potato."],
    tip:"The reverse sear dries the surface completely so you get a crust in under 2 minutes without overcooking the interior. Never skip resting.",
    tip2:"The reverse sear gives you edge-to-edge perfect doneness with no overcooked grey ring. Traditional sear-first gives you a gradient from well-done at the edges to rare in the center. Reverse sear wins every time.",
    recipe_detailed:["Season the ribeye generously with salt and pepper on all sides. For best results, season 1-24 hours ahead and refrigerate uncovered — the salt draws out moisture and then it reabsorbs as a brine.","Place the steak on a wire rack over a sheet pan. Cook in a 250F oven for 25-40 min depending on thickness, until an instant-read thermometer reads 115-120F for medium-rare.","Meanwhile, roast sweet potatoes at 425F until tender, or bake them whole at 400F for 45 min.","When the steak reaches 115-120F, heat a cast iron skillet screaming hot for 5 min. Add oil, then sear the steak 60-90 seconds per side for a deeply caramelized crust. Rest 5 min before slicing."]},

  { id:151, name:"Chick-fill-yay Nuggets",             protein:"chicken", cal:420, time:35, servings:4,
    desc:"A loving homage to everyone's favorite nugget - pickle-brined, double-dredged, and powdered-sugar dusted",
    ingredients:["2 lbs boneless skinless chicken breasts, cut into nuggets","1 cup pickle juice","1 cup whole milk","2 eggs","1 1/2 cups all-purpose flour","2 tbsp powdered sugar","1 1/2 tsp salt","1 tsp black pepper","1/2 tsp paprika","1/2 tsp garlic powder","1/2 tsp onion powder","1/4 tsp cayenne","Oil for frying","Honey mustard to serve"],
    recipe:["Soak chicken in pickle juice 30 min to 4 hours in the fridge.","Whisk milk and eggs. Mix flour, powdered sugar, and all spices in another bowl.","Drain chicken. Dip in milk/egg, dredge in flour pressing firmly. Dip again, dredge again for double crust.","Heat oil to 350°F. Fry nuggets in batches 3-4 min per side until golden and 165°F internal.","Drain on a rack. Serve immediately with honey mustard."],
    tip:"The powdered sugar in the dredge caramelizes in the oil and gives that distinctive slightly sweet, deeply golden crust. Don't skip it.",
    tip2:"The pickle juice brine is the signature — it is what makes the chicken juicy and gives it that tangy, distinctive flavor. Don't skip it or substitute. Even 30 min makes a noticeable difference.",
    recipe_detailed:["Cut chicken breasts into nugget-sized pieces. Submerge in a mixture of milk and pickle juice or buttermilk plus pickles. Marinate at least 30 min, or up to 4 hours in the fridge.","Mix flour with powdered sugar, salt, pepper, garlic powder, and paprika — the powdered sugar helps the coating brown evenly.","Drain chicken but don't pat dry. Dredge in the seasoned flour, pressing firmly so it adheres in a thick, craggy layer.","Fry in 325-350F oil for 3-4 min until golden and cooked through, or bake at 425F on a wire rack 18-20 min. Serve with copycat sauce: mix mayo, honey, mustard, and a splash of lemon."]},

  { id:191, name:"Southern Fried Chicken",              protein:"chicken", cal:520, time:45, servings:4,
    desc:"Classic buttermilk fried chicken - savory, crispy, and juicy. Served with creamy coleslaw and grilled corn",
    ingredients:["3 lbs bone-in chicken pieces (thighs and drumsticks)","2 cups buttermilk","1 tbsp hot sauce","2 cups all-purpose flour","1 tbsp garlic powder","1 tbsp onion powder","2 tsp smoked paprika","1 tsp black pepper","1 tsp salt","1 tsp cayenne","Lard or neutral oil for frying (2-3 inches deep)","Coleslaw: 1 small head cabbage shredded, 1 carrot grated, 1/2 cup mayo, 2 tbsp apple cider vinegar, 1 tsp sugar, salt","4 ears corn, grilled or pan-charred with butter"],
    recipe:["Marinate chicken in buttermilk and hot sauce overnight or at least 2 hours. The acid tenderizes the meat deeply.","Mix flour, garlic powder, onion powder, paprika, black pepper, salt, and cayenne in a wide bowl.","Remove chicken from buttermilk - shake off excess but don't pat dry. Dredge in seasoned flour, pressing firmly into all crevices. Shake off loose flour. Let rest on a rack 10 min - this helps the crust adhere.","Heat oil to 325°F in a cast iron or Dutch oven (chicken lowers the temp when added). Fry thighs and drumsticks in batches, 12-15 min per side, until deep golden and internal temp is 165°F. Don't rush with high heat - the bone-in pieces need time.","Drain on a wire rack (never paper towels). Rest 5 min. Serve alongside creamy coleslaw and corn charred in butter with a pinch of salt."],
    tip:"325°F oil (not 350°F) is the correct temp for bone-in chicken - it cooks through before the crust burns. The buttermilk cling is what holds the crust on, so don't shake it all off.",
    tip2:"Maintain oil temperature at 325-340F throughout frying. Adding cold chicken drops the temp — add pieces slowly and adjust heat to bring it back. Too low means greasy; too high means burnt outside and raw inside.",
    recipe_detailed:["Brine chicken pieces in buttermilk seasoned with hot sauce, salt, garlic powder, and paprika for at least 4 hours, preferably overnight.","Season flour mixture aggressively with salt, pepper, garlic powder, paprika, cayenne, and dried herbs. Dredge buttermilk-coated chicken in flour, back in buttermilk, back in flour — the double dip builds a thick, craggy crust.","Heat 3 inches of oil to 325-340F in a heavy pot or cast iron. Add chicken pieces skin-side down, not crowding the pot. Maintain temperature throughout.","Fry 12-15 min, turning once, until deep golden brown and internal temperature reaches 165F. Drain on a wire rack and rest 5 min before eating."]},

  // ── 10 more Breakfast ────────────────────────────────────────────────────
  { id:152, name:"Turkish Menemen",                    protein:"breakfast", cal:290, time:20, servings:4,
    desc:"A beloved Turkish breakfast - soft scrambled eggs cooked in spiced tomato and pepper sauce",
    ingredients:["6 eggs","3 ripe tomatoes, roughly chopped","2 green peppers, sliced","1 onion, diced","3 tbsp olive oil","1 tsp dried red pepper flakes","1 tsp cumin","Salt","Fresh parsley","Crusty bread to serve","Feta optional"],
    recipe:["Heat oil over medium. Cook onion 5 min. Add peppers, cook 3 min.","Add tomatoes, pepper flakes, cumin, salt. Cook until tomatoes break down, 8 min.","Crack eggs directly into the pan. Stir very gently to create a soft, custardy scramble.","Top with parsley and feta. Serve with bread."],
    tip:"Menemen should be soft and slightly runny - pull off heat while still a little underdone.",
    tip2:"Menemen is a soft-scrambled egg dish — it should be creamy and custardy, not dry and rubbery. Stir constantly over medium-low heat and pull it while it still looks slightly underdone. Residual heat finishes it.",
    recipe_detailed:["Heat olive oil in a wide pan over medium. Add onion and green pepper and cook 5-6 min until completely soft. Add garlic and cook 1 min.","Add diced tomatoes and season with salt, pepper, and red pepper flakes. Cook 8-10 min until tomatoes break down into a thick sauce.","Crack eggs directly into the sauce. Stir gently and constantly with a spatula over medium-low heat, folding the eggs through the tomatoes as they set. Cook until the eggs are just barely set — soft, silky curds. Remove from heat while they still look slightly underdone.","Crumble feta over the top and add fresh herbs. Serve straight from the pan with crusty bread for scooping."]},

  { id:153, name:"Croque Madame",                      protein:"breakfast", cal:520, time:20, servings:2,
    desc:"The French classic - ham and gruyère sandwich smothered in béchamel and topped with a fried egg",
    ingredients:["4 slices thick sourdough","4 oz sliced ham","3 oz Gruyère, grated","2 tbsp butter","1 tbsp flour","3/4 cup whole milk","1 tsp Dijon mustard","Pinch nutmeg","2 eggs","Salt"],
    recipe:["Make béchamel: melt butter, whisk in flour 1 min. Add milk slowly, simmer until thick. Add mustard, nutmeg, salt.","Spread béchamel on bread. Layer ham and Gruyère. Grill in buttered pan 2-3 min per side until golden.","Top with remaining béchamel and Gruyère. Broil 2-3 min until bubbling. Fry eggs sunny-side up. Place one on each sandwich."],
    tip:"The béchamel on top is what makes this special. Broil until properly bubbling and golden brown.",
    tip2:"Bechamel is just a roux cooked into milk — stir constantly and don't stop. If lumps form, keep stirring over heat; they usually dissolve. If they don't, push the sauce through a sieve.",
    recipe_detailed:["Make bechamel: melt butter in a small saucepan over medium heat. Add flour and stir constantly for 1-2 min. Pour in warm milk slowly while whisking. Cook 3-4 min until thickened enough to coat a spoon. Season with salt, pepper, and nutmeg.","Butter two slices of bread. Spread Dijon on the inside faces. Layer with ham and Gruyere. Close the sandwich and butter the outside too.","Cook in a skillet over medium heat 3-4 min per side until golden. Spread bechamel over the top and add more Gruyere. Transfer to a baking sheet and broil 2-3 min until bubbly and spotted brown.","Fry an egg sunny-side up with a runny yolk. Place on top of the finished sandwich. Eat immediately."]},

  { id:154, name:"Congee with Toppings",               protein:"breakfast", cal:260, time:40, servings:4,
    desc:"Silky Chinese rice porridge with soft-boiled eggs, scallion, ginger, and sesame oil",
    ingredients:["1 cup jasmine rice","6 cups chicken broth","1 cup water","1 tbsp ginger, grated","3 garlic cloves","Salt","4 soft-boiled eggs, halved","4 green onions, sliced","2 tbsp sesame oil","Soy sauce","White pepper","Chili oil"],
    recipe:["Combine rice, broth, water, ginger, garlic. Bring to boil. Reduce to a low simmer.","Cook uncovered 30-40 min, stirring occasionally, until rice breaks down into thick creamy porridge.","Season with salt and white pepper. Ladle into bowls. Top with egg, green onion, sesame oil, soy sauce, and chili oil."],
    tip:"More water (up to 10:1) makes it silkier. It looks thin hot but thickens as it cools.",
    tip2:"The ratio for congee is 1 cup rice to 8-10 cups water or broth — much more liquid than regular rice. The grains need to fully break down into a creamy porridge. Stir occasionally and it gets there over 45-60 min.",
    recipe_detailed:["Rinse rice until water runs clear. Combine rice, broth, ginger, and any aromatics in a large pot. Bring to a boil, then reduce to the lowest possible simmer.","Cook 45-60 min, stirring every 10 min to prevent sticking, until the rice has completely broken down into a smooth, creamy porridge. Add more broth or water if it gets too thick.","Season the congee with salt and white pepper. Taste — it should be subtly savory and comforting on its own.","Serve in deep bowls with a spread of toppings: soft-boiled eggs, sliced green onion, fried shallots, crispy garlic, sesame oil, soy sauce, white pepper, and chili oil."]},

  { id:155, name:"Israeli Breakfast Spread",           protein:"breakfast", cal:380, time:20, servings:4,
    desc:"A Mediterranean spread of hummus, Israeli salad, labneh, olives, and jammy eggs with warm pita",
    ingredients:["1 can hummus","4 eggs","2 Persian cucumbers, diced","3 roma tomatoes, diced","1/4 red onion, diced","2 tbsp parsley","Juice of 1/2 lemon","2 tbsp olive oil","Salt","1 cup labneh","1/2 cup olives","Za'atar","Warm pita"],
    recipe:["Boil eggs 7 min. Ice bath 5 min, peel.","Combine cucumbers, tomatoes, red onion, parsley, lemon, oil, salt for salad.","Arrange hummus, labneh, olives, and salad on a platter. Halve eggs and nestle in. Drizzle with za'atar and olive oil.","Serve with warm pita."],
    tip:"Israeli breakfast is meant to be social - put everything in the center and let people graze.",
    tip2:"The quality of an Israeli breakfast is entirely in the produce — peak-season tomatoes and cucumbers make or break it. Salt the tomato pieces lightly and let them sit 5 min so they release juice, then drain before adding to the salad.",
    recipe_detailed:["Make Israeli salad: dice cucumber and tomato into very small pieces, about 5mm cubes. Add finely diced red onion, flat-leaf parsley, lemon juice, olive oil, and salt. The small cut is essential. Toss and let sit 5 min.","Soft-boil eggs: into boiling water for exactly 7 min, then ice bath. Peel when cool — the yolk should be set at the edges and jammy in the center.","Arrange the spread: a big bowl of salad, halved eggs, sliced cucumber, good quality olives, labneh or thick yogurt drizzled with olive oil, hummus, and warm pita or fresh bread.","The idea is everything on the table at once — no formal plating. Tear bread and eat mezze-style."]},

  { id:156, name:"Ham & Cheese Savory Crepes",         protein:"breakfast", cal:350, time:25, servings:4,
    desc:"Thin French crepes filled with ham, egg, and melted Gruyère - a Paris street food classic",
    ingredients:["1 cup flour","2 eggs","1 1/4 cups milk","2 tbsp butter, melted","Pinch salt","4 slices ham","4 eggs for filling","1 cup Gruyère, grated","2 tbsp chives","Butter for pan"],
    recipe:["Whisk flour, eggs, milk, melted butter, and salt into smooth batter. Rest 15 min.","Heat nonstick skillet. Add butter. Pour 1/4 cup batter, tilt to coat thinly. Cook 1-2 min, flip, cook 30 sec.","Return crepe to pan. Add ham and Gruyère to half. Crack egg on top. Fold to half-moon. Cook 2-3 min until set.","Garnish with chives."],
    tip:"Resting the batter relaxes gluten - gives thin, elastic crepes that don't tear when folded.",
    tip2:"Crepe batter needs to rest 30 min before cooking — the gluten relaxes and the batter thins slightly. Rested batter makes smooth, flexible crepes; fresh batter tears.",
    recipe_detailed:["Make batter: blend eggs, milk, flour, butter, and a pinch of salt until completely smooth. Let rest 30 min at room temperature — this is essential.","Heat a non-stick skillet over medium-high. Brush with a thin film of butter. Pour in just enough batter to coat the pan thinly — tilt and swirl immediately to spread it before it sets. Cook 1-2 min until the edges look dry and lift slightly, then flip for 30 seconds.","Fill each crepe with sliced ham, Gruyere, and a spoonful of Dijon. Fold in half, then in half again. Return to the pan to melt the cheese.","Optionally top with a fried egg and a handful of dressed greens. Serve immediately."]},

  { id:157, name:"Sweet Potato Breakfast Bowl",        protein:"breakfast", cal:410, time:30, servings:4,
    desc:"Roasted sweet potatoes with fried eggs, black beans, avocado, and chipotle crema",
    ingredients:["2 large sweet potatoes, cubed","3 tbsp olive oil","1 tsp smoked paprika","1/2 tsp cumin","Salt","1 can black beans, drained","4 eggs","1 avocado, sliced","1/2 cup sour cream","1 chipotle in adobo, minced","2 tbsp lime juice","Cilantro","Hot sauce"],
    recipe:["Toss sweet potato with oil, paprika, cumin, salt. Roast at 425°F 25 min until caramelized.","Warm black beans. Stir together sour cream, chipotle, lime for crema. Fry eggs.","Build bowls: sweet potato, beans, egg, avocado, crema, cilantro, hot sauce."],
    tip:"Roast cut-side down without stirring the first 15 min for caramelized edges, not steamed pieces.",
    tip2:"Roasted sweet potato is far better than microwaved for this bowl — the dry heat caramelizes the natural sugars and creates a deeper, sweeter flavor. Cube it and roast at 425F while everything else comes together.",
    recipe_detailed:["Cube sweet potato and toss with oil, salt, and cinnamon. Roast at 425F for 20-25 min until caramelized on the edges and tender throughout.","Soft-boil or fry your eggs to preference. While they cook, cook breakfast sausage or bacon if using.","Prepare toppings: slice avocado, wash greens, toast nuts, and prepare any sauces such as tahini or maple-sriracha.","Build the bowl: sweet potato as the base, greens, egg, protein, avocado. Drizzle with tahini or maple-sriracha sauce."]},

  { id:158, name:"Dutch Baby Pancake",                  protein:"breakfast", cal:380, time:25, servings:4,
    desc:"A dramatic puffed oven pancake served with lemon, powdered sugar, and fresh berries",
    ingredients:["3 eggs, room temperature","3/4 cup whole milk, room temperature","3/4 cup flour","1 tbsp sugar","1/2 tsp vanilla","Pinch salt","3 tbsp unsalted butter","Powdered sugar","Lemon juice","Fresh berries"],
    recipe:["Preheat oven to 425°F with a 10-inch cast iron skillet inside.","Blend eggs, milk, flour, sugar, vanilla, and salt until very smooth. Rest 5 min.","Remove hot skillet. Add butter - sizzles immediately. Swirl to coat. Pour in all batter at once. Return to oven.","Bake 20 min without opening. Dust with powdered sugar, squeeze lemon, top with berries."],
    tip:"Room temperature eggs and milk are essential - cold ingredients prevent the dramatic puff.",
    tip2:"The pan must be screaming hot when the batter goes in — preheat it in the oven at 425F for 10 min. The thermal shock from cold batter hitting the hot pan is what creates the dramatic puff and crispy, custardy edges.",
    recipe_detailed:["Place a cast iron skillet in the oven and preheat to 425F for at least 10 min — the pan must be very hot.","While the pan heats, blend eggs, milk, flour, vanilla, and a pinch of salt until completely smooth. The batter should be thin.","When the pan is very hot, carefully add butter and swirl to coat. Immediately pour in all the batter at once — it should sizzle as it hits the pan.","Bake 18-22 min without opening the oven door — peeking causes it to deflate. Serve immediately dusted with powdered sugar and lemon juice."]},

  { id:159, name:"Smashed Potato Breakfast Skillet",   protein:"breakfast", cal:440, time:35, servings:4,
    desc:"Crispy smashed potatoes with caramelized onions, bacon, and runny eggs in a cast iron skillet",
    ingredients:["1.5 lbs small potatoes, boiled","4 slices bacon, chopped","1 onion, thinly sliced","4 eggs","2 tbsp olive oil","2 garlic cloves","1 tsp smoked paprika","Salt and pepper","Chives","Sour cream or hot sauce"],
    recipe:["Cook bacon until crispy. Remove, keep fat. Add oil. Smash potatoes flat. Cook undisturbed 4-5 min until golden. Flip.","Add onion and garlic around potatoes. Cook until golden. Season with paprika, salt, pepper.","Make 4 wells. Crack an egg into each. Bake at 400°F 6-8 min. Top with bacon and chives. Serve with sour cream or hot sauce on the side."],
    tip:"Don't stir the potatoes for the first 5 min - that contact time builds the crust.",
    tip2:"Boil the potatoes all the way through before smashing and frying — they should be cooked completely, not al dente. Undercooked potatoes don't smash flat and won't crisp evenly.",
    recipe_detailed:["Boil small potatoes until completely tender — a fork should slide through with zero resistance. Drain and let steam dry for 5 min.","Heat oil in a large cast iron over medium-high. Place potatoes in the pan and smash each one flat with the bottom of a glass or a spatula. Season with salt, pepper, garlic powder, and paprika.","Cook undisturbed 4-5 min until the bottom is deeply golden and crispy. Flip and cook 3 more min. Remove to a plate.","In the same pan, cook breakfast sausage or bacon. Add peppers and onions and cook until softened. Return potatoes. Make wells and add eggs. Cover and cook until whites are set. Scatter cheese and serve straight from the pan."]},

  { id:160, name:"Japanese Miso Breakfast Bowl",       protein:"breakfast", cal:280, time:15, servings:4,
    desc:"A traditional Japanese breakfast - warm miso soup with tofu alongside steamed rice, pickles, and nori",
    ingredients:["3 cups dashi or vegetable broth","3 tbsp white miso paste","1/2 block soft tofu, cubed","1 tbsp dried wakame","2 green onions, sliced","2 cups cooked short-grain rice","Pickled ginger and cucumber","Soy sauce","Nori strips"],
    recipe:["Heat dashi over medium - do not boil. Dissolve miso in a ladle of warm dashi, whisk back in.","Add tofu and wakame. Warm 2 min. Top with green onion.","Serve alongside warm rice with pickles, nori, and soy sauce."],
    tip:"Miso must never boil - it kills the probiotics and dulls the flavor. Always dissolve in a ladle of warm broth first.",
    tip2:"Never boil miso — add it off the heat or in water below simmering. Boiling destroys the beneficial enzymes and mutes the delicate, complex flavor.",
    recipe_detailed:["Cook rice the night before if possible — cold rice is better for this bowl since it firms up and separates more easily.","Make miso soup: bring dashi or water to a near-simmer, not boiling. Remove from heat. Whisk in miso paste until dissolved. Add cubed silken tofu and wakame seaweed. Keep warm but don't boil.","Soft-boil an egg: 7 min in boiling water, then ice bath, then peel. Optionally marinate peeled egg in soy sauce, mirin, and water for 1 hour.","Assemble: warm rice, miso soup on the side, halved egg, pickled ginger, nori strips, sliced green onion, and a drizzle of sesame oil."]},

  // ── 10 more Meatless ──────────────────────────────────────────────────────
  { id:161, name:"Eggplant Parmigiana",                protein:"plant-based", cal:420, time:50, servings:4,
    desc:"Classic Italian baked eggplant in tomato sauce layered with mozzarella and parmesan",
    ingredients:["2 large eggplants, sliced 1/2\"thick","Salt","2 cups flour","3 eggs, beaten","2 cups breadcrumbs","1 cup parmesan, grated","2 cups marinara sauce","2 cups fresh mozzarella, sliced","Fresh basil","Olive oil"],
    recipe:["Salt eggplant slices, let sit 20 min, pat dry. Dredge: flour → egg → breadcrumbs. Fry in olive oil until golden, 2 min per side.","Layer in baking dish: marinara, eggplant, mozzarella, parmesan. Repeat.","Bake at 400°F 25 min until bubbling. Rest 10 min. Top with basil."],
    tip:"Salting and pressing the eggplant removes water so slices crisp instead of steam. Paper towels and something heavy for 20 min.",
    tip2:"Salt the eggplant slices and let them sit for 30 min before cooking — they release bitter water and absorb far less oil during frying. Rinse and pat completely dry before breading.",
    recipe_detailed:["Slice eggplant into half-inch rounds. Salt both sides and spread on a rack for 30 min — you will see water bead on the surface. Rinse thoroughly and pat completely dry.","Set up a breading station: flour, beaten eggs, and seasoned breadcrumbs. Dredge eggplant in flour, then egg, then press firmly into breadcrumbs.","Fry in half an inch of oil over medium-high, 2-3 min per side, until deep golden. Drain on a wire rack.","Layer in a baking dish: marinara, eggplant, mozzarella, Parmesan. Repeat layers, ending with cheese. Bake at 375F for 25-30 min until bubbly and golden. Rest 10 min before serving."]},

  { id:162, name:"Thai Green Curry (Veg)",             protein:"plant-based", cal:380, time:25, servings:4,
    desc:"Fragrant Thai green curry with tofu, zucchini, and Thai basil in creamy coconut broth",
    ingredients:["1 block firm tofu, pressed and cubed","2 tbsp coconut oil","2-3 tbsp green curry paste","2 cans (14 oz) coconut milk","1 cup vegetable broth","2 zucchini, sliced","1 cup green beans","1 tbsp soy sauce","1 tbsp brown sugar","Lime juice","1 cup Thai basil","Jasmine rice"],
    recipe:["Pan-fry tofu in coconut oil until golden, 8 min. Remove. Fry curry paste 1-2 min. Add one can coconut milk.","Add broth and second can coconut milk. Add vegetables. Season with soy, sugar, lime.","Add tofu and Thai basil. Serve over jasmine rice."],
    tip:"Fry the curry paste in oil before adding liquid - this blooms the aromatics and is the step most home cooks skip.",
    tip2:"Fry the green curry paste in coconut cream until the oil separates — you will see it start to pool around the paste. This cracking step blooms the paste and is where the soup transitions from flat to deeply layered.",
    recipe_detailed:["Open the coconut milk and spoon the thick cream from the top into the pan. Heat over medium until simmering. Add green curry paste and fry in the cream 2-3 min, stirring constantly, until the oil separates and pools around the paste.","Add the thinner coconut milk, broth, and fish sauce or soy sauce to keep it vegan. Stir to combine and bring to a gentle simmer.","Add denser vegetables first and simmer 5-7 min. Add quick-cooking vegetables in the last 2 min.","Squeeze lime juice in at the very end. Taste — it should be fragrant, slightly spicy, and balanced. Serve over jasmine rice with extra lime wedges."]},

  { id:163, name:"Roasted Beet & Feta Salad",  protein:"plant-based", cal:310, time:40, servings:4,
    desc:"Roasted beets with creamy goat cheese, candied walnuts, and honey-dijon dressing over arugula",
    ingredients:["4 medium beets","4 oz feta cheese, crumbled","1/2 cup walnuts","3 tbsp honey","4 cups arugula","3 tbsp olive oil","2 tbsp balsamic vinegar","1 tsp Dijon","Salt","Fresh thyme"],
    recipe:["Wrap beets in foil. Roast at 400°F 45 min. Cool, peel, slice.","Toss walnuts with 1 tbsp honey. Toast in dry pan 3 min until caramelized.","Whisk oil, balsamic, Dijon, 2 tbsp honey, salt for dressing. Toss arugula with half. Arrange beets. Add goat cheese and walnuts. Drizzle remaining dressing."],
    tip:"Roasting beets in foil makes them steam-roast - much sweeter than boiling. Skin slips off with a paper towel once cooled.",
    tip2:"To avoid staining everything magenta, dress the beets separately and add them last. Or embrace it and toss everything together — it all turns a beautiful pink anyway.",
    recipe_detailed:["Wrap beets individually in foil with a drizzle of olive oil. Roast at 400F for 45-60 min until a knife slides in without resistance. Cool, then rub the skins off with a paper towel.","Make honey-Dijon vinaigrette: whisk together Dijon, honey, red wine vinegar, olive oil, salt, and pepper.","Toast walnuts in a dry pan 3-4 min until golden and smelling nutty. Watch them — they burn fast.","Arrange arugula on a platter. Slice beets and add. Scatter crumbled feta and toasted walnuts. Drizzle dressing just before serving and toss gently at the table."]},

  { id:164, name:"Mushroom & Spinach Quesadillas",     protein:"plant-based", cal:360, time:20, servings:4,
    desc:"Crispy flour tortillas filled with sautéed mushrooms, wilted spinach, and melted pepper jack",
    ingredients:["8 flour tortillas","1 lb cremini mushrooms, sliced","3 cups baby spinach","1 onion, diced","3 garlic cloves","2 cups pepper jack, shredded","2 tbsp olive oil","1 tsp smoked paprika","1 tsp cumin","Salt","Sour cream and guacamole"],
    recipe:["Sauté onion. Add mushrooms, cook over HIGH heat without stirring until golden, 5 min. Add garlic, paprika, cumin, salt.","Add spinach, wilt 1 min. Layer filling on half of each tortilla, top with cheese, fold.","Cook in buttered pan 2-3 min per side until crispy. Serve with sour cream and guac."],
    tip:"High heat without stirring is everything for mushrooms - they need to brown, not steam.",
    tip2:"Cook the filling completely before adding it to the quesadilla — you only have 2-3 min of pan time for the cheese to melt and the tortilla to crisp. Any underdone filling stays underdone.",
    recipe_detailed:["Heat oil in a skillet over medium-high. Add mushrooms in a single layer — cook without stirring 3 min until browned on one side. Stir and cook 2 more min. Season with salt.","Add garlic and spinach. Stir until spinach wilts, 1-2 min. Season and let any excess moisture cook off completely. The filling should be dry, not watery.","Heat a clean skillet over medium. Place a tortilla flat. Add cheese on half, then the filling, then more cheese. Fold in half.","Cook 2-3 min per side, pressing gently, until golden and crispy and the cheese is fully melted. Cut into wedges and serve with sour cream, guacamole, and salsa."]},

  { id:165, name:"Lemon Ricotta Pasta",                protein:"plant-based", cal:430, time:20, servings:4,
    desc:"Silky pasta with whipped ricotta, lemon, fresh basil, and toasted pine nuts - ready in 20 minutes",
    ingredients:["1 lb spaghetti","1 cup whole milk ricotta","Zest and juice of 2 lemons","1/4 cup parmesan","3 tbsp olive oil","3 garlic cloves, minced","1/2 cup fresh basil","1/4 cup toasted pine nuts","Salt, black pepper, red pepper flakes","1/2 cup pasta water"],
    recipe:["Cook pasta in heavily salted water. Reserve 1 cup pasta water before draining.","Whip ricotta with lemon zest, juice, parmesan, olive oil, salt, pepper until smooth.","Toss hot pasta with garlic and olive oil. Add ricotta and pasta water a splash at a time until creamy. Fold in basil. Top with pine nuts."],
    tip:"Starchy pasta water turns ricotta into a sauce - add a splash at a time until it coats the noodles like cream.",
    tip2:"Reserve more pasta water than you think you need — at least a full cup. Ricotta is thick and the starchy pasta water is what makes it flow into a silky sauce rather than clumping.",
    recipe_detailed:["Cook pasta in generously salted water. Reserve at least 1 cup pasta water before draining.","In a large bowl, mix ricotta with lemon zest, lemon juice, a drizzle of olive oil, salt, and pepper. Taste — it should be bright and creamy.","Add hot drained pasta to the ricotta bowl. Toss vigorously, adding pasta water a splash at a time until the sauce is silky and coats every strand.","Finish with Parmesan, more lemon zest, black pepper, and fresh basil. Serve immediately — ricotta pasta tightens up as it cools."]},

  { id:166, name:"Pumpkin & Black Bean Enchiladas",    protein:"plant-based", cal:390, time:40, servings:4,
    desc:"Corn tortillas filled with spiced pumpkin and black beans, smothered in red sauce and cheese",
    ingredients:["8 corn tortillas","1 can (15 oz) pumpkin puree","1 can black beans, drained","1 cup corn","1 tsp cumin","1 tsp chili powder","1 can (19 oz) red enchilada sauce","1.5 cups Monterey Jack, shredded","Sour cream, green onion, cilantro"],
    recipe:["Mix pumpkin, beans, corn, spices, 1/4 cup enchilada sauce. Season. Warm tortillas in dry pan.","Fill, roll, place seam-side down in greased 9x13 dish. Pour remaining sauce over. Top with cheese.","Bake at 375°F 25 min until bubbling. Top with sour cream, green onion, cilantro."],
    tip:"Warm tortillas before rolling - cold corn tortillas crack and split.",
    tip2:"Dip each tortilla briefly in warm sauce before rolling — it softens it and prevents cracking when you fold, plus builds flavor into the tortilla itself.",
    recipe_detailed:["Make enchilada sauce: saute onion and garlic, add chili powder, cumin, and oregano, then tomato sauce and broth. Simmer 10 min until slightly thickened. Season.","Make filling: mix pumpkin puree with drained black beans, cumin, chili powder, garlic powder, salt, and pepper.","Warm tortillas briefly in a dry pan so they are pliable. Dip each in warm sauce, fill with the pumpkin-bean mixture and a little cheese, roll tightly and place seam-side down in a baking dish.","Pour remaining sauce over the enchiladas. Scatter cheese over the top. Bake at 375F for 25 min until bubbly. Top with sour cream, avocado, and cilantro."]},

  { id:167, name:"Roasted Cauliflower Steaks",         protein:"plant-based", cal:280, time:35, servings:4,
    desc:"Thick-cut cauliflower steaks roasted with harissa, chickpeas, and tahini dressing",
    ingredients:["2 large heads cauliflower","3 tbsp harissa paste","4 tbsp olive oil","1 can chickpeas, drained","1 tsp cumin","1 tsp smoked paprika","Salt","3 tbsp tahini","2 tbsp lemon juice","1 garlic clove","3-4 tbsp water","Parsley and pomegranate seeds"],
    recipe:["Slice cauliflower into 1-inch steaks. Brush with harissa and 2 tbsp oil. Season. Toss chickpeas with remaining oil, cumin, paprika, salt on the same pan.","Roast at 425°F 30 min, flipping cauliflower once, until charred at edges.","Whisk tahini, lemon, garlic, water into sauce. Drizzle over steaks. Top with parsley and pomegranate."],
    tip:"Roast at the highest heat your oven can do - the char on the edges is the entire point.",
    tip2:"Sear the cauliflower steaks in a hot pan before roasting — 2 min per side in olive oil. The oven alone gives you color, but the sear gives you a Maillard-browned, nutty crust.",
    recipe_detailed:["Cut the cauliflower vertically into 1-inch steaks. You will get 2-3 good steaks from the center. Pat dry.","Season both sides with olive oil, salt, pepper, and your spices. Heat an oven-safe skillet over high heat. Sear steaks 2 min per side until golden.","Transfer skillet to 425F oven and roast 15-20 min until tender through the core. Test with a thin knife — it should slide through without resistance.","Serve over hummus or grain, drizzled with tahini, pomegranate seeds, toasted pine nuts, and fresh herbs."]},

  { id:168, name:"Mujaddara",                          protein:"plant-based", cal:360, time:40, servings:4,
    desc:"A humble but extraordinary Middle Eastern dish of lentils and rice with deeply caramelized onions",
    ingredients:["1 cup green or brown lentils","3/4 cup long-grain rice","3 large onions, thinly sliced","4 tbsp olive oil","1 tsp cumin","1/2 tsp allspice","1/4 tsp cinnamon","Salt","Plain yogurt","Fresh parsley"],
    recipe:["Cook lentils in salted water 20 min until almost tender. Drain, reserve liquid.","Cook onions in oil over medium-low with a pinch of salt for 35-40 min until deeply golden and jammy.","Remove half the onions. Add lentils, rice, spices to pan. Add reserved liquid. Cover, simmer 18 min.","Top with reserved caramelized onions. Serve with yogurt and parsley."],
    tip:"40 minutes for the onions is not an exaggeration. Patience transforms humble ingredients.",
    tip2:"The crispy onions are not a garnish — they are the whole point. Cook them in enough oil at medium heat for 20-25 min until deeply golden and caramelized. Under-done onions on mujaddara is like a burger without a patty.",
    recipe_detailed:["Cook lentils in salted water 20 min until tender but not mushy. Drain.","Meanwhile, caramelize onions: slice thinly and cook in olive oil over medium heat for 20-25 min, stirring frequently, until deep golden-brown. Season with salt. Don't rush — this is the heart of the dish.","Cook rice separately until fluffy. Combine lentils and rice, season well with cumin, coriander, cinnamon, salt, and pepper.","Serve topped very generously with the caramelized onions. Add a dollop of plain yogurt and fresh herbs."]},

  { id:169, name:"Chickpea Stew with Feta",            protein:"plant-based", cal:340, time:30, servings:4,
    desc:"A Spanish-inspired quick stew of chickpeas in smoky tomato broth with wilted greens and feta",
    ingredients:["2 cans chickpeas, drained","1 can (14 oz) diced tomatoes","3 cups vegetable broth","1 onion, diced","4 garlic cloves","1 tsp smoked paprika","1 tsp cumin","1/2 tsp turmeric","3 cups kale or spinach","4 oz feta, crumbled","2 tbsp olive oil","Salt","Crusty bread"],
    recipe:["Sauté onion 5 min. Add garlic and spices, cook 1 min. Add tomatoes and broth. Simmer 10 min.","Smash a handful of chickpeas against the pot to thicken. Add remaining chickpeas. Simmer 8 min.","Add greens, wilt 2 min. Top with feta. Serve with bread."],
    tip:"Smashing some chickpeas is what makes this thick and creamy instead of brothy.",
    tip2:"Add the feta after plating, not into the pot — it dissolves and disappears if you stir it into the hot stew. Added cold on top, it stays in creamy chunks and you get bursts of salty richness in every bite.",
    recipe_detailed:["Heat olive oil in a large pot. Cook onion and garlic 5 min until soft. Add tomato paste and cook 1-2 min until it darkens slightly.","Add drained chickpeas, crushed tomatoes, broth, and spices. Stir and bring to a simmer. Cook 20 min uncovered until the sauce reduces and thickens.","Add spinach and stir until wilted. Taste and season. A splash of red wine vinegar at the end brightens it.","Ladle into bowls and top with crumbled feta, a drizzle of good olive oil, and crusty bread for dipping."]},

  { id:170, name:"Shakshuka Verde",                    protein:"plant-based", cal:300, time:25, servings:4,
    desc:"A green twist on shakshuka - eggs poached in tomatillo, jalapeño, and spinach sauce",
    ingredients:["6 eggs","1 can (14 oz) tomatillos, drained","2 jalapeños, roughly chopped","1 onion, diced","3 garlic cloves","2 cups baby spinach","1 tsp cumin","1/2 tsp coriander","2 tbsp olive oil","Salt","Cotija or feta","Fresh cilantro","Warm tortillas"],
    recipe:["Blend tomatillos and jalapeños until smooth. Heat oil. Cook onion and garlic until soft. Add cumin, coriander.","Pour in tomatillo sauce. Simmer 8 min until almost jammy. Add spinach, wilt.","Make 6 wells. Crack an egg into each. Cover and cook 5-7 min. Top with cotija, cilantro. Serve with tortillas."],
    tip:"Let the tomatillo sauce cook down until almost jammy before adding the eggs - this concentrates flavor and prevents a watery result.",
    tip2:"Tomatillos are naturally acidic and bitter raw. A short simmer after adding them is enough to mellow the bitterness — taste the sauce before adding eggs and adjust salt and a pinch of sugar if needed.",
    recipe_detailed:["Husk and rinse tomatillos — they are sticky, rinse thoroughly. Quarter or roughly chop. Saute onion, garlic, and jalapeno in oil until soft. Add tomatillos and cook 5 min until they break down into a sauce.","Add cumin, salt, and a handful of cilantro. Use an immersion blender to blend partially — a slightly rough texture is nice. Taste and adjust salt, lime juice, or a pinch of sugar to balance.","Bring the sauce to a gentle simmer. Make shallow wells and crack eggs in. Cover and cook 5-7 min until whites are set and yolks are still runny.","Top with crumbled cotija or feta, extra cilantro, sliced avocado, and warm corn tortillas on the side."]},
  {id:251,name:"Polenta Florentine",protein:"plant-based",time:30,servings:4,cal:420,
   desc:"Creamy soft polenta topped with garlicky sauteed spinach, a poached egg, and shaved Parmesan.",
   ingredients:["2 cups polenta","6 cups water or vegetable broth","1 cup Parmesan (grated)","2 tbsp butter","1 lb fresh spinach","4 eggs","3 garlic cloves (sliced)","Pinch of nutmeg","Salt and pepper"],
   recipe:["Bring 6 cups salted water to a boil. Whisk in polenta, reduce heat, stir 5 min. Cook on low 15-20 min stirring often until thick and creamy.","Stir in butter and Parmesan. Season with salt and pepper. Keep warm.","Saute garlic in olive oil 1 min. Add spinach in batches, cook until wilted 3-4 min. Season with nutmeg, salt, and pepper.","Poach eggs in barely simmering water with a splash of vinegar, 3 min for runny yolks.","Spoon polenta into bowls, top with spinach, a poached egg, and extra Parmesan."],
   tip:"Use a wide pan and plenty of water for poaching - fresh eggs hold together best."},

  // ── Additional Meatless Meals ──────────────────────────────────────────────
  {id:226,name:"Lentil Bolognese",protein:"plant-based",time:40,servings:4,cal:380,desc:"Rich lentil & tomato ragu over pappardelle with Parmesan.",ingredients:["1 lb pappardelle","1.5 cups green lentils","28oz crushed tomatoes","1 onion","3 garlic cloves","2 carrots","2 celery stalks","2 tbsp tomato paste","1 tsp oregano","Parmesan"],recipe:["Saute diced onion, carrot, celery in olive oil 8 min.","Add garlic, tomato paste, and oregano, cook 2 min.","Add lentils, tomatoes, and 2 cups water. Simmer 25 min.","Toss with cooked pasta and Parmesan."],tip:"Use red lentils for a creamier sauce.",
    tip2:"Don't rush the soffritto at the start — the onion, carrot, and celery need a full 8 min to soften and sweeten. This is the flavor base the whole dish is built on.",
    recipe_detailed:["Finely dice onion, carrot, and celery into roughly equal small pieces. Cook in olive oil over medium heat 8-10 min, stirring occasionally, until very soft and the onion is translucent.","Add garlic and tomato paste, cook 2 min until the paste darkens slightly.","Add lentils, crushed tomatoes, and 2 cups water or broth. Bring to a boil, then reduce to a gentle simmer. Cook 25-30 min, stirring occasionally, until lentils are completely soft and the sauce is thick.","Cook pappardelle in heavily salted boiling water until al dente. Reserve 1 cup pasta water before draining. Toss pasta with the ragu, adding pasta water to loosen. Finish with Parmesan and olive oil."]},
  {id:227,name:"Black Bean Burgers",protein:"plant-based",time:25,servings:4,cal:420,desc:"Smoky black bean patties with avocado and chipotle mayo on brioche.",ingredients:["2 cans black beans (drained)","0.5 cup breadcrumbs","1 egg","1 tsp cumin","1 tsp smoked paprika","4 brioche buns","1 avocado","Chipotle mayo"],recipe:["Mash beans, mix with breadcrumbs, egg, and spices. Form 4 patties.","Chill 15 min. Pan-fry in oil 4 min per side until crisp.","Serve on buns with avocado and chipotle mayo."],tip:"Chilling the patties before cooking helps them hold together.",
    tip2:"Over-mashing the beans makes a dense, gummy patty. Mash only until most beans are broken but some chunks remain — the texture of partly whole beans is what holds the patty together.",
    recipe_detailed:["Drain and rinse beans thoroughly, then spread on a baking sheet and bake at 350F for 10 min — this dries them out slightly and makes for a firmer patty.","Mash beans roughly — stop when you still have some visible chunks. Overmashing creates a gummy, wet paste that won't hold a patty shape.","Mix with breadcrumbs, egg, cumin, smoked paprika, garlic powder, and salt. The mixture should hold its shape when squeezed. If too wet, add more breadcrumbs.","Form into patties, refrigerate 15-30 min, then pan-fry in oil over medium 4 min per side until deeply golden and crispy on both faces."]},
  {id:228,name:"Tofu Stir-Fry with Bok Choy",protein:"plant-based",time:25,servings:4,cal:310,desc:"Crispy tofu and bok choy in a ginger-sesame sauce over rice.",ingredients:["14oz extra-firm tofu (pressed)","4 baby bok choy (halved)","3 tbsp soy sauce","1 tbsp sesame oil","1 tbsp rice vinegar","2 tsp ginger","2 garlic cloves","1 tsp cornstarch","Cooked rice"],recipe:["Cube and pan-fry tofu until golden, ~10 min.","Whisk soy sauce, sesame oil, vinegar, ginger, garlic, cornstarch.","Add bok choy, cook 3 min. Pour sauce, toss until thickened.","Serve over rice."],tip:"Press tofu at least 30 min for best crispiness.",
    tip2:"Pat the tofu dry multiple times with paper towels even after pressing. Any surface moisture creates steam in the pan and prevents browning.",
    recipe_detailed:["Press tofu for 30 min under a weighted towel. Then pat dry again with paper towels. Cut into cubes. Toss lightly with cornstarch and salt — the cornstarch creates a thin crust.","Heat oil in a non-stick pan over medium-high until shimmering. Add tofu in a single layer. Don't touch for 3-4 min until the bottom is deeply golden and releases naturally. Flip and cook 2 more min on each side.","Make sauce: whisk soy sauce, sesame oil, rice vinegar, ginger, garlic, and cornstarch.","In the same pan, cook halved baby bok choy cut-side down 2 min until charred. Add sauce and tofu, toss 1-2 min until sauce thickens and coats everything. Serve over rice."]},
  {id:229,name:"Margherita Flatbread Pizza",protein:"plant-based",time:20,servings:4,cal:390,desc:"Crispy flatbreads with San Marzano tomatoes, fresh mozzarella, and basil.",ingredients:["4 flatbreads or naan","1 cup crushed San Marzano tomatoes","8oz fresh mozzarella","Fresh basil","2 tbsp olive oil","1 garlic clove"],recipe:["Preheat oven to 450F. Rub flatbreads with garlic and olive oil.","Spread tomatoes, top with mozzarella.","Bake 10-12 min until cheese bubbles.","Top with fresh basil."],tip:"Add red pepper flakes for heat.",
    tip2:"Less is more with Margherita. Restrain the toppings — a thin spread of crushed tomato, a few torn pieces of mozzarella, and a small drizzle of olive oil. Overloaded flatbread steams and turns soggy.",
    recipe_detailed:["Preheat oven to 450F with a baking sheet inside — you want the surface already hot.","Rub flatbreads with a cut garlic clove and a light brush of olive oil.","Spread a thin layer of crushed San Marzano tomatoes. Don't spread all the way to the edges — leave a half-inch border. Tear mozzarella into pieces and scatter — leave gaps.","Bake 10-12 min until cheese is melted and bubbly with some golden spots and the edges are crispy. Remove and immediately top with fresh basil added after baking. A drizzle of olive oil and flaky salt to finish."]},
  {id:230,name:"Vegetable Gyoza",protein:"plant-based",time:35,servings:4,cal:340,desc:"Pan-fried dumplings filled with cabbage, shiitake, and ginger.",ingredients:["30 gyoza wrappers","2 cups napa cabbage (shredded)","1 cup shiitake mushrooms (minced)","2 scallions","2 tsp ginger","2 tbsp soy sauce","1 tsp sesame oil","Dipping sauce"],recipe:["Salt cabbage, rest 10 min, squeeze dry. Mix with mushrooms, scallions, ginger, soy, sesame oil.","Fill wrappers with 1 tsp filling, fold and pleat to seal.","Pan-fry flat side down 3 min. Add water, cover, steam 4 min.","Serve with dipping sauce."],tip:"Freeze extras in a single layer before bagging.",
    tip2:"The pan-fry then steam technique gives you the best of both worlds: a crispy, golden bottom and a tender, steamed top. Use a lid that fits tightly — the steam is what finishes the filling.",
    recipe_detailed:["Salt shredded cabbage, let sit 10 min, then squeeze very dry in a towel. Mix with minced shiitake mushrooms also squeezed dry, scallions, ginger, soy sauce, and sesame oil.","Fill each wrapper with about 1 teaspoon of filling. Moisten the edge with water, fold in half, and pleat the front edge to seal. They should stand flat with a curved shape.","Heat oil in a flat-bottomed skillet over medium-high. Place gyoza flat-side down in a single layer. Cook 2-3 min until the bottoms are golden and crispy.","Add enough water to come a quarter inch up the gyoza. Cover immediately with a tight lid. Steam 4 min. Remove lid, let any remaining water evaporate, and cook 1 more minute. Serve with soy sauce, rice vinegar, and chili oil."]},
  {id:231,name:"Stuffed Bell Peppers",protein:"plant-based",time:45,servings:4,cal:370,desc:"Peppers filled with quinoa, black beans, corn, and melted cheese.",ingredients:["4 large bell peppers (halved)","1 cup cooked quinoa","1 can black beans","1 cup corn","1 cup salsa","1 tsp cumin","1 cup shredded Mexican cheese","Cilantro"],recipe:["Preheat oven to 375F. Hollow out peppers.","Mix quinoa, beans, corn, salsa, and cumin.","Fill peppers, top with cheese. Bake 30 min.","Garnish with cilantro."],tip:"Add a jalapeno to the filling for heat.",
    tip2:"Pre-bake the empty pepper halves 10 min before stuffing — they will be tender all the way through when the filling is done, rather than underdone and crunchy around the finished filling.",
    recipe_detailed:["Halve peppers lengthwise, remove seeds. Place cut-side up on a baking sheet, brush with oil, and roast at 400F for 10 min — just enough to soften slightly.","Mix filling: cooked quinoa, drained black beans, corn, salsa, cumin, and salt. Taste — it should be well-seasoned on its own.","Spoon filling generously into each pepper half, mounding it slightly. Top each with shredded cheese.","Return to 375F oven and bake 25 min until filling is heated through and cheese is melted. Rest 5 min before serving. Top with cilantro."]},
  {id:232,name:"Mushroom Risotto",protein:"plant-based",time:40,servings:4,cal:450,desc:"Creamy arborio rice with mixed mushrooms and Parmesan.",ingredients:["1.5 cups arborio rice","1oz dried porcini (soaked)","2 cups cremini mushrooms","1 shallot","0.5 cup white wine","4 cups warm vegetable broth","0.5 cup Parmesan","2 tbsp butter"],recipe:["Saute shallot in butter. Add cremini, cook until golden.","Add rice, stir 1 min. Deglaze with wine.","Add porcini liquid then broth one ladle at a time, stirring 25 min.","Stir in Parmesan and butter. Rest 2 min."],tip:"Never rinse arborio - the starch makes it creamy.",
    tip2:"The stirring serves a purpose — it rubs the starch off the rice grains into the cooking liquid, which is how you get that characteristic creamy texture. But constant stirring is not required; stir frequently, not constantly.",
    recipe_detailed:["Soak dried porcini in 2 cups hot water for 15 min. Squeeze mushrooms out and save the soaking liquid — strain it through a paper towel to remove grit.","Saute shallot in butter until soft and translucent. Add fresh cremini mushrooms and cook until golden, 5-6 min. Add garlic and porcini, cook 1 min. Remove mushrooms and set aside.","Add arborio rice to the same pan and stir 1 min until the edges turn translucent. Deglaze with white wine and stir until absorbed.","Add warm broth one ladle at a time, stirring and waiting for each addition to absorb before adding the next — about 20 min. Use the porcini soaking liquid as part of the total liquid. When rice is al dente and sauce is creamy, remove from heat. Stir in cold butter and Parmesan. Rest 2 min."]},
  {id:233,name:"Veggie Sushi Bowls",protein:"plant-based",time:25,servings:4,cal:380,desc:"Sushi rice with avocado, cucumber, edamame, and pickled ginger.",ingredients:["2 cups sushi rice","3 tbsp rice vinegar","1 tbsp sugar","2 avocados","1 cucumber","1 cup edamame","Pickled ginger","Nori","Soy sauce","Sriracha mayo"],recipe:["Cook rice. Mix vinegar and sugar; fold into warm rice.","Slice avocado and cucumber.","Build bowls: rice, avocado, cucumber, edamame, ginger, nori.","Drizzle with soy sauce and sriracha mayo."],tip:"A rice cooker makes perfectly sticky sushi rice.",
    tip2:"Season sushi rice while it is still very warm — the starch cells are open and it absorbs the vinegar seasoning much better than cold rice. Mix gently with a wooden spoon using folding motions, not stirring.",
    recipe_detailed:["Rinse sushi rice until water runs clear. Cook per package. While still hot, mix rice vinegar, sugar, and salt until dissolved. Fold gently into the rice with a wooden spoon. The rice should be glossy and slightly sticky.","Slice avocado and cucumber just before serving — both deteriorate quickly if cut too far ahead.","Make sriracha mayo: whisk sriracha with mayo. Thin with a little water if you want it drizzle-able.","Build bowls: rice base, then arranged sections of avocado, cucumber, edamame, and pickled ginger. Lay torn nori over everything. Drizzle with soy sauce and sriracha mayo. Eat immediately."]},
  {id:234,name:"Falafel Bowls",protein:"plant-based",time:35,servings:4,cal:440,desc:"Crispy baked falafel over rice with tzatziki, tomatoes, and cucumbers.",ingredients:["2 cans chickpeas","0.25 cup parsley","3 garlic cloves","1 tsp cumin","1 tsp coriander","3 tbsp flour","Cooked rice","1 cup tzatziki","Cherry tomatoes","Cucumber","Pita"],recipe:["Pulse chickpeas, parsley, garlic, and spices. Mix in flour.","Form balls, bake at 425F 25 min, flipping halfway.","Serve over rice with tzatziki, tomatoes, and cucumber."],tip:"Dried chickpeas make crispier falafel than canned.",
    tip2:"Use dried chickpeas soaked overnight — not canned. Canned chickpeas are too wet and the falafel will fall apart. Dried soaked chickpeas are raw but softened, which gives the right texture to hold a ball shape.",
    recipe_detailed:["Soak dried chickpeas in cold water overnight. Drain completely — they should be plump but still raw.","Pulse drained chickpeas, parsley, cilantro, garlic, onion, cumin, coriander, salt, and pepper in a food processor until it resembles coarse wet sand — not a smooth paste. Add flour and pulse to combine.","Form into balls or patties. Bake at 425F on an oiled baking sheet 25 min, flipping once, until deeply golden and firm. Or fry in 350F oil for 3 min until golden.","Serve over rice with tzatziki, halved cherry tomatoes, cucumber, and warm pita. Drizzle everything with tahini sauce: tahini, lemon juice, garlic, and water to thin."]},
  {id:235,name:"Pad Thai with Tofu",protein:"plant-based",time:30,servings:4,cal:420,desc:"Classic pad thai with pressed tofu, rice noodles, peanuts, and tamarind sauce.",ingredients:["8oz rice noodles","14oz extra-firm tofu (cubed)","3 eggs","2 cups bean sprouts","3 scallions","0.25 cup tamarind paste","3 tbsp soy sauce","2 tbsp brown sugar","2 tbsp lime juice","0.25 cup roasted peanuts"],recipe:["Soak noodles 10 min. Mix tamarind, soy, sugar, and lime.","Fry tofu until golden. Push aside, scramble eggs.","Add noodles and sauce, toss 3 min. Add sprouts and scallions.","Top with peanuts and lime wedges."],tip:"High heat is essential - use a wok if you have one.",
    tip2:"Add the noodles last and toss quickly — they need only 2-3 min once they hit the hot pan. Overcooked pad thai noodles turn mushy and clump together. When in doubt, undercook slightly in the soak step.",
    recipe_detailed:["Soak rice noodles in room temperature water 30 min until pliable but still firm — they finish cooking in the pan. Don't soak in boiling water or they overcook.","Press tofu dry, cube, and fry in oil until golden and slightly crispy, 6-8 min. Remove and set aside.","Make sauce: whisk tamarind paste, fish sauce or soy for vegan, brown sugar, and lime juice. It should taste bold — intensely sour, sweet, and savory.","In a very hot wok, add oil, then drained noodles, then sauce. Toss 2 min. Push to sides, scramble eggs in center, then mix through. Add tofu, bean sprouts, and scallions. Toss 1 min. Top with roasted peanuts, lime, and fresh chili."]},
  {id:236,name:"Butternut Squash Soup",protein:"plant-based",time:40,servings:4,cal:280,desc:"Silky roasted butternut squash soup with coconut milk and toasted pepitas.",ingredients:["1 large butternut squash (cubed)","1 onion","3 garlic cloves","1 can coconut milk","3 cups vegetable broth","1 tsp cumin","0.5 tsp nutmeg","Pepitas"],recipe:["Roast squash at 425F with olive oil 25 min.","Saute onion and garlic. Add squash, broth, spices. Simmer 10 min.","Blend until smooth. Stir in coconut milk.","Top with toasted pepitas."],tip:"Roasting first adds depth you cannot get from boiling.",
    tip2:"Roasting concentrates flavor through caramelization — don't skip it for boiling to save time. The golden edges on the roasted squash add a depth of sweetness that boiled squash simply doesn't have.",
    recipe_detailed:["Peel and cube butternut squash into roughly even pieces. Toss with olive oil, salt, and pepper. Spread on a sheet pan with space between pieces. Roast at 425F for 25-30 min until golden and caramelized on the edges.","Meanwhile, cook onion in butter or oil until soft, 5 min. Add garlic and cook 1 min.","Add roasted squash, broth, and spices. Simmer 10 min together to marry the flavors. Blend until completely smooth.","Stir in coconut milk and heat gently — don't boil after adding coconut milk. Taste and adjust salt. Serve topped with toasted pepitas and a drizzle of coconut milk."]},
  {id:237,name:"White Bean and Kale Soup",protein:"plant-based",time:30,servings:4,cal:310,desc:"Tuscan-style soup with cannellini beans, kale, and a Parmesan rind.",ingredients:["2 cans cannellini beans","4 cups kale (chopped)","1 onion","4 garlic cloves","1 can diced tomatoes","4 cups vegetable broth","1 Parmesan rind","Fresh rosemary"],recipe:["Saute onion and garlic. Add tomatoes, broth, beans, and Parmesan rind.","Simmer 15 min. Add kale, cook 5 min.","Remove rind. Season with salt and red pepper flakes.","Serve with crusty bread."],tip:"The Parmesan rind adds remarkable umami depth.",
    tip2:"Keep the Parmesan rind in the whole time it simmers — it won't fully melt but it slowly releases a rich, savory umami that builds the broth's body. Remove it before serving.",
    recipe_detailed:["Saute onion in olive oil until soft, 5 min. Add garlic and fresh rosemary and cook 1 min.","Add drained cannellini beans, diced tomatoes, broth, and the Parmesan rind. The rind slowly dissolves rich depth into the broth.","Simmer 15 min. Add chopped kale and stir until wilted, 3-5 min. The kale should be bright green and tender but still have some texture.","Remove the Parmesan rind. Season generously with salt, pepper, and red pepper flakes. Finish with a drizzle of good olive oil. Serve with crusty bread for dunking."]},
  {id:238,name:"Tempeh Tacos",protein:"plant-based",time:25,servings:4,cal:390,desc:"Crumbled tempeh with taco spices in corn tortillas with avocado and slaw.",ingredients:["2 blocks tempeh (crumbled)","2 tbsp taco seasoning","2 tbsp soy sauce","1 tbsp lime juice","Corn tortillas","Shredded cabbage","Pico de gallo","Avocado"],recipe:["Crumble tempeh, cook in oil 5 min until browned.","Add taco seasoning, soy sauce, and splash of water. Cook 3 min.","Fill warm tortillas with tempeh, cabbage, pico, and avocado.","Finish with lime juice."],tip:"Steam tempeh 10 min before cooking to remove bitterness.",
    tip2:"Steam the tempeh before cooking to remove its natural bitterness. 10 min in a steamer or microwave with a splash of water softens it and opens the structure so it absorbs the taco seasoning.",
    recipe_detailed:["Steam tempeh for 10 min — place in a steamer basket or microwave in a bowl with 2 tablespoons water, covered, for 3 min. Let cool slightly, then crumble into rough pieces.","Cook crumbled tempeh in oil over medium-high heat 4-5 min until golden and starting to crisp.","Add taco seasoning and soy sauce with a splash of water. Stir and cook 2-3 min until the liquid evaporates and the spices cling to the tempeh.","Warm corn tortillas over a flame or dry pan. Fill with tempeh, shredded cabbage, pico de gallo, and avocado. Squeeze lime over everything."]},
  {id:239,name:"Caprese Pesto Pasta",protein:"plant-based",time:20,servings:4,cal:520,desc:"Pasta with fresh basil pesto, cherry tomatoes, and torn mozzarella.",ingredients:["1 lb fusilli or penne","0.5 cup basil pesto","2 cups cherry tomatoes (halved)","8oz fresh mozzarella (torn)","Fresh basil","Olive oil"],recipe:["Cook pasta in salted water, reserve 0.5 cup pasta water.","Toss drained pasta with pesto, adding pasta water to loosen.","Fold in tomatoes and mozzarella.","Top with fresh basil and olive oil."],tip:"Pasta water starch helps the pesto cling to every piece.",
    tip2:"Never heat pesto — the fresh basil will oxidize and turn an unappetizing brown-grey. Always add it off the heat and let the warm pasta and pasta water bring it together.",
    recipe_detailed:["Cook pasta in heavily salted boiling water until al dente. Reserve at least 3/4 cup starchy pasta water before draining.","Drain pasta and return to the pot off the heat immediately. Add pesto and toss — do not put it back on the burner.","Add pasta water a splash at a time, tossing continuously, until the pesto loosens into a silky sauce that coats every piece.","Fold in halved cherry tomatoes and torn fresh mozzarella. Add fresh basil at the very end and toss once more. Serve immediately."]},
  {id:240,name:"Chickpea and Sweet Potato Curry",protein:"plant-based",time:35,servings:4,cal:400,desc:"Coconut milk curry with chickpeas, sweet potato, and spinach over basmati.",ingredients:["2 cans chickpeas","1 large sweet potato (cubed)","2 cups spinach","1 can coconut milk","1 can diced tomatoes","1 onion","3 garlic cloves","1 tbsp curry powder","1 tsp turmeric","Basmati rice"],recipe:["Saute onion and garlic. Add spices, stir 1 min.","Add sweet potato, tomatoes, and coconut milk. Simmer 15 min.","Add chickpeas and spinach, cook 5 min.","Serve over basmati."],tip:"A squeeze of lemon at the end brightens the whole dish.",
    tip2:"Add spinach off the heat — stir it in and put the lid on for 60 seconds. It wilts perfectly without overcooking to a dull green mush.",
    recipe_detailed:["Heat oil in a large pan over medium. Cook onion 5 min until golden. Add garlic and cook 1 min. Add curry powder and turmeric, stir 30 seconds — they should bloom and smell intensely fragrant.","Add sweet potato cubes, diced tomatoes, and coconut milk. Stir to combine. Bring to a simmer and cook 15 min until the sweet potato is completely tender when pierced.","Add drained chickpeas and warm through 3 min. Remove from heat, add spinach, and cover the pan for 60 seconds — it will wilt perfectly from the residual heat.","Squeeze lemon juice in and season with salt. Serve over basmati rice with a dollop of plain yogurt and fresh cilantro."]},
  {id:241,name:"Zucchini Corn Fritters",protein:"plant-based",time:25,servings:4,cal:320,desc:"Golden fritters with zucchini, corn, and feta served with herby yogurt.",ingredients:["3 zucchini (grated)","1 cup corn","0.5 cup feta (crumbled)","2 eggs","0.5 cup flour","Greek yogurt","Fresh dill","Lemon"],recipe:["Salt grated zucchini, rest 10 min, squeeze dry.","Mix zucchini, corn, feta, eggs, and flour.","Pan-fry spoonfuls 3 min per side until golden.","Serve with yogurt mixed with dill and lemon zest."],tip:"Squeezing out all moisture is the most important step.",
    tip2:"Removing water from the zucchini is the single most important step — grate it, salt it, wait 10 min, and then squeeze as hard as you can in a clean towel. Any remaining moisture and you will get soggy fritters that fall apart.",
    recipe_detailed:["Grate zucchini and spread in a colander. Toss with a generous pinch of salt and let sit 10 min. Take handfuls and squeeze very firmly in a clean dish towel until you are getting almost no more moisture.","Mix squeezed zucchini with corn, crumbled feta, eggs, flour, salt, and pepper. The mixture should hold its shape when a spoonful is dropped.","Heat a thin film of oil in a skillet over medium-high. Drop spoonfuls of batter and flatten slightly. Cook 3 min undisturbed until the edges look set and the bottom is golden. Flip and cook 2-3 more min.","Mix yogurt with fresh dill, lemon zest, garlic, and salt. Serve fritters hot with the yogurt sauce."]},
  {id:242,name:"Portobello Mushroom Tacos",protein:"plant-based",time:20,servings:4,cal:350,desc:"Meaty portobello mushrooms and peppers in tortillas with chipotle crema.",ingredients:["4 large portobello caps (sliced)","2 bell peppers (sliced)","1 red onion","2 tbsp taco seasoning","Flour tortillas","Chipotle crema","Cilantro","Lime"],recipe:["Toss mushrooms, peppers, and onion with oil and taco seasoning.","Roast at 425F 20 min or cook in cast iron until charred.","Fill warm tortillas, top with chipotle crema and cilantro.","Squeeze lime over everything."],tip:"High heat gives mushrooms a meaty texture.",
    tip2:"Portobello mushrooms release a lot of water as they cook. Roasting at high heat drives that moisture off quickly — if you roast too low or too crowded, the mushrooms steam and turn slimy instead of getting meaty and charred.",
    recipe_detailed:["Slice portobello caps into thick strips. Slice peppers and red onion. Toss all together with oil and taco seasoning.","Spread in a single layer on sheet pans — use two if needed, no crowding. Roast at 425F for 18-22 min, flipping halfway, until the mushrooms have shrunk and the edges are charred and caramelized.","Make chipotle crema: blend sour cream, a chipotle in adobo, lime juice, and salt until smooth.","Warm flour tortillas. Fill with the mushroom mixture and drizzle generously with chipotle crema. Top with fresh cilantro, a squeeze of lime, and diced avocado."]},
  {id:243,name:"Paneer Butter Masala",protein:"plant-based",time:35,servings:4,cal:480,desc:"Cubes of paneer in a rich, creamy tomato-butter sauce with warm spices.",ingredients:["14oz paneer (cubed)","1 can crushed tomatoes","1 onion","3 garlic cloves","1 tsp ginger","0.5 cup heavy cream","2 tbsp butter","1 tsp garam masala","1 tsp cumin","0.5 tsp turmeric","Basmati rice","Naan"],recipe:["Saute onion, garlic, ginger in butter. Add spices, cook 1 min.","Add tomatoes, simmer 15 min. Blend smooth.","Return to pan, stir in cream. Add paneer, simmer 5 min.","Serve with rice and naan."],tip:"Lightly fry paneer first for a golden crust.",
    tip2:"Fry the paneer before adding to the sauce — 2 min per side in hot oil until golden. Unfried paneer is soft and crumbly and dissolves into the sauce. Fried paneer holds its shape and has a satisfying bite.",
    recipe_detailed:["Cut paneer into cubes and fry in a thin layer of oil over medium-high heat, 2 min per side until golden. Remove and set aside.","In the same pan, saute diced onion in butter 5 min until soft. Add garlic and ginger, cook 1 min. Add garam masala, cumin, and turmeric — stir 30 seconds until fragrant.","Add crushed tomatoes and simmer 12-15 min until the sauce thickens and you can drag a spoon through it and see the pan. Blend smooth with an immersion blender.","Return sauce to medium heat, stir in heavy cream. Simmer gently 5 min. Add paneer and heat through 2 min. Season with salt and finish with a small piece of butter. Serve with basmati rice and warm naan."]},
  {id:244,name:"Vegetarian Ramen",protein:"plant-based",time:30,servings:4,cal:430,desc:"Rich miso broth with soft-boiled eggs, tofu, corn, and noodles.",ingredients:["4 portions ramen noodles","4 cups vegetable broth","2 tbsp miso paste","1 tbsp soy sauce","1 tbsp sesame oil","14oz tofu (cubed)","4 soft-boiled eggs","1 cup corn","4 scallions","Nori","Sesame seeds"],recipe:["Heat broth, whisk in miso off the boil, add soy and sesame oil.","Pan-fry tofu until golden.","Cook noodles. Divide into bowls, ladle broth over.","Top with tofu, halved eggs, corn, scallions, nori, and sesame seeds."],tip:"Never boil miso - add it off the heat to preserve flavor.",
    tip2:"Don't boil the broth after adding miso — whisk it in off the heat. Boiling miso kills its probiotic enzymes and significantly dulls its complex, fermented flavor.",
    recipe_detailed:["Make soft-boiled ramen eggs: bring water to a boil, lower eggs in gently, cook exactly 7 min, then transfer immediately to an ice bath. Peel when cool. Marinate in soy sauce, mirin, and water for at least 1 hour.","Bring vegetable broth to a near-simmer, not boiling. Remove from heat. Whisk in miso paste, soy sauce, and sesame oil until completely dissolved.","Pan-fry tofu cubes in oil until golden on all sides, 6-8 min.","Cook ramen noodles separately. Divide into bowls. Ladle hot miso broth over. Arrange toppings: tofu, halved marinated egg, corn, sliced scallions, nori, and a drizzle of sesame oil."]},
  {id:245,name:"Sweet Potato Black Bean Burrito",protein:"plant-based",time:30,servings:4,cal:510,desc:"Burritos with roasted sweet potato, black beans, rice, and salsa verde.",ingredients:["2 large sweet potatoes (cubed)","1 can black beans","2 cups cooked rice","1 cup salsa verde","1 cup shredded cheese","4 large flour tortillas","Sour cream","Cilantro"],recipe:["Roast sweet potato at 425F 20 min.","Layer rice, beans, sweet potato, cheese, and salsa verde on tortillas.","Fold and roll tightly. Toast in a dry pan 2 min per side.","Serve with sour cream, extra salsa verde, and cilantro."],tip:"Toasting the burrito seals it and adds a satisfying crunch.",
    tip2:"Toast the burrito seam-side down first in a dry pan — the heat seals it shut so it stays closed when you eat it. Without toasting, it unfurls and everything falls out.",
    recipe_detailed:["Roast sweet potato cubes at 425F for 20 min until caramelized. Season with cumin, chili powder, salt, and pepper before roasting.","Warm flour tortillas until pliable — microwave 30 sec wrapped in a damp paper towel, or heat in a dry pan.","Layer down the center: rice, black beans, sweet potato, shredded cheese, and salsa verde. Don't overfill.","Fold sides in first, then fold the bottom flap up and over the filling, tuck tightly, and roll forward. Toast seam-side down in a dry pan 2 min until golden and sealed. Flip and toast the other side."]},
  {id:246,name:"Spanakopita Quesadillas",protein:"plant-based",time:20,servings:4,cal:370,desc:"Spinach and feta in crispy flour tortillas with tzatziki.",ingredients:["4 large flour tortillas","3 cups spinach (wilted, squeezed dry)","1 cup feta (crumbled)","0.5 cup ricotta","2 garlic cloves","0.25 tsp nutmeg","Tzatziki"],recipe:["Mix spinach, feta, ricotta, garlic, and nutmeg.","Spread over half of each tortilla, fold closed.","Cook in dry pan 3 min per side until golden.","Slice and serve with tzatziki."],tip:"Squeeze every drop of moisture from the spinach.",
    tip2:"Squeeze all moisture from the wilted spinach — really commit to it. Wet spinach makes the quesadilla soggy from the inside and prevents the tortilla from crisping.",
    recipe_detailed:["Cook spinach in a pan with a splash of water until fully wilted. Drain in a colander, then take small handfuls and squeeze as firmly as you can to remove all the water.","Mix squeezed spinach with crumbled feta, ricotta, minced garlic, and nutmeg. Season — feta is salty so taste before adding salt.","Heat a dry non-stick pan over medium heat. Lay a tortilla flat. Spread filling over half, leaving a border. Fold in half and press flat.","Cook 3 min per side, pressing gently with a spatula. The tortilla should be golden and crispy. Cut into wedges and serve with tzatziki."]},
  {id:247,name:"Red Lentil Dal",protein:"plant-based",time:30,servings:4,cal:360,desc:"Comforting spiced red lentil dal with a crispy cumin tadka.",ingredients:["1.5 cups red lentils","1 can diced tomatoes","1 onion","3 garlic cloves","1 tsp turmeric","1 tsp cumin seeds","1 tsp garam masala","2 tbsp ghee","Cilantro","Basmati rice or naan"],recipe:["Simmer lentils with turmeric and 4 cups water 15 min.","Saute onion and garlic in ghee. Add tomatoes and garam masala, cook 5 min.","Combine with lentils, simmer 5 min.","Fry cumin seeds in ghee until they pop, drizzle over dal."],tip:"The tadka poured at the end is where all the flavor lives.",
    tip2:"The tadka at the end is the most important step — heating cumin seeds in ghee until they pop and turn fragrant, then pouring the sizzling fat over the dal. Don't skip it. It is the difference between flat and finished.",
    recipe_detailed:["Rinse red lentils until water runs clear. Add to a pot with 4 cups water and turmeric. Bring to a boil, skim any foam, reduce to a simmer. Cook 15-20 min until completely soft and falling apart.","Meanwhile, saute diced onion in ghee until golden, 7 min. Add garlic and cook 1 min. Add diced tomatoes and garam masala, cook 5 min until the tomatoes break down.","Combine the tomato mixture with the cooked lentils. Stir and simmer together 5 min. Season with salt. The dal should be thick and pourable.","Make the tadka: heat ghee in a small pan until very hot. Add cumin seeds and let them sizzle and pop for 30 seconds until fragrant. Pour the sizzling ghee and cumin over the dal immediately. Serve with rice or warm naan."]},
  {id:248,name:"Cauliflower Fried Rice",protein:"plant-based",time:25,servings:4,cal:290,desc:"Low-carb cauliflower rice wok-fried with vegetables and soy-sesame sauce.",ingredients:["1 large cauliflower (riced)","3 eggs","1 cup peas","2 carrots (diced)","3 scallions","3 garlic cloves","3 tbsp soy sauce","1 tbsp sesame oil","2 tsp ginger"],recipe:["Pulse cauliflower in food processor to rice-sized pieces.","Stir-fry carrots and garlic 3 min. Push aside, scramble eggs.","Add cauliflower, peas, soy sauce, sesame oil, and ginger. Toss 5 min.","Top with sliced scallions."],tip:"Very hot pan and minimal stirring gives the best caramelization.",
    tip2:"Let the cauliflower rice sit in contact with the hot pan for 30 seconds at a time without stirring — this creates light browning and a slightly nutty flavor. Constant stirring keeps it pale and bland.",
    recipe_detailed:["Pulse cauliflower florets in a food processor until they look like rice. Spread on a clean towel and squeeze out as much moisture as possible.","Heat a wok over very high heat. Add sesame oil, then diced carrots and garlic. Stir fry 2-3 min until carrots soften. Push to the side.","Add more oil if needed. Crack eggs into the center and scramble until just barely set, then break up and mix through.","Add cauliflower rice and spread in a layer. Don't stir for 30 seconds — let it sit and get slightly golden. Then toss. Add peas, soy sauce, and ginger. Toss and cook 3 more min. Top with sliced scallions."]},
  {id:249,name:"Veggie Banh Mi Bowls",protein:"plant-based",time:30,servings:4,cal:410,desc:"Lemongrass tofu over jasmine rice with pickled daikon, carrots, and sriracha mayo.",ingredients:["14oz tofu (pressed, sliced)","2 tbsp lemongrass paste","3 tbsp soy sauce","1 tbsp brown sugar","Jasmine rice","1 cup daikon (julienned)","1 cup carrots (julienned)","Rice vinegar","Cilantro","Jalapeno","Sriracha mayo"],recipe:["Quick-pickle daikon and carrots in rice vinegar, sugar, and salt 20 min.","Marinate tofu in lemongrass, soy, and sugar. Pan-fry until caramelized.","Build bowls: rice, tofu, pickled veggies, jalapeno, cilantro.","Drizzle with sriracha mayo."],tip:"The quick-pickled vegetables are what make this dish.",
    tip2:"Make the quick pickles first — they need at least 20 min but are dramatically better after an hour or refrigerated overnight. The acidity is what makes banh mi; without enough tangy pickles the bowl is flat.",
    recipe_detailed:["Make quick pickles first: julienne daikon and carrots finely. Toss with rice vinegar, 1 tablespoon sugar, and a pinch of salt. Let sit 20 min minimum.","Marinate pressed tofu slices in lemongrass paste, soy sauce, and brown sugar for 15 min. Pan-fry in a hot skillet 2-3 min per side until the edges caramelize.","Make sriracha mayo: mix mayo with sriracha, lime juice, and a pinch of garlic.","Build bowls: cooked rice base, sliced caramelized tofu, drained pickled vegetables, sliced cucumber, jalapeno, and plenty of fresh cilantro. Drizzle sriracha mayo over everything."]},
  {id:250,name:"Spinach Ricotta Stuffed Shells",protein:"plant-based",time:45,servings:4,cal:490,desc:"Jumbo pasta shells with spinach-ricotta, baked in marinara and mozzarella.",ingredients:["20 jumbo pasta shells","2 cups ricotta","2 cups spinach (wilted, squeezed)","1 egg","1 cup Parmesan","2 cups marinara","1.5 cups shredded mozzarella","Basil"],recipe:["Cook shells al dente. Mix ricotta, spinach, egg, and Parmesan.","Spread half the marinara in a baking dish. Fill shells.","Top with remaining marinara and mozzarella. Bake 375F 25 min.","Garnish with basil."],tip:"Undercook the shells slightly - they finish in the oven.",
    tip2:"Use a piping bag or a zip-lock bag with the corner snipped to fill the shells — it is dramatically faster and cleaner than using a spoon, and you can fill each shell more completely without tearing.",
    recipe_detailed:["Cook jumbo pasta shells 2 min less than the package time. They are al dente now and will finish cooking in the oven. Rinse with cool water and lay flat on an oiled sheet pan.","Wilt spinach, drain, and squeeze completely dry. Mix with ricotta, egg, most of the Parmesan, salt, pepper, and nutmeg. Transfer to a piping bag or zip-lock bag.","Spread half the marinara in a baking dish. Pipe filling into each shell and place snugly in the dish, open side up. Pour remaining marinara over the shells. Scatter mozzarella and remaining Parmesan generously over the top.","Cover with foil and bake at 375F for 25 min. Remove foil and bake 15 more min until the cheese is bubbly and golden. Rest 5 min before serving with fresh basil."]},

  // ── 20 Pork Meals ────────────────────────────────────────────────────────
  { id:171, name:"Taiwanese Braised Pork Rice",        protein:"pork", cal:450, time:40, servings:4,
    desc:"Lu Rou Fan - tender soy-braised pork belly over steamed rice with soy egg and pickles",
    ingredients:["1.5 lbs pork belly, cubed","1/3 cup soy sauce","2 tbsp dark soy sauce","2 tbsp rice wine","2 tbsp brown sugar","1 cup water","3 garlic cloves","2 shallots, sliced","2 star anise","1/2 tsp five spice","4 hard boiled eggs","White rice","Pickled mustard greens"],
    recipe:["Blanch pork belly 5 min. Drain. Caramelize shallots in oil until golden. Add garlic, star anise, five spice. Cook 1 min.","Add pork, both soy sauces, rice wine, sugar, water. Add peeled boiled eggs. Bring to boil.","Simmer covered 35 min until pork is tender and sauce is thick and glossy.","Serve over rice with halved soy egg and pickled greens."],
    tip:"Dark soy sauce is key for the deep caramel color - don't substitute with regular soy.",
    tip2:"Dark soy sauce is what gives Lu Rou Fan its signature mahogany color — it is thicker and sweeter than regular soy. If you don't have it, use regular soy and add a teaspoon of molasses.",
    recipe_detailed:["Blanch pork belly cubes in boiling water 5 min. Drain and rinse — this removes impurities and makes the final sauce cleaner.","In a wok or Dutch oven over medium heat, fry shallots in oil until golden. Add pork and stir fry 5 min until lightly colored.","Add soy sauce, dark soy sauce, rice wine, sugar, star anise, five spice, and enough water to just cover. Bring to a boil, skim any foam.","Reduce to the lowest possible simmer and braise 1-1.5 hours until the pork is meltingly tender and the sauce has reduced to a thick, lacquered glaze. Add hard-boiled eggs in the last 20 min. Serve over white rice with pickled vegetables."]},

  { id:172, name:"Mexican Pork Pozole",                protein:"pork", cal:390, time:50, servings:6,
    desc:"A hearty traditional Mexican hominy soup with tender pork shoulder and dried chiles",
    ingredients:["2 lbs pork shoulder, cubed","2 cans (15 oz) hominy, drained","3 dried guajillo chiles","2 dried ancho chiles","4 garlic cloves","1 onion","1 tsp cumin","1 tsp oregano","6 cups chicken broth","Salt","Shredded cabbage, radish, lime, tostadas to top"],
    recipe:["Sear pork until browned. Remove. Toast dried chiles 30 sec per side. Soak in hot water 20 min. Blend with garlic and 1 cup soaking water. Strain into pot.","Add pork, broth, cumin, oregano. Simmer 35 min. Add hominy. Cook 10 more min. Season.","Serve topped with cabbage, radish, lime, and oregano."],
    tip:"Toasting dried chiles briefly wakes them up - 60 seconds makes a huge difference to flavor depth.",
    tip2:"Hominy needs time to absorb the broth flavor — don't add it at the start. Add it for the last 20 min of simmering so it softens and swells in the flavored broth without turning mushy.",
    recipe_detailed:["Brown pork shoulder in batches in a large pot over high heat. Remove and set aside. In the drippings, cook onion and garlic until softened.","Make the chile base: toast dried guajillo and ancho chiles briefly in a dry pan. Remove seeds and stems, soak in hot water 15 min. Blend with garlic, oregano, and some soaking liquid until smooth.","Return pork to the pot. Add chile sauce, broth, and cumin. Simmer 1.5-2 hours until pork is pull-apart tender. Shred the pork into the broth.","Add drained hominy and simmer 20 more min. Taste and season. Serve topped with shredded cabbage, radishes, dried oregano, lime juice, and warm tortillas."]},

  { id:173, name:"Korean Spicy Pork Stir Fry",         protein:"pork", cal:400, time:20, servings:4,
    desc:"Dwaeji Bulgogi - spicy-sweet pork marinated in gochujang, sesame, and pear",
    ingredients:["1.5 lbs pork shoulder, thinly sliced","3 tbsp gochujang","2 tbsp soy sauce","1 tbsp sesame oil","1 tbsp rice wine","2 tbsp sugar or honey","4 garlic cloves, grated","1 tbsp ginger","1/2 Asian pear, grated","Sesame seeds, green onion","Rice and lettuce wraps"],
    recipe:["Combine gochujang, soy, sesame oil, rice wine, sugar, garlic, ginger, and pear for marinade. Marinate pork 30 min.","Cook in a cast iron over high heat 2-3 min per side until edges caramelize.","Garnish with sesame seeds and green onion. Serve with rice in lettuce wraps."],
    tip:"Grated pear is a traditional Korean tenderizer - enzymes break down the protein and add fruity sweetness.",
    tip2:"Gochujang and gochugaru together give you two layers of heat — one deep and fermented, one bright and direct. Using both is what makes it taste Korean rather than just hot.",
    recipe_detailed:["Slice pork belly or shoulder very thin. Mix marinade: gochujang, gochugaru, soy sauce, sesame oil, garlic, ginger, and a little sugar. Toss pork in marinade and let sit 15-30 min.","Heat wok over very high heat. Add pork in a single layer — it should sizzle loudly. Stir fry 3-4 min until cooked through and caramelized. Work in batches to avoid steaming.","Add sliced onion and green onion to the pan in the last 2 min. Toss briefly.","Serve over rice. Top with sesame seeds, more green onion, and a fried egg. The egg yolk broken over everything and mixed in is traditional."]},

  { id:174, name:"Chinese Char Siu Pork",              protein:"pork", cal:380, time:45, servings:4,
    desc:"Cantonese BBQ pork with a lacquered honey-hoisin glaze - the signature red pork of Cantonese cuisine",
    ingredients:["2 lbs pork shoulder or tenderloin","3 tbsp hoisin sauce","2 tbsp soy sauce","2 tbsp honey","1 tbsp oyster sauce","1 tbsp dry sherry","1/2 tsp Chinese five spice","2 garlic cloves, grated","1 tsp sesame oil"],
    recipe:["Mix all sauce ingredients. Reserve 1/4 for glazing. Marinate pork 2 hours or overnight.","Roast at 400°F on a wire rack over a foil pan with 1/2 cup water below, 25 min. Brush with reserved marinade. Roast 15 more min until lacquered.","Rest 5 min. Slice and serve over rice with bok choy."],
    tip:"The water in the pan prevents drips from smoking, but you still want high heat for the lacquer.",
    tip2:"Brush the glaze on in multiple thin coats during cooking rather than one thick coat, and use the broiler for the final 3 min to get the signature char.",
    recipe_detailed:["Slice pork shoulder into long strips about 2 inches wide. Mix marinade: hoisin, soy sauce, honey, Shaoxing wine, five spice, and garlic. Marinate at least 4 hours, preferably overnight.","Remove pork from marinade and reserve the marinade. Place on a rack over a foil-lined baking sheet.","Roast at 375F for 25 min, brushing with reserved marinade every 10 min. Increase to broil for the last 3-5 min — watch closely as the high sugar glaze transitions from sticky to char.","Rest 5 min, then slice against the grain. Serve over rice with steamed bok choy and a drizzle of any leftover glaze."]},

  { id:175, name:"Vietnamese Caramelized Pork",        protein:"pork", cal:370, time:30, servings:4,
    desc:"Thịt kho - pork belly braised in a rich caramel, fish sauce, and coconut water with soy eggs",
    ingredients:["1.5 lbs pork belly, cubed","1/3 cup fish sauce","3 tbsp sugar","1 1/2 cups coconut water","4 eggs, hard boiled and peeled","4 garlic cloves","2 shallots","Black pepper","Steamed rice"],
    recipe:["Cook sugar in a dry pan until golden caramel. Add coconut water carefully.","Add pork, garlic, shallots, fish sauce, pepper. Add boiled eggs. Bring to boil. Reduce and simmer 25 min until sauce becomes a thick glaze.","Serve over rice."],
    tip:"Don't rush the caramel - deep amber before adding coconut water means deep flavor.",
    tip2:"The caramel is the heart of this dish — cook the sugar until it turns amber-brown before adding anything else. Pale caramel is sweet with no depth; dark caramel is bitter. Amber is the window.",
    recipe_detailed:["In a heavy pan, melt sugar without stirring over medium heat until it turns amber-brown — about 5-7 min. Swirl the pan but don't stir.","Carefully add coconut water or water — it will spatter. Add fish sauce, black pepper, and minced garlic. Stir to combine.","Add pork belly cubes and stir to coat. Bring to a simmer and cook 30-40 min over low heat until the pork is tender and the sauce thickens into a lacquer-like glaze.","Add hard-boiled eggs in the last 10 min. Serve over rice with fresh cucumber slices and pickled vegetables to cut the richness."]},

  { id:176, name:"Filipino Pork Adobo",                protein:"pork", cal:420, time:40, servings:6,
    desc:"The national dish of the Philippines - pork braised in vinegar, soy, and garlic until meltingly tender",
    ingredients:["2 lbs pork shoulder, cubed","1/3 cup soy sauce","1/2 cup white vinegar","8 garlic cloves, crushed","4 bay leaves","1 tsp whole black peppercorns","1 tbsp sugar","1 tbsp oil","White rice"],
    recipe:["Combine pork, soy, vinegar, garlic, bay leaves, peppercorns. Marinate 30 min.","Bring to a boil without stirring. Reduce, cover, simmer 30 min.","Remove pork. Reduce sauce until syrupy. Brown pork in oil. Pour reduced sauce over. Serve over rice."],
    tip:"Do not stir while the vinegar is raw - let it boil first to prevent curdling. This is the single most important rule of adobo.",
    tip2:"The sauce should reduce until almost dry and the pork fries in its own fat at the very end — that last few minutes of sizzling in the concentrated sauce is what creates the caramelized, sticky coating that defines Filipino adobo.",
    recipe_detailed:["Combine pork pieces, soy sauce, vinegar, garlic, bay leaves, and black peppercorns in a pot. Layer the ingredients and let them marinate 30 min.","Bring to a boil over high heat, then reduce to medium. Cook uncovered 30-40 min until pork is tender and cooked through.","Reduce to low heat and continue cooking until the sauce reduces to a thick glaze. The pork should be sizzling and frying in its own rendered fat.","Taste and adjust — it should be intensely savory, tangy from the vinegar, and garlicky. Serve over white rice."]},

  { id:177, name:"Italian Herb Pork Tenderloin",       protein:"pork", cal:440, time:30, servings:4,
    desc:"Fennel-rubbed pork tenderloin with roasted white beans and salsa verde",
    ingredients:["1.5 lbs pork tenderloin","2 tbsp herbes de Provence","4 garlic cloves, minced","1 tbsp rosemary","1 tbsp thyme","Zest of 1 lemon","3 tbsp olive oil","1 can white beans, drained","1 cup fresh parsley","2 tbsp capers","1 tbsp red wine vinegar","Salt"],
    recipe:["Mix fennel, garlic, rosemary, thyme, lemon zest, oil, salt. Rub all over tenderloin.","Sear all sides. Roast at 400°F 15-18 min until 145°F internal. Rest 5 min.","Warm white beans in olive oil. Blend parsley, capers, vinegar, oil for salsa verde.","Slice. Serve over beans with salsa verde."],
    tip:"145°F is the modern safe standard for pork - juicy and slightly pink, which is completely safe.",
    tip2:"Use a meat thermometer — pork tenderloin is expensive and unforgiving. Overcooked above 150F it turns dry and chalky. At 140-145F it is juicy, slightly rosy, and safe.",
    recipe_detailed:["Mix a herb crust: garlic, fresh rosemary, thyme, sage, olive oil, salt, and pepper. Rub all over the pork tenderloin and let marinate 30 min at room temperature.","Sear in an oven-safe skillet over medium-high heat, turning to brown all sides, about 8 min total.","Transfer to a 400F oven and roast 15-18 min until a thermometer reads 140F in the thickest part.","Rest 5-8 min covered loosely with foil. Slice into medallions and serve with the pan juices and roasted vegetables."]},

  { id:178, name:"Thai Larb Moo",                     protein:"pork", cal:320, time:20, servings:4,
    desc:"Northern Thai minced pork salad with toasted rice powder, lime, fish sauce, and fresh herbs",
    ingredients:["1.5 lbs ground pork","3 tbsp uncooked jasmine rice","4 tbsp fish sauce","4 tbsp lime juice","1 tbsp sugar","2 shallots, thinly sliced","3 green onions, sliced","1/4 cup fresh mint","1/4 cup fresh cilantro","2 tbsp dried chili flakes","Butter lettuce to serve","Rice to serve"],
    recipe:["Toast rice in dry pan, stirring constantly, until golden, 5-7 min. Grind to coarse powder.","Cook ground pork over medium-high with no oil until just cooked through.","Remove from heat. Season with fish sauce, lime, sugar, chili flakes. Toss in shallots, green onion, mint, cilantro, and toasted rice powder.","Serve at room temperature in butter lettuce wraps."],
    tip:"The toasted rice powder is the soul of larb - nutty crunch that binds the salad. There is no substitute.",
    tip2:"Toasted rice powder is non-negotiable in larb — it adds a nutty, almost smoky flavor and slightly crunchy texture you cannot get from anything else. Dry-toast raw rice in a pan until golden, then grind coarsely.",
    recipe_detailed:["Make toasted rice powder: add a handful of raw jasmine rice to a dry pan over medium heat. Stir constantly 5-7 min until golden and nutty-smelling. Cool and grind coarsely. Set aside.","Cook ground pork in a pan with minimal oil over medium-high heat, breaking it up fine, until just cooked through. Remove from heat immediately.","While still warm, toss pork with fish sauce, lime juice, chili flakes, and a pinch of sugar. Add sliced shallots, green onion, and fresh mint and cilantro. Toss well.","Add toasted rice powder and mix through. Taste and adjust lime, fish sauce, and chili. Serve over rice or with fresh cabbage."]},

  { id:179, name:"Spanish Chorizo & Potato Stew",     protein:"pork", cal:430, time:35, servings:4,
    desc:"A warming Galician stew with smoky Spanish chorizo, potatoes, and white beans",
    ingredients:["12 oz Spanish chorizo, sliced","4 Yukon gold potatoes, cubed","1 can white beans, drained","1 onion, diced","4 garlic cloves","1 tsp smoked paprika","1/4 tsp cayenne","2 bay leaves","3 cups chicken broth","1/4 cup olive oil","Salt","Fresh parsley"],
    recipe:["Sear chorizo in oil until browned. Remove. Cook onion in chorizo fat until golden.","Add garlic, paprika, cayenne, bay leaves, cook 1 min. Add potatoes and broth. Simmer 15 min.","Add beans and chorizo. Simmer 10 min until thick. Season with salt to taste. Top with parsley."],
    tip:"Spanish chorizo (cured) is completely different from Mexican chorizo (raw) - use the firm, sliceable kind.",
    tip2:"Slice the chorizo thick enough that it holds its shape but still renders its oil into the broth. About half-inch rounds is the target.",
    recipe_detailed:["Slice Spanish chorizo into half-inch rounds. Cook in a large pot over medium heat 3-4 min per side until the oil renders and the edges brown. Remove and set aside. Leave the orange chorizo oil in the pot.","In the chorizo oil, cook onion, garlic, and diced pepper 5 min until softened. Add smoked paprika and tomato paste, cook 1 min.","Add cubed potatoes and broth. Bring to a boil, reduce to a simmer, and cook 15-20 min until potatoes are completely tender.","Return chorizo to the pot. Add white beans if using, simmer 5 more min. Season and finish with a drizzle of olive oil and fresh parsley."]},

  { id:180, name:"Greek Pork Souvlaki Pita",          protein:"pork", cal:410, time:25, servings:4,
    desc:"Marinated pork tenderloin skewers with tzatziki, tomato, and onion in warm pita",
    ingredients:["1.5 lbs pork tenderloin, cubed","3 tbsp olive oil","Juice of 1 lemon","3 garlic cloves, grated","1 tsp dried oregano","1 tsp smoked paprika","Salt","4 pita breads","1 cup tzatziki","1 tomato, diced","1/2 red onion, sliced","Fresh parsley"],
    recipe:["Marinate pork with oil, lemon, garlic, oregano, paprika, salt. At least 30 min.","Thread onto skewers. Grill or cook in ridged pan 8-10 min, turning, until cooked.","Warm pitas. Spread tzatziki, add pork, tomato, red onion. Wrap in parchment."],
    tip:"The parchment wrap holds everything together and steams the pita slightly so it doesn't crack.",
    tip2:"Don't skip the rest after grilling — even 5 min makes the pork noticeably juicier. The muscle fibers relax and pull juices back in rather than letting them run onto the cutting board.",
    recipe_detailed:["Cut pork into 1.5-inch cubes. Mix marinade: olive oil, lemon juice, garlic, dried oregano, thyme, salt, and pepper. Toss pork in marinade and refrigerate at least 1 hour.","Thread onto skewers, leaving space between pieces. Grill or cook in a grill pan over high heat 10-12 min, turning every few minutes, until cooked through with char marks.","Rest 5 min while you warm pita bread and prepare toppings: sliced tomato, red onion, fresh parsley, and tzatziki.","Slide pork off skewers into pita. Add toppings and a generous spoon of tzatziki. Fold and eat immediately."]},

  { id:181, name:"Japanese Tonkatsu",                 protein:"pork", cal:480, time:30, servings:4,
    desc:"Crispy panko-breaded pork cutlets with tonkatsu sauce and shredded cabbage",
    ingredients:["4 pork loin chops, pounded slightly","Salt and pepper","1/2 cup flour","2 eggs, beaten","2 cups panko breadcrumbs","Neutral oil for frying","1/2 head cabbage, finely shredded","Tonkatsu sauce","Steamed rice"],
    recipe:["Season pork. Dredge: flour → egg → panko. Press firmly.","Heat 1 inch oil to 350°F. Fry cutlets 3-4 min per side until golden and 145°F internal. Drain on rack. Rest 3 min. Slice crosswise.","Serve over shredded cabbage with tonkatsu sauce."],
    tip:"Panko creates a shattering crust. Always rest after frying to let the crust set before slicing.",
    tip2:"Press the panko into the pork firmly with your hands. And use panko specifically, not regular breadcrumbs — panko's larger, drier flakes create the signature shaggy, ultra-crispy crust.",
    recipe_detailed:["Pound pork cutlets to half-inch thickness using a meat mallet. Season both sides with salt and pepper.","Set up the breading station: flour, beaten eggs, and panko in separate shallow dishes. Coat the pork in flour, then egg, then press firmly into panko with your hands so it grips the surface.","Heat 1 inch of oil to 340-350F in a heavy pan. Fry one cutlet at a time, 3-4 min per side, until deep golden and cooked through. Drain on a wire rack.","Slice into strips while hot. Serve over rice with tonkatsu sauce, shredded cabbage dressed with sesame dressing, and pickled ginger."]},

  { id:182, name:"Peruvian Lomo Saltado",             protein:"pork", cal:440, time:25, servings:4,
    desc:"Peru's classic stir-fry with pork, tomatoes, onions, aji amarillo, and french fries mixed in",
    ingredients:["1.5 lbs pork tenderloin, strips","1 red onion, wedged","2 tomatoes, wedged","1 jalapeño","3 tbsp soy sauce","2 tbsp red wine vinegar","1 tbsp oyster sauce","3 garlic cloves, minced","2 tbsp cilantro","2 cups cooked french fries","Rice to serve","Neutral oil"],
    recipe:["Heat a wok ripping hot. Sear pork in batches until browned, 2 min. Remove.","Stir fry onion and jalapeño 2 min. Add garlic, then tomatoes.","Return pork. Add soy, vinegar, oyster sauce. Toss on high heat 1 min. Add fries and cilantro. Toss.","Serve immediately with rice."],
    tip:"Extremely high wok heat is everything - under 5 minutes of active time. Low heat makes it a soggy stew.",
    tip2:"Lomo saltado is a stir fry — it must be cooked over the highest heat you have. If your stove doesn't get very hot, do it in very small batches so the pan temperature doesn't drop.",
    recipe_detailed:["Slice beef into strips and marinate briefly in soy sauce, cumin, and pepper. Slice peppers, red onion, and tomato into large pieces.","Get a wok or large skillet screaming hot. Add oil, then beef in a single layer. Sear 60 seconds without touching, toss, 30 more seconds. Remove.","In the same hot pan, add onion wedges and peppers. Stir fry 2 min until they char slightly. Add tomatoes, garlic, and aji amarillo paste. Cook 1 min.","Return beef. Add soy sauce, red wine vinegar, and fresh cilantro. Toss over highest heat for 1 min. Serve over white rice and with French fries on the side."]},

  { id:183, name:"Hungarian Pork Goulash",            protein:"pork", cal:400, time:50, servings:6,
    desc:"A hearty pork stew rich with Hungarian sweet paprika, caraway, and potatoes",
    ingredients:["2 lbs pork shoulder, cubed","3 tbsp Hungarian sweet paprika","1 tsp caraway seeds","2 onions, diced","3 garlic cloves","1 can diced tomatoes","2 cups broth","3 potatoes, cubed","2 tbsp lard or oil","1 green pepper, diced","1 tsp vinegar","Salt","Sour cream and egg noodles"],
    recipe:["Cook onions in lard 10 min until very golden. Remove from heat. Stir in paprika - never fry paprika directly in hot fat.","Return to heat. Add garlic, caraway, pork. Coat everything. Add tomatoes, broth, green pepper. Simmer covered 30 min.","Add potatoes. Cook 20 more min. Finish with vinegar. Serve with sour cream and noodles."],
    tip:"Always add paprika off the heat - it burns in seconds in hot fat. Let it bloom in residual warmth before returning to the burner.",
    tip2:"Add the paprika off the heat or in very little fat — it burns easily and turns bitter. Stir it into the vegetables, then immediately add the liquid to stop the cooking.",
    recipe_detailed:["Cut pork shoulder into 1.5-inch cubes. Brown in batches in a Dutch oven over high heat until deeply seared on all sides. Remove each batch to a plate.","Reduce heat to medium. Cook onion 5 min until soft. Remove from heat momentarily, add sweet paprika and stir for 30 seconds in residual heat. Add tomatoes immediately to stop the paprika cooking.","Return pork to the pot. Add broth, caraway seeds, marjoram, bay leaves, and diced peppers. Bring to a boil, then reduce to a low simmer.","Braise 1.5-2 hours until pork is very tender and the sauce has thickened. Stir in a spoonful of sour cream just before serving. Serve over egg noodles or spaetzle."]},

  { id:184, name:"Pulled Pork Banh Mi",               protein:"pork", cal:430, time:20, servings:4,
    desc:"Hoisin pulled pork with pickled daikon, jalapeño, and cilantro in a toasted baguette",
    ingredients:["2 lbs pulled pork","2 tbsp hoisin sauce","1 tbsp soy sauce","4 baguette sections","1 cup daikon, julienned","1 cup carrots, julienned","3 tbsp rice vinegar","1 tbsp sugar","1 tsp salt","1 jalapeño, sliced","Cilantro","2 tbsp mayo","Sriracha"],
    recipe:["Quick pickle: combine daikon and carrot with vinegar, sugar, salt. Rest 15 min.","Toss pulled pork with hoisin and soy. Warm in a pan 5 min.","Spread mayo on rolls, toast. Layer pork, pickled veg, jalapeño, cilantro, sriracha."],
    tip:"Even 15 minutes of pickling makes a huge difference - the veg cuts richness and makes each bite feel fresh.",
    tip2:"Make the quick pickles at least 30 min before assembling — the carrots and daikon need time to absorb the vinegar brine. Made the day before, they are significantly better.",
    recipe_detailed:["Quick-pickle carrots and daikon: julienne both thinly. Toss with rice vinegar, sugar, and salt. Let sit at least 30 min at room temperature or overnight in the fridge.","Braise pork shoulder with soy sauce, fish sauce, garlic, and lemongrass at 325F for 3-4 hours until pull-apart tender. Shred and toss with some of the cooking liquid.","Make the sauce: mix mayonnaise with sriracha and a squeeze of lime.","Assemble on a split baguette: sriracha mayo on both cut sides, a generous layer of pork, pickled carrots and daikon, fresh cucumber slices, jalapeno, and plenty of fresh cilantro."]},

  { id:185, name:"Moroccan Spiced Pork",              protein:"pork", cal:380, time:55, servings:4,
    desc:"Pork shoulder braised with preserved lemon, olives, and apricots in a Moroccan spice blend",
    ingredients:["1.5 lbs pork shoulder, cubed","1 onion, diced","4 garlic cloves","1 tsp cumin","1 tsp coriander","1/2 tsp ginger","1/2 tsp cinnamon","1/2 tsp turmeric","1 cup chicken broth","1/2 cup dried apricots","1/2 cup green olives","1 preserved lemon rind, diced","2 tbsp olive oil","Couscous","Fresh cilantro"],
    recipe:["Brown pork in batches. Remove. Cook onion until golden. Add garlic and spices, cook 1 min.","Return pork. Add broth, apricots, olives, preserved lemon. Cover and simmer 45 min.","Serve over couscous with cilantro."],
    tip:"Preserved lemon adds a salty, deeply lemony, almost floral flavor that fresh lemon cannot replicate.",
    tip2:"Toast the spices briefly in oil to bloom before adding liquid — stir them in the fat for 30 seconds until the kitchen smells incredible. This step unlocks volatile oils that are otherwise locked in the dried spice.",
    recipe_detailed:["Season pork shoulder or chops with ras el hanout, salt, and pepper. Let sit 30 min or overnight.","Sear the pork in a Dutch oven over high heat on all sides until deeply browned. Remove.","In the same pot, cook onion and garlic until soft. Add preserved lemon, olives, tomatoes, and broth. Return pork.","Braise at 325F for 2-2.5 hours until pork is very tender. Stir in fresh cilantro and a squeeze of lemon. Serve over couscous with harissa on the side."]},

  { id:186, name:"German Pork Schnitzel",             protein:"pork", cal:450, time:25, servings:4,
    desc:"Pork loin pounded thin, breaded, and pan-fried until golden - served with lemon and potato salad",
    ingredients:["4 pork loin chops, pounded to 1/4\"","Salt and pepper","1/2 cup flour","2 eggs, beaten","2 cups breadcrumbs","1/4 cup oil and 2 tbsp butter","1 lemon","Potato salad or roasted potatoes","Fresh parsley"],
    recipe:["Pound pork to 1/4 inch. Season. Bread: flour → egg → breadcrumbs. Do not press the crumbs.","Fry in oil/butter over medium-high 2-3 min per side. Don't crowd.","Serve immediately with lemon, a sprinkle of fresh parsley, and potato salad."],
    tip:"Don't press the breading - gently lay in breadcrumbs. Loose coating creates air pockets that puff into a light, crispy shell.",
    tip2:"Use a generous amount of oil — schnitzel should swim in it, not fry in a thin coating. About a quarter to half inch of oil allows the breading to float freely and puff, creating that light, airy texture.",
    recipe_detailed:["Pound pork cutlets to a quarter-inch thickness between two sheets of plastic wrap. Season with salt and pepper.","Set up breading: flour, beaten eggs, and fine breadcrumbs. Dredge in flour, then egg, then breadcrumbs — don't press. The breading should sit loosely on the surface for the classic wrinkled look.","Heat a quarter to half inch of oil in a large skillet to 330-350F. Fry schnitzel 2-3 min per side, swirling the pan occasionally so the oil washes over the top.","Drain immediately on a wire rack. Serve with lemon wedges, potato salad, and lingonberry jam. Schnitzel loses its crunch as it rests, so eat right away."]},

  { id:187, name:"Cuban Medianoche Sandwich",         protein:"pork", cal:510, time:25, servings:4,
    desc:"Roasted pork, glazed ham, Swiss cheese, mustard, and pickles pressed in a sweet egg roll",
    ingredients:["1 lb roasted pork","8 oz glazed ham, sliced","4 oz Swiss cheese","4 tbsp yellow mustard","8 dill pickles, sliced","4 sweet medianoche or brioche rolls","2 tbsp butter"],
    recipe:["Slice rolls. Spread mustard on both cut sides. Layer ham, roasted pork, Swiss, pickles. Butter outsides.","Press in a panini press or weigh down in a skillet with a heavy pan on top, medium heat, 3-4 min per side until golden and cheese melted.","Cut diagonally. Serve immediately."],
    tip:"The weight is essential - pressing flat melds all layers and crisps the bread. A cast iron on top works perfectly.",
    tip2:"Press the sandwich under something heavy while it toasts — a cast iron is perfect. The pressure is what makes the sandwich compact, the bread crispy all the way through, and the cheese melt fully.",
    recipe_detailed:["Spread mustard generously on both cut sides of the sweet egg bread. Layer in order: Swiss cheese, ham, roasted pork, pickles, and more Swiss cheese. Close the sandwich.","Brush the outside of the bread with butter on both sides.","Heat a skillet or griddle over medium heat. Place sandwich in the pan and press firmly with a heavy skillet on top. Cook 3-4 min until the bottom is deep golden. Flip, press again, and cook 3 more min.","The sandwich is done when the bread is crispy throughout, the cheese is completely melted, and the layers are compressed. Slice diagonally and serve immediately."]},

  { id:188, name:"Vietnamese Lemongrass Pork",        protein:"pork", cal:390, time:30, servings:4,
    desc:"Bún Thịt Nướng - grilled lemongrass pork over cool rice vermicelli with pickled veg and nuoc cham",
    ingredients:["1.5 lbs pork shoulder, thinly sliced","3 tbsp fish sauce","2 tbsp sugar","1 tbsp lemongrass, minced","3 garlic cloves, grated","1 shallot, grated","1 tbsp sesame oil","8 oz rice vermicelli, cooked","Nuoc cham: 3 tbsp fish sauce, 3 tbsp lime juice, 2 tbsp sugar, chili, 2 tbsp water","Bean sprouts, mint, basil, cucumber","Crushed peanuts"],
    recipe:["Marinate pork in fish sauce, sugar, lemongrass, garlic, shallot, sesame oil. 30 min.","Grill over high heat 2-3 min per side until charred at edges.","Make nuoc cham: combine all, stir until sugar dissolves.","Divide vermicelli into bowls. Top with pork, bean sprouts, herbs, cucumber, peanuts. Pour nuoc cham over."],
    tip:"The charring is what makes this dish - don't be afraid of dark edges. Smoky pork against cool noodles and fresh herbs is the whole flavor profile.",
    tip2:"Lemongrass is woody — only the bottom 4 inches of the stalk are edible. Peel off the tough outer layers until you hit the pale, moist inner core. Mince this finely or pound in a mortar.",
    recipe_detailed:["Prepare lemongrass: peel outer layers and use only the pale bottom 4 inches. Mince or pound very finely.","Mix marinade: minced lemongrass, fish sauce, sugar, garlic, and shallots. Toss sliced pork in the marinade for at least 30 min.","Heat a wok or pan over very high heat. Cook pork in batches — it should caramelize quickly in the fish sauce and sugar. Stir fry 3-4 min until cooked through and the edges have some char.","Serve over rice vermicelli or jasmine rice with fresh herbs, bean sprouts, cucumber, and nuoc cham dipping sauce."]},

  { id:189, name:"Jamaican Jerk Pork",                protein:"pork", cal:430, time:70, servings:6,
    desc:"Scotch bonnet-fire jerk pork slow-roasted with allspice and thyme - served with rice and peas",
    ingredients:["2.5 lbs bone-in pork shoulder","4 scotch bonnet or habanero peppers","6 green onions","4 garlic cloves","2 tbsp fresh thyme","1 tbsp allspice","1 tsp cinnamon","1 tsp black pepper","2 tbsp soy sauce","2 tbsp brown sugar","2 tbsp lime juice","2 tbsp oil","Rice and peas to serve"],
    recipe:["Blend all marinade ingredients to a paste. Score pork deeply. Rub into cuts. Marinate overnight.","Roast uncovered at 325°F for 60-70 min until 160°F internal and darkened on the outside.","Rest 10 min. Slice or pull apart. Serve with Jamaican rice and peas (coconut milk + kidney beans)."],
    tip:"The overnight marinade is non-negotiable for a thick shoulder. Wear gloves when handling scotch bonnets.",
    tip2:"The longer jerk marinates, the better — scotch bonnets and allspice need time to fully permeate the meat. 24 hours is good, 48 hours is better.",
    recipe_detailed:["Blend jerk marinade: scotch bonnet peppers, allspice, thyme, garlic, ginger, green onion, soy sauce, brown sugar, cinnamon, nutmeg, and black pepper. It should be a thick, fragrant paste.","Score the pork deeply so the marinade penetrates. Coat thoroughly, working it into the cuts. Refrigerate at least 12 hours, ideally 24-48 hours.","Cook low and slow: grill over indirect heat at 275-300F for 3-4 hours for shoulder, or 350F for 30-40 min for chops.","Rest the meat 10 min. Serve with rice and peas, fried plantains, and coleslaw to counter the heat."]},

  { id:190, name:"Pork Ramen (Tonkotsu Style)",       protein:"pork", cal:510, time:40, servings:4,
    desc:"A simplified home tonkotsu ramen with rich pork-miso broth, chashu pork, and soft egg",
    ingredients:["1.5 lbs pork belly or tenderloin","1 tbsp white miso","2 tbsp soy sauce","1 tbsp mirin","2 garlic cloves, grated","1 tsp sesame oil","4 cups chicken or pork broth","1 cup whole milk","4 portions ramen noodles","4 soft boiled eggs, marinated in soy and mirin","Nori, green onion, bean sprouts, corn, sesame seeds","Chili oil"],
    recipe:["Marinate pork with miso, soy, mirin, garlic, sesame oil. Sear all sides. Roast at 325°F 25 min. Slice thin.","Combine broth and milk. Whisk in 1 tbsp miso. Simmer - never boil. Season.","Cook noodles. Ladle broth into bowls. Add noodles, pork, halved soy egg, nori, toppings. Finish with sesame seeds and chili oil."],
    tip:"Adding whole milk to the broth is the home cook's secret for creamy tonkotsu effect without a 12-hour pork bone boil.",
    tip2:"The white, creamy color of tonkotsu broth comes from collagen extracted by a full boil — not a simmer. You need to boil the bones hard the entire time. This is how the broth emulsifies into that rich, milky consistency.",
    recipe_detailed:["Blanch pork bones 5 min, drain, and rinse thoroughly. This removes impurities that make the broth cloudy and funky.","Return bones to pot, cover with cold water, and bring to a FULL BOIL — not a simmer. Boil hard for 4-6 hours, topping up with water as needed. The broth will turn white and creamy. Season with salt.","Make tare: combine soy sauce, mirin, and sake. Simmer 5 min. This is added to each bowl individually so everyone can adjust to taste.","Cook ramen noodles per package. Add tare to each bowl, ladle in hot broth, top with noodles, chashu pork slices, soft-boiled marinated egg, corn, green onion, nori, and sesame seeds."]},
  {id:252,name:"Chicken 65",protein:"chicken",time:30,servings:4,cal:510,desc:"Crispy deep-fried chicken bites in a fiery, tangy South Indian spice sauce, served with naan and jasmine rice.",ingredients:["2 lb chicken thighs, cut into bite-sized pieces","1 cup plain yogurt","2 tbsp red chili powder","1 tsp turmeric","1 tbsp ginger-garlic paste","2 tbsp cornstarch","1 tbsp all-purpose flour","Oil for frying","1 tsp mustard seeds","10 fresh curry leaves","4 dried red chilies","2 tbsp soy sauce","1 tbsp vinegar","4 naan breads, warmed","2 cups jasmine rice, cooked"],recipe:["Marinate chicken in yogurt, 1 tbsp chili powder, turmeric, ginger-garlic paste, cornstarch, flour, and salt for at least 15 min.","Heat oil to 350F. Fry chicken in batches 6-8 min until golden and cooked through. Drain on paper towels.","In a wok, heat 2 tbsp oil. Add mustard seeds and let them pop. Add curry leaves and dried chilies.","Add remaining chili powder, soy sauce, and vinegar. Stir 30 seconds.","Toss fried chicken in the sauce until evenly coated.","Serve immediately with warm naan and jasmine rice."],tip:"Double-fry for extra crunch: fry once at 325F to cook through, then again at 375F for 90 seconds to crisp the exterior."},
  {id:253,name:"Beef Chili",protein:"beef",time:45,servings:6,cal:520,desc:"Thick, hearty Texas-style beef chili with kidney beans, chili peppers, and a dark beer.",ingredients:["2 lb ground beef","1 can kidney beans, drained","1 can diced tomatoes","1 can tomato paste","1 bottle dark beer or beef broth","1 large onion, diced","4 cloves garlic, minced","2 tbsp chili powder","1 tsp cumin","1 tsp smoked paprika","1 tsp cayenne","Salt and pepper","Shredded cheddar, sour cream, green onion to serve"],recipe:["Brown ground beef over high heat. Drain excess fat.","Add onion and garlic, cook 3 min.","Stir in chili powder, cumin, paprika, cayenne, salt, and pepper. Cook 1 min.","Add tomatoes, tomato paste, beer, and beans. Stir to combine.","Simmer uncovered 30 min, stirring occasionally, until thick.","Serve topped with cheddar, sour cream, and green onion."],tip:"A dark beer like stout or porter adds a roasted, slightly bitter depth that beef broth alone cannot match."},
  {id:254,name:"Philly Cheesesteak",protein:"beef",time:25,servings:4,cal:680,desc:"Shaved ribeye, sauteed peppers and onions, Cheez Whiz on a toasted hoagie roll.",ingredients:["2 lb ribeye steak, shaved thin","4 hoagie rolls, split and toasted","1 large onion, thinly sliced","2 green bell peppers, thinly sliced","1 jar Cheez Whiz","2 tbsp vegetable oil","Salt and pepper"],recipe:["Freeze the ribeye for 30 min before slicing for thinner cuts. Slice as thin as possible against the grain.","Heat oil in a large griddle or skillet over high heat. Cook onions and peppers until soft and caramelized, about 8 min. Set aside.","Add shaved beef to same pan. Season with salt and pepper. Cook, chopping and stirring, 3-4 min.","Mix beef with onions and peppers. Portion onto rolls.","Microwave Cheez Whiz 30 seconds. Drizzle generously over beef.","Press roll closed and serve immediately."],tip:"Cheez Whiz is traditional and intentional — it melts into every crevice. Provolone is the respectable alternative."},
  {id:255,name:"French Dip Sandwiches",protein:"beef",time:30,servings:4,cal:590,desc:"Thinly sliced roast beef on hoagie rolls with provolone, served with rich au jus for dipping.",ingredients:["1.5 lb deli roast beef, sliced thin","4 hoagie rolls, split","8 slices provolone cheese","2 cups beef broth","1 tbsp Worcestershire sauce","1 tsp garlic powder","1 tsp onion powder","1 tbsp butter","Salt and pepper"],recipe:["Simmer beef broth, Worcestershire, garlic powder, onion powder, and butter 10 min. Season to taste — this is your au jus.","Warm the roast beef slices in the au jus for 2 min.","Pile beef onto rolls, top with provolone.","Broil open-faced 2 min until cheese melts and rolls are toasty.","Serve immediately with a ramekin of hot au jus for dipping."],tip:"Keep the au jus hot — a warm dip on a warm sandwich. Cold au jus defeats the whole purpose."},
  {id:256,name:"Beef Stroganoff",protein:"beef",time:30,servings:4,cal:620,desc:"Tender beef in a rich sour cream and mushroom sauce over egg noodles.",ingredients:["1.5 lb beef sirloin, thinly sliced","12 oz wide egg noodles","8 oz cremini mushrooms, sliced","1 onion, diced","3 cloves garlic, minced","1 cup beef broth","1 cup sour cream","2 tbsp flour","2 tbsp butter","1 tbsp Worcestershire sauce","Salt and pepper","Fresh parsley"],recipe:["Cook egg noodles per package. Reserve 0.5 cup pasta water.","Season beef with salt and pepper. Sear in butter over high heat 2 min per side. Remove.","Saute mushrooms and onion in same pan until golden, 5 min. Add garlic 1 min.","Stir in flour, then broth and Worcestershire. Simmer 3 min.","Remove from heat. Stir in sour cream. Return beef and noodles to pan and toss.","Adjust consistency with pasta water if needed. Top with parsley."],tip:"Add the sour cream off the heat — if the sauce is boiling when it goes in, it will curdle and break."},
  {id:257,name:"BBQ Beef Brisket Sliders",protein:"beef",time:25,servings:4,cal:560,desc:"Slow-cooked shredded brisket piled on slider buns with pickles and slaw.",ingredients:["2 lb smoked beef brisket, shredded","1 cup BBQ sauce","12 slider buns","Dill pickle chips","2 cups coleslaw mix","3 tbsp mayo","1 tbsp apple cider vinegar","Salt and pepper"],recipe:["Mix coleslaw with mayo, vinegar, salt, and pepper. Refrigerate 10 min.","Warm brisket with BBQ sauce in a skillet or microwave until hot.","Toast slider buns under the broiler 1-2 min.","Pile brisket onto bottom buns. Add pickles and a scoop of slaw.","Cap with top bun and serve immediately."],tip:"Use smoked brisket from a BBQ joint or grocery store deli — the smoke is the whole flavor."},
  {id:258,name:"Beef Nachos",protein:"beef",time:25,servings:4,cal:690,desc:"Loaded tortilla chips with seasoned beef, melted cheese, jalapenos, and all the toppings.",ingredients:["1 lb ground beef","1 bag tortilla chips","2 cups shredded cheddar-jack cheese","1 can black beans, drained","1 can diced tomatoes with green chilies","1 tbsp taco seasoning","Sliced jalapenos","Sour cream","Guacamole","Green onions"],recipe:["Preheat oven to 400F. Brown ground beef, drain fat, add taco seasoning and 2 tbsp water. Cook 1 min.","Spread chips in a single layer on a foil-lined sheet pan.","Layer beans, beef, tomatoes with chilies, and cheese evenly over chips.","Bake 10-12 min until cheese is fully melted and bubbly.","Top with jalapenos, sour cream, guacamole, and green onions. Serve immediately."],tip:"Build in layers and bake uncovered — never cover nachos or the steam makes the chips soggy."},
  {id:259,name:"Carne Asada Bowls",protein:"beef",time:25,servings:4,cal:540,desc:"Marinated and grilled skirt steak over jasmine rice with pico de gallo, guac, and lime crema.",ingredients:["1.5 lb skirt steak","Juice of 2 limes","Juice of 1 orange","4 cloves garlic, minced","2 tbsp olive oil","1 tsp cumin","1 tsp chili powder","Salt and pepper","2 cups cooked jasmine rice","Pico de gallo","Guacamole","Sour cream and lime wedges"],recipe:["Marinate steak in lime juice, orange juice, garlic, oil, cumin, chili powder, and salt 15-30 min.","Grill or sear over high heat 3-4 min per side. Rest 5 min.","Slice thinly against the grain.","Build bowls: rice, steak, pico, guacamole.","Finish with sour cream and a squeeze of lime."],tip:"Skirt steak is thin and fast — do not overcook it. It is done before you think it is."},
  {id:260,name:"Beef Enchiladas",protein:"beef",time:40,servings:6,cal:580,desc:"Seasoned ground beef rolled in corn tortillas, smothered in red enchilada sauce and melted cheese.",ingredients:["2 lb ground beef","12 corn tortillas","2 cans red enchilada sauce","2 cups shredded Mexican cheese blend","1 onion, diced","3 cloves garlic, minced","1 tbsp chili powder","1 tsp cumin","Salt and pepper","Sour cream and jalapenos to serve"],recipe:["Preheat oven to 375F. Brown beef with onion and garlic. Season with chili powder, cumin, salt, and pepper. Drain fat.","Warm tortillas 30 seconds in the microwave so they do not crack when rolled.","Spoon 1 cup enchilada sauce in the bottom of a 9x13 baking dish.","Fill each tortilla with beef mixture, roll up, and place seam-down in dish.","Pour remaining sauce over top. Cover with cheese.","Bake 20-25 min until bubbly. Serve with sour cream and jalapenos."],tip:"Warm the tortillas before rolling — cold corn tortillas crack. 30 seconds in the microwave wrapped in a damp paper towel does it."},
  {id:261,name:"Classic Meatloaf",protein:"beef",time:75,servings:6,cal:490,desc:"Old-school beef and pork meatloaf with a sweet ketchup glaze.",ingredients:["1.5 lb ground beef","0.5 lb ground pork","1 cup breadcrumbs","2 eggs","0.5 cup milk","1 onion, grated","2 cloves garlic, minced","1 tbsp Worcestershire sauce","Salt and pepper","0.5 cup ketchup","2 tbsp brown sugar","1 tbsp vinegar"],recipe:["Preheat oven to 350F. Mix all meatloaf ingredients until just combined — do not overwork.","Press into a 9x5 loaf pan or free-form on a sheet pan.","Mix ketchup, brown sugar, and vinegar for glaze. Spread half on top.","Bake 45 min. Apply remaining glaze. Bake another 15 min until internal temp hits 160F.","Rest 10 min before slicing."],tip:"Grating the onion instead of dicing it means it disappears into the meat and keeps every slice moist."},
  {id:262,name:"Chicken Parmesan",protein:"chicken",time:35,servings:4,cal:650,desc:"Crispy breaded chicken cutlets smothered in marinara and melted mozzarella over spaghetti.",ingredients:["4 chicken breasts, pounded thin","1 cup breadcrumbs","0.5 cup grated Parmesan","2 eggs, beaten","1 jar marinara sauce","2 cups shredded mozzarella","12 oz spaghetti","2 tbsp olive oil","Salt and pepper","Fresh basil"],recipe:["Cook spaghetti per package. Preheat oven to 400F.","Season chicken, dip in egg, coat in breadcrumb-Parmesan mix.","Pan-fry in oil over medium-high heat 3 min per side until golden.","Transfer to baking sheet. Top each with marinara and mozzarella.","Bake 12-15 min until cheese is bubbly and golden.","Serve over spaghetti with extra marinara and fresh basil."],tip:"Pound the chicken to an even thickness — uneven chicken means some parts dry out before the thick parts are done."},
  {id:263,name:"Chicken Pot Pie",protein:"chicken",time:50,servings:6,cal:570,desc:"Creamy chicken and vegetable filling in a flaky double pie crust.",ingredients:["3 cups cooked chicken, shredded","1 tsp poultry seasoning (or half tsp dried thyme plus quarter tsp dried sage)","0.5 tsp garlic powder","1 cup frozen peas","1 cup carrots, diced","1 cup celery, diced","0.5 cup diced onion","0.33 cup butter","0.33 cup flour","1.75 cups chicken broth","0.67 cup milk","Salt and pepper","2 refrigerated pie crusts"],recipe:["Preheat oven to 425F. Melt butter in a saucepan. Cook onion, carrots, celery 5 min.","In a bowl, toss the shredded chicken with the poultry seasoning, garlic powder, and a generous pinch of salt and pepper so it is well-seasoned before it goes into the filling.","Stir in flour until absorbed. Gradually add broth and milk, whisking until thick, about 5 min.","Season the sauce with salt and pepper to taste, then stir in the seasoned chicken and peas.","Line a 9-inch pie dish with one crust. Pour in filling. Top with second crust, crimp edges, cut steam vents.","Bake 30-35 min until golden. Rest 5 min before serving."],tip:"Cut the steam vents generously, without them the top crust puffs and the filling boils over the sides. Seasoning the chicken separately, not just the sauce, is what keeps the filling from tasting flat."},
  {id:264,name:"Chicken Alfredo",protein:"chicken",time:25,servings:4,cal:720,desc:"Fettuccine tossed in a rich butter and Parmesan cream sauce with seasoned grilled chicken.",ingredients:["1.5 lb chicken breasts","12 oz fettuccine","1 cup heavy cream","6 tbsp butter","1.5 cups grated Parmesan","4 cloves garlic, minced","Salt, pepper, and Italian seasoning","Fresh parsley"],recipe:["Cook fettuccine per package, reserve 1 cup pasta water.","Season chicken with Italian seasoning, salt, and pepper. Pan-sear 6-7 min per side. Slice.","In same pan, melt butter over medium. Add garlic, cook 1 min.","Add cream, simmer 2 min. Add Parmesan and stir until melted and smooth.","Toss pasta in sauce, adding pasta water to loosen if needed.","Plate pasta, top with sliced chicken, finish with parsley and more Parmesan."],tip:"Take the pan off the heat before adding Parmesan — boiling cheese turns it gritty and breaks the sauce."},
  {id:265,name:"Buffalo Chicken Wraps",protein:"chicken",time:20,servings:4,cal:480,desc:"Crispy chicken tossed in Buffalo sauce, wrapped with lettuce, tomato, and blue cheese.",ingredients:["1.5 lb chicken tenders","0.5 cup Franks RedHot sauce","2 tbsp butter, melted","4 large flour tortillas","2 cups romaine, shredded","1 cup cherry tomatoes, halved","0.5 cup blue cheese crumbles","0.5 cup blue cheese dressing","Salt and pepper"],recipe:["Season chicken with salt and pepper. Pan-sear over medium-high 3-4 min per side.","Mix hot sauce and melted butter. Toss cooked chicken in Buffalo sauce.","Warm tortillas 20 seconds in microwave.","Layer romaine, tomatoes, and blue cheese crumbles on each tortilla.","Add Buffalo chicken, drizzle with blue cheese dressing.","Roll tightly and slice on the diagonal."],tip:"The butter in the Buffalo sauce is not optional — it tempers the heat and makes the sauce cling to the chicken."},
  {id:266,name:"Chicken Fried Rice",protein:"chicken",time:20,servings:4,cal:440,desc:"Day-old jasmine rice stir-fried with chicken, egg, soy sauce, and sesame.",ingredients:["2 cups cooked chicken, diced","3 cups day-old jasmine rice","3 eggs, beaten","1 cup frozen peas and carrots","4 cloves garlic, minced","4 tbsp soy sauce","1.5 tbsp oyster sauce","1 tsp sesame oil","2 tbsp vegetable oil","Green onions"],recipe:["Heat vegetable oil in a wok or large skillet over high heat until smoking.","Add chicken and garlic. Stir-fry 2 min.","Push to the side. Scramble eggs in the center, then fold into chicken.","Add rice. Press down and let it sear 1-2 min. Then stir-fry to combine.","Add peas and carrots. Stir in soy sauce and oyster sauce.","Drizzle sesame oil, toss. Serve topped with green onions."],tip:"Cold, day-old rice is non-negotiable. Fresh rice is too wet and turns to mush. Make rice the night before."},
  {id:267,name:"Chicken Quesadillas",protein:"chicken",time:20,servings:4,cal:530,desc:"Crispy flour tortillas stuffed with seasoned chicken, melted cheese, peppers, and onions.",ingredients:["1.5 lb cooked chicken, shredded","8 large flour tortillas","2 cups shredded Mexican cheese blend","1 bell pepper, thinly sliced","0.5 onion, thinly sliced","1 tbsp taco seasoning","1 tbsp olive oil","Sour cream, salsa, guacamole to serve"],recipe:["Cook pepper and onion in oil until soft, 4 min.","Toss chicken with taco seasoning.","Layer cheese, chicken, and veggies on half of each tortilla. Fold over.","Cook quesadillas in a dry skillet over medium heat 2-3 min per side until crispy and golden.","Slice into wedges. Serve with sour cream, salsa, and guacamole."],tip:"Use a dry pan — no oil. The tortilla renders enough fat on its own and oil makes it greasy instead of crispy."},
  {id:268,name:"Honey Butter Chicken Biscuits",protein:"chicken",time:25,servings:4,cal:610,desc:"Crispy fried chicken tenders drizzled with honey butter on flaky buttermilk biscuits.",ingredients:["1.5 lb chicken tenders","1 cup buttermilk","1 cup flour","1 tsp garlic powder","1 tsp paprika","Salt and pepper","Oil for frying","1 can refrigerated biscuits","4 tbsp butter, melted","3 tbsp honey"],recipe:["Soak chicken in buttermilk 10 min. Bake biscuits per package directions.","Mix flour with garlic powder, paprika, salt, and pepper.","Dredge chicken from buttermilk into seasoned flour.","Fry in 350F oil 5-6 min until golden and cooked through.","Mix melted butter and honey for honey butter sauce.","Split biscuits, place chicken inside, drizzle generously with honey butter."],tip:"Drizzle the honey butter while everything is hot — it soaks into the biscuit and makes the whole thing taste like it was made at Whataburger."},
  {id:269,name:"BBQ Chicken Pizza",protein:"chicken",time:25,servings:4,cal:550,desc:"Tangy BBQ sauce, shredded chicken, red onion, cilantro, and smoked gouda on a crispy crust.",ingredients:["1 pre-made pizza dough or naan","0.5 cup BBQ sauce","2 cups cooked chicken, shredded","0.5 red onion, thinly sliced","1.5 cups smoked gouda or mozzarella, shredded","0.25 cup fresh cilantro","Olive oil","Salt and pepper"],recipe:["Preheat oven to 450F or follow dough package directions. Stretch dough onto a greased sheet pan.","Brush dough with BBQ sauce to the edges.","Scatter chicken evenly, then red onion, then cheese.","Bake 12-15 min until crust is golden and cheese is bubbly.","Remove, top with fresh cilantro, slice, and serve."],tip:"BBQ sauce burns faster than tomato sauce — watch it in the last 3 minutes and pull it when the edges just start to char."},
  {id:270,name:"Chicken & Waffles",protein:"chicken",time:35,servings:4,cal:740,desc:"Southern-spiced crispy fried chicken on fluffy waffles with maple syrup and hot sauce.",ingredients:["8 chicken drumsticks or thighs","1 cup buttermilk","1 tbsp hot sauce","1.5 cups flour","1 tsp cayenne","1 tsp garlic powder","1 tsp onion powder","Salt and pepper","Oil for frying","8 frozen waffles, toasted","Maple syrup and hot sauce to serve"],recipe:["Marinate chicken in buttermilk and hot sauce at least 20 min.","Mix flour with cayenne, garlic powder, onion powder, salt, and pepper.","Dredge chicken in seasoned flour, pressing firmly to coat.","Fry in 350F oil 12-14 min until deep golden and cooked through. Drain.","Toast waffles. Plate with chicken on top.","Serve with maple syrup and hot sauce — pour both liberally."],tip:"Pour maple syrup AND hot sauce. The sweet-heat combination over crispy chicken is the whole point."},
  { id:300,name:"Garlic Butter Scallops with Herbed Orzo",protein:"seafood",time:25,servings:4,cal:520,desc:"Seared jumbo scallops in a garlic-butter pan sauce over lemony orzo with fresh herbs.",premium:true,ingredients:["1.5 lb jumbo sea scallops, patted dry","Salt and pepper","2 tbsp olive oil","4 tbsp butter, divided","4 garlic cloves, minced","1 cup orzo","2 cups chicken broth","Zest and juice of 1 lemon","0.25 cup chopped parsley","0.25 cup grated parmesan"],recipe:["Cook orzo in chicken broth per package directions until al dente and broth is mostly absorbed. Stir in 1 tbsp butter, lemon zest, and parmesan.","Season scallops generously with salt and pepper. Heat oil in a large skillet over high heat until shimmering.","Sear scallops 1.5-2 min per side until golden-brown crusts form. Do not move them while searing. Remove to a plate.","Lower heat to medium. Melt remaining butter, add garlic, cook 30 sec until fragrant. Stir in lemon juice.","Spoon orzo onto plates, top with scallops, drizzle with garlic butter, and scatter parsley over top."],tip:"A dry scallop and a screaming-hot pan are the whole secret to a real sear — pat them dry twice if you have to.",recipe_detailed:["Cook the orzo directly in chicken broth like a risotto rather than boiling it in water and draining — it soaks up flavor as it cooks. Stir occasionally and check at the package's minimum time; orzo overcooks fast. Once tender, fold in a tablespoon of butter, the lemon zest, and parmesan off the heat so the cheese doesn't clump.","Scallops are mostly water, and water is the enemy of a good sear. Lay them on a paper towel, press another paper towel on top, and let them sit while you prep everything else. Season both sides with salt and pepper right before they hit the pan, not earlier — salt draws out moisture over time.","Use a stainless or cast iron skillet, not nonstick, and get it properly hot — a drop of water should skitter and evaporate almost instantly. Add oil, then lay scallops in one at a time, flat side down, leaving space between each. Crowding drops the pan's temperature and steams them instead of searing.","Resist the urge to peek or move them: 90 seconds to 2 minutes undisturbed builds a deep golden crust that releases cleanly from the pan on its own. Flip once, sear the second side for about a minute less — scallops finish cooking fast and go rubbery if pushed past opaque-and-just-firm.","Wipe out the pan if it's scorched, then build the sauce in the same skillet to catch the fond. Melt butter over medium, add garlic just until it smells nutty (30 seconds, no more, or it turns bitter), then kill the heat with lemon juice, which stops the garlic from browning further and brightens the whole sauce."]},
  { id:301,name:"Blackened Mahi Mahi Tacos",protein:"seafood",time:20,servings:4,cal:410,desc:"Cajun-spiced mahi mahi in warm tortillas with crunchy slaw and a creamy chipotle drizzle.",premium:true,ingredients:["1.5 lb mahi mahi fillets","2 tbsp blackening seasoning (paprika, cayenne, garlic powder, oregano, thyme)","2 tbsp olive oil","8 small corn tortillas","3 cups shredded cabbage slaw mix","0.5 cup mayo","1 chipotle pepper in adobo, minced","1 lime, juiced","Cilantro","Cotija cheese, crumbled"],recipe:["Whisk mayo, chipotle, and half the lime juice for the crema. Set aside.","Pat mahi mahi dry, coat all over with blackening seasoning, pressing to adhere.","Heat oil in a heavy skillet over medium-high until nearly smoking. Sear fish 3-4 min per side until a dark crust forms and it flakes easily.","Rest 2 min, then flake into large chunks. Toss slaw with remaining lime juice.","Warm tortillas, fill with fish and slaw, drizzle with chipotle crema, and top with cilantro and cotija."],tip:"Get the pan properly hot before the fish goes in — a true blacken needs real heat, not a gentle warm-through.",recipe_detailed:["Make the crema first so the flavors have time to meld: whisk mayo, minced chipotle (seeds removed if you want less heat), and half the lime juice until smooth. Taste and adjust — more chipotle for smokier heat, more lime for brightness.","Pat the mahi mahi bone-dry with paper towels; any surface moisture will steam instead of char. Sprinkle blackening seasoning generously over both sides and press it in with your fingers so it forms a crust rather than sitting loose on top.","A cast iron or carbon steel pan is ideal here since it holds heat well and can take the high temperature blackening demands. Heat oil until it just starts to shimmer and thin wisps of smoke appear — this is hotter than you'd use for most fish.","Lay the fillets away from you to avoid splatter, and don't touch them for a full 3 minutes. The spice crust needs contact time with the hot metal to actually blacken rather than just turn brown. Flip once with a thin fish spatula, working gently since the crust is delicate.","The fish is done when it flakes easily with a fork and reads about 137°F in the thickest part — mahi mahi dries out fast past that point, so pull it a shade early and let carryover heat finish the job during the 2-minute rest before flaking."]},
  { id:302,name:"Thai Coconut Shrimp Curry",protein:"seafood",time:25,servings:4,cal:460,desc:"Sweet-spicy red curry shrimp simmered in coconut milk with bell peppers over jasmine rice.",premium:true,ingredients:["1.5 lb large shrimp, peeled and deveined","2 tbsp red curry paste","1 can (14 oz) coconut milk","1 red bell pepper, sliced","1 cup snap peas","1 tbsp fish sauce","1 tbsp brown sugar","1 lime, juiced","Fresh basil","Jasmine rice, cooked"],recipe:["Scoop the thick coconut cream from the top of the can into a hot pot. Fry curry paste in it 1-2 min until fragrant and glossy.","Add remaining coconut milk, fish sauce, and brown sugar. Bring to a gentle simmer.","Add bell pepper and snap peas, cook 3-4 min until just tender.","Add shrimp, cook 3-4 min until pink and opaque throughout.","Stir in lime juice, taste and adjust salt/sweet/sour. Serve over rice topped with basil."],tip:"Frying the curry paste in coconut cream first — instead of just dumping in the whole can — is what gives the curry real depth instead of a thin, watery taste.",recipe_detailed:["Don't shake the coconut milk can before opening. Scoop just the thick cream that's risen to the top into a hot, dry pot — this is the step Thai cooks call 'cracking' the coconut cream, and it lets the paste fry in fat instead of simmering in liquid, which is what actually builds flavor.","Fry the curry paste in that cream over medium heat, stirring constantly, until it darkens slightly, smells toasty rather than raw, and the oil starts to separate a little at the edges — about 1 to 2 minutes. Rushing this step is the most common reason curry tastes flat.","Pour in the rest of the coconut milk along with fish sauce and brown sugar, and stir to dissolve everything into one sauce. Bring it to a bare simmer — a hard boil can cause coconut milk to separate and look curdled, so keep the heat gentle from here on.","Add the vegetables first since they need slightly longer than the shrimp, and cook just until the peppers soften but the snap peas still have a bit of snap. Shrimp go in last and cook fast — 3 to 4 minutes is enough for large shrimp to turn pink and opaque; overcooked shrimp turn tough and curl tightly.","Finish off the heat with lime juice so its brightness doesn't cook away, then taste. Thai curries balance salty (fish sauce), sweet (sugar), and sour (lime) against the richness of the coconut milk — adjust in small increments until it tastes balanced to you, not flat or one-note."]},
  { id:303,name:"Cedar Plank Salmon with Dill Sauce",protein:"seafood",time:30,servings:4,cal:480,desc:"Smoky grilled salmon on a cedar plank with a cool, tangy yogurt-dill sauce.",premium:true,ingredients:["1 cedar grilling plank, soaked 1 hour","4 salmon fillets, skin-on","2 tbsp olive oil","Salt and pepper","1 lemon, sliced","0.75 cup Greek yogurt","2 tbsp fresh dill, chopped","1 tbsp lemon juice","1 garlic clove, grated","Salt"],recipe:["Soak the cedar plank in water at least 1 hour, weighting it down so it stays submerged.","Whisk yogurt, dill, lemon juice, garlic, and a pinch of salt for the sauce. Chill until serving.","Preheat grill to medium-high. Place the soaked plank on the grate 3 min until it starts to crackle and smoke lightly.","Brush salmon with oil, season with salt and pepper, and lay skin-down on the plank with lemon slices on top. Close the lid.","Grill 12-15 min until salmon flakes easily and reaches 125-130F. Serve on the plank with dill sauce."],tip:"If the plank catches a real flame instead of just smoking, mist it with water from a spray bottle — don't panic and pull the salmon.",recipe_detailed:["Submerge the cedar plank fully in water for at least an hour, and longer if you have time — a dry plank will scorch and can flame up rather than smoke. A plate or can on top keeps it from floating.","While the plank soaks, make the sauce so its flavors have time to come together in the fridge: whisk yogurt, dill, lemon juice, and grated garlic with a pinch of salt. It should taste bright and slightly tangy — this cool sauce is the contrast to the smoky, rich fish.","Get your grill to a steady medium-high before the plank goes on. Set the wet plank directly on the grate and close the lid for a few minutes until you hear faint crackling and see the first wisps of cedar smoke — that's your cue it's ready for the fish.","Lay the salmon skin-side down directly on the plank (the skin protects the flesh from scorching and helps it release cleanly later) and fan lemon slices over the top so their oils drip down through the fish as it cooks. Close the lid and resist opening it, which lets smoke and heat escape.","Salmon is done when it flakes with light pressure from a fork and the center is still faintly translucent — pull it around 125 to 130°F since it will keep climbing a few degrees as it rests. Carry the whole plank to the table; it makes a great centerpiece and keeps the fish warm."]},
  { id:304,name:"New England Clam Chowder",protein:"seafood",time:45,servings:6,cal:390,desc:"Creamy, hearty chowder loaded with clams, potatoes, and smoky bacon.",premium:true,ingredients:["4 slices bacon, diced","1 onion, diced","2 celery stalks, diced","3 tbsp flour","3 cans (6.5 oz) chopped clams, juice reserved","2 cups clam juice or seafood stock","3 Yukon gold potatoes, cubed","2 cups half-and-half","2 bay leaves","Salt and pepper","Oyster crackers and chives to serve"],recipe:["Cook bacon in a large pot until crisp. Remove bacon, leave the fat.","Cook onion and celery in the bacon fat 5 min until softened. Stir in flour, cook 1 min.","Whisk in reserved clam juice and stock, scraping up browned bits. Add potatoes and bay leaves.","Simmer 15-18 min until potatoes are tender. Stir in half-and-half and clams, warm through — don't boil.","Season with salt and pepper. Serve topped with crispy bacon, chives, and oyster crackers."],tip:"Add the clams at the very end and just warm them through — boiled clams turn to rubber fast.",recipe_detailed:["Render the bacon slowly over medium heat so it crisps evenly and leaves behind well-flavored fat — this fat is the base of the whole chowder's flavor, so don't rush it or drain it away. Set the crispy bacon aside for garnish.","Sauté the onion and celery right in the bacon fat until they're soft and translucent but not browned, about 5 minutes. Sprinkle the flour over top and stir constantly for a full minute — this cooks off the raw flour taste and sets up the chowder's thickness.","Pour in the reserved clam juice and stock gradually, whisking as you go to work out any lumps, and scrape the bottom of the pot to lift up the browned bits, which carry a lot of flavor. Add the potatoes and bay leaves once the liquid is smooth.","Simmer gently, uncovered, until a fork slides easily into the potatoes, 15 to 18 minutes — a hard boil can break the roux's thickening power, so keep it at a lazy bubble. This is also when the chowder base actually develops its flavor, so don't shortcut the simmer.","Stir in the half-and-half and the clams only at the end, and warm everything through on low heat without letting it boil — both dairy and clams turn unpleasant (grainy dairy, rubbery clams) if they're cooked too hard or too long. Taste before serving; clam juice is salty, so season carefully."]},
  { id:305,name:"Shrimp Scampi Linguine",protein:"seafood",time:20,servings:4,cal:540,desc:"Garlicky butter-and-wine shrimp tossed with linguine, lemon, and a shower of parsley.",premium:true,ingredients:["1 lb linguine","1.5 lb large shrimp, peeled and deveined","Salt and pepper","4 tbsp butter, divided","3 tbsp olive oil","6 garlic cloves, thinly sliced","0.5 cup dry white wine","1 lemon, zested and juiced","0.5 tsp red pepper flakes","0.5 cup chopped parsley","Parmesan to serve"],recipe:["Cook linguine in heavily salted water until just shy of al dente. Reserve 1 cup pasta water before draining.","Season shrimp with salt and pepper. Heat olive oil and 1 tbsp butter in a large skillet over medium-high.","Sear shrimp 1-2 min per side until just pink. Remove to a plate.","Add garlic and pepper flakes to the same pan, cook 30 sec. Pour in wine, scrape up browned bits, simmer 2 min to reduce slightly.","Add pasta, remaining butter, lemon zest and juice, and a splash of pasta water. Toss until glossy, return shrimp to warm through, and finish with parsley and parmesan."],tip:"Undercook the pasta slightly on purpose — it finishes cooking in the sauce and soaks up all that garlic-wine flavor.",recipe_detailed:["Salt the pasta water until it tastes like the sea — this is your only chance to season the noodles themselves. Cook the linguine about a minute short of the package's al dente time since it will finish cooking in the sauce later. Reserve a full cup of the starchy water before draining; you'll need it to bring the sauce together.","Pat the shrimp dry and season simply with salt and pepper. Get the oil and a tablespoon of butter hot in a wide skillet, then sear the shrimp in a single layer without crowding — work in two batches if needed. They only need a minute or two per side until just turning pink; pull them before they're fully cooked, since they'll rejoin the sauce later.","Lower the heat slightly and add the sliced garlic and red pepper flakes to the same pan, off the direct high heat so the garlic turns golden and fragrant rather than scorched and bitter — this takes about 30 seconds. Pour in the wine right away to stop the garlic from cooking further, and scrape up any browned bits stuck to the pan, which are pure flavor.","Let the wine bubble and reduce by about half, which concentrates its flavor and cooks off the harsh alcohol edge, leaving something bright and savory. This is the backbone of a proper scampi sauce.","Add the drained pasta directly to the skillet along with the remaining butter, lemon zest and juice, and a good splash of the reserved pasta water. Toss vigorously — the starch in the water combines with the butter to form a light, clinging sauce rather than a greasy or watery one. Fold the shrimp back in just to reheat, then finish with parsley and a generous grating of parmesan."]},
  { id:306,name:"Korean Gochujang Salmon Bowls",protein:"seafood",time:25,servings:4,cal:490,desc:"Sticky-sweet gochujang-glazed salmon over rice with quick pickled cucumber and avocado.",premium:true,ingredients:["4 salmon fillets","3 tbsp gochujang","2 tbsp honey","1 tbsp soy sauce","1 tbsp rice vinegar","1 tsp sesame oil","2 garlic cloves, grated","1 cucumber, thinly sliced","2 tbsp rice vinegar (for pickle)","1 tsp sugar","2 avocados, sliced","Cooked rice","Sesame seeds and scallion"],recipe:["Toss cucumber slices with 2 tbsp rice vinegar, sugar, and a pinch of salt. Set aside to quick-pickle while you cook.","Whisk gochujang, honey, soy sauce, 1 tbsp rice vinegar, sesame oil, and garlic for the glaze.","Pat salmon dry, season lightly with salt. Sear skin-down in an oiled skillet over medium-high 4 min until crisp.","Flip, brush generously with glaze, and cook 3-4 min more, brushing again, until glaze is sticky and salmon flakes easily.","Build bowls with rice, salmon, pickled cucumber, and avocado. Top with sesame seeds and scallion."],tip:"Brush the glaze on in the last few minutes only — gochujang's sugars burn fast over direct heat.",recipe_detailed:["Start the quick pickle first so it has time to work: toss the cucumber slices with rice vinegar, sugar, and a pinch of salt, and let them sit at room temperature while you do everything else. Even 15 minutes gives them a nice tang and crunch.","Whisk the glaze ingredients together in a small bowl until smooth — gochujang can be lumpy straight from the jar, so make sure it's fully worked into the honey and soy sauce with no clumps left, which helps it coat evenly later.","Pat the salmon very dry and season lightly with salt (the glaze brings plenty of flavor on its own). Sear skin-side down in a hot, lightly oiled skillet for about 4 minutes without moving it — this renders the skin and gets it properly crisp, which is hard to achieve once glaze is involved.","Flip the fillets and brush a generous layer of glaze over the top. From here, watch closely: gochujang's natural sugars caramelize quickly and can scorch if the heat is too high, so keep it at medium and brush on a second coat halfway through the remaining cook time for a deep, glossy lacquer.","Salmon is ready when it flakes easily with a fork and the glaze has turned sticky and slightly charred at the edges, about 3 to 4 more minutes. Build your bowls right away while everything is warm, letting the cool pickled cucumber and creamy avocado play off the hot, spicy-sweet fish."]},
  { id:307,name:"Cajun Shrimp and Grits",protein:"seafood",time:30,servings:4,cal:520,desc:"Blackened shrimp in a smoky bacon-butter pan sauce over creamy cheddar grits.",premium:true,ingredients:["1.5 lb large shrimp, peeled and deveined","2 tbsp Cajun seasoning","4 slices bacon, diced","1 cup stone-ground grits","4 cups chicken broth","1 cup shredded cheddar","2 tbsp butter","1 bell pepper, diced","3 garlic cloves, minced","2 scallions, sliced","Hot sauce to taste"],recipe:["Bring broth to a boil, whisk in grits. Reduce heat, simmer 20-25 min, stirring often, until creamy. Stir in cheddar and butter, season with salt.","Meanwhile, toss shrimp with Cajun seasoning. Cook bacon in a skillet until crisp; remove, leave the fat.","Sear shrimp in the bacon fat 1-2 min per side until pink. Remove.","Add bell pepper and garlic to the pan, cook 3 min until softened. Return shrimp and bacon to warm through.","Spoon grits into bowls, top with the shrimp mixture, scallions, and hot sauce."],tip:"Stir the grits often and don't rush the simmer — real stone-ground grits need the full 20+ minutes to turn creamy instead of gritty.",recipe_detailed:["Whisk the grits into boiling broth in a steady stream to prevent clumping, then immediately drop the heat to low. Stone-ground grits need a genuine 20 to 25 minute simmer, stirring every few minutes so they don't stick and scorch on the bottom — instant grits will not give you the same texture, so seek out stone-ground if you can.","Once the grits are thick and creamy and no longer taste gritty on the tongue, stir in the cheddar and butter off the heat so the cheese melts smoothly instead of breaking. Season with salt to taste — grits need more than you'd expect.","While the grits simmer, toss the shrimp thoroughly with Cajun seasoning so every piece is coated. Render the bacon in a separate skillet over medium heat until crisp and deeply browned, then remove it to a paper-towel-lined plate, leaving all that flavorful fat behind.","Sear the seasoned shrimp in the hot bacon fat in a single layer, about 1 to 2 minutes per side — they cook fast, so pull them the moment they turn pink and opaque to avoid rubbery shrimp. Set them aside with the bacon.","Sauté the bell pepper and garlic in the same pan until just softened, scraping up the flavorful browned bits left behind. Return the shrimp and bacon to the pan just to reheat everything together, then spoon the whole mixture over bowls of hot cheddar grits and finish with scallions and a shake of hot sauce."]},
  { id:308,name:"Miso Butter Cod with Bok Choy",protein:"seafood",time:20,servings:4,cal:380,desc:"Flaky cod broiled with a savory miso-butter glaze, served with garlicky sesame bok choy.",premium:true,ingredients:["4 cod fillets","3 tbsp white miso paste","2 tbsp butter, softened","1 tbsp honey","1 tbsp mirin","4 heads baby bok choy, halved","1 tbsp sesame oil","2 garlic cloves, minced","1 tbsp soy sauce","Sesame seeds"],recipe:["Preheat broiler. Mash miso, butter, honey, and mirin into a smooth paste.","Pat cod dry, place on a foil-lined sheet pan, and spread the miso butter generously over each fillet.","Broil 6-8 min until the top is caramelized and browned and fish flakes easily.","Meanwhile, heat sesame oil in a skillet, add garlic, cook 30 sec. Add bok choy cut-side down, cook 3-4 min until charred and just tender. Splash with soy sauce.","Serve cod over bok choy, spooning any pan juices on top, finished with sesame seeds."],tip:"Broilers vary a lot — start checking at the 5-minute mark so the miso glaze caramelizes instead of burning.",recipe_detailed:["Mash the miso, softened butter, honey, and mirin together with a fork or small whisk until you have a completely smooth, spreadable paste — any lumps of miso won't melt evenly under the broiler and can leave salty pockets.","Pat the cod thoroughly dry so the glaze adheres rather than sliding off, then spread a thick, even layer of the miso butter over the top of each fillet, right to the edges. Line your sheet pan with foil, since the glaze can drip and burn onto bare metal.","Position the oven rack so the fish sits about 6 inches from the broiler element, not directly under it — miso's natural sugars caramelize fast and can go from perfectly browned to burnt in under a minute. Broil in short stretches, checking every couple of minutes rather than walking away.","While the cod broils, get a skillet good and hot with the sesame oil, then bloom the garlic for just 30 seconds until fragrant. Lay the bok choy halves cut-side down so the flat surface makes full contact with the pan — this is what gives you real char rather than a pale, steamed vegetable.","Pull the cod once the top is deeply caramelized in spots and the fish flakes apart easily with a fork, usually 6 to 8 minutes total. Splash the bok choy with soy sauce right at the end so it stays glossy rather than reducing to a sticky glaze, then plate everything together with the pan juices spooned over the fish."]},
  { id:309,name:"Lobster Roll Night",protein:"seafood",time:20,servings:4,cal:430,desc:"Chilled, buttery lobster salad piled into toasted split-top rolls, New England style.",premium:true,ingredients:["1 lb cooked lobster meat, chopped","0.33 cup mayo","1 tbsp lemon juice","1 celery stalk, finely diced","1 tbsp fresh chives, chopped","Salt and pepper","4 split-top hot dog buns","3 tbsp butter, softened","Lettuce leaves","Lemon wedges to serve"],recipe:["Gently fold lobster meat with mayo, lemon juice, celery, and chives. Season with salt and pepper. Chill 15 min if time allows.","Butter both outer sides of the split-top buns.","Toast buns in a skillet over medium heat 1-2 min per side until golden and crisp.","Line each bun with a lettuce leaf, then pile in the lobster salad, mounding it generously.","Serve immediately with lemon wedges on the side."],tip:"Go light on the mayo and fold gently — the lobster meat should be the star, not drowning in dressing.",recipe_detailed:["Chop the lobster meat into bite-sized chunks, keeping some larger pieces intact rather than mincing it fine — you want to actually taste and feel the lobster in every bite, not a paste.","Fold in the mayo, lemon juice, celery, and chives using a light hand — overmixing breaks the lobster meat down and makes the salad mushy. Start with a little less mayo than you think you need; you can always add more, but a soupy lobster salad is hard to fix.","Season with salt and pepper, taste, and adjust the lemon if it needs more brightness. If you have 15 minutes to spare, chill the salad — cold lobster salad has noticeably better texture and flavor than room-temperature, though it's still good either way.","Butter the outer, flat sides of the split-top buns generously, all the way to the edges. Toast them in a dry skillet over medium heat, pressing down gently, until each side is deeply golden and a little crisp — this contrast between the crunchy toasted bread and the cool, creamy filling is what makes a lobster roll special.","Tuck a lettuce leaf into each toasted bun before adding the filling — it adds crunch and keeps the bread from getting soggy. Mound the lobster salad generously so it spills slightly over the top, and serve right away with lemon wedges for anyone who wants extra brightness."]},
  { id:310,name:"Japanese Souffle Pancakes",protein:"breakfast",time:30,servings:4,cal:410,desc:"Tall, jiggly, cloud-like pancakes with a delicate vanilla flavor, dusted with powdered sugar.",premium:true,ingredients:["4 eggs, separated","0.25 cup milk","1 tsp vanilla extract","0.5 cup flour","0.5 tsp baking powder","0.33 cup sugar","0.25 tsp cream of tartar","Butter for the pan","Powdered sugar and maple syrup to serve"],recipe:["Whisk egg yolks, milk, and vanilla. Sift in flour and baking powder, whisk until smooth.","In a separate clean bowl, beat egg whites with cream of tartar until foamy. Gradually add sugar, beating to stiff, glossy peaks.","Fold a third of the whites into the yolk batter to lighten it, then gently fold in the rest in two more additions — don't overmix.","Heat a nonstick pan over low heat, butter lightly. Spoon batter into tall mounds, cover, and cook 4-5 min per side, adding a splash of water to the pan before covering to steam them.","Carefully flip, cover, cook 4-5 min more until set and cooked through. Dust with powdered sugar and serve with syrup."],tip:"Low and slow is everything here — these puff from steam and gentle heat, and a hot pan will brown the outside before the inside sets.",recipe_detailed:["Separate the eggs carefully, making sure absolutely no yolk gets into the whites — even a trace of fat will keep the whites from whipping to full volume, which is what gives these pancakes their signature height.","Whisk the yolks with milk and vanilla until smooth, then sift the flour and baking powder directly into the bowl to avoid lumps, whisking just until combined. This is your flavor base, and it should be a thick, smooth batter.","In a completely clean, dry bowl, beat the egg whites with cream of tartar (which stabilizes the foam) starting on low speed until foamy, then gradually stream in the sugar while increasing speed. Beat until the peaks stand up firmly and glossy when you lift the beater — this usually takes 3 to 5 minutes and is the single most important step in the recipe.","Fold, don't stir: add about a third of the meringue into the yolk batter first and mix it in fully to loosen the batter, then add the rest in two more additions, using a spatula to cut down through the center and fold up the sides. Stop as soon as no white streaks remain — overfolding deflates the air you worked to build.","Cook over the lowest heat your stove allows, in a lightly buttered nonstick pan. Mound the batter tall rather than spreading it, add a spoonful of water to the pan away from the batter, and cover immediately to trap steam — this is what cooks the inside gently while the pancakes rise. Expect 4 to 5 minutes per side with the lid on, and flip gently with two spatulas to keep them from collapsing."]},
  { id:311,name:"Chorizo and Egg Breakfast Tacos",protein:"breakfast",time:20,servings:4,cal:460,desc:"Spicy Mexican chorizo scrambled with eggs and potatoes, piled into warm tortillas.",premium:true,ingredients:["12 oz Mexican chorizo, casing removed","2 potatoes, small-diced","8 eggs, beaten","8 small flour or corn tortillas","1 cup shredded cheddar or queso fresco","0.5 cup salsa","Cilantro","Lime wedges"],recipe:["Cook diced potatoes in a skillet with a little oil over medium heat 10-12 min, stirring occasionally, until golden and tender.","Push potatoes to one side. Add chorizo, breaking it up, and cook 5-6 min until browned and cooked through.","Drain excess grease if needed. Pour in beaten eggs and stir gently, cooking until just set and creamy — don't overcook.","Warm tortillas in a dry skillet or over a flame until lightly charred.","Fill tortillas with the chorizo-egg-potato mixture, top with cheese, salsa, and cilantro. Serve with lime wedges."],tip:"Mexican chorizo is raw and needs to be fully cooked through, unlike the cured Spanish kind — cook it until no pink remains before adding the eggs.",recipe_detailed:["Start the potatoes first since they take the longest: dice them small and uniform so they cook evenly, and give them a full 10 to 12 minutes in the skillet, stirring only occasionally so each side gets a chance to brown rather than just steaming in a crowded pan.","Once the potatoes are fork-tender with golden edges, push them to one side of the skillet to make room. Add the chorizo directly to the empty side, breaking it apart with your spatula as it cooks — Mexican chorizo is sold raw, so cook it thoroughly, about 5 to 6 minutes, until no pink remains and it's rendered its bright red fat into the pan.","If there's a lot of excess grease pooled in the pan, spoon some off before adding the eggs, or your scramble will taste greasy rather than rich. Pour the beaten eggs directly over the chorizo and potatoes.","Stir gently and continuously over medium-low heat, pulling the eggs from the edges of the pan toward the center as they set. Pull the pan off the heat while the eggs still look slightly underdone and glossy — they'll keep cooking from residual heat and end up perfectly creamy rather than dry and rubbery.","Char the tortillas directly over a gas flame for a few seconds per side if you have one, or in a dry hot skillet — this small step adds real flavor that a microwaved tortilla can't match. Build the tacos immediately while everything is hot, and let each person add their own cheese, salsa, and lime to taste."]},
  { id:312,name:"Classic Belgian Waffles with Berries",protein:"breakfast",time:25,servings:4,cal:480,desc:"Crisp-edged, fluffy Belgian waffles topped with macerated berries and whipped cream.",premium:true,ingredients:["2 cups flour","1 tbsp baking powder","0.25 cup sugar","0.5 tsp salt","2 eggs, separated","1.75 cups milk","0.5 cup melted butter","1 tsp vanilla extract","2 cups mixed berries","2 tbsp sugar (for berries)","Whipped cream and maple syrup to serve"],recipe:["Toss berries with 2 tbsp sugar and let macerate at room temperature while you make the batter.","Whisk flour, baking powder, sugar, and salt. In another bowl, whisk egg yolks, milk, melted butter, and vanilla.","Pour wet into dry ingredients, whisking just until combined — a few lumps are fine.","Beat egg whites to soft peaks and fold into the batter gently.","Cook in a preheated waffle iron per its instructions until golden and crisp. Top with macerated berries and whipped cream."],tip:"Folding in beaten egg whites instead of just adding whole eggs is what gives Belgian waffles their extra-light, crisp texture.",recipe_detailed:["Toss the berries with sugar well before you plan to serve — even 15 to 20 minutes lets the sugar draw out their juices and create a light natural syrup, which is far better than plain fruit on top.","Whisk the dry ingredients together thoroughly so the baking powder is evenly distributed — clumped baking powder means some bites of waffle rise more than others. In a separate bowl or large measuring cup, whisk the egg yolks, milk, melted butter, and vanilla until fully combined.","Pour the wet mixture into the dry and whisk just until no dry streaks of flour remain. Overmixing develops gluten and makes waffles tough and chewy instead of tender, so a few small lumps in the batter are completely fine — better than overworking it.","In a clean bowl, whisk the egg whites until they hold soft, floppy peaks — not stiff, just enough to trap air. Fold them into the batter gently with a spatula, cutting and folding rather than stirring, to keep as much air in as possible. This extra step is what separates a Belgian waffle's light interior from a denser standard waffle.","Preheat your waffle iron fully before adding batter — a properly hot iron is what creates that deep golden color and crisp shell. Resist opening it early to check; most irons signal with reduced steam or a light when they're actually done. Serve waffles immediately for maximum crispness, topped with the macerated berries and their juices plus a dollop of whipped cream."]},
  { id:313,name:"Loaded Breakfast Skillet",protein:"breakfast",time:35,servings:4,cal:540,desc:"A hearty one-pan breakfast of crispy potatoes, sausage, peppers, and eggs baked right in.",premium:true,ingredients:["1.5 lbs baby potatoes, quartered","2 tbsp olive oil","12 oz breakfast sausage, casings removed","1 bell pepper, diced","1 small onion, diced","1 cup shredded cheddar","4-6 eggs","Salt and pepper","Chives or green onion","Hot sauce to serve"],recipe:["Preheat oven to 400F. Toss potatoes with oil, salt, and pepper on a sheet pan. Roast 20 min until nearly tender.","Meanwhile, brown sausage in an oven-safe skillet, breaking it up, about 6-7 min. Add pepper and onion, cook 4-5 min until softened.","Add roasted potatoes to the skillet and toss everything together. Sprinkle cheese over top.","Make 4-6 wells in the mixture and crack an egg into each well.","Bake at 400F for 8-10 min until egg whites are set but yolks are still jammy. Top with chives and hot sauce."],tip:"Roasting the potatoes separately first, rather than boiling or steaming them, is what keeps this skillet from turning soggy.",recipe_detailed:["Cut the potatoes into evenly sized quarters so they roast at the same rate, then toss them with olive oil, salt, and pepper directly on a sheet pan — giving them space rather than piling them up is key to actual roasting instead of steaming. Twenty minutes at 400°F should leave them golden at the edges and nearly fork-tender.","While the potatoes roast, brown the sausage in an oven-safe skillet over medium heat, breaking it into small, uneven crumbles with your spatula — those craggy bits crisp up nicely and add texture. This takes about 6 to 7 minutes; drain excess fat if there's a lot pooling.","Add the diced pepper and onion straight into the sausage fat and cook until they've softened and picked up a little color, roughly 4 to 5 minutes. This builds a flavorful base for everything that follows.","Once the potatoes are done, add them straight to the skillet with the sausage and vegetables and toss to combine everything evenly. Scatter the cheese over the top so it melts down into the mixture as it goes back into the oven.","Use the back of a spoon to press 4 to 6 shallow wells into the mixture, spaced out, and crack an egg into each. Bake at 400°F for 8 to 10 minutes — start checking at 8, since you want the whites fully set but the yolks still soft and jammy so they run into the skillet when you serve it."]},
  { id:314,name:"Overnight Cinnamon French Toast Bake",protein:"breakfast",time:50,servings:6,cal:490,desc:"A make-ahead baked French toast casserole with a crackly cinnamon-sugar top, perfect for a lazy morning.",premium:true,ingredients:["1 loaf brioche or challah, cubed","8 eggs","2 cups milk","0.5 cup heavy cream","0.5 cup sugar","2 tsp cinnamon","1 tsp vanilla extract","Pinch of salt","0.33 cup butter, melted","0.33 cup brown sugar","0.5 cup chopped pecans (optional)","Maple syrup to serve"],recipe:["Grease a 9x13 baking dish and spread the cubed bread evenly.","Whisk eggs, milk, cream, sugar, cinnamon, vanilla, and salt. Pour evenly over the bread, pressing down so it soaks in.","Cover and refrigerate at least 4 hours, or overnight.","When ready to bake, preheat oven to 350F. Mix melted butter, brown sugar, and pecans, and drizzle over the top.","Bake 40-45 min until puffed, golden, and set in the center. Let rest 5 min, then serve with maple syrup."],tip:"Stale, day-old bread actually works better here than fresh — it soaks up the custard without turning to mush.",recipe_detailed:["Cube the bread a day ahead if you can and leave it uncovered on the counter to stale slightly, or lightly toast fresh cubes in a low oven — this matters more than you'd think, since fresh, soft bread can turn gummy once it's saturated with custard.","Spread the cubes evenly in a greased baking dish, distributing any denser pieces so no one area is over- or under-filled. Whisk the eggs, milk, cream, sugar, cinnamon, vanilla, and salt together thoroughly until no streaks of egg white remain.","Pour the custard slowly and evenly over the bread, then press down gently with a spatula or your hands so every cube gets a chance to soak. Cover tightly and refrigerate for at least 4 hours — overnight is better — so the bread fully absorbs the custard rather than just sitting in a puddle of it.","When you're ready to bake, let the dish sit at room temperature for about 15 minutes while the oven preheats, which helps it bake more evenly. Mix the melted butter, brown sugar, and pecans if using, and drizzle this streusel-like topping evenly over the surface right before it goes in.","Bake until the top is deeply golden, slightly crackly, and the center no longer jiggles when you nudge the dish, 40 to 45 minutes — tent it loosely with foil partway through if the top is browning faster than the center is setting. Let it rest for 5 minutes before cutting so it holds together on the plate."]},
  { id:315,name:"Corned Beef Hash and Eggs",protein:"breakfast",time:30,servings:4,cal:470,desc:"Crispy pan-fried corned beef and potato hash topped with a fried egg.",premium:true,ingredients:["1 lb cooked corned beef, diced","3 russet potatoes, small-diced","1 onion, diced","2 tbsp oil, divided","2 tbsp butter","Salt and pepper","4 eggs","Chives","Hot sauce or ketchup to serve"],recipe:["Parboil diced potatoes in salted water 5 min until just tender at the edges. Drain well.","Heat oil in a large skillet over medium-high. Add potatoes in a single layer, cook 8-10 min undisturbed until deeply golden on the bottom.","Add onion and corned beef, stir to combine, and press the whole mixture flat with a spatula. Cook 6-8 min, flipping in sections, until crispy throughout.","Season with salt and pepper (go light on salt — corned beef is already salty).","In a separate pan, fry eggs in butter to your liking. Serve hash topped with a fried egg and chives."],tip:"Parboiling the potatoes briefly first means they finish crisping in the skillet instead of staying raw in the middle.",recipe_detailed:["Give the diced potatoes a 5-minute head start in boiling salted water — just enough to soften the edges without fully cooking them through. Drain thoroughly and let them steam-dry for a minute; excess water on the surface will make them steam instead of crisp in the skillet.","Heat oil until it's shimmering before adding the potatoes, then spread them into a single, even layer and leave them alone. Resisting the urge to stir for a full 8 to 10 minutes is what builds a deep, crackly golden crust on the bottom layer.","Add the onion and diced corned beef directly into the skillet with the potatoes, folding everything together, then press it all down firmly into an even layer with your spatula — packing it down helps more surface area make contact with the hot pan.","Let it cook undisturbed again for several minutes to crisp, then use your spatula to flip sections over in large scoops rather than stirring constantly, which would just crumble everything into small crispy bits without any texture contrast. Repeat until most of the hash has some golden, crispy edges.","Taste before adding salt — cured corned beef carries plenty of sodium on its own. Fry the eggs separately in a bit of butter, keeping the yolks runny if you like them for a sauce that mixes into the hash once you cut in. Plate the hash hot, top with an egg, and finish with chives."]},
  { id:316,name:"Huevos Divorciados",protein:"breakfast",time:20,servings:4,cal:420,desc:"Fried eggs on crispy tortillas, one side topped with red salsa and the other with green, divorced right down the middle.",premium:true,ingredients:["8 corn tortillas","Oil for frying","8 eggs","1 cup red salsa (salsa roja)","1 cup green salsa (salsa verde)","1 can (15 oz) refried black beans, warmed","0.5 cup crumbled queso fresco","Cilantro","Avocado slices"],recipe:["Warm both salsas in separate small saucepans over low heat.","Heat a thin layer of oil in a skillet. Fry tortillas one at a time, 30-60 sec per side, until crisp and lightly golden. Drain on paper towels.","In the same skillet, fry eggs to your liking — crispy edges, runny yolks are traditional.","Spread warmed refried beans on each plate, top with two crispy tortillas per person.","Top one tortilla with a fried egg and red salsa, the other with a fried egg and green salsa. Finish with queso fresco, cilantro, and avocado."],tip:"Keep the two salsas separate right up until plating — the visual 'divorce' down the middle is the whole point of the dish.",recipe_detailed:["Warm the red and green salsas separately in their own small saucepans over low heat — they should be warm and slightly thickened, not boiling, which can make them taste harsh and lose their fresh flavor.","Heat a thin layer of oil in a skillet until it shimmers, then fry the tortillas one or two at a time for 30 to 60 seconds per side until they're crisp and just turning golden at the edges. Drain them on paper towels immediately so they stay crisp rather than greasy.","Fry the eggs in the same skillet, adding a touch more oil if needed. The traditional style here is crispy, lacy edges with a fully runny yolk, so use fairly hot oil and don't move the eggs once they're in the pan.","Spread a layer of warmed refried beans on each plate as the base — this both adds flavor and helps anchor the tortillas so they don't slide around. Lay two crispy tortillas per plate on top of the beans, slightly overlapping in the center.","Top one tortilla with a fried egg smothered in red salsa, and the other with a fried egg smothered in green salsa, keeping a clear line between the two colors down the middle of the plate. Finish with crumbled queso fresco, fresh cilantro, and avocado slices, and serve immediately while the tortillas are still crisp."]},
  { id:317,name:"Sausage Gravy Biscuit Bake",protein:"breakfast",time:40,servings:6,cal:560,desc:"Flaky biscuits baked right into a peppery sausage gravy — a casserole take on biscuits and gravy.",premium:true,ingredients:["1 lb breakfast sausage","0.33 cup flour","3 cups whole milk","1 tsp black pepper, or more to taste","0.5 tsp salt","1 can (16 oz) refrigerated biscuits","1 cup shredded cheddar","Chives"],recipe:["Preheat oven to 375F. Brown sausage in a large oven-safe skillet, breaking it into small crumbles, about 7 min.","Sprinkle flour over the sausage, stir, and cook 1-2 min. Gradually whisk in milk, stirring constantly until no lumps remain.","Simmer, stirring often, 5-7 min until thickened to a gravy consistency. Season generously with black pepper and salt.","Cut biscuits into quarters and nestle them into the gravy across the top of the skillet. Sprinkle with cheddar.","Bake 20-25 min until biscuits are golden and cooked through and gravy is bubbling at the edges. Top with chives before serving."],tip:"Season the gravy more aggressively with black pepper than feels natural — it mellows out once it bakes into the biscuits.",recipe_detailed:["Brown the sausage in an oven-safe skillet over medium heat, breaking it into small, even crumbles as it cooks, about 7 minutes until no pink remains. Don't drain the fat — it's the base of the gravy's flavor.","Sprinkle the flour directly over the cooked sausage and stir it in, letting it cook for a minute or two to lose its raw taste and coat the meat evenly — this is essentially building a roux right in the pan with the sausage still in it.","Pour in the milk gradually, whisking constantly as you add it so the flour doesn't clump. Once it's all incorporated, let it come to a gentle simmer, stirring frequently, until it thickens into a proper gravy consistency, about 5 to 7 minutes — it should coat the back of a spoon.","Season boldly with black pepper — classic sausage gravy is meant to have real peppery bite — and salt to taste, keeping in mind the biscuits and cheese to come are relatively mild.","Cut the biscuits into quarters and press them into the gravy across the surface of the skillet, spacing them so the gravy peeks through between pieces. Scatter cheddar over everything, then bake at 375°F for 20 to 25 minutes until the biscuits are cooked through and golden on top and the gravy is bubbling visibly at the edges. Let it sit a few minutes before serving so the gravy sets slightly."]},
  { id:318,name:"Korean Braised Short Ribs (Galbi Jjim)",protein:"beef",time:105,servings:6,cal:610,desc:"Fall-apart tender short ribs braised in a sweet-savory soy sauce with carrots and daikon.",premium:true,ingredients:["4 lbs bone-in short ribs","1 Asian pear, grated","1 onion, grated","6 garlic cloves, minced","1 tbsp ginger, grated","0.75 cup soy sauce","0.33 cup brown sugar","2 tbsp sesame oil","2 cups water or beef broth","3 carrots, cut into chunks","1 daikon radish, cut into chunks","4 dried shiitake mushrooms (optional)","Sesame seeds and scallions"],recipe:["Soak short ribs in cold water 30 min to draw out blood, then drain and pat dry.","Blanch ribs in boiling water 5 min to remove impurities, then rinse under cold water.","Whisk grated pear, onion, garlic, ginger, soy sauce, brown sugar, and sesame oil for the braising liquid.","Add ribs and braising liquid to a large pot with water or broth. Bring to a boil, skim foam, then cover and simmer 1 hour.","Add carrots, daikon, and mushrooms. Simmer uncovered 30-40 min more until meat is fork-tender and sauce has thickened. Top with sesame seeds and scallions."],tip:"The initial blanch looks like an extra step you can skip — don't. It's what gives you a clean, clear sauce instead of a cloudy, gamey one.",recipe_detailed:["Soaking the ribs in cold water draws out residual blood that would otherwise cloud and darken your braising liquid. Change the water once partway through the 30 minutes if it gets very red.","Blanching is a two-minute investment for a much cleaner final dish: drop the ribs into a pot of boiling water for about 5 minutes, then dump them into a colander and rinse thoroughly under cold water, rubbing off any grey scum clinging to the surface.","Grate the Asian pear and onion on a box grater rather than chopping them — pureed this way, they melt into the sauce and add natural sweetness and tenderizing enzymes that a diced pear or onion wouldn't provide as effectively. Whisk them together with the garlic, ginger, soy sauce, brown sugar, and sesame oil.","Combine the blanched ribs with the braising liquid and enough water or broth to mostly submerge them. Bring to a boil first, skimming off any foam that rises to the top, then reduce to a bare simmer, cover, and let it go undisturbed for a full hour — this slow, gentle heat is what breaks down the tough connective tissue in short ribs.","Add the vegetables only after that first hour, once the meat already has a head start on tenderness, and simmer uncovered from here so the sauce can reduce and thicken as the vegetables cook. You'll know it's ready when a fork slides into the meat with almost no resistance and the sauce clings thickly to everything — usually another 30 to 40 minutes."]},
  { id:319,name:"Philly Cheesesteak Skillet",protein:"beef",time:25,servings:4,cal:530,desc:"All the flavor of a Philly cheesesteak in a quick skillet with melty provolone, no hoagie roll required.",premium:true,ingredients:["1.5 lb ribeye or sirloin, thinly sliced","2 tbsp oil","1 onion, sliced","1 green bell pepper, sliced","8 oz mushrooms, sliced","3 garlic cloves, minced","Salt and pepper","6 slices provolone cheese","4 hoagie rolls or over rice/potatoes","Yellow mustard (optional)"],recipe:["Freeze the beef 15 min to firm up, then slice it very thin against the grain.","Heat oil in a large skillet over high heat. Sear beef in batches 1-2 min until just browned. Remove.","In the same skillet, cook onion, bell pepper, and mushrooms 6-8 min until softened and browned at the edges. Add garlic, cook 1 min.","Return beef to the skillet, season with salt and pepper, and toss to combine.","Lay provolone slices over the top, cover, and let melt 1-2 min. Serve in hoagie rolls or over rice or roasted potatoes."],tip:"Slicing the beef thin against the grain matters more than the cut you choose — even a cheaper steak turns tender this way.",recipe_detailed:["Firming the beef in the freezer for about 15 minutes makes it dramatically easier to slice paper-thin, which is the single biggest factor in getting that classic cheesesteak texture rather than chewy strips of steak.","Slice against the grain — look for the direction of the muscle fibers and cut perpendicular to them, which shortens the fibers and makes each bite tender no matter which cut of beef you're using.","Get your skillet very hot before searing, and work in small batches so the beef actually browns instead of steaming in its own juices from overcrowding. A minute or two per batch is plenty since the slices are thin; pull them out while there's still a little pink, since they'll finish cooking later.","In the same skillet, without wiping it out, cook the onion, pepper, and mushrooms over medium-high heat, stirring occasionally but letting them sit long enough between stirs to actually brown and caramelize at the edges — this takes a solid 6 to 8 minutes and is where a lot of the dish's flavor comes from. Add garlic only in the last minute so it doesn't burn.","Return the beef to the pan along with any juices that collected on the plate, toss everything together, and season with salt and pepper. Lay the provolone slices over the top, cover the skillet for a minute or two so the residual heat melts the cheese into a gooey blanket, then serve it all immediately, ideally piled into a hoagie roll or over rice or potatoes for a lower-carb option."]},
  { id:320,name:"Beef Birria Tacos",protein:"beef",time:180,servings:6,cal:580,desc:"Rich, chile-braised beef tacos dipped in their own consomme and griddled until crispy.",premium:true,ingredients:["3 lbs beef chuck roast, cut into large chunks","4 dried guajillo chiles, stemmed and seeded","2 dried ancho chiles, stemmed and seeded","1 chipotle in adobo","1 onion, quartered","6 garlic cloves","2 tomatoes","2 bay leaves","1 tsp cumin","1 tsp oregano","1 cinnamon stick","4 cups beef broth","Corn tortillas","Shredded Oaxaca or mozzarella cheese","Cilantro and diced onion for topping","Lime wedges"],recipe:["Toast dried chiles in a dry pot 1-2 min per side until fragrant. Soak in hot water 15 min to soften.","Blend soaked chiles, chipotle, onion, garlic, tomatoes, cumin, and oregano with a bit of broth until smooth.","Sear beef chunks in the pot until browned on all sides. Add the blended sauce, remaining broth, bay leaves, and cinnamon stick.","Cover and simmer 2.5-3 hours (or pressure cook 45 min) until beef shreds easily with a fork.","Shred beef and skim fat from the broth (this is your consomme). Dip tortillas in the fat, fill with beef and cheese, fold and griddle until crispy. Serve with consomme for dipping, topped with cilantro, onion, and lime."],tip:"Skim the orange fat that rises to the top of the consomme and dip your tortillas in it before griddling — that's the trick behind birria's deep red, crispy shell.",recipe_detailed:["Toasting the dried chiles briefly in a dry pot wakes up their oils and deepens their flavor considerably compared to using them straight from the bag — watch closely since they can go from toasted to burnt in seconds, and burnt chiles turn bitter.","Rehydrate the toasted chiles in hot (not boiling) water for about 15 minutes until they're pliable, then blend them with the chipotle, onion, garlic, tomatoes, and spices, using a little broth to help it move in the blender. Strain if you want an ultra-smooth sauce, though it's not strictly necessary.","Sear the beef chunks hard on all sides in the same pot before adding any liquid — this Maillard browning adds a depth of flavor that boiling from raw simply can't replicate. Don't crowd the pot; work in batches if needed.","Once the beef is seared, pour in the chile sauce along with the remaining broth, bay leaves, and cinnamon stick, and bring to a simmer. From here it's a long, slow braise — 2.5 to 3 hours on the stovetop, or about 45 minutes under pressure in an Instant Pot — until the meat shreds effortlessly with two forks.","Once done, pull the meat out to shred, and let the braising liquid (now your consomme) sit for a few minutes so the fat rises to the top — skim this off into a small bowl. Dip each tortilla into that reserved fat before griddling; it's what fries the tortilla from the outside in and gives birria tacos their distinctive crispy, deep-red shell. Fill with shredded beef and cheese, fold, and griddle on both sides until crisp and the cheese has melted, then serve alongside small cups of the hot consomme for dipping."]},
  { id:321,name:"Mongolian Beef",protein:"beef",time:20,servings:4,cal:490,desc:"Crispy strips of flank steak in a glossy, sweet-savory soy and brown sugar sauce with scallions.",premium:true,ingredients:["1.5 lb flank steak, thinly sliced against the grain","0.33 cup cornstarch","0.33 cup vegetable oil","1 tbsp fresh ginger, minced","4 garlic cloves, minced","0.5 cup soy sauce","0.5 cup water","0.5 cup brown sugar","6 scallions, cut into 2-inch pieces","Cooked rice to serve"],recipe:["Toss sliced steak with cornstarch until evenly coated.","Heat oil in a wok or large skillet over high heat. Fry beef in batches 2-3 min until crispy and browned. Remove to a paper-towel-lined plate.","Pour off most of the oil, leaving about 1 tbsp. Add ginger and garlic, cook 30 sec until fragrant.","Add soy sauce, water, and brown sugar. Bring to a simmer and cook 2-3 min until slightly thickened.","Return beef to the pan, toss to coat in the glossy sauce, add scallions, and cook 1 min more. Serve over rice."],tip:"The cornstarch coating is what makes this 'crispy' beef — don't skip it even though the recipe otherwise looks like a simple stir-fry.",recipe_detailed:["Slice the flank steak as thin as you can manage, cutting against the grain to keep each piece tender rather than chewy — partially freezing the steak beforehand makes this much easier to do neatly.","Toss the sliced beef with cornstarch until every piece has a light, even coating — this thin crust is what fries up crispy in the hot oil and also helps the sauce cling to the meat later rather than sliding right off.","Fry the beef in a wok or large skillet with plenty of oil over high heat, working in small batches so the pieces have room to crisp rather than steam. Two to three minutes per batch should give you deeply golden, crispy edges; drain on paper towels as you go.","Pour off most of the frying oil but leave a thin film in the pan, then quickly bloom the ginger and garlic for about 30 seconds over the residual heat — any longer and they'll scorch and turn bitter, given how hot the pan already is.","Add the soy sauce, water, and brown sugar, and let the mixture bubble and reduce for 2 to 3 minutes until it's noticeably thickened and glossy — it should coat a spoon rather than run off it. Toss the crispy beef back into this sauce along with the scallions, stirring quickly just to coat everything evenly before serving over rice while the beef is still at its crispiest."]},
  { id:322,name:"Peppercorn Crusted Steak with Red Wine Sauce",protein:"beef",time:30,servings:4,cal:560,desc:"A steakhouse classic: crusty peppercorn-seared steak finished with a rich red wine pan sauce.",premium:true,ingredients:["4 New York strip or ribeye steaks","3 tbsp black peppercorns, coarsely crushed","Salt","2 tbsp oil","3 tbsp butter, divided","1 shallot, minced","0.75 cup dry red wine","0.75 cup beef broth","1 tsp Dijon mustard","Fresh thyme"],recipe:["Let steaks come to room temperature 30 min. Season generously with salt, then press crushed peppercorns firmly into both sides.","Heat oil in a heavy skillet over high heat until nearly smoking. Sear steaks 3-4 min per side for medium-rare, adding 1 tbsp butter in the last minute and basting.","Remove steaks to rest, tented with foil, for 5-8 min.","In the same skillet, lower heat to medium, add shallot, cook 1 min. Pour in wine, scraping up browned bits, and simmer 3-4 min until reduced by half.","Add broth and mustard, simmer 3-4 min more until slightly thickened. Off heat, swirl in remaining butter and thyme. Spoon sauce over rested steaks to serve."],tip:"Always build the pan sauce in the same skillet you seared the steak in — those browned bits stuck to the bottom are pure concentrated flavor.",recipe_detailed:["Pulling the steaks out to sit at room temperature for 30 minutes helps them cook more evenly all the way through instead of being cold in the center when the outside is done. Season with salt generously, then press the crushed peppercorns into the surface with the flat of your hand so they really adhere rather than falling off in the pan.","Get the skillet properly hot — cast iron holds heat best for this — until the oil is just shy of smoking. Lay the steaks in and don't move them for a full 3 to 4 minutes to build a real crust; add a tablespoon of butter near the end and tilt the pan to spoon the foaming butter over the steaks as they finish, which bastes them with extra flavor.","Pull the steaks at your target doneness (135°F for medium-rare on an instant-read thermometer, keeping in mind they'll climb another few degrees while resting) and let them rest, loosely tented with foil, for at least 5 minutes — this redistributes the juices so they stay in the meat instead of running out onto the cutting board.","Don't wash the skillet — those browned bits stuck to the bottom are the foundation of the sauce. Lower the heat, soften the shallot briefly, then deglaze with the red wine, scraping vigorously with a wooden spoon to lift up every bit of fond. Let it reduce by about half, which concentrates the flavor and cooks off the raw alcohol taste.","Add the broth and mustard and simmer until the sauce has thickened slightly and coats the back of a spoon. Take the pan off the heat before swirling in the last of the butter — adding cold butter off-heat (a technique called mounting) gives the sauce a glossy, silky finish that reheating over direct heat would break. Spoon it generously over the rested steaks along with fresh thyme."]},
  { id:323,name:"Vietnamese Beef Pho",protein:"beef",time:90,servings:6,cal:450,desc:"A fragrant, spiced beef broth ladled over rice noodles with thin-sliced beef and fresh herbs.",premium:true,ingredients:["3 lbs beef bones (oxtail or knuckle)","1 lb beef chuck, whole","1 onion, halved","3-inch piece ginger, halved","3 star anise","1 cinnamon stick","3 whole cloves","1 tbsp coriander seeds","0.25 cup fish sauce","2 tbsp rock sugar or brown sugar","1 lb rice noodles (banh pho)","0.5 lb sirloin, very thinly sliced","Bean sprouts, Thai basil, cilantro, lime, jalapeno, and hoisin/sriracha to serve"],recipe:["Char the onion and ginger halves directly over a flame or under the broiler until blackened in spots. Rinse off the char, keeping the softened flesh.","Blanch beef bones and chuck in boiling water 5 min, then rinse well. This keeps the broth clear.","Toast star anise, cinnamon, cloves, and coriander seeds in a dry pot 1-2 min until fragrant. Add bones, chuck, charred onion and ginger, and enough water to cover generously.","Bring to a boil, skim foam thoroughly, then reduce to a very gentle simmer, partially covered, for 1.5-2 hours. Season with fish sauce and sugar.","Remove chuck once tender, slice thin. Strain broth. Cook rice noodles per package directions. Build bowls with noodles, cooked and raw sliced beef, ladle hot broth over top to cook the raw beef, and serve with herbs and condiments."],tip:"Charring the onion and ginger before they go into the pot is a small step that gives the broth real depth — don't skip straight to raw aromatics.",recipe_detailed:["Char the onion and ginger directly over an open flame, under a broiler, or in a dry hot skillet until the outsides are properly blackened in spots — this isn't just for looks; the char adds a subtle smokiness that's essential to an authentic-tasting broth. Rinse off the blackened bits under water once cooled, keeping the now-softened flesh underneath.","Blanching the bones and chuck first — a rolling boil for about 5 minutes, then a thorough rinse under cold water — washes away the impurities and scum that would otherwise cloud your broth and give it a muddy, off flavor. This step is non-negotiable for a clear, clean-tasting pho.","Toast the whole spices in the dry, empty pot for a minute or two until they become fragrant, which wakes up their essential oils far more than adding them raw would. Add the blanched bones and meat, the charred aromatics, and enough water to cover everything generously, usually 4 to 5 quarts.","Bring it to a boil, then diligently skim off every bit of foam and grey scum that rises in the first 15 minutes — this patience is what separates a clear, restaurant-quality broth from a cloudy, muddy one. Drop to the gentlest possible simmer (just a lazy bubble here and there) and let it go, partially covered, for 1.5 to 2 hours, seasoning gradually with fish sauce and sugar as it develops.","Pull the chuck out once it's tender enough to slice easily and let it rest before cutting into thin slices. Strain the finished broth through a fine mesh sieve to remove all the spent aromatics and bone fragments, and keep it at a hard simmer for serving. To build bowls, layer noodles, a mix of the cooked sliced chuck and paper-thin raw sirloin, then ladle the scalding broth directly over the raw beef, which gently poaches it right in the bowl. Serve with the full spread of herbs and condiments so everyone can season their own bowl."]},
  { id:324,name:"Beef Yakisoba",protein:"beef",time:20,servings:4,cal:470,desc:"Quick stir-fried noodles with tender beef, cabbage, and carrots in a sweet-savory yakisoba sauce.",premium:true,ingredients:["1 lb yakisoba noodles (or ramen noodles)","1 lb sirloin or flank steak, thinly sliced","2 tbsp oil","3 cups shredded cabbage","1 carrot, julienned","1 onion, sliced","3 tbsp Worcestershire sauce","2 tbsp oyster sauce","2 tbsp ketchup","1 tbsp soy sauce","1 tsp sugar","Pickled red ginger and aonori (optional) to serve"],recipe:["Whisk Worcestershire, oyster sauce, ketchup, soy sauce, and sugar for the yakisoba sauce.","If noodles are fresh, loosen them under warm water. If dried, cook per package directions and drain.","Heat oil in a large skillet or wok over high heat. Stir-fry beef 2-3 min until browned. Remove.","Add cabbage, carrot, and onion to the same pan, stir-fry 3-4 min until just tender-crisp.","Add noodles and beef back to the pan, pour sauce over top, and toss everything together 2-3 min until noodles are coated and heated through. Serve topped with pickled ginger if using."],tip:"Have every ingredient prepped and within arm's reach before you turn on the heat — yakisoba comes together in minutes and there's no time to chop mid-stir-fry.",recipe_detailed:["Mix the sauce first, before anything else — whisk the Worcestershire, oyster sauce, ketchup, soy sauce, and sugar together in a small bowl until fully combined. Having it ready to pour means you won't be fumbling with bottles once the stir-fry is moving fast.","If you're using fresh yakisoba noodles (usually found refrigerated), loosen them by rinsing briefly under warm water so they separate easily instead of clumping in the pan. Dried noodles should be cooked just to al dente per the package, then drained well since excess water dilutes the sauce.","Get the wok or skillet very hot before adding the beef, and stir-fry it quickly, just 2 to 3 minutes, until it's browned but not overcooked — pull it out onto a plate so it doesn't keep cooking while you handle the vegetables.","Add the cabbage, carrot, and onion straight into the same hot pan and stir-fry over high heat, keeping things moving so the vegetables cook fast and stay crisp rather than turning soggy — about 3 to 4 minutes is enough for cabbage to wilt slightly while carrots still have bite.","Return the noodles and beef to the pan, pour the sauce evenly over everything, and toss vigorously with tongs or two spatulas so the sauce coats every strand of noodle. Keep tossing over the heat for a couple of minutes until everything is glossy and heated through, then serve right away while it's hot, with pickled ginger on the side if you like the contrast."]},
  { id:325,name:"Carne Asada with Chimichurri",protein:"beef",time:25,servings:4,cal:490,desc:"Citrus-marinated grilled flank steak sliced thin and topped with a bright, garlicky chimichurri.",premium:true,ingredients:["2 lbs flank or skirt steak","0.33 cup orange juice","2 tbsp lime juice","4 garlic cloves, minced","2 tbsp olive oil","1 tsp cumin","Salt and pepper","1 cup fresh parsley, finely chopped","0.25 cup fresh oregano or cilantro, finely chopped","2 garlic cloves, minced (for chimichurri)","0.5 cup olive oil (for chimichurri)","2 tbsp red wine vinegar","0.5 tsp red pepper flakes"],recipe:["Whisk orange juice, lime juice, garlic, olive oil, cumin, salt, and pepper. Marinate steak at least 1 hour, up to overnight, in the fridge.","Make chimichurri: combine parsley, oregano, garlic, olive oil, vinegar, red pepper flakes, and a pinch of salt. Let sit at room temperature while the steak cooks.","Remove steak from marinade, pat dry, and let come to room temperature 20 min.","Grill or sear in a very hot skillet 4-5 min per side for medium-rare, depending on thickness.","Rest 5-8 min, then slice thin against the grain. Serve topped generously with chimichurri."],tip:"Chimichurri actually improves after sitting 20-30 minutes at room temperature — the flavors meld and mellow, so make it before you cook the steak, not after.",recipe_detailed:["Whisk together the citrus juices, garlic, olive oil, cumin, salt, and pepper for the marinade, then submerge the steak in it in a resealable bag or shallow dish. An hour is enough to add flavor, but letting it go overnight in the fridge lets the acid work more on tenderizing the meat as well.","Make the chimichurri while the steak marinates rather than at the last minute — combine the finely chopped parsley and oregano (or cilantro) with garlic, olive oil, vinegar, and red pepper flakes, and let it rest at room temperature. Chimichurri is actually better after 20 to 30 minutes as the flavors have time to meld together into something more cohesive than a chopped-herb oil.","Pull the steak from the marinade with enough time to pat it dry and let it come closer to room temperature, about 20 minutes — a cold steak straight from the fridge cooks unevenly and struggles to develop a good sear.","Cook over very high, direct heat, whether on a grill or in a heavy skillet — flank and skirt steak are thin cuts that benefit from fast, hot cooking rather than a slow approach, which would overcook them before a crust forms. Four to five minutes per side is typical for medium-rare, but go by feel or a thermometer (130-135°F) rather than the clock alone since thickness varies.","Resting for a full 5 to 8 minutes matters even more with a thin, quick-cooked cut like this — cutting in too soon lets all the juices run out onto the board instead of staying in the meat. Always slice against the grain in thin strips; with flank and skirt steak this is critical, since the muscle fibers are long and slicing with the grain results in a noticeably tougher bite. Top generously with the room-temperature chimichurri right before serving."]},
  { id:326,name:"Cuban Mojo Pork with Black Beans and Rice",protein:"pork",time:150,servings:6,cal:560,desc:"Citrus-garlic marinated pork roast, slow-roasted until tender, served over rice and black beans.",premium:true,ingredients:["3.5 lb pork shoulder","1 cup orange juice","0.33 cup lime juice","8 garlic cloves, minced","1 tbsp cumin","1 tbsp dried oregano","0.25 cup olive oil","Salt and pepper","1 onion, sliced","2 cans black beans, drained","1 tsp cumin (for beans)","Cooked white rice","Cilantro and lime wedges"],recipe:["Whisk orange juice, lime juice, garlic, cumin, oregano, olive oil, salt, and pepper. Marinate pork shoulder at least 4 hours, ideally overnight, in the fridge.","Preheat oven to 300F. Place pork and marinade in a Dutch oven with sliced onion. Cover and roast 3-3.5 hours until fork-tender.","In the last 30 min, uncover and increase heat to 425F to crisp and brown the exterior.","Meanwhile, warm black beans with a little cumin, salt, and a splash of water until heated through.","Shred or slice the pork, spoon pan juices over top, and serve with rice, black beans, cilantro, and lime wedges."],tip:"Marinate this one overnight if you possibly can — mojo needs real time for the citrus and garlic to penetrate a cut this thick.",recipe_detailed:["Whisk the marinade thoroughly so the garlic, cumin, and oregano are evenly distributed rather than clumped, then submerge the pork shoulder fully in a large resealable bag or covered dish. Massage the marinade into the meat before refrigerating.","Give it real time — 4 hours is a minimum, but overnight is genuinely better for a cut this thick and fatty. The acid in the citrus needs time to work its way in, and rushing this step is the difference between a pork roast that tastes seasoned only on the surface and one that's flavorful all the way through.","Roast low and slow, covered, so the connective tissue in the shoulder has time to break down into gelatin without drying out the meat — 300°F for 3 to 3.5 hours is the sweet spot. Check with a fork partway through; it should offer real resistance until close to the end.","In the final 30 minutes, remove the lid and crank the oven to 425°F. This step transforms the pale, boiled-looking exterior into something browned and slightly crisp, which matters a lot for both texture and flavor — don't skip it even though the meat is already cooked through by this point.","Let the roast rest for a few minutes before shredding or slicing, and spoon plenty of the concentrated pan juices back over the meat, which have picked up all that citrus-garlic flavor during the long roast. Serve it simply over rice with warmed black beans, since the pork itself carries most of the flavor."]},
  { id:327,name:"Tonkotsu Ramen with Chashu Pork Belly",protein:"pork",time:60,servings:4,cal:650,desc:"Rich, creamy pork broth ramen topped with tender braised pork belly, soft egg, and scallions.",premium:true,ingredients:["8 cups pork bone broth or good quality store-bought tonkotsu base","2 tbsp miso paste","1 tbsp soy sauce","1 lb pork belly, rolled and tied","0.5 cup soy sauce (for chashu braise)","0.25 cup mirin","0.25 cup sake","2 tbsp sugar","2 garlic cloves","4 soft-boiled eggs, halved","4 portions fresh ramen noodles","Scallions, nori, and bamboo shoots to serve"],recipe:["Braise pork belly: combine soy sauce, mirin, sake, sugar, garlic, and enough water to mostly cover in a pot. Add pork belly, bring to a simmer, cover, and cook 1.5-2 hours until very tender.","Cool pork belly slightly in the braising liquid, then slice into thick rounds.","Warm the broth, whisking in miso paste and soy sauce until dissolved. Taste and adjust seasoning.","Cook ramen noodles per package directions, just shy of al dente. Drain well.","Divide noodles among bowls, ladle hot broth over top, and arrange chashu pork, soft-boiled egg, scallions, nori, and bamboo shoots on top."],tip:"Cool the pork belly in its braising liquid before slicing — it firms up and holds together much better than slicing it hot.",recipe_detailed:["Roll the pork belly into a tight log and tie it with kitchen twine at intervals — this keeps its shape during the long braise so you get neat, round slices rather than something that falls apart.","Combine the braising liquid ingredients in a pot just big enough to hold the pork snugly, add enough water to mostly submerge it, and bring to a simmer before covering. Let it go low and slow for 1.5 to 2 hours; you're looking for the fat to have rendered soft and the meat to yield easily to a fork.","Once done, let the pork belly cool in its braising liquid for at least 20 to 30 minutes before attempting to slice it — hot, freshly braised pork belly is fragile and tends to shred rather than slice cleanly, while a slightly cooled roll holds together and gives you neat rounds.","While the pork cools, doctor your broth: warm it gently and whisk in the miso paste until fully dissolved with no lumps, along with a bit of soy sauce for depth. Miso loses some of its aroma if boiled hard, so keep the heat moderate. Taste and adjust — tonkotsu ramen broth should taste rich and full-bodied, almost creamy.","Cook the noodles separately in a large pot of boiling water, pulling them slightly before fully al dente since they'll continue softening in the hot broth. Assemble quickly once everything is ready: noodles first, broth ladled over, then the sliced chashu, a jammy soft-boiled egg, scallions, and any other toppings arranged on top so they don't sink and get lost in the bowl."]},
  { id:328,name:"Bibimbap with Spicy Pork",protein:"pork",time:35,servings:4,cal:590,desc:"A colorful Korean rice bowl with gochujang-spiced pork, sauteed vegetables, and a fried egg.",premium:true,ingredients:["1.5 lb ground pork","3 tbsp gochujang","1 tbsp soy sauce","1 tbsp sugar","1 tbsp sesame oil","3 garlic cloves, minced","2 cups spinach","1 carrot, julienned","1 cup bean sprouts","1 zucchini, julienned","4 eggs","Cooked short-grain rice","Sesame seeds"],recipe:["Whisk gochujang, soy sauce, sugar, half the sesame oil, and garlic. Toss with ground pork and let sit 10 min.","Blanch spinach 30 sec, squeeze dry, and season with a pinch of salt and sesame oil. Set aside.","Saute carrot, then bean sprouts, then zucchini separately in a little oil, each 2-3 min, seasoning lightly with salt. Keep separate.","Cook the marinated pork in a hot skillet 6-8 min, breaking it up, until browned and cooked through.","Fry eggs sunny-side up. Divide rice among bowls, arrange pork and vegetables in sections on top, add a fried egg to each, and finish with sesame seeds. Stir together before eating."],tip:"Keep each vegetable and the pork in its own little pile arranged around the bowl — the visual arrangement is half of what makes bibimbap bibimbap.",recipe_detailed:["Whisk the gochujang, soy sauce, sugar, half the sesame oil, and garlic into a smooth marinade, then work it thoroughly into the ground pork with your hands or a spoon. Let it sit for at least 10 minutes so the flavors start to penetrate the meat rather than just coating the outside.","Blanching the spinach very briefly — just 30 seconds in boiling water — wilts it without turning it mushy or bitter. Shock it in cold water if you can, then squeeze out as much liquid as possible before seasoning; wet spinach will water down the whole bowl.","Cook each vegetable separately rather than all together in one pan — this is what traditional bibimbap does, and it matters because each vegetable has a different ideal cooking time and you want each to retain its own distinct texture and flavor rather than everything blending into a single mushy stir-fry. A couple of minutes per vegetable with a light hand on the oil and salt is plenty.","Cook the marinated pork in a hot, dry-ish skillet, breaking it into small crumbles as it browns — the gochujang marinade will caramelize slightly at the edges, which adds good flavor, so don't stir too constantly or you'll prevent that browning.","Fry the eggs last, keeping the yolks runny since they'll be broken and stirred through the rice at the table, acting as a rich, silky sauce. Arrange the rice as the base in each bowl, then place the pork and each vegetable in its own distinct section around the edges rather than mixing them, top with the fried egg in the center, and finish with sesame seeds — the dish is meant to be vigorously stirred together right before eating, mixing all those separate flavors and textures into one bite."]},
  { id:329,name:"Pork Katsu Sando",protein:"pork",time:30,servings:4,cal:620,desc:"Crispy panko-breaded pork cutlets with tangy katsu sauce, pressed between soft milk bread.",premium:true,ingredients:["4 boneless pork loin chops, pounded to 1/2 inch","Salt and pepper","0.5 cup flour","2 eggs, beaten","1.5 cups panko breadcrumbs","Oil for frying","8 slices soft white sandwich bread, crusts removed","0.33 cup ketchup","2 tbsp Worcestershire sauce","1 tbsp soy sauce","1 tbsp sugar","Shredded cabbage and Kewpie mayo"],recipe:["Whisk ketchup, Worcestershire, soy sauce, and sugar for the katsu sauce. Set aside.","Season pork chops with salt and pepper. Dredge in flour, dip in egg, then coat thoroughly in panko, pressing to adhere.","Heat about 1/2 inch of oil in a skillet to 340-350F. Fry cutlets 3-4 min per side until deep golden and cooked through. Drain on a rack.","Slice cutlets into strips. Spread mayo on bread, add a layer of shredded cabbage, then pork drizzled generously with katsu sauce.","Press sandwiches firmly, trim edges if desired, and cut in half to serve."],tip:"Use a wire rack instead of paper towels to drain the fried cutlets — paper towels trap steam underneath and soften the crust you just worked for.",recipe_detailed:["Pound the pork chops to an even half-inch thickness using a meat mallet or the bottom of a heavy pan — even thickness means even cooking, so no part is raw while another is overdone.","Set up a proper breading station: flour in one dish, beaten egg in another, panko in a third. Season the pork first, then dredge in flour (shaking off excess), dip fully in egg, and press into the panko firmly on both sides so the crumbs really adhere rather than flaking off in the oil.","Heat the oil to a genuine 340 to 350°F — use a thermometer if you have one, since oil that's too cool makes the breading absorb grease and turn soggy, while oil that's too hot burns the crust before the pork cooks through. Fry until deep golden brown, about 3 to 4 minutes per side.","Drain the fried cutlets on a wire rack set over a sheet pan rather than directly on paper towels — a rack lets air circulate underneath and keeps the bottom crust just as crisp as the top, while paper towels trap steam against the bottom and soften it.","Build the sandwiches while the cutlets are still warm: spread Kewpie mayo on the bread, add a bed of shredded cabbage for crunch and to balance the richness of the fried pork, then the sliced cutlet drizzled generously with the tangy-sweet katsu sauce. Press the sandwich together firmly with your hands before cutting so the layers hold together in a clean cross-section."]},
  { id:330,name:"Carnitas Tacos with Pineapple Salsa",protein:"pork",time:180,servings:6,cal:520,desc:"Slow-braised, crispy-edged pork carnitas with a sweet-tart pineapple salsa.",premium:true,ingredients:["4 lb pork shoulder, cut into large chunks","1 orange, juiced (keep the halves)","4 garlic cloves","1 onion, quartered","2 tsp cumin","1 tsp oregano","2 bay leaves","Salt and pepper","2 cups pineapple, diced","0.25 cup red onion, minced","1 jalapeno, minced","2 tbsp cilantro, chopped","1 lime, juiced","Corn tortillas"],recipe:["Season pork generously with salt, pepper, cumin, and oregano. Place in a Dutch oven with orange juice and squeezed halves, garlic, onion, and bay leaves.","Add water just to cover. Bring to a simmer, cover, and cook at a low simmer (or 300F oven) 2.5-3 hours until pork shreds easily.","Remove pork, discard bay leaves and orange halves, and shred the meat. Reduce remaining liquid on the stove until thick and syrupy.","Toss shredded pork with the reduced liquid. Spread on a sheet pan and broil 5-8 min until edges are crispy and caramelized.","Combine pineapple, red onion, jalapeno, cilantro, and lime juice for the salsa. Serve carnitas in warm tortillas topped with pineapple salsa."],tip:"Don't skip broiling the shredded pork at the end — that quick blast of high heat is what turns tender braised pork into proper crispy-edged carnitas.",recipe_detailed:["Season the pork shoulder chunks generously all over before it goes into the pot — this is your only real chance to season the meat itself, since the braising liquid will only lightly flavor the surface. Nestle in the squeezed orange halves along with the juice; the peel adds a subtle bitterness and aroma that's traditional in good carnitas.","Add just enough water to bring the liquid level up to cover the meat, then bring it to a bare simmer rather than a boil — a hard boil toughens meat before it has a chance to become tender through slow breakdown of connective tissue. Whether on the stovetop or in a 300°F oven, give it the full 2.5 to 3 hours; it's done when the pork falls apart at the gentlest prodding of a fork.","Once the pork is tender, pull it out to shred (discarding the spent orange halves and bay leaves), and don't throw out the braising liquid — put it back on the stove over medium-high heat and let it reduce down until it's noticeably thickened and syrupy. This concentrated liquid is what will give the shredded pork real flavor rather than being just plain and dry.","Toss the shredded pork thoroughly with that reduced liquid so every strand picks up flavor, then spread it in an even layer on a sheet pan. Broil it, watching closely, until the edges and any exposed fat go crispy and caramelized in spots — this step is what separates real carnitas from simple pulled pork, so don't rush past it.","Make the pineapple salsa while the pork braises so the flavors have time to meld — the sweetness of the pineapple and the acidity of the lime are meant to cut through the richness of the pork. Serve everything family-style with warm tortillas so people can build their own tacos."]},
  { id:331,name:"Honey Garlic Pork Chops",protein:"pork",time:25,servings:4,cal:440,desc:"Pan-seared pork chops glazed in a sticky honey-garlic sauce, ready in under half an hour.",premium:true,ingredients:["4 bone-in pork chops, about 1 inch thick","Salt and pepper","2 tbsp oil","4 tbsp butter, divided","6 garlic cloves, minced","0.33 cup honey","0.25 cup soy sauce","1 tbsp apple cider vinegar","0.25 tsp red pepper flakes","Chopped parsley"],recipe:["Pat pork chops dry and season generously with salt and pepper.","Heat oil and 1 tbsp butter in a skillet over medium-high. Sear chops 4-5 min per side until deeply browned and internal temp reaches 140-145F. Remove to rest.","Lower heat to medium, add remaining butter and garlic, cook 30 sec until fragrant.","Whisk in honey, soy sauce, vinegar, and red pepper flakes. Simmer 2-3 min until slightly thickened.","Return chops to the pan, spoon sauce over top, and let rest in the sauce 2-3 min before serving, finished with parsley."],tip:"Pull the chops at 140-145F, not the old-school 160F — they'll climb a few more degrees while resting and stay juicy instead of drying out.",recipe_detailed:["Pat the pork chops completely dry with paper towels before seasoning — any surface moisture gets in the way of a good sear and steams the meat instead of browning it. Season both sides generously with salt and pepper right before cooking.","Get the oil and butter hot in the skillet until the butter's foam subsides, which signals it's hot enough without burning. Lay the chops in and leave them alone for a full 4 to 5 minutes per side, resisting the urge to check or move them, which is what builds a deep, flavorful crust.","Use an instant-read thermometer if you have one and pull the chops at 140 to 145°F in the thickest part — pork is safe well before the old 160°F guideline, and pulling it earlier along with a proper rest is the difference between a juicy chop and a dry, chalky one. Tent with foil while you make the sauce.","Lower the heat before adding the remaining butter and garlic to the same pan — garlic burns almost instantly in a hot, empty skillet, so give the pan a moment to cool slightly first, then cook the garlic just 30 seconds until fragrant, not browned.","Whisk in the honey, soy sauce, vinegar, and red pepper flakes directly into the pan, scraping up the browned bits from searing the chops, which dissolve into the sauce and add real depth. Let it bubble and reduce slightly until glossy and clinging to a spoon, then return the rested chops to the pan just long enough to soak up some sauce and rewarm, 2 to 3 minutes, before serving with extra sauce spooned over top."]},
  { id:332,name:"Stuffed Pork Chops with Apple and Sage",protein:"pork",time:45,servings:4,cal:510,desc:"Thick-cut pork chops stuffed with a savory apple, sage, and breadcrumb filling.",premium:true,ingredients:["4 thick-cut bone-in pork chops (1.5 inch)","2 tbsp butter","1 apple, diced small","1 small onion, diced","2 garlic cloves, minced","1 cup breadcrumbs","0.25 cup chicken broth","1 tbsp fresh sage, chopped (or 1 tsp dried)","Salt and pepper","2 tbsp oil"],recipe:["Preheat oven to 375F. Melt butter in a skillet, cook apple and onion 5-6 min until softened. Add garlic, cook 1 min.","Off heat, stir in breadcrumbs, broth, sage, salt, and pepper until the mixture holds together when pressed.","Cut a deep pocket into the side of each pork chop, being careful not to cut all the way through. Season chops with salt and pepper inside and out.","Stuff each chop generously with the apple mixture, securing with toothpicks if needed.","Heat oil in an oven-safe skillet over medium-high. Sear chops 2-3 min per side until browned, then transfer skillet to the oven and bake 15-18 min until pork reaches 140-145F. Rest 5 min before serving."],tip:"Cut the pocket from the side, not the top, and leave a solid border around three edges — that's what keeps the filling from spilling out as it cooks.",recipe_detailed:["Cook the apple and onion in butter over medium heat until they're truly softened and just starting to turn golden at the edges, about 5 to 6 minutes — undercooked apple stays too firm and starchy inside the finished chop. Add the garlic only at the very end so it doesn't burn during that longer cooking time.","Off the heat, stir in the breadcrumbs, a splash of broth, sage, salt, and pepper. You're looking for a mixture that holds together when you press it in your hand but isn't wet or pasty — add broth a tablespoon at a time until you hit that texture.","Using a sharp paring knife, cut into the thickest side of each chop and work the blade side to side to create a deep pocket, being careful to leave the top, bottom, and far edge intact so the filling has somewhere to stay rather than falling straight through.","Pack the stuffing in firmly but don't overfill — a chop that's stuffed too full will burst open during searing. Secure the opening with a toothpick or two if the pocket doesn't want to stay closed on its own.","Sear the stuffed chops in a hot, oven-safe skillet just long enough to brown both sides well, then move the whole skillet into the oven to finish — this two-step method gives you a well-browned crust without overcooking the outside while the thick chop and its filling come up to temperature. Pull at 140 to 145°F and let the chops rest for a full 5 minutes before removing toothpicks and serving, which lets the stuffing set and the juices settle."]},
  { id:333,name:"Korean Fried Chicken Wings (Yangnyeom)",protein:"chicken",time:45,servings:4,cal:590,desc:"Extra-crispy double-fried wings tossed in a sweet, sticky, garlicky gochujang glaze.",premium:true,ingredients:["3 lb chicken wings, split","0.5 cup cornstarch","0.25 cup flour","Salt and pepper","Oil for frying","3 tbsp gochujang","2 tbsp ketchup","2 tbsp honey","2 tbsp brown sugar","1 tbsp soy sauce","1 tbsp rice vinegar","3 garlic cloves, minced","1 tsp grated ginger","Sesame seeds and scallions"],recipe:["Pat wings very dry. Toss with cornstarch, flour, salt, and pepper until evenly coated.","Heat oil to 325F. Fry wings in batches 8-9 min until pale golden and cooked through. Remove and let rest 5 min.","Increase oil to 375F. Fry wings a second time, 3-4 min, until deeply golden and shatteringly crisp. Drain on a rack.","Whisk gochujang, ketchup, honey, brown sugar, soy sauce, vinegar, garlic, and ginger in a saucepan. Simmer 2-3 min until glossy and slightly thickened.","Toss hot wings in the sauce until fully coated. Serve immediately topped with sesame seeds and scallions."],tip:"The double fry is non-negotiable for real Korean fried chicken — the first fry cooks the meat through, the second is what makes the skin shatter.",recipe_detailed:["Pat the wings as dry as possible with paper towels — any surface moisture turns to steam in the fryer and prevents a crisp crust from forming. Toss them thoroughly with the cornstarch, flour, salt, and pepper so every piece has an even, light coating rather than thick clumps.","Fry the wings at a moderate 325°F for the first round, about 8 to 9 minutes, until they're cooked through and pale golden but not yet deeply browned. This lower, longer fry is about cooking the meat gently; don't rush it by cranking the heat.","Let the fried wings rest on a wire rack for a full 5 minutes — this brief rest lets residual moisture escape and the crust set slightly, which sets you up for a much crispier second fry than going straight back into the oil.","Raise the oil temperature to a hotter 375°F and fry the wings again, this time for a shorter 3 to 4 minutes. This second, hotter fry is the real secret to Korean fried chicken's signature ultra-crisp, almost glassy shell — it renders out any remaining fat and moisture from the first fry.","Make the sauce while the wings rest between fries so it's ready the moment they come out crisp: simmer the gochujang, ketchup, honey, brown sugar, soy sauce, vinegar, garlic, and ginger together until glossy and slightly thickened. Toss the hot, freshly fried wings in the sauce immediately and serve right away — waiting too long lets the sauce soften that hard-won crispy crust."]},
  { id:334,name:"Chicken Katsu Curry",protein:"chicken",time:35,servings:4,cal:610,desc:"Crispy panko chicken cutlets sliced over rice and smothered in a mild, sweet Japanese curry sauce.",premium:true,ingredients:["4 boneless chicken thighs or breasts, pounded thin","Salt and pepper","0.5 cup flour","2 eggs, beaten","1.5 cups panko breadcrumbs","Oil for frying","2 tbsp butter","1 onion, diced","2 carrots, diced","2 potatoes, diced","2 tbsp Japanese curry roux (or 2 tbsp flour + 2 tbsp curry powder)","2.5 cups chicken broth","1 tbsp honey","1 tbsp soy sauce","Cooked rice"],recipe:["Melt butter in a pot, cook onion, carrots, and potatoes 5-6 min until onion softens.","Add broth, bring to a simmer, and cook 12-15 min until vegetables are tender. Stir in curry roux (or flour-curry powder paste) until dissolved and sauce thickens. Add honey and soy sauce, simmer 3-4 min more.","Meanwhile, season chicken, dredge in flour, dip in egg, then coat in panko, pressing to adhere.","Heat oil in a skillet and fry chicken 3-4 min per side until golden and cooked through. Drain on a rack, then slice into strips.","Serve rice topped with sliced katsu chicken, ladling the curry sauce generously over top."],tip:"Japanese curry should taste mild and slightly sweet, closer to a savory gravy than an Indian or Thai curry — go easy on the honey and taste as you build it.",recipe_detailed:["Cook the onion, carrots, and potatoes together in butter first, giving them a genuine 5 to 6 minutes so the onion turns translucent and starts building a flavor base rather than staying raw and sharp once the liquid goes in.","Add the broth and simmer until the vegetables are fully tender when pierced with a fork, 12 to 15 minutes. This isn't a quick step — the vegetables need real time to soften and start releasing their own sweetness into the broth.","Stir in the curry roux gradually, breaking it up so it dissolves smoothly rather than clumping (if making your own paste from flour and curry powder, whisk it with a little of the hot broth first to loosen it before adding to the pot). Let it simmer a few more minutes until it thickens into a gravy-like consistency, then add honey and soy sauce to round out the sweet-savory balance that's characteristic of Japanese curry.","While the curry simmers, bread the chicken using the standard flour-egg-panko sequence, pressing the panko on firmly so it forms a thick, even crust. Fry in enough oil to come partway up the cutlets, 3 to 4 minutes per side, until deeply golden and cooked through — an instant-read thermometer reading 165°F is the safest check.","Rest the fried cutlets briefly on a wire rack before slicing into strips — this keeps the crust crisp rather than trapping steam underneath. Serve over a mound of rice with the sliced katsu fanned out on top, and ladle the curry generously alongside or over the chicken, keeping some of the crispy top exposed if you like a textural contrast against the sauce."]},
  { id:335,name:"Chicken Tikka Masala",protein:"chicken",time:40,servings:4,cal:520,desc:"Char-grilled marinated chicken simmered in a creamy, spiced tomato sauce.",premium:true,ingredients:["2 lb boneless chicken thighs, cubed","1 cup plain yogurt","2 tbsp lemon juice","1 tbsp garam masala","1 tbsp ground cumin","1 tsp turmeric","4 garlic cloves, minced","1 tbsp ginger, grated","2 tbsp oil","1 onion, diced","1 can (28 oz) crushed tomatoes","1 cup heavy cream","1 tbsp butter","Cilantro and rice or naan to serve"],recipe:["Whisk yogurt, lemon juice, half the garam masala, half the cumin, turmeric, half the garlic, and half the ginger. Marinate chicken at least 30 min, up to overnight.","Thread or lay marinated chicken on a hot grill pan or under the broiler. Cook 4-5 min per side until charred in spots and cooked through. Set aside.","Heat oil in a pot, cook onion 5-6 min until softened. Add remaining garlic and ginger, cook 1 min. Add remaining garam masala and cumin, toast 30 sec.","Add crushed tomatoes, simmer 12-15 min until slightly reduced and deepened in color.","Stir in cream and butter, simmer 3-4 min. Add the charred chicken and any juices, simmer 5 min more to warm through. Serve over rice or with naan, topped with cilantro."],tip:"Charring the chicken under a broiler or on a hot grill pan before it goes into the sauce is what gives tikka masala its name and its smoky depth — don't just poach it directly in the sauce.",recipe_detailed:["Whisk together the yogurt marinade with half of each spice and aromatic, saving the rest to build the sauce later — this two-stage seasoning is what gives the dish layered flavor rather than a single flat note. Let the chicken marinate for at least 30 minutes, though several hours or overnight develops far more flavor and tenderizes the meat further thanks to the yogurt's acidity.","Cook the marinated chicken under high, direct heat — a hot grill pan or your oven's broiler both work well — specifically so it develops real char and blackened edges in spots. This charring is the 'tikka' part of tikka masala and is what separates the dish from a plain chicken curry; don't skip straight to simmering raw chicken in the sauce.","Build the sauce base by cooking the onion low and slow enough to really soften and turn translucent, about 5 to 6 minutes, before adding the remaining garlic and ginger for just a minute. Toast the remaining garam masala and cumin briefly in the hot oil and onions — this blooms their flavor far more than adding them directly to a wet sauce would.","Add the crushed tomatoes and let the sauce simmer uncovered for a full 12 to 15 minutes, which cooks out the raw, acidic edge of canned tomatoes and lets the sauce reduce and deepen into a richer color and flavor.","Stir in the cream and butter only near the end, and keep the heat moderate from here — cream can split if boiled too hard. Add the charred chicken along with any juices that collected while it rested, and let it simmer gently just long enough to heat through and let the chicken absorb some of the sauce, about 5 minutes, before serving."]},
  { id:336,name:"Nashville Hot Chicken Sandwiches",protein:"chicken",time:40,servings:4,cal:640,desc:"Fiery, crispy fried chicken thighs brushed with a cayenne-spiked hot oil, piled on soft buns with pickles.",premium:true,ingredients:["4 boneless chicken thighs","1 cup buttermilk","1 tbsp hot sauce","1.5 cups flour","1 tbsp paprika","1 tsp garlic powder","Salt and pepper","Oil for frying","0.5 cup frying oil (for hot sauce)","3 tbsp cayenne pepper","1 tbsp brown sugar","1 tsp paprika (for hot sauce)","4 brioche buns","Dill pickle chips","Mayo"],recipe:["Whisk buttermilk and hot sauce. Marinate chicken thighs at least 1 hour, up to overnight.","Mix flour, paprika, garlic powder, salt, and pepper. Dredge marinated chicken thoroughly in the flour mixture, pressing to adhere.","Heat frying oil to 325-350F. Fry chicken 6-7 min per side until deep golden and cooked through (165F internal).","Carefully whisk hot frying oil (0.5 cup, ladled from the fryer or heated separately) with cayenne, brown sugar, and paprika until smooth.","Brush the fiery oil generously over both sides of the fried chicken. Build sandwiches with mayo, pickles, and the hot chicken on brioche buns."],tip:"Adjust the cayenne to your real heat tolerance — Nashville hot is meant to be seriously spicy, but there's no shame in starting with less than tradition calls for.",recipe_detailed:["Whisk the buttermilk and hot sauce together and submerge the chicken thighs fully, marinating for at least an hour but ideally overnight — buttermilk's acidity tenderizes the meat while the hot sauce adds a layer of flavor underneath the crust.","Mix the dredge thoroughly so the paprika, garlic powder, salt, and pepper are evenly distributed through the flour. Pull the chicken straight from the buttermilk without shaking off too much liquid, then press it firmly into the flour mixture — that clinging buttermilk is what helps the flour build a thick, craggy crust rather than a thin dusting.","Fry at a steady 325 to 350°F, checking with a thermometer if you have one — thighs take longer than you'd expect, 6 to 7 minutes per side, since you need the crust deeply golden by the time the inside reaches a safe 165°F. Adjust the heat down if the outside is browning too fast relative to how cooked the inside is.","The hot oil topping is what makes this dish 'Nashville hot' rather than just fried chicken — carefully ladle out a portion of the hot frying oil (or heat fresh oil separately to a similar temperature) and whisk in the cayenne, brown sugar, and paprika immediately off the heat. Work quickly and carefully, since you're handling hot oil and volatile ground cayenne, which can make you cough if you breathe it in directly.","Brush this fiery, glossy oil generously over both sides of the chicken immediately after frying while it's still hot, so it soaks in rather than sitting on the surface. Build the sandwiches right away with cool mayo and crunchy dill pickles, whose fat and acidity respectively help balance the heat."]},
  { id:337,name:"General Tso's Chicken",protein:"chicken",time:30,servings:4,cal:560,desc:"Crispy fried chicken bites tossed in a sweet, tangy, slightly spicy takeout-style sauce.",premium:true,ingredients:["1.5 lb boneless chicken thighs, cubed","1 egg","0.5 cup cornstarch, plus 2 tbsp","Salt and pepper","Oil for frying","3 garlic cloves, minced","1 tbsp ginger, grated","3 dried red chiles (optional)","0.33 cup soy sauce","0.25 cup rice vinegar","0.25 cup sugar","2 tbsp ketchup","0.5 cup chicken broth","Steamed broccoli and rice to serve"],recipe:["Whisk egg with chicken, then toss in 0.5 cup cornstarch, salt, and pepper until evenly coated.","Heat oil to 350F. Fry chicken in batches 4-5 min until golden and crispy. Drain on a rack.","Whisk remaining 2 tbsp cornstarch into the broth. Whisk soy sauce, vinegar, sugar, and ketchup separately.","Heat a splash of oil in a clean pan, add garlic, ginger, and dried chiles if using, cook 30 sec. Add the soy-vinegar-sugar mixture, bring to a simmer.","Stir in the cornstarch slurry and simmer 1-2 min until thickened and glossy. Toss fried chicken in the sauce and serve immediately over rice with steamed broccoli."],tip:"Toss the chicken in the sauce right before serving, not ahead of time — even a great crispy coating goes soft fast once sauce hits it.",recipe_detailed:["Whisk the egg into the cubed chicken first so it has something to help the cornstarch adhere, then toss thoroughly in the cornstarch, salt, and pepper until every piece has a clumpy, even coating — this rougher texture (versus a smooth flour dredge) is what gives General Tso's its characteristic craggy, extra-crispy exterior.","Fry in oil heated to a true 350°F, working in batches so the pieces have room and the oil temperature doesn't crash. Four to five minutes should render them deeply golden and cooked through; drain on a wire rack rather than paper towels to keep the crust crisp.","Make the sauce components separately and have them ready before you start assembling: whisk the small amount of cornstarch into the broth to make a slurry (this thickens the sauce at the end), and whisk the soy sauce, vinegar, sugar, and ketchup together separately as your flavor base.","In a clean pan, quickly bloom the garlic, ginger, and dried chiles (if you want real heat) in a little oil over medium heat for just 30 seconds — any longer risks burning the garlic, which turns bitter. Immediately add the soy-vinegar-sugar mixture to stop the aromatics from cooking further, and bring it to a simmer.","Stir in the cornstarch slurry and simmer for a minute or two, watching it transform from thin and watery to glossy and clinging to the spoon. Toss the freshly fried chicken into this hot sauce right at the very end, just before serving — sauce sitting on fried chicken for even a few minutes will soften that crispy coating you worked to build."]},
  { id:338,name:"Chicken Piccata with Capers",protein:"chicken",time:25,servings:4,cal:430,desc:"Pan-seared chicken cutlets in a bright, buttery lemon-caper sauce.",premium:true,ingredients:["4 boneless chicken breasts, halved horizontally and pounded thin","Salt and pepper","0.5 cup flour","3 tbsp olive oil","4 tbsp butter, divided","3 garlic cloves, minced","0.5 cup dry white wine","0.5 cup chicken broth","0.33 cup lemon juice","3 tbsp capers, drained","Chopped parsley"],recipe:["Season chicken with salt and pepper, dredge lightly in flour, shaking off excess.","Heat olive oil and 1 tbsp butter in a large skillet over medium-high. Sear chicken 3-4 min per side until golden and cooked through. Remove.","Add garlic to the pan, cook 30 sec. Pour in wine, scraping up browned bits, and simmer 2-3 min to reduce slightly.","Add broth, lemon juice, and capers, simmer 3-4 min until slightly reduced.","Off heat, swirl in remaining butter until glossy. Return chicken to the pan to coat and warm through. Finish with parsley."],tip:"Pound the chicken to an even thickness before dredging — piccata cooks fast, and uneven cutlets mean some pieces dry out while others stay underdone.",recipe_detailed:["Slice each chicken breast horizontally into two thinner cutlets, then pound them between plastic wrap to an even quarter-inch thickness. Even thickness across all the pieces is what lets everything cook at the same fast pace without some pieces overcooking while others lag behind.","Season the cutlets, then dredge lightly in flour and shake off the excess thoroughly — you want just a thin, even coating that helps the chicken brown nicely and gives the sauce something to cling to, not a thick, gummy layer.","Sear in a mix of olive oil and butter (the oil raises the butter's smoke point so it doesn't burn) over medium-high heat, working in batches if your pan isn't large enough to avoid crowding. Three to four minutes per side should give you a golden crust and fully cooked chicken since the cutlets are thin.","Once the chicken is out, cook the garlic briefly in the same pan for just 30 seconds, then deglaze immediately with the wine, scraping up every browned bit stuck to the pan — this is where a lot of the sauce's flavor comes from. Let it reduce for a couple of minutes to cook off the raw alcohol taste.","Add the broth, lemon juice, and capers, and simmer until the sauce reduces slightly and the flavors concentrate. Take the pan off the heat entirely before swirling in the remaining cold butter — this off-heat mounting technique gives the sauce a glossy, emulsified finish rather than a greasy, separated one. Return the chicken just to reheat gently in the finished sauce, then serve immediately with parsley scattered over top."]},
  { id:339,name:"Jerk Chicken with Rice and Peas",protein:"chicken",time:60,servings:4,cal:560,desc:"Smoky-sweet, spicy Jamaican jerk chicken thighs grilled until charred, served with coconut rice and peas.",premium:true,ingredients:["8 bone-in chicken thighs","4 scallions, chopped","2 scotch bonnet or habanero peppers (adjust to taste)","1 onion, chopped","4 garlic cloves","1 tbsp fresh thyme","1 tbsp allspice","1 tsp cinnamon","1 tsp nutmeg","0.25 cup soy sauce","0.25 cup lime juice","2 tbsp brown sugar","2 tbsp oil","1.5 cups rice","1 can (14 oz) coconut milk","1 can red kidney beans, drained","1 clove garlic, whole","Salt"],recipe:["Blend scallions, peppers, onion, garlic, thyme, allspice, cinnamon, nutmeg, soy sauce, lime juice, brown sugar, and oil into a smooth marinade.","Marinate chicken thighs at least 2 hours, ideally overnight, in the fridge.","Grill chicken over medium heat, turning occasionally, 30-35 min until charred in spots and cooked through (165F internal), moving to indirect heat if flare-ups occur.","Meanwhile, combine rice, coconut milk, kidney beans, whole garlic clove, a splash of water, and salt in a pot. Bring to a boil, then cover and simmer 18-20 min until rice is tender.","Fluff rice and peas, discard garlic clove, and serve alongside the grilled jerk chicken."],tip:"Handle the scotch bonnet peppers with gloves and avoid touching your face — their heat lingers on skin far more than a jalapeno's.",recipe_detailed:["Blend all the marinade ingredients together until you have a mostly smooth, thick paste — the scotch bonnet peppers bring real heat along with a distinct fruity flavor that's central to authentic jerk seasoning, so don't substitute a milder pepper if you can help it, just adjust the quantity to your tolerance.","Coat the chicken thighs thoroughly in the marinade, working it under the skin if the thighs are skin-on for even deeper flavor. Marinate for at least 2 hours, but overnight gives the allspice, thyme, and heat real time to penetrate the meat rather than sitting only on the surface.","Grill over medium, not high, heat — jerk chicken benefits from a slower cook that renders the fat and chars the surface without burning it before the inside is done. Turn the pieces occasionally and expect 30 to 35 minutes total; move any pieces that flare up to a cooler part of the grill rather than pulling them too early.","Start the rice and peas partway through the chicken's grilling time so everything finishes together. Simmering the rice directly in coconut milk rather than water is what gives it that characteristic richness; a whole garlic clove tossed in infuses flavor without needing to mince anything.","Chicken is done at 165°F internal, with good char and color on the skin. Fluff the finished rice with a fork, discard the garlic clove, and serve everything together — the cool, creamy rice is meant to offset the heat and smokiness of the jerk chicken."]}
];

// ── Utilities ─────────────────────────────────────────────────────────────────
function seededShuffle(arr, seed) {
  const a=[...arr]; let s=seed;
  for(let i=a.length-1;i>0;i--){
    s=(s*1664525+1013904223)&0xffffffff;
    const j=Math.abs(s)%(i+1);
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
// ── Week & day window system ───────────────────────────────────────────────
// ALL windows are anchored to the SUNDAY of the current calendar week.
// weekOffset=0  → this Sun-Sat calendar week
// weekOffset=-1 → last Sun-Sat calendar week
// weekOffset=+1 → next Sun-Sat calendar week
//
// Within "this week" (weekOffset=0), days are ROTATED to show today first,
// then the remaining days in calendar order (wrapping Sun at end if needed).
// This way midnight rollover automatically moves Sunday from position 0 to
// the end of the week, and last week correctly shows Sun-Sat of the prior week.

// ── Date-keyed week system ────────────────────────────────────────────────────
// Each plan row stores data keyed by ISO date strings (YYYY-MM-DD).
// Seed = days since fixed epoch (2024-01-07), advances by 1 each day.
// This guarantees: today is always slot 0, yesterday always last slot of LW,
// tomorrow always first slot of NW , true sequential rollover at midnight.

const EPOCH_DATE = '2024-01-07'; // a fixed Monday anchor
const EPOCH_MS = new Date(EPOCH_DATE + 'T00:00:00').getTime();

// Returns ISO date string for today + N days
function dateStr(offsetDays=0){
  const d=new Date(); d.setHours(0,0,0,0);
  d.setDate(d.getDate()+offsetDays);
  return d.toISOString().slice(0,10);
}

// Returns days since epoch for a given ISO date string (or today)
function daysSinceEpoch(iso){
  const d=iso?new Date(iso+'T00:00:00'):new Date();
  d.setHours(0,0,0,0);
  return Math.round((d.getTime()-EPOCH_MS)/864e5);
}

// Seed for a week = day-index of the first day of that week's window
// weekOffset=0 → this week (starts today), weekOffset=-1 → last week, etc.
function getWeekSeed(weekOffset=0){
  const d=new Date(); d.setHours(0,0,0,0);
  d.setDate(d.getDate()+(weekOffset*7));
  const dow=d.getDay();
  d.setDate(d.getDate()+(dow===0?-6:1-dow));
  return Math.round((d.getTime()-new Date('2024-01-07T00:00:00').getTime())/864e5);
}
function getWeekSeedForDate(isoStr){
  const d=new Date(isoStr+'T00:00:00'); 
  const dow=d.getDay();
  d.setDate(d.getDate()+(dow===0?-6:1-dow));
  return Math.round((d.getTime()-new Date('2024-01-07T00:00:00').getTime())/864e5);
}

// Returns array of 7 ISO date strings for the week window
// weekOffset=0 → [today, today+1, ..., today+6]
// weekOffset=-1 → [today-7, today-6, ..., today-1]  ← yesterday is last ✓
// weekOffset=+1 → [today+7, today+8, ..., today+13]
function getWindowDates(weekOffset=0){
  const start=weekOffset*7;
  return Array.from({length:7},(_,i)=>dateStr(start+i));
}

// Display label for a date string: "Wed" / "Wednesday"
function dayLabel(iso,long=false){
  const d=new Date(iso+'T00:00:00');
  return d.toLocaleDateString('en-US',{weekday:long?'long':'short'});
}

// Day-of-week name for a date string (for cookAssignment lookup)
function dayOfWeek(iso){
  const d=new Date(iso+'T00:00:00');
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
}

// Window start date for labels
function getWindowStart(weekOffset=0){
  const d=new Date(); d.setHours(0,0,0,0);
  d.setDate(d.getDate()+(weekOffset*7));
  return d;
}

// Legacy Sunday-anchored seed , for migration only
function getLegacyWeekSeed(weekOffset=0){
  const now=new Date(); now.setHours(0,0,0,0);
  const day=now.getDay();
  const sun=new Date(now); sun.setDate(now.getDate()-day+(weekOffset*7));
  const st=new Date(sun.getFullYear(),0,1);
  return sun.getFullYear()*100+Math.floor((sun-st)/(7*864e5));
}

// Legacy: Sunday names for a legacy seed's week (for migration day-name→date mapping)
function getLegacyDatesForSeed(legacySeed){
  // Find the Sunday for this seed , reverse of getLegacyWeekSeed
  // Try offsets to find which week matches
  for(let off=-52;off<=52;off++){
    if(getLegacyWeekSeed(off)===legacySeed){
      const now=new Date(); now.setHours(0,0,0,0);
      const day=now.getDay();
      const sun=new Date(now); sun.setDate(now.getDate()-day+(off*7));
      const names=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const result={};
      names.forEach((name,i)=>{
        const d=new Date(sun); d.setDate(sun.getDate()+i);
        result[name]=d.toISOString().slice(0,10);
      });
      return result;
    }
  }
  return null;
}

function weekLabel(weekOffset=0){
  const fmt=(iso)=>new Date(iso+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const dates=getWindowDates(weekOffset);
  return `${fmt(dates[0])}-${fmt(dates[6])}`;
}

// getOrderedDays: returns 7 ISO date strings for the given week window.
// Alias of getWindowDates , kept for call-site compatibility.
function getOrderedDays(weekOffset=0){ return getWindowDates(weekOffset); }

// Returns Set of indices (0-6) that are in the past for the given week window
function getPastDayIndices(weekOffset){
  if(weekOffset<0) return new Set([0,1,2,3,4,5,6]);
  if(weekOffset>0) return new Set();
  // This week: today is index 0, so no slots are past (today is always first)
  return new Set();
}
// dates: array of 7 ISO date strings for the week window
function generateDefaultPlan(rotated,dates){
  const plan={},used=new Set();let idx=0;
  const pick=(avoidP)=>{
    let m=rotated[idx%rotated.length],t=0;
    while((used.has(m.id)||m.protein===avoidP)&&t<MEALS.length){idx++;t++;m=rotated[idx%rotated.length];}
    used.add(m.id);idx++;return m;
  };
  for(let d=0;d<dates.length;d++){
    const day=dates[d],prev=d>0?plan[dates[d-1]]:null;
    plan[day]={meal:pick(prev?.meal?.protein||null),isLeftover:false,isDoubled:false,isEatOut:false};
  }
  return plan;
}
function recalcFrom(plan,rotated,startIdx,dates){
  const next={...plan};
  for(let d=startIdx;d<dates.length;d++){
    const day=dates[d],prev=next[dates[d-1]],cur=next[day];
    if(!cur?.isLeftover)continue;
    if(prev&&!prev.isEatOut&&canBeLeftover(prev.meal)){
      next[day]={...cur,meal:prev.meal,isDoubled:needsDoubling(prev.meal)};
    } else {
      const used=new Set(dates.slice(0,d).map(dd=>next[dd]?.meal?.id));
      const fb=rotated.find(m=>!used.has(m.id)&&m.protein!==prev?.meal?.protein)||rotated[d%rotated.length];
      next[day]={meal:fb,isLeftover:false,isDoubled:false,isEatOut:false};
    }
  }
  return next;
}
// ── URL encode/decode plan ────────────────────────────────────────────────────
function encodePlan(plan){
  const data={};
  Object.keys(plan).forEach(day=>{
    const d=plan[day];
    data[day]={
      eo:d.isEatOut?1:0,
      il:d.isLeftover?1:0,
      mid:d.meal?.isCustom?null:d.meal?.id,
      cn:d.meal?.isCustom?d.meal.name:null,
    };
  });
  return btoa(JSON.stringify(data)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}

function decodePlan(encoded,dates){
  try{
    const padded=encoded.replace(/-/g,"+").replace(/_/g,"/");
    const pad=padded.length%4===0?padded:padded+"===".slice(padded.length%4);
    const data=JSON.parse(atob(pad));
    const plan={};
    (dates||Object.keys(data)).forEach(day=>{
      const d=data[day];
      if(!d){plan[day]={meal:MEALS[0],isLeftover:false,isEatOut:false};return;}
      let meal;
      if(d.cn){
        meal={id:`custom-${day}`,name:d.cn,isCustom:true,protein:"custom",time:null,servings:2,desc:"Custom meal"};
      } else {
        meal=MEALS.find(m=>m.id===d.mid)||MEALS[0];
      }
      plan[day]={meal,isLeftover:!!d.il,isEatOut:!!d.eo};
    });
    return plan;
  }catch{return null;}
}

function getEncodedFromURL(){
  try{
    const h=window.location.hash;
    if(h.startsWith("#plan="))return h.slice(6);
    const p=new URLSearchParams(window.location.search).get("plan");
    return p||null;
  }catch{return null;}
}

function buildShareURL(plan){
  const encoded=encodePlan(plan);
  const base=window.location.href.split("#")[0].split("?")[0];
  // Embed both the plan and the auth hash so the link auto-unlocks
  return `${base}?auth=${CORRECT_HASH}#plan=${encoded}`;
}

// groups: each entry is {days:[day,...], crossWeek:"prev"|"next"|null}
// crossWeek "prev" = Saturday of prev week + Sunday of this week
// crossWeek "next" = Saturday of this week + Sunday of next week
function groupDays(plan, prevWeekPlan, nextWeekPlan, orderedDays=[], weekOffset=0){
  const groups=[];
  const daysList=orderedDays;
  const firstDay=daysList[0];
  const lastDay=daysList[daysList.length-1];

  // Last day of the previous window (relative to weekOffset)
  const prevWindowDays=getWindowDates(weekOffset-1);
  const prevWindowLastDay=prevWindowDays[prevWindowDays.length-1];

  // First day of this window is a leftover if:
  // 1. it has isLeftover:true
  // 2. its meal matches the last day of the previous window
  const firstIsLeftoverFromPrev=
    prevWeekPlan&&
    plan[firstDay]?.isLeftover&&
    !prevWeekPlan[prevWindowLastDay]?.isEatOut&&
    plan[firstDay]?.meal?.id===prevWeekPlan[prevWindowLastDay]?.meal?.id;

  let i=0;
  while(i<daysList.length){
    const day=daysList[i];
    if(i===0&&firstIsLeftoverFromPrev){
      groups.push({days:[day],crossWeek:"prev",tail:true});i++;continue;
    }
    const next=daysList[i+1];
    if(next&&plan[next]?.isLeftover&&!plan[day]?.isEatOut){
      groups.push({days:[day,next],crossWeek:null});i+=2;
    } else {
      groups.push({days:[day],crossWeek:null});i++;
    }
  }

  // First day of next window (relative to weekOffset)
  const nextWindowDays=getWindowDates(weekOffset+1);
  const nextWindowFirstDay=nextWindowDays[0];
  if(nextWeekPlan&&
    nextWeekPlan[nextWindowFirstDay]?.isLeftover&&
    !plan[lastDay]?.isEatOut&&
    nextWeekPlan[nextWindowFirstDay]?.meal?.id===plan[lastDay]?.meal?.id){
    const lastGroup=groups.find(g=>g.days.includes(lastDay));
    if(lastGroup) lastGroup.crossWeek="next";
  }

  return groups;
}



// ── Grocery category classifier ───────────────────────────────────────────
const ING_CATEGORIES=[
  {id:"produce",   label:"🥦 Produce",   keywords:["onion","garlic","tomato","pepper","lettuce","spinach","kale","cucumber","lemon","lime","avocado","broccoli","mushroom","zucchini","carrot","celery","ginger","cabbage","scallion","green onion","jalapeño","cilantro","parsley","basil","thyme","rosemary","dill","mint","herb","potato","sweet potato","corn","arugula","eggplant","cauliflower","beet","shallot","leek","chive","radish","asparagus","apple","pear","berries","berry","mango","banana","pineapple","fruit","vegetable","veg ","fresh","romaine","salad"]},
  {id:"protein",   label:"🥩 Proteins",  keywords:["beef","chicken","pork","salmon","shrimp","turkey","lamb","tuna","cod","steak","ground","sausage","bacon","ham","egg","eggs","tofu","tempeh","fish","seafood","crab","lobster","prawn","duck","venison","bison"]},
  {id:"dairy",     label:"🧀 Dairy & Eggs",keywords:["milk","cream","butter","cheese","mozzarella","parmesan","cheddar","gruyère","feta","ricotta","yogurt","sour cream","ghee","half and half","heavy cream","whipping cream","cottage","brie","goat cheese","paneer","labneh","cotija","monterey","swiss","grated","shredded cheese"]},
  {id:"grain",     label:"🌾 Grains & Bread",keywords:["rice","pasta","noodle","bread","tortilla","pita","flour","panko","breadcrumb","oat","quinoa","farro","barley","couscous","cracker","wrap","baguette","roll","bun","phyllo","lasagna","ramen","vermicelli","udon","soba","cornmeal"]},
  {id:"canned",    label:"🥫 Canned & Dry", keywords:["can","canned","jar","tomato sauce","marinara","broth","stock","bean","beans","lentil","chickpea","coconut milk","hominy","tomatillo","enchilada sauce","salsa","paste","puree","dried","sun-dried","anchovy"]},
  {id:"spice",     label:"🧂 Spices & Condiments",keywords:["salt","pepper","cumin","paprika","turmeric","oregano","cayenne","cinnamon","nutmeg","coriander","chili powder","allspice","soy sauce","fish sauce","sesame oil","olive oil","vinegar","mustard","honey","sugar","miso","gochujang","hoisin","oyster sauce","sriracha","hot sauce","Worcestershire","tahini","za'atar","five spice","star anise","bay leaf","curry","seasoning","spice","oil ","sauce "]},
  {id:"frozen",    label:"❄️ Frozen",     keywords:["frozen","ice"]},
  {id:"other",     label:"Other",      keywords:[]},
];

function classifyIngredient(ing){
  const lower=ing.toLowerCase();
  for(const cat of ING_CATEGORIES){
    if(cat.id==="other")continue;
    if(cat.keywords.some(kw=>lower.includes(kw))) return cat.id;
  }
  return "other";
}
const PANTRY_RE=/\b(salt|pepper|black pepper|white pepper|olive oil|vegetable oil|cooking oil|garlic powder|onion powder|cumin|paprika|smoked paprika|italian seasoning|red pepper flakes|crushed red pepper|cayenne|oregano|thyme|rosemary|bay leaves?|cinnamon|chili powder|nutmeg|allspice|turmeric|coriander|dried \w+|seasoning|spice|to taste|to serve|to top|optional|as needed)\b/i;

function filterPantry(ingredients){
  return ingredients.filter(ing=>{
    // Keep if it's a real grocery item (has quantity words or doesn't match pantry pattern)
    const lower=ing.toLowerCase();
    // Always keep if it has a cup/tbsp/lb/oz/can measurement - it's a real quantity item
    if(/\d|\bcup\b|\btbsp\b|\btsp\b|\blb\b|\boz\b|\bcan\b|\bbunch\b|\bhead\b|\bclove|\bstalk|\bstrip/i.test(ing)) return true;
    return !PANTRY_RE.test(lower);
  });
}

// ── Protein config (matches onboarding) ──────────────────────────────────────
const PROTEIN_OPTIONS=[
  {id:"beef",label:"Beef",Icon:Beef},
  {id:"chicken",label:"Chicken",Icon:Bird},
  {id:"seafood",label:"Seafood",Icon:Fish},
  {id:"pork",label:"Pork",Icon:Ham},
  {id:"plant-based",label:"Meatless",Icon:Leaf},
  {id:"breakfast",label:"Breakfast",Icon:Egg},
];

// ── CustomRecipePreview , inline recipe editor on custom meal cards ────────────
// ── CustomMealNameEditor , tap-to-edit meal name on custom cards ────────────
function CustomMealNameEditor({meal,day,onUpdateMeal,C}){
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState(meal.name||"");
  const inputRef=useRef(null);

  useEffect(()=>setDraft(meal.name||""),[meal.name]);

  const handleConfirm=()=>{
    if(draft.trim()&&draft.trim()!==meal.name){
      onUpdateMeal(day,{...meal,name:draft.trim()});
    }
    setEditing(false);
  };

  if(editing){
    return(
      <div onClick={e=>e.stopPropagation()}>
        <input
          ref={inputRef}
          autoFocus
          value={draft}
          maxLength={50}
          onChange={e=>setDraft(e.target.value)}
          onBlur={handleConfirm}
          onKeyDown={e=>{if(e.key==="Enter")handleConfirm();if(e.key==="Escape"){setDraft(meal.name||"");setEditing(false);}}}
          style={{fontSize:16,fontWeight:700,color:C.text,background:"transparent",border:"none",borderBottom:`1.5px solid ${C.accent}`,outline:"none",width:"100%",padding:"2px 0",fontFamily:"system-ui,sans-serif",touchAction:"manipulation"}}
        />
      </div>
    );
  }

  return(
    <span
      onClick={e=>{e.stopPropagation();setEditing(true);}}
      style={{fontSize:15,fontWeight:700,color:C.text,lineHeight:1.3,cursor:"text",borderBottom:"1.5px solid transparent",display:"inline"}}
      title="Tap to edit name"
    >
      {meal.name}
    </span>
  );
}

// ── CustomRecipePreview , inline recipe editor on custom meal cards ────────────
function CustomRecipePreview({meal,C}){
  const hasRecipe=!!(meal.rawText&&meal.rawText.trim());
  return(
    <div style={{marginTop:4}}>
      <div style={{fontSize:12,color:C.muted}}>
        {hasRecipe?"View your custom recipe +":"Add your custom recipe +"}
      </div>
    </div>
  );
}

function CustomRecipeExpandedCard({meal,day,onUpdateMeal,C,householdId,currentUserId,onRefreshCustomMeals,onEditingChange}){
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState(meal.rawText||"");
  const [saving,setSaving]=useState(false);
  const [deleting,setDeleting]=useState(false);
  const [confirmDelete,setConfirmDelete]=useState(false);
  const cardRef=useRef(null);
  const textareaRef=useRef(null);

  useEffect(()=>setDraft(meal.rawText||""),[meal.rawText]);
  useEffect(()=>{ if(onEditingChange)onEditingChange(editing); },[editing]);

  const buildRecipeText=()=>{
    const ing=ingredients.map(i=>`- ${i}`).join('\n');
    const steps=(meal.recipe_detailed||meal.recipe||[]).map((s,i)=>`${i+1}. ${s}`).join('\n');
    return `Ingredients:\n${ing}\n\nSteps:\n${steps}`;
  };
  const handleStartEdit=()=>{
    setEditDraft(hasOverride?meal.rawText:buildRecipeText());
    setEditing(true);
  };
  const handleSaveEdit=async()=>{
    if(!editDraft.trim()){setEditing(false);return;}
    setEditSaving(true);
    const overrideName=`__override__${meal.id}`;
    let savedId=meal._overrideId||null;
    if(savedId){
      await supabase.from('custom_meals').update({raw_text:editDraft.trim()}).eq('id',savedId);
    } else {
      const{data}=await supabase.from('custom_meals').insert({
        household_id:householdId,user_id:currentUserId,
        name:overrideName,raw_text:editDraft.trim()
      }).select('id').single();
      if(data?.id)savedId=data.id;
    }
    if(onUpdateMeal&&day){
      onUpdateMeal(day,{...meal,rawText:editDraft.trim(),_editOverride:true,_overrideId:savedId});
    }
    setEditSaving(false);setEditing(false);
  };
  const handleRestoreEdit=async()=>{
    if(meal._overrideId){
      await supabase.from('custom_meals').delete().eq('id',meal._overrideId);
    }
    if(onUpdateMeal&&day){
      const{rawText:_a,_editOverride:_b,_overrideId:_c,...restored}=meal;
      onUpdateMeal(day,restored);
    }
  };
  const handlePrint=()=>{
    const w=window.open("","_blank");
    w.document.write(`<html><head><title>${meal.name}</title><style>body{font-family:system-ui,sans-serif;max-width:600px;margin:40px auto;padding:0 20px;line-height:1.6}h1{font-size:22px}pre{white-space:pre-wrap;font-family:inherit;font-size:14px}.no-print{margin-top:20px}</style></head><body><h1>${meal.name}</h1><pre>${meal.rawText||""}</pre><div class="no-print"><button onclick="window.print()" style="padding:10px 20px;background:#FF6B35;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer">Print</button></div></body></html>`);
    w.document.close();setTimeout(()=>w.print(),400);
  };

  const scrollCardToTop=()=>{
    setTimeout(()=>{
      if(cardRef.current){
        const top=cardRef.current.getBoundingClientRect().top+window.scrollY-42;
        window.scrollTo({top,behavior:"smooth"});
      }
    },100);
  };

  const handleEdit=()=>{
    setEditing(true);
    scrollCardToTop();
    setTimeout(()=>textareaRef.current?.focus(),200);
  };

  const validateRecipe=(text)=>{
    if(!text||!text.trim())return{ok:false,err:"Recipe can\'t be empty."};
    const clean=text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,""); // strip control chars
    if(clean.length>2000)return{ok:false,err:`Too long (${clean.length}/2000 chars).`};
    // Check for null bytes or other Postgres-unsafe chars
    if(/\u0000/.test(clean))return{ok:false,err:"Contains invalid characters."};
    return{ok:true,clean};
  };
  const handleSave=async()=>{
    if(!draft.trim()){setEditing(false);return;} // empty draft: just close edit mode
    const v=validateRecipe(draft);
    if(!v.ok){alert(v.err);setEditing(false);return;}
    setSaving(true);
    const cleanDraft=v.clean;
    // Upsert to custom_meals table
    const row={household_id:householdId,user_id:currentUserId,name:meal.name,raw_text:cleanDraft.trim()};
    // If this custom meal already has a UUID id (from DB), update it; else insert
    const isDbId=meal.id&&!String(meal.id).startsWith("custom-");
    let savedId=meal.id;
    if(isDbId){
      await supabase.from("custom_meals").update({raw_text:cleanDraft.trim()}).eq("id",meal.id);
    } else {
      const{data}=await supabase.from("custom_meals").insert(row).select("id").single();
      if(data?.id)savedId=data.id;
    }
    // Update local plan state with the new rawText (and DB id if new)
    onUpdateMeal(day,{...meal,rawText:cleanDraft.trim(),id:savedId});
    if(onRefreshCustomMeals)await onRefreshCustomMeals();
    setSaving(false);
    setEditing(false);
  };

  const handleDelete=async()=>{
    setDeleting(true);
    const isDbId=meal.id&&!String(meal.id).startsWith("custom-");
    if(isDbId){
      await supabase.from("custom_meals").delete().eq("id",meal.id);
    }
    // Replace card with a random standard meal
    const randomMeal=MEALS[Math.floor(Math.random()*MEALS.length)];
    onUpdateMeal(day,randomMeal);
    if(onRefreshCustomMeals)await onRefreshCustomMeals();
    setDeleting(false);
    setConfirmDelete(false);
    setEditing(false);
  };

  const hasRecipe=!!(meal.rawText&&meal.rawText.trim());

  if(editing){
    return(
      <div ref={cardRef} data-custom-day={day} style={{marginTop:10,position:"relative"}} onClick={e=>e.stopPropagation()}>
        <textarea ref={textareaRef} value={draft}
          onChange={e=>setDraft(e.target.value.slice(0,2000))}
          onBlur={handleSave}
          placeholder="Enter your recipe. This will be saved to your household and can only be seen by you. You can select this recipe again later."
          rows={9}
          style={{width:"100%",padding:"10px 12px",borderRadius:10,border:`1px solid ${C.border}`,fontSize:16,background:C.card,color:C.text,lineHeight:1.6,resize:"none",outline:"none",boxSizing:"border-box",fontFamily:"system-ui,sans-serif"}}
        />
      </div>
    );
  }

  return(
    <div ref={cardRef} style={{marginTop:10}} onClick={e=>e.stopPropagation()}>
      {hasRecipe?(
        <div style={{background:C.subtle,borderRadius:10,border:`1px solid ${C.border}`,padding:"10px 12px"}}>
          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
            <button onClick={handlePrint}
              style={{display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:600,color:C.muted,background:"transparent",border:"none",cursor:"pointer",padding:0}}>
              <Upload size={14} strokeWidth={1.8}/> Print
            </button>
          </div>
          {/* Recipe text + Edit/Delete */}
          <div style={{position:"relative"}}>
            <div style={{fontSize:13,color:C.textSub,lineHeight:1.7,whiteSpace:"pre-wrap",paddingBottom:32}}>
              {meal.rawText}
            </div>
            <div style={{position:"absolute",bottom:0,right:0,display:"flex",gap:6}}>
              {confirmDelete?(
                <>
                  <span style={{fontSize:11,color:"#E05050",alignSelf:"center"}}>Delete this recipe?</span>
                  <button onClick={handleDelete} disabled={deleting}
                    style={{padding:"3px 10px",borderRadius:8,border:"1px solid #E0505066",background:"#E0505011",color:"#E05050",fontSize:11,fontWeight:600,cursor:"pointer"}}>
                    {deleting?"…":"Yes"}
                  </button>
                  <button onClick={()=>setConfirmDelete(false)}
                    style={{padding:"3px 10px",borderRadius:8,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,fontSize:11,cursor:"pointer"}}>
                    No
                  </button>
                </>
              ):(
                <>
                  <button onClick={()=>setConfirmDelete(true)}
                    style={{padding:"3px 10px",borderRadius:8,border:"1px solid rgba(0,0,0,0.12)",background:"transparent",color:C.muted,fontSize:11,cursor:"pointer"}}>
                    Delete
                  </button>
                  <button onClick={handleEdit}
                    style={{padding:"3px 10px",borderRadius:8,border:"1px solid rgba(0,0,0,0.18)",background:"transparent",color:C.text,fontSize:11,fontWeight:600,cursor:"pointer"}}>
                    Edit
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ):(
        <div style={{position:"relative"}}>
          <textarea ref={textareaRef} value={draft}
            onChange={e=>{setDraft(e.target.value.slice(0,2000));if(!editing)setEditing(true);}}
            onFocus={()=>setEditing(true)}
            onBlur={handleSave}
            placeholder="Enter your recipe. This will be saved to your household and can only be seen by you. You can select this recipe again later."
            rows={6}
            style={{width:"100%",padding:"10px 12px",borderRadius:10,border:`1px solid ${C.border}`,fontSize:16,background:C.card,color:C.text,lineHeight:1.6,resize:"none",outline:"none",boxSizing:"border-box",fontFamily:"system-ui,sans-serif"}}
          />
          <div style={{position:"absolute",bottom:8,right:8,display:"none"}}>
            <button style={{display:"none"}}>
              {saving?"Saving…":"Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── HouseholdAvatarRow , scales avatars down to fit container width ────────────
function HouseholdAvatarRow({householdSize,memberNames,COOK_COLORS,C}){
  const containerRef=useRef(null);
  const rowRef=useRef(null);
  const [scale,setScale]=useState(1);

  useEffect(()=>{
    if(!containerRef.current||!rowRef.current)return;
    const obs=new ResizeObserver(()=>{
      const avail=containerRef.current?.offsetWidth||200;
      const natural=rowRef.current?.scrollWidth||avail;
      setScale(natural>avail?avail/natural:1);
    });
    obs.observe(containerRef.current);
    return()=>obs.disconnect();
  },[householdSize]);

  return(
    <div ref={containerRef} style={{flex:1,overflow:"hidden",display:"flex",alignItems:"center"}}>
      <div ref={rowRef} style={{
        display:"flex",alignItems:"center",
        transform:`scale(${scale})`,
        transformOrigin:"left center",
        flexShrink:0,
        transition:"transform 0.2s ease",
      }}>
        {Array.from({length:householdSize}).map((_,i)=>{
          const name=memberNames[i];
          const isLarge=!!name;
          const w=isLarge?44:40;
          return(
            <div key={i} style={{
              width:w,height:w,borderRadius:"50%",
              background:name?COOK_COLORS[i%COOK_COLORS.length]:C.mutedBg,
              border:`2px solid ${C.card}`,
              marginLeft:i===0?0:isLarge?-6:-8,
              display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
              gap:0,color:"#fff",flexShrink:0,position:"relative",zIndex:householdSize-i,
              paddingTop:isLarge?2:0,
            }}>
              {name?(
                <>
                  <ChefHat size={12} strokeWidth={1.8} color="#fff"/>
                  <span style={{fontSize:13,fontWeight:800,lineHeight:1}}>{name[0].toUpperCase()}</span>
                </>
              ):(
                <User size={16} strokeWidth={2} color="#fff"/>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── FaceIdSettingsRow , Face ID enrollment from Settings ─────────────────────
function FaceIdSettingsRow({C,compact=false}){
  const isAndroid=()=>/Android/i.test(navigator.userAgent);
const isIPad=()=>/iPad/i.test(navigator.userAgent)||(navigator.maxTouchPoints>1&&/Macintosh/i.test(navigator.userAgent));
const biometricLabel=()=>isAndroid()?'Biometrics':isIPad()?'Touch ID':'Face ID';
  const WEBAUTHN_URL="https://forknight.app/auth/webauthn";
  const FACEID_KEY="forknight_faceid_email";
  const [status,setStatus]=useState("idle"); // idle | loading | done | error
  const [isRegistered,setIsRegistered]=useState(()=>{
    try{
      const raw=localStorage.getItem(FACEID_KEY);
      if(!raw) return false;
      if(!raw.startsWith('{')) return !!raw;
      const {email,ts}=JSON.parse(raw);
      if(Date.now()-ts>60*24*60*60*1000){localStorage.removeItem(FACEID_KEY);return false;}
      return !!email;
    }catch{return false;}
  });
  const [platformAvailable,setPlatformAvailable]=useState(false);
  useEffect(()=>{
    if(window.PublicKeyCredential)
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then(setPlatformAvailable).catch(()=>{});
  },[]);

  const base64urlToUint8=(b64)=>{const b=b64.replace(/-/g,"+").replace(/_/g,"/");return Uint8Array.from(atob(b),c=>c.charCodeAt(0));};
  const uint8ToBase64url=(arr)=>{const bytes=arr instanceof Uint8Array?arr:new Uint8Array(arr);return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');};

  const handleEnroll=async()=>{
    setStatus("loading");
    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session){console.log("[FaceID settings] no session");setStatus("error");return;}
      // Begin
      const beginRes=await fetch(`${WEBAUTHN_URL}/register/begin`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jwt:session.access_token})});
      const beginText=await beginRes.text();
      console.log("[FaceID settings] begin:",beginRes.status);
      if(!beginRes.ok){setStatus("error");return;}
      const {options,challengeId}=JSON.parse(beginText);
      options.challenge=base64urlToUint8(options.challenge);
      options.user.id=base64urlToUint8(options.user.id);
      options.pubKeyCredParams=(options.pubKeyCredParams||[]).filter(p=>p.alg!==-8);
      // Face ID prompt
      let credential;
      try{ credential=await navigator.credentials.create({publicKey:options}); }
      catch(credErr){
        console.log("[FaceID settings] credentials.create error:",credErr.name,credErr.message);
        // User cancelled , silently go back to idle
        if(credErr.name==="NotAllowedError"){setStatus("idle");return;}
        setStatus("error");return;
      }
      // Complete
      const completeRes=await fetch(`${WEBAUTHN_URL}/register/complete`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jwt:session.access_token,challengeId,deviceName:"iPhone",credential:{id:credential.id,rawId:uint8ToBase64url(credential.rawId),type:credential.type,response:{attestationObject:uint8ToBase64url(credential.response.attestationObject),clientDataJSON:uint8ToBase64url(credential.response.clientDataJSON)}}})});
      const completeText=await completeRes.text();
      console.log("[FaceID settings] complete:",completeRes.status,completeText.slice(0,200));
      const{verified}=JSON.parse(completeText);
      if(verified){
        try{localStorage.setItem(FACEID_KEY,JSON.stringify({email:session.user.email,ts:Date.now()}));}catch{}
        setIsRegistered(true);
        setStatus("done");
      } else {setStatus("error");}
    }catch(e){
      console.log("[FaceID settings] error:",e.name,e.message);
      setStatus("error");
    }
  };

  if(!platformAvailable) return null;
  if(isRegistered||status==="done"){
    if(compact) return(
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",
        padding:"12px",borderRadius:10,border:`1px solid ${C.border}`,color:C.muted,fontSize:13,gap:6}}>
        <svg width={14} height={14} viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="18" fill={C.muted}/></svg>
        Face ID on
      </div>
    );
    return(
      <div style={{marginTop:12,display:"flex",alignItems:"center",gap:8,justifyContent:"center",padding:"10px 0"}}>
        <svg width={18} height={18} viewBox="0 0 100 100" fill="none"><path d="M22 8 L13 8 Q8 8 8 13 L8 22" stroke={C.muted} strokeWidth="7" strokeLinecap="round"/><path d="M78 8 L87 8 Q92 8 92 13 L92 22" stroke={C.muted} strokeWidth="7" strokeLinecap="round"/><path d="M8 78 L8 87 Q8 92 13 92 L22 92" stroke={C.muted} strokeWidth="7" strokeLinecap="round"/><path d="M92 78 L92 87 Q92 92 87 92 L78 92" stroke={C.muted} strokeWidth="7" strokeLinecap="round"/><line x1="34" y1="36" x2="34" y2="47" stroke={C.muted} strokeWidth="6.5" strokeLinecap="round"/><line x1="66" y1="36" x2="66" y2="47" stroke={C.muted} strokeWidth="6.5" strokeLinecap="round"/><path d="M50 44 L50 58" stroke={C.muted} strokeWidth="6" strokeLinecap="round"/><path d="M44 64 Q50 68 56 64" stroke={C.muted} strokeWidth="5.5" strokeLinecap="round" fill="none"/><path d="M34 74 Q42 83 50 83 Q58 83 66 74" stroke={C.muted} strokeWidth="6" strokeLinecap="round" fill="none"/></svg>
        <span style={{fontSize:13,color:C.muted}}>Face ID enabled</span>
      </div>
    );
  }

  if(compact) return(
    <button onClick={handleEnroll} disabled={status==="loading"}
      style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,
        padding:"12px",borderRadius:10,border:`1px solid ${C.border}`,
        background:"transparent",color:status==="error"?"#E05050":C.muted,
        fontSize:13,fontWeight:600,cursor:"pointer"}}>
      <svg width={14} height={14} viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="22" fill="none" stroke={status==="error"?"#E05050":C.muted} strokeWidth="8"/><circle cx="50" cy="50" r="8" fill={status==="error"?"#E05050":C.muted}/></svg>
      {status==="loading"?"Setting up…":status==="error"?"Try again":"Enable Face ID"}
    </button>
  );
  return(
    <div style={{marginTop:12}}>
      <button onClick={handleEnroll} disabled={status==="loading"}
        style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,width:"100%",padding:"14px",borderRadius:12,border:`1px solid ${C.border}`,background:"transparent",cursor:"pointer",fontSize:14,fontWeight:600,color:status==="error"?"#E05050":C.text}}>
        <svg width={18} height={18} viewBox="0 0 100 100" fill="none"><path d="M22 8 L13 8 Q8 8 8 13 L8 22" stroke={status==="error"?"#E05050":C.text} strokeWidth="7" strokeLinecap="round"/><path d="M78 8 L87 8 Q92 8 92 13 L92 22" stroke={status==="error"?"#E05050":C.text} strokeWidth="7" strokeLinecap="round"/><path d="M8 78 L8 87 Q8 92 13 92 L22 92" stroke={status==="error"?"#E05050":C.text} strokeWidth="7" strokeLinecap="round"/><path d="M92 78 L92 87 Q92 92 87 92 L78 92" stroke={status==="error"?"#E05050":C.text} strokeWidth="7" strokeLinecap="round"/><line x1="34" y1="36" x2="34" y2="47" stroke={status==="error"?"#E05050":C.text} strokeWidth="6.5" strokeLinecap="round"/><line x1="66" y1="36" x2="66" y2="47" stroke={status==="error"?"#E05050":C.text} strokeWidth="6.5" strokeLinecap="round"/><path d="M50 44 L50 58" stroke={status==="error"?"#E05050":C.text} strokeWidth="6" strokeLinecap="round"/><path d="M44 64 Q50 68 56 64" stroke={status==="error"?"#E05050":C.text} strokeWidth="5.5" strokeLinecap="round" fill="none"/><path d="M34 74 Q42 83 50 83 Q58 83 66 74" stroke={status==="error"?"#E05050":C.text} strokeWidth="6" strokeLinecap="round" fill="none"/></svg>
        {status==="loading"?"Setting up…":status==="error"?`Try again , ${biometricLabel()} failed`:`Enable ${biometricLabel()} sign-in`}
      </button>
    </div>
  );
}

function HouseholdSettings({onClose,members,currentUserId,householdId,inviteCode,weekPlans,onSignOut,cookAssignment,setCookDay,memberNames,COOK_COLORS,householdSize=2,setHouseholdSize,themePref="system",setTheme,onOpenShareSheet,showFeedback,setShowFeedback,feedbackType,setFeedbackType,feedbackText,setFeedbackText,feedbackSent,setFeedbackSent,feedbackSending,setFeedbackSending,showAppearanceSheet,setShowAppearanceSheet}){
  const C=useC();
  const {showPremiumUi,tier}=usePremium();
  const [animIn,setAnimIn]=useState(false);
  const [proteins,setProteins]=useState(null);
  const [editingMembers,setEditingMembers]=useState(false);
  const [removingId,setRemovingId]=useState(null);
  const [confirmLeaveId,setConfirmLeaveId]=useState(null);
  const [editingNameId,setEditingNameId]=useState(null);
  const [editNameVal,setEditNameVal]=useState("");

  const EASE="cubic-bezier(0.32,0.72,0,1)";
  const MEMBER_COLORS=["#5A8FAA","#7A5FA8","#C0785A","#4A7A6A","#A06A4A"]; // matches COOK_COLORS order: aaron, purple, alona, teal
  const MAX_MEMBERS=5;

  useEffect(()=>{
    const t=requestAnimationFrame(()=>requestAnimationFrame(()=>setAnimIn(true)));
    return ()=>cancelAnimationFrame(t);
  },[]);
  // Lock body scroll while picker is open
  useEffect(()=>{
    const prev=document.body.style.overflow;
    document.body.style.overflow="hidden";
    return ()=>{ document.body.style.overflow=prev; };
  },[]);

  // Load protein prefs using raw fetch to bypass Supabase client lock queue
  useEffect(()=>{
    let cancelled=false;
    const SUPABASE_URL="https://cekgmugupbbmehpeoqnp.supabase.co";
    const SUPABASE_ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNla2dtdWd1cGJibWVocGVvcW5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0MDY4MDAsImV4cCI6MjA5Mjk4MjgwMH0.VfBTWhvpuAviNNP2ZCF6kMj0qGyNvjGO2Z04z_u2e98";
    const load=async()=>{
      // Get auth token from stored session
      let token=SUPABASE_ANON;
      try{
        const raw=localStorage.getItem("forknight-auth");
        if(raw){const s=JSON.parse(raw);token=s?.access_token||SUPABASE_ANON;}
      }catch{}
      for(let i=0;i<3;i++){
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),3000);
        try{
          const res=await fetch(
            `${SUPABASE_URL}/rest/v1/profiles?select=preferred_proteins&id=eq.${currentUserId}&limit=1`,
            {headers:{"apikey":SUPABASE_ANON,"Authorization":`Bearer ${token}`,"Accept":"application/json"},signal:controller.signal}
          );
          clearTimeout(timer);
          if(cancelled)return;
          if(res.ok){
            const rows=await res.json();
            const prefs=new Set(rows[0]?.preferred_proteins||[]);
            setProteins(prefs);
            // Seed localStorage so relevance sort can access without re-fetch
            try{localStorage.setItem(`forknight_fav_proteins_${currentUserId||householdId||"local"}`,JSON.stringify([...prefs]));}catch{}
            return;
          }
          console.log("[proteins] attempt",i+1,"status:",res.status);
        }catch(e){
          clearTimeout(timer);
          if(cancelled)return;
          console.log("[proteins] attempt",i+1,"error:",e.message);
        }
        if(i<2)await new Promise(r=>setTimeout(r,500));
      }
      if(!cancelled){setProteins(new Set());}
    };
    load();
    return ()=>{cancelled=true;};
  },[currentUserId]);

  const handleClose=()=>{setAnimIn(false);setTimeout(onClose,280);};

  const toggleProtein=async(id)=>{
    const next=new Set(proteins);
    next.has(id)?next.delete(id):next.add(id);
    setProteins(next);
    try{localStorage.setItem(`forknight_fav_proteins_${currentUserId||householdId||"local"}`,JSON.stringify([...next]));}catch{}
    await supabase.from("profiles").upsert({id:currentUserId,preferred_proteins:[...next]});
  };

  const handleRemove=async(memberId)=>{
    setRemovingId(memberId);
    await supabase.rpc("remove_household_member",{p_member_id:memberId,p_requester_id:currentUserId});
    setRemovingId(null);
    handleClose();
  };

  const handleLeave=async()=>{
    await supabase.rpc("leave_household",{p_user_id:currentUserId});
    handleClose();
    if(onSignOut)onSignOut();
  };

  const handleSaveName=async()=>{
    if(!editNameVal.trim())return;
    const {data:{session}}=await supabase.auth.getSession();
    if(session?.user){
      await supabase.from("profiles").upsert({id:session.user.id,display_name:editNameVal.trim(),chef_names:[editNameVal.trim()]});
    }
    setEditingNameId(null);
    window.location.reload();
  };

  // Share invite
  const handleShareInvite=()=>{
    const text=`Join my Forknight household!

Forknight keeps us synced on what's for dinner all week.

→ forknight.app

When you create your account, enter this code:
${inviteCode}`;
    if(navigator.share){navigator.share({title:"Join Forknight",text}).catch(()=>{});}
    else{navigator.clipboard.writeText(text).catch(()=>{});}
  };

  // Time saved from past leftovers
  const timeSaved=useMemo(()=>{
    let mins=0;
    const now=new Date(); now.setHours(0,0,0,0);
    const cutoff=new Date(now); cutoff.setDate(now.getDate()-30);
    Object.entries(weekPlans||{}).forEach(([wOff,plan])=>{
      const wStart=getWindowStart(Number(wOff));
      Object.entries(plan||{}).forEach(([day,d])=>{
        if(d?.isLeftover&&d?.meal?.time){
          const dayDate=new Date(day+'T00:00:00');
          if(dayDate>=cutoff&&dayDate<now) mins+=d.meal.time;
        }
      });
    });
    return mins;
  },[weekPlans]);

  return(
    <>
      <div onClick={handleClose} style={{position:"fixed",inset:0,background:C.overlay,zIndex:60,opacity:animIn?1:0,transition:"opacity 280ms ease"}}/>
      <div style={{
        position:"fixed",inset:0,zIndex:61,background:C.bg,
        display:"flex",flexDirection:"column",
        transform:animIn?"translateY(0)":"translateY(100%)",
        transition:`transform 280ms ${EASE}`,
      }}>
        {/* Constrain content to 650px on desktop */}
        <div style={{width:"100%",maxWidth:650,margin:"0 auto",display:"flex",flexDirection:"column",height:"100%"}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 18px 12px",background:C.card,borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
          <div style={{fontSize:18,fontWeight:800,color:C.text}}>Household Settings</div>
          <button onClick={handleClose} style={{width:34,height:34,borderRadius:"50%",background:C.subtle,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <X size={18} strokeWidth={2.5} color={C.text}/>
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{overflowY:"auto",flex:1,padding:"0 18px 32px",WebkitOverflowScrolling:"touch"}}>

          {/* Household size */}
          <div style={{marginTop:20,marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Household size</div>
            <div style={{background:C.subtle,border:`1px solid ${C.border}`,borderRadius:14,padding:"16px 14px 14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                <span style={{fontSize:36,fontWeight:800,color:C.text,minWidth:40,lineHeight:1,flexShrink:0}}>{householdSize}</span>
                {/* Avatar row , scales down to fit on narrow screens */}
                <HouseholdAvatarRow householdSize={householdSize} memberNames={memberNames} COOK_COLORS={COOK_COLORS} C={C}/>
              </div>
              <input type="range" min={1} max={8} value={householdSize}
                onChange={e=>setHouseholdSize&&setHouseholdSize(Number(e.target.value))}
                style={{width:"100%",accentColor:C.accent,height:4,cursor:"pointer"}}
              />
            </div>
          </div>

          {/* Chef schedule section */}
          <div style={{marginTop:24}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:"0.08em",textTransform:"uppercase"}}>Default chef schedule</div>
              <button onClick={()=>setEditingMembers(e=>!e)} style={{fontSize:11,fontWeight:700,color:C.accent,background:C.subtle,border:"none",borderRadius:6,padding:"2px 8px",cursor:"pointer"}}>
                {editingMembers?"Done":"Edit"}
              </button>
            </div>

            {members.map((m,i)=>{
              const isMe=m.id===currentUserId;
              const color=MEMBER_COLORS[i%MEMBER_COLORS.length];
              const mName=m.display_name||"Chef";
              const isEditingThisName=editingNameId===m.id;

              const hasAssignedDays=DAYS.some(d=>cookAssignment?.[d]===mName);
              return(
                <div key={m.id} style={{marginBottom:12}}>
                  {/* Name row */}
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0"}}>
                    <div style={{width:52,height:52,borderRadius:"50%",background:color,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1,color:"#fff",flexShrink:0,paddingTop:hasAssignedDays?2:0}}>
                      {hasAssignedDays&&<ChefHat size={13} strokeWidth={1.8} color="#fff"/>}
                      <span style={{fontSize:hasAssignedDays?18:22,fontWeight:800,lineHeight:1,letterSpacing:"-0.5px"}}>{mName[0].toUpperCase()}</span>
                    </div>

                    {isEditingThisName?(
                      <div style={{flex:1,display:"flex",gap:6,alignItems:"center"}}>
                        <input autoFocus value={editNameVal} onChange={e=>setEditNameVal(e.target.value.slice(0,15))}
                          onKeyDown={e=>{if(e.key==="Enter")handleSaveName();if(e.key==="Escape"){setEditingNameId(null);}}}
                          style={{flex:1,padding:"6px 10px",borderRadius:8,border:`1.5px solid ${C.accent}`,fontSize:16,outline:"none"}}/>
                        <button onClick={handleSaveName} style={{padding:"6px 12px",borderRadius:8,border:"none",background:C.text,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Save</button>
                        <button onClick={()=>setEditingNameId(null)} style={{padding:"6px 10px",borderRadius:8,border:`1px solid ${C.border}`,background:"transparent",fontSize:13,color:C.muted,cursor:"pointer"}}>Cancel</button>
                      </div>
                    ):(
                      <>
                        <div style={{flex:1}}>
                          {isMe?(
                            <button onClick={()=>{setEditingNameId(m.id);setEditNameVal(mName);}} style={{display:"flex",alignItems:"center",gap:5,background:"none",border:"none",cursor:"pointer",padding:0}}>
                              <span style={{fontSize:14,fontWeight:600,color:C.text}}>{mName}</span>
                              <span style={{fontSize:11,color:C.muted}}>(you)</span>
                              <Pencil size={11} strokeWidth={2} color={C.muted}/>
                            </button>
                          ):(
                            <span style={{fontSize:14,fontWeight:600,color:C.text}}>{mName}</span>
                          )}
                        </div>
                        {/* Remove member hidden until feature is ready */}
                        {editingMembers&&isMe&&(
                          confirmLeaveId==="me"?(
                            <div style={{display:"flex",gap:6}}>
                              <button onClick={handleLeave} style={{padding:"5px 10px",borderRadius:7,border:"none",background:"#E05050",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Leave</button>
                              <button onClick={()=>setConfirmLeaveId(null)} style={{padding:"5px 10px",borderRadius:7,border:`1px solid ${C.border}`,background:"transparent",fontSize:12,color:C.muted,cursor:"pointer"}}>Cancel</button>
                            </div>
                          ):(
                            <button onClick={()=>setConfirmLeaveId("me")} style={{display:"flex",alignItems:"center",gap:4,padding:"5px 10px",borderRadius:7,border:`1px solid #E0505033`,background:C.errorTint,fontSize:12,fontWeight:600,color:"#E05050",cursor:"pointer"}}>
                              <LogOut size={12} strokeWidth={2}/>Leave
                            </button>
                          )
                        )}
                      </>
                    )}
                  </div>

                  {/* Cook day chips per member */}
                  <div style={{display:"flex",alignItems:"center",gap:6,paddingBottom:12,borderBottom:`1px solid ${C.border}`,paddingTop:6}}>
                    <ChefHat size={13} strokeWidth={2} color={color} style={{flexShrink:0,opacity:0.7}}/>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap",flex:1}}>
                      {DAYS.map(day=>{
                        const assignedName=cookAssignment?.[day]||memberNames[0];
                        const isAssigned=assignedName===mName;
                        // 2-member households: tap any day on either row to toggle between members
                        const handleDayTap=()=>{
                          if(!setCookDay) return;
                          if(memberNames.length===2){
                            // Toggle: if already assigned to this member, switch to the other; otherwise assign to this member
                            const other=memberNames.find(n=>n!==mName)||mName;
                            setCookDay(day, isAssigned?other:mName);
                          } else {
                            setCookDay(day,mName);
                          }
                        };
                        return(
                          <button key={day} onClick={handleDayTap}
                            style={{padding:"4px 8px",borderRadius:8,border:`1.5px solid ${isAssigned?color:C.border}`,background:isAssigned?color+"22":"transparent",fontSize:11,fontWeight:700,color:isAssigned?color:C.muted,cursor:"pointer",transition:"all 0.15s",opacity:isAssigned?1:0.45}}>
                            {day.slice(0,3)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* New member / invite row */}
            {editingMembers&&(
              <div style={{padding:"12px 0",borderBottom:`1px solid ${C.border}`}}>
                {members.length>=MAX_MEMBERS?(
                  <div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>Household is full (max {MAX_MEMBERS} members)</div>
                ):(
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:34,height:34,borderRadius:"50%",background:C.border,display:"flex",alignItems:"center",justifyContent:"center",color:C.muted,flexShrink:0}}>
                      <Users size={16} strokeWidth={2}/>
                    </div>
                    <div style={{flex:1,fontSize:14,fontWeight:600,color:C.muted}}>New member</div>
                    <button onClick={handleShareInvite} style={{display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:8,border:"none",background:C.accent,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                      <Share2 size={13} strokeWidth={2}/>Invite
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* My Favorites */}
          <div style={{marginTop:24}}>
            <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>My Favorites</div>
            {proteins===null?(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {PROTEIN_OPTIONS.map(p=>(
                  <div key={p.id} style={{height:80,borderRadius:14,background:C.subtle,animation:"pulse 1.5s ease infinite"}}/>
                ))}
                <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
              </div>
            ):(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {PROTEIN_OPTIONS.map(p=>{
                  const on=proteins.has(p.id);
                  return(
                    <button key={p.id} onClick={(e)=>{toggleProtein(p.id);const el=e.currentTarget;el.classList.remove("fk-wiggle");void el.offsetWidth;el.classList.add("fk-wiggle");setTimeout(()=>el.classList.remove("fk-wiggle"),400);}} style={{
                      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                      gap:8,padding:"16px 12px",borderRadius:14,
                      border:`2px solid ${on?C.accent:C.border}`,
                      background:on?C.accentTint:C.card,
                      cursor:"pointer",transition:"all 0.15s",position:"relative",
                    }}>
                      {on&&<div style={{position:"absolute",top:8,right:8,width:16,height:16,borderRadius:"50%",background:C.accent,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        <Check size={9} strokeWidth={3} color="#fff"/>
                      </div>}
                      <p.Icon size={22} strokeWidth={1.6} color={on?C.accent:C.muted}/>
                      <span style={{fontSize:12,fontWeight:700,color:on?C.accent:C.text}}>{p.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Premium status card */}
          {showPremiumUi&&(
          <div style={{marginTop:20,background:C.card,borderRadius:14,padding:"16px 18px",
            border:`1px solid ${C.border}`}}>
            {/* Header row */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <span style={{fontSize:13,fontWeight:700,color:C.text}}>Forknight Premium</span>
              <span style={{fontSize:11,fontWeight:600,padding:"3px 10px",borderRadius:20,
                background:tier==="free"?C.border:C.accent+"22",
                color:tier==="free"?C.muted:C.accent}}>
                {tier==="grandfathered"?"Grandfathered":tier==="premium"?"Premium":"Free"}
              </span>
            </div>
            {/* Upgrade CTA — secondary style */}
            {tier==="free"&&(
              <button onClick={()=>{/* TODO StoreKit */}}
                style={{width:"100%",padding:"11px",background:"transparent",
                  border:`1.5px solid ${C.accent}`,borderRadius:10,
                  color:C.accent,fontSize:14,fontWeight:700,cursor:"pointer",
                  marginBottom:14}}>
                Upgrade to Premium — $1/month
              </button>
            )}
          </div>
          )}


          {/* Sign out + Face ID - same row */}
          <div style={{display:"flex",gap:8,marginTop:12,marginBottom:4}}>
            <button onClick={()=>{handleClose();setTimeout(()=>{if(onSignOut)onSignOut();},300);}}
              style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,
                padding:"12px",borderRadius:10,border:`1px solid ${C.border}`,
                background:"transparent",color:C.muted,fontSize:13,fontWeight:600,cursor:"pointer"}}>
              <LogOut size={14} strokeWidth={2}/> Sign out
            </button>
            <FaceIdSettingsRow C={C} compact={true}/>
          </div>

          {/* Share Invite - primary CTA */}
          {inviteCode&&(
            <div style={{marginTop:28}}>
              <button onClick={onOpenShareSheet||handleShareInvite} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,width:"100%",padding:"16px",borderRadius:14,border:"none",background:C.accent,color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer"}}>
                <Share2 size={18} strokeWidth={2.5}/> Share Household Invite
              </button>
            </div>
          )}



          {/* Share the app + Appearance - same row */}
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,marginTop:16,paddingBottom:4}}>
            <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:16}}>
              <button onClick={()=>{
                const text="Check out Forknight! Plan meals together. Eat meals together. https://forknight.app";
                if(navigator.share){navigator.share({title:"Forknight",text}).catch(()=>{});}
                else{navigator.clipboard.writeText(text).catch(()=>{});}
              }} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:C.muted,textDecoration:"underline",display:"inline-flex",alignItems:"center",gap:5,padding:0}}>
                <Share2 size={13} strokeWidth={2}/> Share the app
              </button>
              <span style={{width:1,height:12,background:C.border,flexShrink:0}}/>
              <button onClick={()=>setShowFeedback(true)}
                style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:C.muted,textDecoration:"underline",display:"inline-flex",alignItems:"center",gap:5,padding:0}}>
                <MessageCircle size={13} strokeWidth={2}/> Feedback
              </button>
              <span style={{width:1,height:12,background:C.border,flexShrink:0}}/>
              <button onClick={()=>setShowAppearanceSheet(true)}
                style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:C.muted,display:"inline-flex",alignItems:"center",gap:5,textDecoration:"underline",padding:0}}>
                {themePref==="dark"?<Moon size={13} strokeWidth={2}/>:themePref==="light"?<Sun size={13} strokeWidth={2}/>:<SunMoon size={13} strokeWidth={2}/>}
                Appearance
              </button>
            </div>
            <span style={{fontSize:10,color:C.muted}}>Forknight<sup style={{fontSize:"0.75em",verticalAlign:"super"}}>®</sup> v1.5.8</span>
          </div>

        </div>{/* end scrollable */}
        </div>{/* end 650px inner */}
      </div>

      {/* Appearance sheet */}
    </>
  );
}


function GrocerySheet({plan,onClose,householdSize=2,orderedDays=DAYS,nextWeekPlan=null,nextWeekOrderedDays=DAYS}){
  const C=useC();
  const [includeNext,setIncludeNext]=useState(false);

  const buildData=(p,oDays,hSize)=>oDays.filter(day=>!p[day]?.isEatOut&&!p[day]?.isLeftover&&p[day]?.meal?.ingredients?.length)
    .map(day=>{
      const d=p[day];
      const nextDay=oDays[oDays.indexOf(day)+1];
      const nextIsLeftover=nextDay&&p[nextDay]?.isLeftover;
      const shouldDouble=nextIsLeftover||!!d.isDoubled;
      const scaleFactor=d.meal.servings?hSize/d.meal.servings:1;
      const factor=shouldDouble?scaleFactor*2:scaleFactor;
      const ings=scaleIngredients(d.meal.ingredients,factor);
      // Only show 2× badge when doubling for leftovers; household scale is implicit
      const leftoverLabel=shouldDouble?"2×":"";
      return {day,mealName:d.meal.name,leftoverLabel,ingredients:filterPantry(ings)};
    }).filter(d=>d.ingredients.length>0);

  const thisWeekData=useMemo(()=>buildData(plan,orderedDays,householdSize),[plan,orderedDays,householdSize]);
  const nextWeekData=useMemo(()=>nextWeekPlan?buildData(nextWeekPlan,nextWeekOrderedDays,householdSize):[],[nextWeekPlan,nextWeekOrderedDays,householdSize]);
  const data=useMemo(()=>{
    const tw=thisWeekData.map(d=>({...d,dayKey:`this_${d.day}`}));
    const nw=nextWeekData.map(d=>({...d,dayKey:`next_${d.day}`}));
    return includeNext?[...tw,...nw]:tw;
  },[thisWeekData,nextWeekData,includeNext]);

  const [groupBy,setGroupBy]=useState("day"); // "day" or "category"
  const GROCERY_SEL_KEY="forknight_grocery_sel";
  const GROCERY_REM_KEY="forknight_grocery_rem";
  const [selMeals,setSelMeals]=useState(()=>{
    try{const s=sessionStorage.getItem(GROCERY_SEL_KEY);return s?new Set(JSON.parse(s)):new Set(data.map(d=>d.dayKey));}
    catch{return new Set(data.map(d=>d.dayKey));}
  });
  const [removed,setRemoved]=useState(()=>{
    try{const r=sessionStorage.getItem(GROCERY_REM_KEY);return r?new Set(JSON.parse(r)):new Set();}
    catch{return new Set();}
  });
  const saveSelMeals=(next)=>{setSelMeals(next);try{sessionStorage.setItem(GROCERY_SEL_KEY,JSON.stringify([...next]));}catch{}};
  const saveRemoved=(next)=>{setRemoved(next);try{sessionStorage.setItem(GROCERY_REM_KEY,JSON.stringify([...next]));}catch{}};

  // When next-week toggle adds new days, auto-select them
  useEffect(()=>{
    setSelMeals(prev=>{
      const next=new Set(prev);
      data.forEach(d=>{if(!next.has(d.dayKey))next.add(d.dayKey);});
      try{sessionStorage.setItem(GROCERY_SEL_KEY,JSON.stringify([...next]));}catch{}
      return next;
    });
  },[data]);

  const toggleMeal=dayKey=>saveSelMeals((()=>{const n=new Set(selMeals);n.has(dayKey)?n.delete(dayKey):n.add(dayKey);return n;})());
  const toggleIng=(dayKey,ing)=>{const k=`${dayKey}|${ing}`;const n=new Set(removed);n.has(k)?n.delete(k):n.add(k);saveRemoved(n);};

  // Build plain text for native share → Reminders
  // Each ingredient is its own line so iOS Reminders creates a separate item per ingredient
  const buildShareText=()=>{
    const lines=["Grocery List\n"];
    for(const d of data){
      if(!selMeals.has(d.dayKey||d.day))continue;
      const ings=d.ingredients.filter(ing=>!removed.has(`${d.dayKey||d.day}|${ing}`));
      if(!ings.length)continue;
      lines.push(`${dayLabel(d.day,true)} - ${d.mealName}`);
      ings.forEach(ing=>lines.push(`  • ${ing}`));
      lines.push('');
    }
    return lines.join('\n').trim();
  };

  const handleShareReminders=async()=>{
    const text=buildShareText();
    if(!text.trim())return;
    if(navigator.share){
      try{ await navigator.share({title:"Grocery List",text}); }
      catch{ try{await navigator.clipboard.writeText(text);}catch{} }
    } else {
      try{await navigator.clipboard.writeText(text);}catch{}
      alert("Copied to clipboard!");
    }
  };

  return (
    <>
      <div onClick={onClose} style={{position:"fixed",inset:0,background:C.overlay,zIndex:50}}/>
      <div style={{position:"fixed",left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:650,bottom:0,zIndex:51,background:C.card,borderRadius:"20px 20px 0 0",maxHeight:"88vh",display:"flex",flexDirection:"column",boxShadow:"0 -4px 28px rgba(0,0,0,0.18)"}}>

        {/* Handle */}
        <div style={{display:"flex",justifyContent:"center",padding:"10px 0 0"}}>
          <div style={{width:36,height:4,borderRadius:2,background:C.mutedBg}}/>
        </div>

        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 18px 4px"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,fontSize:17,fontWeight:800,color:C.text}}>
            <ShoppingCart size={18} strokeWidth={2} color={C.text}/> Grocery List
          </div>
          <button onClick={onClose} style={{display:"flex",alignItems:"center",justifyContent:"center",background:"none",border:"none",cursor:"pointer",color:C.muted,padding:4}}>
            <X size={18} strokeWidth={2}/>
          </button>
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 18px 10px"}}>
          <div style={{fontSize:12,color:C.muted}}>Tap to remove</div>
          <div style={{display:"flex",gap:0,borderRadius:8,border:`1px solid ${C.border}`,overflow:"hidden"}}>
            {["By Meal","By Category"].map(v=>(
              <button key={v} onClick={()=>setGroupBy(v==="By Meal"?"day":"category")} style={{padding:"4px 10px",fontSize:11,fontWeight:600,border:"none",cursor:"pointer",background:((groupBy==="day"&&v==="By Meal")||(groupBy==="category"&&v==="By Category"))?C.text:"transparent",color:((groupBy==="day"&&v==="By Meal")||(groupBy==="category"&&v==="By Category"))?C.bg:C.muted}}>
                {v}
              </button>
            ))}
          </div>
          {nextWeekPlan&&(
            <button onClick={()=>setIncludeNext(v=>!v)} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,fontWeight:600,padding:"4px 10px",borderRadius:20,border:`1.5px solid ${includeNext?C.accent:C.border}`,background:includeNext?C.accent+"15":"transparent",color:includeNext?C.accent:C.muted,cursor:"pointer"}}>
              + Next week
            </button>
          )}
        </div>

        {/* Scrollable list */}
        <div style={{overflowY:"auto",flex:1,padding:"0 18px 12px"}}>
          {groupBy==="day" ? (
            // ── By Meal view ──────────────────────────────────────────────
            <>
              {data.map(d=>{
                const on=selMeals.has(d.dayKey||d.day);
                return (
                  <div key={d.day} style={{marginBottom:20}}>
                    <button onClick={()=>toggleMeal(d.day)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:"none",border:"none",cursor:"pointer",padding:"6px 0"}}>
                      <span style={{
                        width:24,height:24,borderRadius:7,flexShrink:0,
                        border:`2px solid ${on?C.accent:C.border}`,
                        background:on?C.accent:"transparent",
                        display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",
                      }}>
                        {on&&<Check size={14} strokeWidth={3}/>}
                      </span>
                      <span style={{fontSize:14,fontWeight:700,color:on?C.text:C.muted,textAlign:"left"}}>{dayLabel(d.day,true)} - {d.mealName}{d.leftoverLabel&&<span style={{color:"#FF6B35",fontWeight:700,marginLeft:4}}>{d.leftoverLabel}</span>}</span>
                    </button>
                    {on&&(
                      <div style={{paddingLeft:34}}>
                        {d.ingredients.map(ing=>{
                          const k=`${d.dayKey||d.day}|${ing}`,rem=removed.has(k);
                          return (
                            <button key={ing} onClick={()=>toggleIng(d.dayKey||d.day,ing)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:"none",border:"none",cursor:"pointer",padding:"7px 0",borderBottom:`1px solid ${C.border}22`}}>
                              <span style={{width:20,height:20,borderRadius:5,flexShrink:0,border:`2px solid ${rem?C.mutedBg:C.accent}`,background:rem?"transparent":C.accent,display:"flex",alignItems:"center",justifyContent:"center"}}>
                                {!rem&&<svg width={11} height={11} viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                {rem&&<X size={11} strokeWidth={2.5} color={C.muted}/>}
                              </span>
                              <span style={{fontSize:13,color:rem?C.mutedBg:C.text,textDecoration:rem?"line-through":"none",textAlign:"left",lineHeight:1.4}}>{ing}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            // ── By Category view ──────────────────────────────────────────
            (()=>{
              // Collect all active ingredients, tag with day for remove key
              const CATEGORIES=[
                {id:"produce",  label:"🥦 Produce",
                  test:i=>/\b(onion|shallot|scallion|green onion|leek|garlic|ginger|galangal|tomato|cherry tomato|pepper|bell pepper|jalape|serrano|chili pepper|broccoli|broccolini|spinach|kale|chard|arugula|lettuce|cabbage|bok choy|napa|celery|carrot|zucchini|courgette|squash|pumpkin|potato|sweet potato|yam|mushroom|shiitake|cremini|portobello|porcini|avocado|corn|lemon|lime|orange|grapefruit|apple|pear|mango|pineapple|banana|berry|strawberry|blueberry|cucumber|herb|cilantro|coriander|parsley|basil|mint|thyme|rosemary|dill|sage|tarragon|chive|eggplant|aubergine|beet|radish|daikon|asparagus|artichoke|fennel|endive|watercress|bok|gai lan|nectarine|plum|apricot|edamame|snap pea|snow pea|green bean|string bean)\b/i.test(i)},
                {id:"proteins",  label:"🥩 Proteins",
                  test:i=>/\b(beef|steak|flank|sirloin|brisket|ground beef|chuck|rib|chicken|turkey|duck|lamb|pork|bacon|pancetta|prosciutto|ham|sausage|chorizo|salami|pepperoni|shrimp|prawn|salmon|tuna|cod|halibut|tilapia|mahi|snapper|sea bass|crab|lobster|scallop|clam|mussel|anchovy|sardine|tofu|tempeh|paneer|seitan|egg|eggs|white fish|firm tofu|extra-firm tofu)\b/i.test(i)},
                {id:"dairy",    label:"🧀 Dairy & Eggs",
                  test:i=>/\b(butter|ghee|milk|whole milk|skim milk|oat milk|almond milk|cream|heavy cream|half and half|sour cream|creme fraiche|cream cheese|cheese|mozzarella|parmesan|parmigiano|pecorino|gruyere|feta|ricotta|cottage cheese|mascarpone|brie|camembert|cheddar|monterey jack|gouda|havarti|provolone|swiss|manchego|yogurt|greek yogurt|kefir|ice cream)\b/i.test(i)},
                {id:"grains",   label:"🌾 Grains, Bread & Pasta",
                  test:i=>/\b(rice|jasmine rice|basmati|arborio|sushi rice|brown rice|wild rice|pasta|spaghetti|pappardelle|linguine|fettuccine|penne|rigatoni|fusilli|farfalle|tagliatelle|lasagna|gnocchi|orzo|couscous|noodle|ramen|udon|soba|vermicelli|rice noodle|glass noodle|flour|all-purpose flour|bread|sourdough|baguette|ciabatta|focaccia|pita|naan|flatbread|tortilla|wrap|roll|bun|bagel|english muffin|panko|breadcrumb|crouton|quinoa|farro|barley|bulgur|polenta|cornmeal|oat|granola|cracker|wonton wrapper|dumpling wrapper|gyoza wrapper|phyllo)\b/i.test(i)},
                {id:"canned",   label:"🥫 Canned & Jarred",
                  test:i=>/\b(can|canned|jar|jarred|crushed tomato|diced tomato|tomato paste|tomato sauce|marinara|passata|coconut milk|coconut cream|broth|stock|chicken broth|vegetable broth|beef broth|bean|black bean|cannellini|chickpea|garbanzo|lentil|kidney bean|navy bean|pinto bean|corn can|artichoke heart|roasted pepper|olive|caper|anchovy|tuna can|sardine can|chipotle|adobo|curry paste|red curry|green curry|yellow curry|hoisin|oyster sauce|fish sauce|worcestershire|hot sauce|sriracha|sambal|gochujang|tahini|almond butter|peanut butter|jam|jelly|preserve)\b/i.test(i)},
                {id:"pantry",   label:"🫙 Pantry & Spices",
                  test:i=>/\b(oil|olive oil|sesame oil|vegetable oil|canola oil|coconut oil|avocado oil|vinegar|rice vinegar|balsamic|red wine vinegar|apple cider vinegar|sherry vinegar|soy sauce|tamari|miso|mirin|sake|shaoxing|rice wine|honey|maple syrup|agave|sugar|brown sugar|powdered sugar|molasses|salt|pepper|black pepper|white pepper|red pepper flake|spice|seasoning|paprika|smoked paprika|cumin|coriander|turmeric|cinnamon|nutmeg|cardamom|clove|star anise|five spice|garam masala|curry powder|chili powder|cayenne|oregano|thyme|bay leaf|rosemary dried|dried herb|mustard|dijon|cornstarch|arrowroot|baking soda|baking powder|vanilla|cocoa|chocolate|saffron|lemongrass paste|tamarind|fish paste)\b/i.test(i)},
                {id:"other",    label:"📦 Other",      test:()=>true},
              ];
              // Aggregate items across selected meals
              const catBuckets={};
              CATEGORIES.forEach(c=>catBuckets[c.id]=[]);
              data.forEach(d=>{
                if(!selMeals.has(d.dayKey||d.day))return;
                d.ingredients.forEach(ing=>{
                  const cat=CATEGORIES.find(c=>c.test(ing))||CATEGORIES[CATEGORIES.length-1];
                  catBuckets[cat.id].push({ing,key:`${d.dayKey||d.day}|${ing}`,day:d.day});
                });
              });
              // Deduplicate by ingredient text
              const seen=new Set();
              CATEGORIES.forEach(c=>{
                catBuckets[c.id]=catBuckets[c.id].filter(({ing})=>{
                  if(seen.has(ing.toLowerCase()))return false;
                  seen.add(ing.toLowerCase());return true;
                });
              });
              return (
                <>
                  {CATEGORIES.filter(c=>catBuckets[c.id].length>0).map(c=>(
                    <div key={c.id} style={{marginBottom:20}}>
                      <div style={{fontSize:12,fontWeight:700,color:C.muted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:6,paddingTop:4}}>{c.label}</div>
                      {catBuckets[c.id].map(({ing,key,day})=>{
                        const rem=removed.has(key);
                        return (
                          <button key={key} onClick={()=>{const n=new Set(removed);n.has(key)?n.delete(key):n.add(key);saveRemoved(n);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:"none",border:"none",cursor:"pointer",padding:"7px 0",borderBottom:`1px solid ${C.border}22`}}>
                            <span style={{width:20,height:20,borderRadius:5,flexShrink:0,border:`2px solid ${rem?C.mutedBg:C.accent}`,background:rem?"transparent":C.accent,display:"flex",alignItems:"center",justifyContent:"center"}}>
                              {rem&&<X size={11} strokeWidth={2.5} color={C.muted}/>}
                            </span>
                            <span style={{fontSize:13,color:rem?C.mutedBg:C.text,textDecoration:rem?"line-through":"none",textAlign:"left",lineHeight:1.4}}>{ing}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </>
              );
            })()
          )}
          {data.length===0&&(
            <div style={{textAlign:"center",color:C.muted,padding:"40px 0",fontSize:13}}>
              No meals with ingredients this week.
            </div>
          )}
        </div>

        {/* Sticky bottom CTA */}
        <div style={{padding:"14px 18px 32px",borderTop:`1px solid ${C.border}`,background:C.card,flexShrink:0}}>
          <button onClick={handleShareReminders} className="fk-press" style={{
            display:"flex",alignItems:"center",justifyContent:"center",gap:10,
            width:"100%",padding:"16px",borderRadius:14,border:"none",
            background:C.text,color:C.bg,fontSize:15,fontWeight:800,cursor:"pointer",
          }}>
            <Share2 size={18} strokeWidth={2.5}/>
            Share List
          </button>
        </div>

      </div>
    </>
  );
}

// ── ProteinFilter ─────────────────────────────────────────────────────────────
function ProteinFilter({active,onChange,onRandom,sortBy,setSortBy,showSort,setShowSort,SORT_OPTIONS,cuisine,setCuisine,showCuisine,setShowCuisine,CUISINE_OPTIONS}){
  const C=useC();
  const sortBtnRef=useRef(null);
  const cuisineBtnRef=useRef(null);
  const [dropStyle,setDropStyle]=useState({});
  const [cuisineDropStyle,setCuisineDropStyle]=useState({});

  const toggleCuisine=()=>{
    if(!showCuisine&&cuisineBtnRef.current){
      const r=cuisineBtnRef.current.getBoundingClientRect();
      const dropH=CUISINE_OPTIONS.length*44;
      const openUp=r.top>dropH+20;
      const sheetLeft=Math.max(0,(window.innerWidth-650)/2);
      const sheetRight=Math.min(window.innerWidth,sheetLeft+650);
      const left=Math.max(8,Math.min(r.right-170,window.innerWidth-178));
      setCuisineDropStyle(openUp
        ?{position:"fixed",bottom:window.innerHeight-r.top,left,width:170,zIndex:200,background:C.card,borderRadius:"12px",boxShadow:"0 -4px 20px rgba(0,0,0,0.18)",border:`1px solid ${C.border}`,overflow:"hidden"}
        :{position:"fixed",top:r.bottom,left,width:170,zIndex:200,background:C.card,borderRadius:"12px",boxShadow:"0 4px 20px rgba(0,0,0,0.18)",border:`1px solid ${C.border}`,overflow:"hidden"}
      );
    }
    setShowCuisine(s=>!s);
  };

  const toggleSort=()=>{
    if(!showSort&&sortBtnRef.current){
      const r=sortBtnRef.current.getBoundingClientRect();
      const dropH=SORT_OPTIONS.length*44;
      const openUp=r.top>dropH+20;
      const sheetLeft=Math.max(0,(window.innerWidth-650)/2);
      const sheetRight=Math.min(window.innerWidth,sheetLeft+650);
      const left=Math.max(8,Math.min(r.right-210,window.innerWidth-218));
      setDropStyle(openUp
        ?{position:"fixed",bottom:window.innerHeight-r.top,left,width:210,zIndex:200,background:C.card,borderRadius:"12px",boxShadow:"0 -4px 20px rgba(0,0,0,0.18)",border:`1px solid ${C.border}`,overflow:"hidden"}
        :{position:"fixed",top:r.bottom,left,width:210,zIndex:200,background:C.card,borderRadius:"12px",boxShadow:"0 4px 20px rgba(0,0,0,0.18)",border:`1px solid ${C.border}`,overflow:"hidden"}
      );
    }
    setShowSort(s=>!s);
  };

  // Lock body scroll while any dropdown is open
  useEffect(()=>{
    if(showSort||showCuisine){
      const prev=document.body.style.overflow;
      document.body.style.overflow="hidden";
      return ()=>{ document.body.style.overflow=prev; };
    }
  },[showSort,showCuisine]);

  return (
    <div style={{marginBottom:10}}>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {PROTEINS.map(p=>{const {Icon,label}=PROTEIN_META[p],on=active===p;return(
          <button key={p} onClick={()=>onChange(p)} style={{display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:20,border:`1.5px solid ${on?"#1A1A1A":"#D0D0C8"}`,background:on?C.text:C.card,color:on?C.bg:C.textSub,fontFamily:"system-ui",fontSize:12,fontWeight:on?700:500,cursor:"pointer",minHeight:34}}>
            <Icon size={13} strokeWidth={2}/> {label}
          </button>
        );})}
        <div style={{position:"relative"}}>
          <button ref={cuisineBtnRef} onClick={toggleCuisine} style={{display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:20,border:`1.5px solid ${C.accent}`,background:showCuisine||cuisine!=="all"?C.accent:"transparent",color:showCuisine||cuisine!=="all"?"#fff":C.accent,fontFamily:"system-ui",fontSize:12,fontWeight:700,cursor:"pointer",minHeight:34}}>
            <ChevronDown size={12} strokeWidth={2}/> {cuisine==="all"?"Cuisine":CUISINE_OPTIONS.find(o=>o.id===cuisine)?.label||"Cuisine"}
          </button>
          {showCuisine&&createPortal(
            <>
              <div onClick={()=>setShowCuisine(false)} style={{position:"fixed",inset:0,zIndex:199}}/>
              <div style={cuisineDropStyle}>
                {CUISINE_OPTIONS.map(o=>(
                  <button key={o.id} onClick={()=>{setCuisine(o.id);setShowCuisine(false);}} style={{width:"100%",padding:"11px 14px",background:"none",border:"none",cursor:"pointer",fontSize:13,textAlign:"left",color:C.text,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    {o.label}{cuisine===o.id&&<Check size={14} strokeWidth={2.5} color={C.accent}/>}
                  </button>
                ))}
              </div>
            </>,document.body
          )}
        </div>
        <div style={{position:"relative"}}>
          <button ref={sortBtnRef} onClick={toggleSort} style={{display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:20,border:`1.5px solid ${C.accent}`,background:showSort?C.accent:"transparent",color:showSort?"#fff":C.accent,fontFamily:"system-ui",fontSize:12,fontWeight:700,cursor:"pointer",minHeight:34}}>
            <SortDesc size={13} strokeWidth={2}/> Sort
          </button>
          {showSort&&createPortal(
            <>
              <div onClick={()=>setShowSort(false)} style={{position:"fixed",inset:0,zIndex:199}}/>
              <div style={dropStyle}>
                {SORT_OPTIONS.map(o=>(
                  <button key={o.id} onClick={()=>{setSortBy(o.id);setShowSort(false);}} style={{width:"100%",padding:"11px 14px",background:"none",border:"none",cursor:"pointer",fontSize:13,textAlign:"left",color:C.text,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    {o.label}{sortBy===o.id&&<Check size={14} strokeWidth={2.5} color={C.accent}/>}
                  </button>
                ))}
              </div>
            </>,document.body
          )}
        </div>
      </div>
    </div>
  );
}

// ── RecipePanel ───────────────────────────────────────────────────────────────
function doubleStep(step){
  // Only double quantities followed by cooking units (weight/volume/count)
  // Explicitly skip: temperatures (°F, °C, degrees), times (min, minutes, hrs, hours, seconds),
  // percentages, and bare numbers not followed by a recognized unit
  return step.replace(
    /(^|\s)((\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)\s*)(lb|oz|lbs|cup|cups|tbsp|tsp|cloves?|strips?|stalks?|cans?|heads?|bunches?|pieces?|slices?|fillets?|breasts?|thighs?|racks?|pounds?|ounces?|tablespoons?|teaspoons?)\b/g,
    (match, pre, numPart, fracPart, unit) => {
      const p = parseQty(numPart.trim());
      if (!p || p.val === 0) return match;
      return pre + toFrac(p.val * 2) + " " + unit;
    }
  );
}

function RecipePanel({meal,doubled,ratings={},onSetRating,scaleFactor=1,day,onUpdateMeal,householdId,currentUserId}){
  const C=useC();
  const [detailed,setDetailed]=useState(false);
  const [editing,setEditing]=useState(false);
  const [editDraft,setEditDraft]=useState('');
  const [editSaving,setEditSaving]=useState(false);
  const hasOverride=!!(meal.rawText&&meal.rawText.trim()&&meal._editOverride);
  // scaleFactor = householdSize / meal.servings (for normal), * 2 for leftovers
  const effectiveFactor=doubled?scaleFactor*2:scaleFactor;
  const ingredients=meal.ingredients?scaleIngredients(meal.ingredients,effectiveFactor):[];
  const hasDetailed=!!(meal.recipe_detailed?.length);
  const activeRecipe=(detailed&&hasDetailed)?meal.recipe_detailed:meal.recipe;
  const rawSteps=activeRecipe||((meal.steps||[]).map(s=>typeof s==='string'?s:s.s||''));
  const steps=rawSteps.map(s=>scaleStep(s,effectiveFactor));
  const myRating=ratings[meal.id]||0;
  const servesN=Math.round((meal.servings||4)*effectiveFactor);

  const buildRecipeText=()=>{
    const ing=(meal.ingredients||[]).map(i=>`- ${i}`).join('\n');
    const recipeSteps=(meal.recipe_detailed||meal.recipe||[]).map((s,i)=>`${i+1}. ${s}`).join('\n');
    return `Ingredients:\n${ing}\n\nSteps:\n${recipeSteps}`;
  };
  const handleStartEdit=()=>{
    setEditDraft(hasOverride?meal.rawText:buildRecipeText());
    setEditing(true);
  };
  const handleSaveEdit=async()=>{
    if(!editDraft.trim()){setEditing(false);return;}
    setEditSaving(true);
    const overrideName=`__override__${meal.id}`;
    let savedId=meal._overrideId||null;
    if(savedId){
      await supabase.from('custom_meals').update({raw_text:editDraft.trim()}).eq('id',savedId);
    } else {
      const{data}=await supabase.from('custom_meals').insert({
        household_id:householdId,user_id:currentUserId,
        name:overrideName,raw_text:editDraft.trim()
      }).select('id').single();
      if(data?.id) savedId=data.id;
    }
    if(onUpdateMeal&&day){
      onUpdateMeal(day,{...meal,rawText:editDraft.trim(),_editOverride:true,_overrideId:savedId});
    }
    setEditSaving(false);setEditing(false);
  };
  const handleRestoreEdit=async()=>{
    if(meal._overrideId){
      await supabase.from('custom_meals').delete().eq('id',meal._overrideId);
    }
    if(onUpdateMeal&&day){
      const{rawText:_a,_editOverride:_b,_overrideId:_c,...restored}=meal;
      onUpdateMeal(day,restored);
    }
  };
  const handlePrint=()=>{
    const ingLines=ingredients.map(i=>`<li style="margin:4px 0">${i}</li>`).join('');
    const stepLines=steps.map((s,i)=>`<li style="margin:6px 0"><b>${i+1}.</b> ${s}</li>`).join('');
    const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${meal.name}</title>
    <style>body{font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px}
    h1{font-size:22px;margin-bottom:4px}h2{font-size:15px;margin:18px 0 6px}
    ul,ol{padding-left:20px;margin:0}li{font-size:14px;line-height:1.6}
    .badge{display:inline-block;padding:2px 8px;background:#FF6B3520;color:#FF6B35;border-radius:6px;font-size:12px;font-weight:700;margin-left:8px}
    @media print{.no-print{display:none}}</style></head>
    <body>
    <h1>${meal.name}${doubled?'<span class="badge">×2 doubled</span>':''}</h1>
    <p style="color:#888;font-size:13px">⏱ ${meal.time} min · 👥 serves ${servesN}</p>
    <h2>Ingredients</h2><ul>${ingLines}</ul>
    <h2>Steps</h2><ol>${stepLines}</ol>
    <br><button class="no-print" onclick="window.print()" style="padding:10px 20px;background:#FF6B35;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer">Print</button>
    </body></html>`;
    const url=URL.createObjectURL(new Blob([html],{type:"text/html"}));
    const w=window.open(url,"_blank");
    if(w) w.onload=()=>setTimeout(()=>w.print(),200);
  };

  return (
    <div style={{marginTop:10,padding:"12px 14px",background:C.subtle,borderRadius:10,border:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
        <div style={{display:"flex",alignItems:"center",gap:6,fontSize:13,fontWeight:700,color:C.text}}>
          <ShoppingCart size={14} strokeWidth={2}/> Ingredients{doubled&&<span style={{fontSize:12,fontWeight:800,color:"#FF6B35",marginLeft:4}}>× 2</span>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          {/* 1-5 star rating */}
          <div style={{display:"flex",gap:2}}>
            {[1,2,3,4,5].map(n=>(
              <button key={n} onClick={()=>onSetRating&&onSetRating(meal.id,n===myRating?0:n)}
                style={{background:"none",border:"none",cursor:"pointer",padding:"2px",lineHeight:1}}>
                <Star size={18} strokeWidth={1.5} fill={n<=myRating?C.star:"none"} color={n<=myRating?C.star:"#B0A090"}/>
              </button>
            ))}
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
            <button onClick={handlePrint} style={{display:"flex",alignItems:"center",gap:5,fontSize:13,fontWeight:600,color:C.muted,background:"transparent",border:"none",cursor:"pointer",padding:0,minHeight:28}}>
              <Upload size={20} strokeWidth={1.8}/> Print
            </button>
            {day&&householdId&&(
              <button onClick={handleStartEdit} style={{display:"flex",alignItems:"center",gap:5,fontSize:13,fontWeight:600,color:C.muted,background:"none",border:"none",cursor:"pointer",padding:0}}>
                <Pencil size={15} strokeWidth={1.8}/> {hasOverride?"Edit (custom)":"Edit"}
              </button>
            )}
            {hasOverride&&day&&householdId&&(
              <button onClick={handleRestoreEdit} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,fontWeight:600,color:C.muted,background:"none",border:"none",cursor:"pointer",padding:0}}>
                <RotateCcw size={12} strokeWidth={1.8}/> Restore
              </button>
            )}
          </div>
        </div>
      </div>
      {editing?(
        <div style={{marginTop:8}}>
          <textarea value={editDraft} onChange={e=>setEditDraft(e.target.value.slice(0,3000))}
            rows={12} style={{width:"100%",padding:"10px 12px",borderRadius:10,
              border:`1px solid ${C.border}`,fontSize:14,lineHeight:1.6,
              background:C.card,color:C.text,resize:"vertical",fontFamily:"system-ui"}}/>
          <div style={{display:"flex",gap:8,marginTop:8}}>
            <button onClick={handleSaveEdit} disabled={editSaving}
              style={{flex:1,padding:"10px",borderRadius:10,border:"none",
                background:C.accent,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>
              {editSaving?"Saving…":"Save Changes"}
            </button>
            <button onClick={()=>setEditing(false)}
              style={{padding:"10px 16px",borderRadius:10,border:`1px solid ${C.border}`,
                background:"none",color:C.muted,fontSize:14,cursor:"pointer"}}>
              Cancel
            </button>
          </div>
        </div>
      ):(
      <>
      {hasOverride&&(
        <div style={{fontSize:13,color:C.textSub,lineHeight:1.7,whiteSpace:"pre-wrap",margin:"8px 0"}}>
          {meal.rawText}
        </div>
      )}
      {!hasOverride&&<>
      <ul style={{listStyle:"none",padding:0,margin:"0 0 12px"}}>
        {ingredients.map((ing,i)=>(
          <li key={i} style={{padding:"2px 0",fontSize:12,color:C.text}}>{ing}</li>
        ))}
      </ul>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
        <div style={{display:"flex",alignItems:"center",gap:6,fontSize:13,fontWeight:700,color:C.text}}>
          <BookOpen size={14} strokeWidth={2}/> Steps
        </div>
        {hasDetailed&&(
          <button onClick={()=>setDetailed(d=>!d)} style={{fontSize:11,fontWeight:700,padding:"2px 9px",borderRadius:6,border:`1px solid ${detailed?"#FF6B35":C.border}`,background:detailed?"#FF6B3518":"transparent",color:detailed?"#FF6B35":C.muted,cursor:"pointer",letterSpacing:"0.02em"}}>
            {detailed?"Hide Details":"Show Details"}
          </button>
        )}
      </div>
      <ol style={{listStyle:"none",padding:0,margin:0}}>
        {steps.map((step,i)=>(
          <li key={i} style={{display:"flex",gap:8,padding:"3px 0",fontSize:12,color:C.text,lineHeight:1.5}}>
            <span style={{fontWeight:700,color:C.accent,minWidth:16}}>{i+1}.</span>{step}
          </li>
        ))}
      </ol>
      {(()=>{
        // tips[] array (detailed) takes priority; fall back to tip/tip2 strings
        const tipList=detailed&&meal.tips?.length?meal.tips
          :(meal.tip?[meal.tip,...(detailed&&meal.tip2?[meal.tip2]:[])]:null);
        return tipList?.length?(
          <div style={{marginTop:14,borderRadius:14,padding:"12px 14px",background:C.subtle,border:`1px solid ${C.border}`}}>
            <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:C.muted,marginBottom:6}}>Pro Tips</div>
            {tipList.map((t,i)=>(
              <div key={i} style={{display:"flex",gap:8,fontSize:12,color:C.textSub,lineHeight:1.6,fontWeight:400,marginTop:i>0?6:0}}>
                <span style={{color:C.accent,fontWeight:700,flexShrink:0}}>-</span>
                <span>{t.replace(/^-\s*/,'')}</span>
              </div>
            ))}
          </div>
        ):null;
      })()}
      </>}
      </>)}
    </div>
  );
}

// ── MealSelector ──────────────────────────────────────────────────────────────
// ── PaywallSheet — reusable paywall overlay ───────────────────────────────────
function PaywallSheet({onClose,highlight=null}){
  const C=useC();
  const isDark=C.bg==="#0D0D0B";
  // Use a slightly elevated version of the card color so the sheet reads as premium
  const bg=isDark
    ?"linear-gradient(170deg,#0D0D0D 0%,#1A1008 50%,#221508 100%)"
    :"linear-gradient(170deg,#FAF8F4 0%,#FFF8F2 100%)";
  const border=isDark?"rgba(255,255,255,0.1)":`1px solid ${C.border}`;
  const dimText=isDark?"rgba(255,255,255,0.35)":C.muted;
  const mutedText=isDark?"rgba(255,255,255,0.55)":C.textSub;
  const rowBg=isDark?"rgba(255,255,255,0.02)":C.subtle;
  const rows=[
    {key:"members",  label:"Household members", free:"2",   prem:"Up to 5"},
    {key:"custom",   label:"Custom meals",      free:"—",   prem:"Yes"},
    {key:"library",  label:"Recipe library",    free:"150", prem:"300+"},
    {key:"scaling",  label:"Scalable recipes",  free:"—",   prem:"Yes"},
    {key:"grocery",  label:"Grocery lists",     free:"—",   prem:"Yes"},
  ];
  return(
    <>
      <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:70,background:"rgba(0,0,0,0.6)"}}/>
      <div style={{position:"fixed",left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:650,bottom:0,zIndex:71,
        background:bg,borderRadius:"24px 24px 0 0",padding:"28px 24px 44px",
        boxShadow:"0 -8px 40px rgba(0,0,0,0.6)"}}>
        <div style={{width:36,height:4,borderRadius:2,background:isDark?"rgba(255,255,255,0.15)":C.mutedBg,margin:"0 auto 24px"}}/>
        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:20}}>
          <span style={{fontFamily:"'Playfair Display',Georgia,serif",fontSize:26,fontWeight:700,
            letterSpacing:"-0.5px",color:isDark?"#fff":C.text}}>Fork</span><span
            style={{fontFamily:"'Playfair Display',Georgia,serif",fontSize:26,fontWeight:700,
              letterSpacing:"-0.5px",color:C.accent}}>night</span>
          <span style={{display:"block",fontSize:11,fontWeight:600,letterSpacing:"0.15em",
            textTransform:"uppercase",color:dimText,marginTop:2}}>Premium</span>
        </div>
        {/* Table — equal 3 columns */}
        <div style={{borderRadius:12,overflow:"hidden",border:isDark?`1px solid ${border}`:`1px solid ${C.border}`,marginBottom:24}}>
          {/* Header */}
          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr"}}>
            <div style={{padding:"9px 14px",background:"rgba(255,255,255,0.04)",
              borderBottom:isDark?`1px solid ${border}`:`1px solid ${C.border}`}}/>
            <div style={{padding:"9px 0",background:"rgba(255,255,255,0.04)",
              borderBottom:`1px solid ${border}`,borderLeft:`1px solid ${border}`,
              fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
              color:dimText,textAlign:"center"}}>
              Free
            </div>
            <div style={{padding:"9px 0",
              background:`linear-gradient(135deg,${C.accent}33,${C.accent}18)`,
              borderBottom:`1px solid ${border}`,borderLeft:`1px solid ${border}`,
              fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
              color:C.accent,textAlign:"center"}}>
              Premium
            </div>
          </div>
          {/* Rows */}
          {rows.map(({label,key,free,prem},ri)=>{
            const last=ri===rows.length-1;
            const rb=last?"none":`1px solid ${border}`;
            const hl=highlight&&key===highlight;
            const hlBg=hl?`${C.accent}${isDark?"28":"18"}`:"transparent";
            return(
              <div key={label} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",
                background:hlBg,
                boxShadow:hl?`inset 0 0 0 1.5px ${C.accent}66`:"none"}}>
                <div style={{padding:"10px 14px",borderBottom:rb,
                  fontSize:12,color:hl?C.accent:mutedText,fontWeight:hl?700:500}}>{label}</div>
                <div style={{padding:"10px 0",borderBottom:rb,
                  borderLeft:`1px solid ${border}`,
                  fontSize:13,color:isDark?dimText:C.muted,fontWeight:500,textAlign:"center"}}>{free}</div>
                <div style={{padding:"10px 0",borderBottom:rb,
                  borderLeft:`1px solid ${border}`,
                  background:hl?"transparent":`linear-gradient(135deg,${C.accent}11,transparent)`,
                  fontSize:13,color:isDark?"#fff":C.text,fontWeight:700,textAlign:"center"}}>{prem}</div>
              </div>
            );
          })}
        </div>
        {/* CTA */}
        <button onClick={()=>{/* TODO StoreKit */onClose();}}
          style={{width:"100%",padding:"15px",
            background:`linear-gradient(135deg,${C.accent},#E05020)`,
            border:"none",borderRadius:14,color:"#fff",fontSize:16,fontWeight:800,
            cursor:"pointer",letterSpacing:"-0.2px",
            boxShadow:`0 4px 24px ${C.accent}55`}}>
          Start free trial
        </button>
        <div style={{textAlign:"center",marginTop:10,color:isDark?"rgba(255,255,255,0.35)":C.muted,fontSize:11,letterSpacing:"0.02em"}}>$1 / month · Cancel anytime</div>
        <button onClick={onClose} style={{display:"block",margin:"14px auto 0",
          background:"none",border:"none",cursor:"pointer",color:isDark?"rgba(255,255,255,0.3)":C.muted,fontSize:12}}>
          Maybe later
        </button>
      </div>
    </>
  );
}

function MealSelector({currentMeal,onSelect,onClose,ratings={},usage={},favoriteProteins=null,householdSize=4,day=null,weekOffset=0,savedCustomMeals=[],onRemoveCustomMeal}){
  // Compute human-readable title
  const mealTitle=useMemo(()=>{
    if(!day)return "Pick a meal";
    // day is now an ISO date string e.g. "2025-05-14"
    const today=new Date(); today.setHours(0,0,0,0);
    const dayDate=new Date(day+'T00:00:00');
    const diffDays=Math.round((dayDate-today)/864e5);
    const label=dayLabel(day,true); // e.g. "Wednesday"
    if(diffDays===0) return "Pick a meal for Today";
    if(diffDays===1) return "Pick a meal for Tomorrow";
    if(diffDays===-1) return "Pick a meal for Yesterday";
    if(weekOffset===-1) return `Pick a meal for last ${label}`;
    if(weekOffset===1) return `Pick a meal for next ${label}`;
    return `Pick a meal for ${label}`;
  },[day,weekOffset]);
  const C=useC();

  // Debug: log when MealSelector mounts and if it encounters issues
  useEffect(()=>{
    console.log("[MealSelector] mounted, MEALS count:", MEALS.length, "savedCustomMeals:", savedCustomMeals.length, "baseList will be rotated:", rotated?.length);
    return ()=>console.log("[MealSelector] unmounted");
  },[]);
  const [filter,setFilter]=useState("all");
  const [customName,setCustomName]=useState("");
  const [customText,setCustomText]=useState("");
  const [customTime,setCustomTime]=useState("");
  const [customServings,setCustomServings]=useState("");
  const {isPremium,showPremiumUi,tier:userTier}=usePremium();
  const [showCustom,setShowCustom]=useState(false);
  const [showPaywall,setShowPaywall]=useState(false);
  const [search,setSearch]=useState("");
  const [expandedMealId,setExpandedMealId]=useState(null);
  const [animIn,setAnimIn]=useState(false);
  const [searchFocused,setSearchFocused]=useState(false);
  const isExpanded=searchFocused||showCustom; // full height when keyboard is up
  const searchRef=useRef();
  const sheetRef=useRef();

  // Trigger enter animation on mount
  useEffect(()=>{
    const t=requestAnimationFrame(()=>requestAnimationFrame(()=>setAnimIn(true)));
    return ()=>cancelAnimationFrame(t);
  },[]);

  // Animated close: slide out, then call onClose after transition
  const handleClose=()=>{
    setAnimIn(false);
    setTimeout(onClose,320);
  };

  // Backdrop tap
  const handleBackdrop=(e)=>{ if(e.target===e.currentTarget) handleClose(); };

  // Swipe-to-close
  const [chipsVisible,setChipsVisible]=useState(true);
  const lastScrollTop=useRef(0);
  const expandedCardRef=useRef(null);

  const isExpandedCardOnScreen=()=>{
    if(!expandedCardRef.current||!listRef.current)return false;
    const cardRect=expandedCardRef.current.getBoundingClientRect();
    const listRect=listRef.current.getBoundingClientRect();
    return cardRect.bottom>listRect.top&&cardRect.top<listRect.bottom;
  };

  const onListScroll=()=>{
    if(!listRef.current)return;
    const st=listRef.current.scrollTop;
    // Ignore negative scrollTop — iOS rubber-band bounce at top creates
    // a momentary negative value that spikes diff and collapses chips
    if(st<0) return;
    const diff=st-lastScrollTop.current;
    if(diff>8){
      setChipsVisible(false);
    } else if(diff<-8){
      if(!isExpandedCardOnScreen()) setChipsVisible(true);
    }
    lastScrollTop.current=st;
  };
  const listRef=useRef(null);
  const touchStart=useRef(null);
  const touchDidScroll=useRef(false);
  const onTouchStart=(e)=>{
    touchStart.current=e.touches[0].clientY;
    touchDidScroll.current=false;
  };
  const onTouchMove=(e)=>{
    e.preventDefault(); // prevent page scroll while dragging grabber
  };
  const onTouchEnd=(e)=>{
    if(touchStart.current===null) return;
    const delta=e.changedTouches[0].clientY-touchStart.current;
    const threshold=sheetRef.current?sheetRef.current.offsetHeight*0.2:80;
    if(delta>threshold) handleClose();
    touchStart.current=null;
  };

  const handleCustom=()=>{
    if(!customName.trim())return;
    handleSelect({
      id:`custom-${Date.now()}`,
      name:customName.trim(),
      isCustom:true,
      protein:"custom",
      time:null,
      servings:2,
      desc:"",
      rawText:"",
    });
  };

  const handleRandom=()=>{
    const pool=filter==="all"?MEALS:MEALS.filter(m=>m.protein===filter);
    const choices=pool.filter(m=>m.id!==currentMeal?.id);
    const pick=choices[Math.floor(Math.random()*choices.length)];
    if(pick) handleSelect(pick);
  };

  // When a meal is selected, animate close then call handler
  const handleSelect=(m)=>{
    try{navigator.vibrate&&navigator.vibrate(10);}catch{}
    setAnimIn(false);
    setTimeout(()=>onSelect(m),320);
  };

  const [sortBy,setSortBy]=useState("popularity");
  const [showSort,setShowSort]=useState(false);
  const [cuisine,setCuisine]=useState("all");
  const [showCuisine,setShowCuisine]=useState(false);
  const rotated=useMemo(()=>{
    const shuffled=seededShuffle(MEALS,getWeekSeed());
    if(!favoriteProteins||favoriteProteins.size===0) return shuffled;
    const preferred=shuffled.filter(m=>m&&m.protein&&favoriteProteins.has(m.protein));
    const rest=shuffled.filter(m=>!m||!m.protein||!favoriteProteins.has(m.protein));
    return [...preferred,...rest];
  },[favoriteProteins]);

  const CUISINE_OPTIONS=[
    {id:"all",       label:"All Cuisines"},
    {id:"american",  label:"American"},
    {id:"mexican",   label:"Mexican"},
    {id:"italian",   label:"Italian"},
    {id:"asian",     label:"Asian"},
    {id:"indian",    label:"Indian"},
    {id:"mediterranean", label:"Mediterranean"},
    {id:"french",    label:"French"},
    {id:"middleeastern", label:"Middle Eastern"},
  ];
  // Map each meal id to a cuisine
  const CUISINE_MAP={
    // American
    "Smash Burgers":"american","Beef Chili":"american","Philly Cheesesteak":"american",
    "Classic Meatloaf":"american","Beef Enchiladas":"american","French Dip Sandwiches":"american",
    "Beef Stroganoff":"american","BBQ Beef Brisket Sliders":"american","Beef Nachos":"american",
    "Chicken Parmesan":"american","Chicken Pot Pie":"american","Chicken Alfredo":"american",
    "Buffalo Chicken Wraps":"american","Chicken Fried Rice":"american","Chicken Quesadillas":"american",
    "Honey Butter Chicken Biscuits":"american","Chicken & Waffles":"american","Chicken & Waffle Stack":"american",
    "Southern Fried Chicken":"american","Hot Wings":"american","Chick-fill-yay Nuggets":"american",
    "Meatloaf & Roasted Veggies":"american","Cajun Shrimp Bowls":"american","Cajun Snow Crab Boil":"american",
    "Shrimp & Cauliflower Grits":"american","Shrimp Cobb Salad":"american","Red Beans & Rice with Sausage":"american",
    "BBQ Chicken Pizza":"american","Biscuits & Gravy":"american","Hash Brown Egg Bake":"american",
    "Pancake Dinner Board":"american","French Toast Casserole":"american","Smashed Potato Breakfast Skillet":"american",
    "Smoked Ribs":"american","Garlic Herb Roasted Chicken":"american","Garlic Butter Salmon":"american",
    "Black Bean Burgers":"american","Butternut Squash Soup":"american","White Bean and Kale Soup":"american",
    "Chicken Zoodle Soup":"american","Lentil Veggie Soup":"american","Three Bean Chili":"american",
    "Stuffed Bell Peppers":"american","Zuppa Toscana":"american","Breakfast Burritos":"american",
    "Pork Chops & Mushroom Gravy":"american","Sheet Pan Flank Steak":"american",
    "Reverse-Sear Ribeye & Sweet Potato":"american","Skillet Beef & Broccoli":"american",
    // Mexican/Latin
    "Taco Bowl":"mexican","Campechano Street Tacos":"mexican","Carne Asada Bowls":"mexican",
    "Carne Guisada":"mexican","Beef Fajita Bowls":"mexican","Birria-Style Beef Tacos":"mexican",
    "Huevos Rancheros":"mexican","Pork Carnitas Bowls":"mexican","Mexican Pork Pozole":"mexican",
    "Salmon Taco Bowls":"mexican","Shrimp Tacos":"mexican","Black Bean Tacos":"mexican",
    "Chicken Enchilada Bowl":"mexican","Chicken Fajita Bowls":"mexican","Plant-Based Taco Bowls":"mexican",
    "Pumpkin & Black Bean Enchiladas":"mexican","Portobello Mushroom Tacos":"mexican",
    "Sweet Potato Black Bean Burrito":"mexican","Tempeh Tacos":"mexican","Peruvian Lomo Saltado":"mexican",
    "Cuban Medianoche Sandwich":"mexican",
    // Italian
    "Chicken Parmesan":"italian","Chicken Piccata":"italian","Chicken Marsala & Risotto":"italian",
    "Lasagna with Salad":"italian","Homemade Pizza Night":"italian","Margherita Flatbread Pizza":"italian",
    "Caprese Gnocchi":"italian","Caprese Pesto Pasta":"italian","Lemon Ricotta Pasta":"italian",
    "Lentil Bolognese":"italian","Zucchini Noodle Bolognese":"italian","Eggplant Parmigiana":"italian",
    "Mushroom Risotto":"italian","Spinach Ricotta Stuffed Shells":"italian","Polenta Florentine":"italian",
    "Sausage & Pepper Skillet":"italian","Italian Herb Pork Tenderloin":"italian","Creamy Tuscan Chicken":"italian",
    // Asian
    "Korean Beef Bowl":"asian","Beef Bulgogi Bowls":"asian","Egg Roll in a Bowl":"asian",
    "Beef & Cabbage Stir Fry":"asian","Korean Spicy Pork Stir Fry":"asian","Chinese Char Siu Pork":"asian",
    "Taiwanese Braised Pork Rice":"asian","Vietnamese Caramelized Pork":"asian","Vietnamese Lemongrass Pork":"asian",
    "Filipino Pork Adobo":"asian","Pork & Veggie Stir Fry":"asian","Pork Ramen (Tonkotsu Style)":"asian",
    "Japanese Tonkatsu":"asian","Thai Larb Moo":"asian","Thai Basil Chicken":"asian",
    "Thai Green Curry (Veg)":"asian","Chicken Shawarma Bowls":"asian","Teriyaki Chicken Bowls":"asian",
    "Chicken Cauliflower Fried Rice":"asian","Egg Fried Rice":"asian","Cauliflower Fried Rice":"asian",
    "Teriyaki Salmon & Broccoli":"asian","Miso-Glazed Salmon":"asian","Coconut Lime Salmon Bowls":"asian",
    "Shrimp Stir Fry":"asian","Shrimp Lettuce Wraps":"asian","Tofu Stir-Fry with Bok Choy":"asian",
    "Vegetable Gyoza":"asian","Vegetarian Ramen":"asian","Veggie Sushi Bowls":"asian",
    "Veggie Banh Mi Bowls":"asian","Pulled Pork Banh Mi":"asian","Pad Thai with Tofu":"asian",
    "Korean Bibimbap (Veg)":"asian","Congee with Toppings":"asian","Japanese Miso Breakfast Bowl":"asian",
    "Coconut Curry Chicken":"asian","Coconut Shrimp Curry":"asian","Chicken 65":"indian",
    "Chicken Fried Rice":"asian",
    // Indian
    "Chana Masala":"indian","Chickpea Tikka Masala":"indian","Tofu Tikka Masala":"indian",
    "Red Lentil Dal":"indian","Saag Paneer":"indian","Paneer Butter Masala":"indian",
    "Chickpea and Sweet Potato Curry":"indian","Mujaddara":"indian",
    // Mediterranean / Greek
    "Blackened Chicken Greek Salad":"mediterranean","Chicken Souvlaki Bowls":"mediterranean",
    "Greek Pork Souvlaki Pita":"mediterranean","Falafel Bowls":"mediterranean",
    "Roasted Beet & Feta Salad":"mediterranean","Spanakopita Bake":"mediterranean",
    "Spanakopita Quesadillas":"mediterranean","Chickpea Stew with Feta":"mediterranean",
    "Roasted Cauliflower Steaks":"mediterranean","Lentil Bolognese":"mediterranean",
    // French
    "Croque Madame":"french","French Onion Soup":"french","Ham & Cheese Savory Crepes":"french",
    "Mushroom Bourguignon":"french","German Pork Schnitzel":"french",
    // Middle Eastern
    "Shakshuka":"middleeastern","Shakshuka Verde":"middleeastern","Turkish Menemen":"middleeastern",
    "Israeli Breakfast Spread":"middleeastern","Moroccan Spiced Pork":"middleeastern",
  };
  const SORT_OPTIONS=[
    {id:"popularity", label:"Popularity"},
    {id:"rating",    label:"My Rating"},
    {id:"calories_lo",label:"Calories: Low to High"},
    {id:"calories_hi",label:"Calories: High to Low"},
    {id:"time_lo",   label:"Prep Time: Shortest"},
    {id:"eaten_hi",  label:"Times Eaten: Most"},
    {id:"eaten_lo",  label:"Times Eaten: Least"},
    {id:"alpha",     label:"A → Z"},
  ];
  const [swipeRemoveId,setSwipeRemoveId]=useState(null); // meal id being swiped
  const [swipeRemoveDx,setSwipeRemoveDx]=useState(0);
  const [pendingRemoveId,setPendingRemoveId]=useState(null);
  const [suppressRemoveWarn,setSuppressRemoveWarn]=useState(()=>{try{return!!localStorage.getItem("fk_suppress_custom_remove_warn");}catch{return false;}});
  const hiddenKey=`forknight_hidden_meals_${householdSize}`; // use a stable key
  const [hiddenMealIds,setHiddenMealIds]=useState(()=>{
    try{const h=localStorage.getItem("forknight_hidden_meals");return h?new Set(JSON.parse(h)):new Set();}catch{return new Set();}
  });
  const hideMeal=(id)=>{
    setHiddenMealIds(prev=>{
      const next=new Set(prev);next.add(String(id));
      try{localStorage.setItem("forknight_hidden_meals",JSON.stringify([...next]));}catch{}
      return next;
    });
    setPendingRemoveId(null);
    setSwipeRemoveId(null);setSwipeRemoveDx(0);
  };
  const handleConfirmHide=(id)=>{
    hideMeal(id||pendingRemoveId);
  };

  const handleConfirmRemove=async(mealId)=>{
    const id=mealId||pendingRemoveId;
    if(!id)return;
    // Custom meals: delete from DB. Standard meals: just hide locally.
    const meal=visible.find(m=>String(m.id)===String(id));
    if(meal?.isCustom&&onRemoveCustomMeal){
      await onRemoveCustomMeal(id);
    }
    hideMeal(id);
  };

  // ── Filtering + search ──────────────────────────────────────────────────────
  const baseList=(filter==="all"?rotated:rotated.filter(m=>m.protein===filter))
    .filter(m=>!hiddenMealIds.has(String(m.id)))
    .filter(m=>cuisine==="all"||CUISINE_MAP[m.name]===cuisine);
  // Saved custom meals only appear in "all" filter or when search matches
  const customPool=savedCustomMeals.filter(c=>
    !hiddenMealIds.has(String(c.id))&&(
      !search.trim()
        ? filter==="all"
        : c.name.toLowerCase().includes(search.toLowerCase())
    )
  );
  const searched=[
    ...(search.trim()?baseList.filter(m=>m.name.toLowerCase().includes(search.toLowerCase())||m.desc?.toLowerCase().includes(search.toLowerCase())):baseList),
    ...customPool,
  ];
  const relevanceScore=(m)=>{
    try{
      const r=(ratings[m.id]||0)*3;
      const maxU=Math.max(1,...Object.values(usage).filter(v=>typeof v==='number'));
      const u=((usage[m.id]||0)/maxU)*2;
      const p=favoriteProteins&&favoriteProteins.size>0&&favoriteProteins.has(m.protein)?2:0;
      return r+u+p;
    }catch(e){console.warn("[relevanceScore] error:",e.message);return 0;}
  };
  let visible=searched;
  try{
    visible=[...searched].sort((a,b)=>{
      switch(sortBy){
        case "relevance":   return relevanceScore(b)-relevanceScore(a);
        case "popularity":  return relevanceScore(b)-relevanceScore(a);
        case "rating":      { const d=(ratings[b.id]||0)-(ratings[a.id]||0); return d!==0?d:(usage[b.id]||0)-(usage[a.id]||0); }
        case "calories_lo": {
          if(a.isCustom&&!b.isCustom)return 1;
          if(!a.isCustom&&b.isCustom)return -1;
          return (a.cal||999)-(b.cal||999);
        }
        case "calories_hi": {
          if(a.isCustom&&!b.isCustom)return 1;
          if(!a.isCustom&&b.isCustom)return -1;
          return (b.cal||0)-(a.cal||0);
        }
        case "time_lo": {
          if(a.isCustom&&!b.isCustom)return 1;
          if(!a.isCustom&&b.isCustom)return -1;
          return (a.time||999)-(b.time||999);
        }
        case "time_hi": {
          if(a.isCustom&&!b.isCustom)return 1;
          if(!a.isCustom&&b.isCustom)return -1;
          return (b.time||0)-(a.time||0);
        }
        case "eaten_hi":    return (usage[b.id]||0)-(usage[a.id]||0);
        case "eaten_lo":    return (usage[a.id]||0)-(usage[b.id]||0);
        case "alpha":       return a.name.localeCompare(b.name);
        default:            return 0;
      }
    });
  }catch(e){console.error("[MealSelector] sort error:",e.message);visible=searched;}

  // Transition config - 320ms cubic-bezier matching iOS spring feel
  const EASE="cubic-bezier(0.32, 0.72, 0, 1)";
  const DUR="320ms";

  return (
    <>
      {/* Backdrop - fades in/out */}
      <div
        onClick={handleBackdrop}
        style={{
          position:"fixed",inset:0,zIndex:60,
          background:C.overlay,
          opacity:animIn?1:0,
          transition:`opacity ${DUR} ease`,
        }}
      />

      {/* Sheet - fixed, centered, 650px max width */}
      <div
        ref={sheetRef}
        data-meal-picker-open="1"
        style={{
          position:"fixed",
          left:"50%",
          width:"100%",maxWidth:650,
          bottom:0,zIndex:61,
          background:C.card,borderRadius:"20px 20px 0 0",
          height:isExpanded?"100dvh":"88dvh",display:"flex",flexDirection:"column",
          boxShadow:"0 -6px 32px rgba(0,0,0,0.15)",
          transform:animIn?`translateX(-50%) translateY(0)`:`translateX(-50%) translateY(100%)`,
          transition:`transform ${DUR} ${EASE}, height 200ms ease`,
          willChange:"transform",
        }}
      >
        {/* Drag handle - touch here to swipe-dismiss */}
        <div
          onTouchStart={(e)=>{e.stopPropagation();onTouchStart(e);}}
          onTouchMove={(e)=>{e.stopPropagation();onTouchMove(e);}}
          onTouchEnd={(e)=>{e.stopPropagation();onTouchEnd(e);}}
          style={{display:"flex",justifyContent:"center",paddingTop:10,paddingBottom:16,
            flexShrink:0,cursor:"grab",touchAction:"none",userSelect:"none",
            WebkitUserSelect:"none"}}
        >
          <div style={{width:36,height:4,borderRadius:2,background:C.mutedBg}}/>
        </div>

        {/* Sticky header: title + close */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 18px 10px",flexShrink:0}}>
          <div style={{fontSize:17,fontWeight:800,color:C.text}}>{mealTitle}</div>
          <button onClick={handleClose} style={{display:"flex",alignItems:"center",justifyContent:"center",background:C.subtle,border:"none",borderRadius:"50%",width:36,height:36,cursor:"pointer",color:C.text}}>
            <X size={20} strokeWidth={2.5}/>
          </button>
        </div>

        {/* Sticky controls: search + custom + filter chips - with elevation */}
        <div style={{
          padding:"0 18px 0 18px",flexShrink:0,
          borderBottom:`1px solid ${C.border}`,
          boxShadow:"0 2px 8px rgba(0,0,0,0.08)",
          background:C.card,
          position:"relative",zIndex:10,
        }}>

          {/* Row */}
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 0 8px",minHeight:46}}>

            {/* === CUSTOM MODE === */}
            <div style={{
              display:"flex",gap:6,alignItems:"center",
              flex:showCustom?1:0,minWidth:0,
              overflow:"hidden",
              opacity:showCustom?1:0,
              transition:"flex 280ms cubic-bezier(0.32,0.72,0,1), opacity 200ms ease",
              pointerEvents:showCustom?"auto":"none",
            }}>
              <input
                autoFocus={showCustom}
                value={customName}
                onChange={e=>setCustomName(e.target.value.slice(0,50))}
                onKeyDown={e=>{if(e.key==="Enter"&&customName.trim())handleCustom();if(e.key==="Escape"){setShowCustom(false);setCustomName("");setCustomText("");setCustomTime("");setCustomServings("");}}}
                placeholder="Custom meal name..."
                maxLength={50}
                style={{flex:1,minWidth:0,padding:"10px 12px",borderRadius:12,border:`1.5px solid ${C.border}`,fontSize:16,outline:"none",background:C.card,color:C.text}}
              />
              <button onClick={handleCustom} disabled={!customName.trim()}
                style={{padding:"10px 14px",borderRadius:12,border:"none",background:customName.trim()?C.accent:C.mutedBg,color:customName.trim()?"#fff":C.muted,fontWeight:700,fontSize:13,cursor:customName.trim()?"pointer":"default",flexShrink:0,whiteSpace:"nowrap"}}>
                Add
              </button>
              <button onClick={()=>{setShowCustom(false);setCustomName("");setCustomText("");setCustomTime("");setCustomServings("");}} style={{display:"flex",alignItems:"center",justifyContent:"center",width:36,height:36,borderRadius:10,border:`1px solid ${C.border}`,background:"transparent",cursor:"pointer",flexShrink:0}}>
                <X size={14} strokeWidth={2} color={C.muted}/>
              </button>
            </div>

            {/* === SEARCH + IDLE MODE === */}
            <div style={{
              display:"flex",gap:8,alignItems:"center",
              flex:showCustom?0:1,minWidth:0,
              overflow:"hidden",
              opacity:showCustom?0:1,
              transition:"flex 280ms cubic-bezier(0.32,0.72,0,1), opacity 200ms ease",
              pointerEvents:showCustom?"none":"auto",
              marginLeft:-12,
            }}>
              {/* Search pill - marginLeft compensates for internal 12px padding so text aligns with content */}
              <div onClick={()=>searchRef.current?.focus()} style={{
                flex:1,display:"flex",alignItems:"center",gap:8,
                padding:"10px 12px",borderRadius:12,
                border:`1.5px solid ${searchFocused?C.accent:C.border}`,
                background:C.bg,
                transition:"border-color 200ms ease",
                minWidth:0,cursor:"text",
              }}>
                <Search size={15} strokeWidth={2} color={searchFocused?C.accent:C.muted}/>
                <input
                  ref={searchRef}
                  value={search}
                  onChange={e=>setSearch(e.target.value)}
                  onFocus={()=>setSearchFocused(true)}
                  onBlur={()=>setSearchFocused(false)}
                  onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();searchRef.current?.blur();setSearchFocused(false);}}}
                  placeholder="Search meals…" enterKeyHint="search"
                  style={{flex:1,minWidth:0,border:"none",outline:"none",fontSize:16,color:C.text,background:"transparent"}}
                />
                {search&&(
                  <button onClick={()=>{setSearch("");searchRef.current?.focus();}} style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",flexShrink:0}}>
                    <X size={13} strokeWidth={2} color={C.muted}/>
                  </button>
                )}
              </div>

              {/* Cancel / Custom button */}
              <div style={{flexShrink:0}}>
                {searchFocused||search?(
                  <button
                    onMouseDown={e=>e.preventDefault()}
                    onClick={()=>{setSearch("");setSearchFocused(false);searchRef.current?.blur();}}
                    style={{display:"flex",alignItems:"center",padding:"10px 4px",background:"transparent",border:"none",cursor:"pointer",fontSize:14,fontWeight:600,color:C.text,whiteSpace:"nowrap"}}
                  >Cancel</button>
                ):(
                  <button
                    onClick={()=>(!showPremiumUi||userTier!=='free')?setShowCustom(true):setShowPaywall(true)}
                    style={{display:"flex",alignItems:"center",gap:4,padding:"10px 12px",borderRadius:12,border:`1.5px dashed ${C.border}`,background:"transparent",fontSize:12,fontWeight:600,color:C.muted,cursor:"pointer",whiteSpace:"nowrap"}}
                  >
                    <Pencil size={13} strokeWidth={2}/> Custom
                  </button>
                )}
              </div>
            </div>

          </div>


          <div style={{
            overflow:"hidden",
            transition:"max-height 0.2s ease, opacity 0.15s ease",
            maxHeight:chipsVisible?"120px":"0px",
            opacity:chipsVisible?1:0,
            pointerEvents:chipsVisible?"auto":"none",
          }}>
          <ProteinFilter active={filter} onChange={f=>{setFilter(f);setSearch("");}} onRandom={handleRandom} sortBy={sortBy} setSortBy={setSortBy} showSort={showSort} setShowSort={setShowSort} SORT_OPTIONS={SORT_OPTIONS} cuisine={cuisine} setCuisine={setCuisine} showCuisine={showCuisine} setShowCuisine={setShowCuisine} CUISINE_OPTIONS={CUISINE_OPTIONS}/>
          </div>
        </div>

        {/* Scrollable meal list - tapping here cancels custom entry */}
        <div
          ref={listRef}
          onScroll={onListScroll}
          onTouchStart={(e)=>{ if(listRef.current) listRef.current._listStartY=e.touches[0].clientY; }}
          onTouchMove={(e)=>{
            const list=listRef.current;
            if(list&&list.scrollTop===0){
              const dy=e.touches[0].clientY-(list._listStartY||0);
              if(dy>0) e.preventDefault();
            }
          }}
          onClick={()=>{ if(showCustom){setShowCustom(false);setCustomName("");setCustomText("");setCustomTime("");setCustomServings("");} }}
          style={{overflowY:"auto",flex:1,padding:"10px 18px 24px",WebkitOverflowScrolling:"touch",overscrollBehavior:"contain",touchAction:"pan-y"}}
        >
          {visible.length===0&&(
            <div style={{textAlign:"center",color:C.muted,padding:"32px 0",fontSize:13}}>No meals match your search.</div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {visible.map(m=>{
              const {Icon}=PROTEIN_META[m.protein]||PROTEIN_META.all,sel=currentMeal?.id===m.id;
              const mRating=ratings[m.id]||0,useCount=usage[m.id]||0;
              const isEx=expandedMealId===m.id;
              const swipeDx=swipeRemoveId===m.id?swipeRemoveDx:0;
              const swipeHandlers={
                onTouchStart:e=>{
                  const t=e.touches[0];
                  e.currentTarget.__swipeStartX=t.clientX;
                  e.currentTarget.__swipeStartY=t.clientY;
                  e.currentTarget.__swipeActive=false;
                  setSwipeRemoveDx(0);
                },
                onTouchMove:e=>{
                  const t=e.touches[0];
                  const dx=t.clientX-(e.currentTarget.__swipeStartX||0);
                  const dy=Math.abs(t.clientY-(e.currentTarget.__swipeStartY||0));
                  // Only activate if clearly horizontal: dx < -20 AND horizontal angle > 2:1
                  if(dx<-20&&Math.abs(dx)>dy*2){
                    if(!e.currentTarget.__swipeActive){
                      e.currentTarget.__swipeActive=true;
                      setSwipeRemoveId(m.id);
                    }
                    e.stopPropagation();
                    const limited=dx>-80?dx:(-80-Math.sqrt(Math.abs(dx)-80)*3);
                    setSwipeRemoveDx(limited);
                  }
                },
                onTouchEnd:e=>{
                  const active=e.currentTarget.__swipeActive;
                  e.currentTarget.__swipeActive=false;
                  setSwipeRemoveId(null);setSwipeRemoveDx(0);
                  if(!active)return;
                  const dx=e.changedTouches[0].clientX-(e.currentTarget.__swipeStartX||0);
                  if(dx<-120){handleConfirmHide(m.id);}
                  else if(dx<-60){
                    if(suppressRemoveWarn){handleConfirmHide(m.id);}
                    else setPendingRemoveId(m.id);
                  }
                },
              };
              const innerCard=(
                <div ref={isEx?expandedCardRef:null} style={{borderRadius:12,border:`1.5px solid ${sel&&!isEx?C.text:C.border}`,background:sel&&!isEx?C.subtle:C.card,overflow:"hidden",transition:"border-color 0.1s ease,background 0.1s ease"}}>
                  {/* Collapsed row */}
                  <button onMouseDown={e=>e.preventDefault()}
                    className="fk-press"
                    onClick={(e)=>{
                      e.preventDefault();
                      const closing=isEx;
                      setExpandedMealId(isEx?null:m.id);
                      if(closing){
                        // Don't auto-reveal chips - user controls visibility via scroll
                      } else {
                        // Scroll the newly expanded card into view after React renders it
                        // Use requestAnimationFrame to let the DOM update first
                        requestAnimationFrame(()=>{
                          requestAnimationFrame(()=>{
                            if(expandedCardRef.current&&listRef.current){
                              const cardRect=expandedCardRef.current.getBoundingClientRect();
                              const listRect=listRef.current.getBoundingClientRect();
                              // If card top is above the list top, scroll to align it
                              if(cardRect.top<listRect.top+8){
                                listRef.current.scrollBy({top:cardRect.top-listRect.top-8,behavior:"smooth"});
                              }
                            }
                          });
                        });
                      }
                    }}
                    style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",cursor:"pointer",textAlign:"left",width:"100%",background:"transparent",border:"none",minHeight:56}}>
                    <span style={{color:C.muted,flexShrink:0}}><Icon size={20} strokeWidth={1.8}/></span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:14,fontWeight:700,color:C.text,lineHeight:1.3}}>{m.name}</span>
                        {mRating>0&&<span style={{fontSize:10,color:C.star,fontWeight:700}}>{mRating}★</span>}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.muted,marginTop:3,flexWrap:"wrap"}}>
                        <Clock size={10} strokeWidth={2}/> {m.time}m
                        <span>·</span>
                        <Users size={10} strokeWidth={2}/> {householdSize}
                        {m.cal&&<><span>·</span><span>{m.cal} cal</span></>}
                        {useCount>0&&<><span>·</span><span>used {useCount}×</span></>}
                      </div>
                    </div>
                    {/* Right side: X+Check when expanded, checkmark when selected */}
                    {isEx?(
                      <div style={{display:"flex",gap:16,flexShrink:0}} onClick={e=>e.stopPropagation()}>
                        <button onClick={()=>setExpandedMealId(null)}
                          style={{width:48,height:48,borderRadius:"50%",background:C.cancelBtn,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                          <X size={20} strokeWidth={2.5} color={C.textSub}/>
                        </button>
                        <button onClick={()=>{setExpandedMealId(null);handleSelect(m);}}
                          style={{width:48,height:48,borderRadius:"50%",background:C.accent,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                          <Check size={20} strokeWidth={2.5} color="#fff"/>
                        </button>
                      </div>
                    ):sel?<Check size={18} strokeWidth={2.5} color={C.green}/>:null}
                  </button>

                  {/* Expanded content - no bottom buttons */}
                  {isEx&&(
                    <div style={{padding:"0 14px 14px",borderTop:`1px solid ${C.border}`,animation:"expandCard 0.1s ease-out"}}>
                      {m.desc&&!m.isCustom&&<div style={{fontSize:13,color:C.textSub,lineHeight:1.5,marginTop:10,marginBottom:8}}>{m.desc}</div>}
                      {m.isCustom&&m.rawText&&(
                        <div style={{marginTop:10}}>
                          <div style={{fontSize:13,color:C.textSub,lineHeight:1.7,whiteSpace:"pre-wrap",background:C.subtle,borderRadius:10,padding:"10px 12px",border:`1px solid ${C.border}`,textAlign:"left"}}>
                            {m.rawText}
                          </div>
                        </div>
                      )}
                      {!m.isCustom&&m.ingredients&&(
                        <>
                          <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6}}>Ingredients</div>
                          <ul style={{margin:0,paddingLeft:18,display:"flex",flexDirection:"column",gap:3}}>
                            {scaleIngredients(m.ingredients,m.servings?householdSize/m.servings:1).map((ing,i)=><li key={i} style={{fontSize:13,color:C.text,lineHeight:1.4}}>{ing}</li>)}
                          </ul>
                        </>
                      )}
                      {!m.isCustom&&m.recipe&&(
                        <>
                          <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6,marginTop:10}}>Steps</div>
                          <ol style={{margin:0,paddingLeft:0,listStyle:"none",display:"flex",flexDirection:"column",gap:4}}>
                            {m.recipe.map((step,i)=>(
                              <li key={i} style={{display:"flex",gap:8,fontSize:12,color:C.textSub,lineHeight:1.5}}>
                                <span style={{fontWeight:700,color:C.accent,minWidth:14,flexShrink:0}}>{i+1}.</span>{step}
                              </li>
                            ))}
                          </ol>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
              // Compute red reveal opacity: 0 at 0px, full at 80px
              const revealOpacity=Math.min(1,Math.abs(swipeDx)/80);
              return(
                <div key={m.id} style={{position:"relative",overflow:"hidden",borderRadius:12,background:C.card}}>
                  {/* Red reveal - only visible as card slides */}
                  {swipeDx<0&&<div style={{position:"absolute",left:0,right:0,top:0,bottom:0,background:`rgba(224,80,80,${revealOpacity})`,display:"flex",alignItems:"center",justifyContent:"flex-end",paddingRight:20,zIndex:0,transition:"none",borderRadius:12}}>
                    <span style={{fontSize:11,fontWeight:700,color:"#fff",opacity:revealOpacity}}>Hide</span>
                  </div>}
                  <div {...swipeHandlers} style={{transform:swipeDx?`translateX(${swipeDx}px)`:"none",transition:swipeRemoveId===m.id?"none":"transform 0.25s ease",position:"relative",zIndex:1}}>
                    {innerCard}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Swipe-to-remove confirm dialog for custom meals */}
          {pendingRemoveId&&(
            <div style={{position:"fixed",inset:0,zIndex:200,background:C.overlay,display:"flex",alignItems:"center",justifyContent:"center",padding:24}} onClick={()=>setPendingRemoveId(null)}>
              <div style={{background:C.card,borderRadius:20,padding:"24px 20px",maxWidth:300,width:"100%",textAlign:"center"}} onClick={e=>e.stopPropagation()}>
                <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:8}}>Hide this meal?</div>
                <div style={{fontSize:13,color:C.muted,lineHeight:1.6,marginBottom:20}}>It won't appear in your meal picker. Your current meal plan is unaffected. You can manage hidden meals in settings.</div>
                <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:C.muted,marginBottom:16,cursor:"pointer",justifyContent:"center"}}>
                  <input type="checkbox" checked={suppressRemoveWarn} onChange={e=>{setSuppressRemoveWarn(e.target.checked);try{e.target.checked?localStorage.setItem("fk_suppress_custom_remove_warn","1"):localStorage.removeItem("fk_suppress_custom_remove_warn");}catch{}}}/>
                  Don't show this again
                </label>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={()=>setPendingRemoveId(null)} style={{flex:1,padding:"11px",borderRadius:10,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,fontSize:13,cursor:"pointer"}}>Cancel</button>
                  <button onClick={()=>handleConfirmHide(pendingRemoveId)} style={{flex:1,padding:"11px",borderRadius:10,border:"none",background:"#E05050",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Hide</button>
                </div>
              </div>
            </div>
          )}
        </div>{/* end scrollable list */}
      {showPaywall&&<PaywallSheet onClose={()=>setShowPaywall(false)} highlight="custom"/>}
      </div>{/* end sheet */}
    </>
  );
}

// ── Password system ───────────────────────────────────────────────────────────
function simpleHash(str){
  let h=5381;
  for(let i=0;i<str.length;i++) h=((h<<5)+h)^str.charCodeAt(i);
  return (h>>>0).toString(36);
}
const CORRECT_HASH=simpleHash("1887");
const DEMO_HASH=simpleHash("1111");
const DEMO_ROW_ID="demo-week"; // separate Supabase row for demo users

const DAY_COOK_DEMO={
  Sunday:"Chef 2", Monday:"Chef 2", Tuesday:"Chef 2",
  Wednesday:"Chef 2", Thursday:"Chef 1", Friday:"Chef 1", Saturday:"Chef 2",
};

// Preview-safe storage - sessionStorage throws in sandboxed iframes
const safeSession={
  get:(k)=>{try{return sessionStorage.getItem(k);}catch{return null;}},
  set:(k,v)=>{try{sessionStorage.setItem(k,v);}catch{}},
};

function getUnlockedMode(){
  try{
    const stored=safeSession.get("dp_auth");
    if(stored===CORRECT_HASH) return "real";
    if(stored===DEMO_HASH) return "demo";
    const h=window.location.hash;
    const hp=new URLSearchParams(h.includes("?")?h.slice(h.indexOf("?")+1):"");
    const sp=new URLSearchParams(window.location.search);
    const auth=hp.get("auth")||sp.get("auth");
    if(auth===CORRECT_HASH) return "real";
    if(auth===DEMO_HASH) return "demo";
  }catch{}
  return null;
}

function LockScreen({onUnlock}){
  const C=useC();
  const [digits,setDigits]=useState(["","","",""]);
  const [err,setErr]=useState(false);
  const [shake,setShake]=useState(false);
  const hiddenRef=useRef();

  // Single hidden input captures all typing
  useEffect(()=>{
    const t=setTimeout(()=>hiddenRef.current?.focus(),80);
    return ()=>clearTimeout(t);
  },[]);

  const attempt=(code)=>{
    const hash=simpleHash(code);
    if(hash===CORRECT_HASH){
      safeSession.set("dp_auth",CORRECT_HASH);
      onUnlock("real");
    } else if(hash===DEMO_HASH){
      safeSession.set("dp_auth",DEMO_HASH);
      onUnlock("demo");
    } else {
      setErr(true);setShake(true);
      setDigits(["","","",""]);
      if(hiddenRef.current){ hiddenRef.current.value=""; hiddenRef.current.focus(); }
      setTimeout(()=>setShake(false),500);
      setTimeout(()=>setErr(false),2000);
    }
  };

  const handleChange=(e)=>{
    const raw=e.target.value.replace(/\D/g,"").slice(0,4);
    const next=["","","",""];
    for(let i=0;i<raw.length;i++) next[i]=raw[i];
    setDigits(next);
    if(raw.length===4) setTimeout(()=>attempt(raw),80);
    // keep value in sync
    e.target.value=raw;
  };

  const handleKey=(e)=>{
    if(e.key==="Backspace"){
      const filled=digits.filter(Boolean).length;
      if(filled>0){
        const next=[...digits];next[filled-1]="";setDigits(next);
      }
    }
  };

  return (
    <div onClick={()=>hiddenRef.current?.focus()} style={{fontFamily:"system-ui,sans-serif",background:C.bg,height:"100dvh",maxWidth:480,margin:"0 auto",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",paddingTop:"15vh",boxSizing:"border-box"}}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&display=swap" rel="stylesheet"/>
<div style={{fontFamily:"'Playfair Display', Georgia, serif",fontSize:36,fontWeight:600,color:C.text,marginBottom:6,letterSpacing:"-0.5px"}}><span style={{letterSpacing:"-0.05em"}}>F</span>orknight<sup style={{fontSize:"0.2em",fontWeight:400,verticalAlign:"super",letterSpacing:0,position:"relative",top:"-6px"}}>®</sup></div>
      <div style={{fontSize:13,color:C.muted,marginBottom:32,textAlign:"center"}}>Enter your 4-digit passcode</div>

      {/* Hidden input fixed in upper portion - keyboard opens below it */}
      <input
        ref={hiddenRef}
        type="number"
        inputMode="numeric"
        pattern="[0-9]*"
        onChange={handleChange}
        onKeyDown={handleKey}
        style={{position:"fixed",opacity:0,pointerEvents:"none",width:1,height:1,top:"30%",left:"50%"}}
      />

      {/* Visual digit boxes */}
      <style>{`
        @keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        .pin-cursor{display:inline-block;width:2px;height:32px;background:#FF6B35;border-radius:1px;animation:blink 1s ease infinite;vertical-align:middle;}
      `}</style>
      <div style={{display:"flex",gap:14,animation:shake?"shake 0.4s ease":"none"}} onClick={()=>hiddenRef.current?.focus()}>
        {digits.map((d,i)=>{
          const filled=digits.filter(Boolean).length;
          const isActive=i===filled&&!err; // cursor sits on the next empty box
          return (
          <div key={i} style={{
            width:60,height:72,borderRadius:16,
            border:`2px solid ${err?"#E05050":isActive?C.accent:d?"#1A1A1A":"#E2E2DC"}`,
            background:err?"#FFF5F5":"#fff",
            display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:36,color:C.text,
            transition:"border-color 0.15s",
            boxShadow:isActive?`0 0 0 3px ${C.accent}22`:d&&!err?"0 0 0 3px #1A1A1A12":"none",
          }}>
            {d ? "●" : isActive ? <span className="pin-cursor"/> : ""}
          </div>
          );
        })}
      </div>
      {err&&<div style={{marginTop:20,fontSize:13,color:"#E05050",fontWeight:600}}>Incorrect passcode - try again</div>}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function MealPlanner({householdId=null, demo=false, inviteCode="", onSignOut=null, householdMembers=[], currentUserId=null, isPremium=true, showPremiumUi=false, subscriptionTier="free"}){
  const [themePref,setThemePref]=useState(()=>{ try{return localStorage.getItem(THEME_KEY)||"system";}catch{return "system";} });
  const [effectiveTheme,setEffectiveTheme]=useState(()=>getEffectiveTheme(themePref));
  useEffect(()=>{
    setEffectiveTheme(getEffectiveTheme(themePref));
    if(themePref==="system"){
      const mq=window.matchMedia?.("(prefers-color-scheme: dark)");
      if(!mq)return;
      const h=()=>setEffectiveTheme(getSystemTheme());
      mq.addEventListener("change",h);
      return ()=>mq.removeEventListener("change",h);
    }
  },[themePref]);
  const setTheme=(v)=>{ try{localStorage.setItem(THEME_KEY,v);}catch{} setThemePref(v); };
  const themeC=THEMES[effectiveTheme]||THEMES.light;
  return (
    <ThemeCtx.Provider value={themeC}>
      <PremiumCtx.Provider value={{isPremium,showPremiumUi,tier:subscriptionTier}}>
      <div style={{background:themeC.bg,minHeight:"100dvh"}}>
        <PlannerApp demo={demo} householdId={demo?null:householdId} inviteCode={inviteCode} onSignOut={onSignOut} householdMembers={householdMembers} currentUserId={currentUserId} themePref={themePref} setTheme={setTheme} effectiveTheme={effectiveTheme}/>
      </div>
      </PremiumCtx.Provider>
    </ThemeCtx.Provider>
  );
}

function PlannerApp({demo=false, householdId=null, inviteCode="", onSignOut=null, householdMembers=[], currentUserId=null, themePref, setTheme, effectiveTheme}){
  const C=useC();
  const {isPremium:plannerIsPremium,showPremiumUi:plannerShowPremiumUi,tier:plannerTier}=usePremium();
  const cookMap=demo?DAY_COOK_DEMO:DAY_COOK;

  // Dynamic member names - use actual profile data, fall back to generic "Chef N" labels
  const memberNames=demo
    ?["Chef 1","Chef 2"]
    :householdMembers.length>0
      ?householdMembers.map((m,i)=>m.display_name||`Chef ${i+1}`)
      :["Chef 1"];

  // Default cook schedule: distribute evenly across members.
  // Sort by userId for stable ordering , householdMembers array order from DB can vary.
  const defaultCookDays=useMemo(()=>{
    if(demo) return DAY_COOK_DEMO;
    // Default: first member cooks all days until user configures in settings.
    // This avoids any computed split that might assign the wrong person.
    const name=memberNames[0]||null;
    return Object.fromEntries(DAYS.map(d=>[d,name]));
  },[memberNames[0]]); // eslint-disable-line

  // cookAssignment: DEFAULT day -> member name, stored in localStorage per household
  // Used by HouseholdSettings to set the standing schedule
  const COOK_KEY=`forknight_cooks_${householdId||"demo"}`;
  const [cookAssignment,setCookAssignment]=useState(()=>{
    try{
      const stored=JSON.parse(localStorage.getItem(COOK_KEY)||"null");
      if(!stored) return {};
      // Filter out any entries with names not in the current member list.
      // Keep entries that are valid , don't wipe the whole schedule.
      const valid=new Set(memberNames);
      const cleaned={};
      let anyValid=false;
      Object.entries(stored).forEach(([dow,name])=>{
        if(valid.has(name)){ cleaned[dow]=name; anyValid=true; }
      });
      // If nothing survived filtering, return empty (getCook falls back to default)
      return anyValid?cleaned:{};
    }catch{ return {}; }
  });

  // Per-week cook overrides - keyed by weekOffset, NOT persisted
  // Day card chips write here; HouseholdSettings writes to cookAssignment (defaults)
  const [weekCookOverrides,setWeekCookOverrides]=useState({});

  const getCook=(day)=>{
    const weekOverrides=weekCookOverrides[weekOffset]||{};
    const dow=dayOfWeek(day);
    return weekOverrides[day]||cookAssignment[dow]||defaultCookDays[dow]||memberNames[0]||null;
  };

  // Called from day card chip tap - only overrides current week
  const toggleCook=(day)=>{
    const current=getCook(day);
    const idx=memberNames.indexOf(current);
    const next=memberNames[(idx+1)%memberNames.length];
    setWeekCookOverrides(prev=>{
      const weekOverrides={...(prev[weekOffset]||{}),[day]:next};
      return {...prev,[weekOffset]:weekOverrides};
    });
    // Persist per-date override to cook-schedule row so it survives refresh
    if(householdId){
      const csId=`${householdId}:cook-schedule`;
      supabase.from("plans").select("data").eq("id",csId).maybeSingle()
        .then(({data:existing})=>{
          const merged={...(existing?.data?JSON.parse(existing.data):{}),[day]:next};
          return supabase.from("plans").upsert({id:csId,household_id:householdId,
            data:JSON.stringify(merged),updated_at:new Date().toISOString()});
        }).catch(()=>{});
    }
  };

  // Called from HouseholdSettings - updates the standing default schedule
  const setCookDay=(day,name)=>{
    const next={...cookAssignment,[day]:name};
    setCookAssignment(next);
    try{localStorage.setItem(COOK_KEY,JSON.stringify(next));}catch{}
    if(householdId){supabase.from("plans").upsert({id:`${householdId}:cook-schedule`,household_id:householdId,data:JSON.stringify(next)}).then(({error})=>{if(error)console.error("[cook]",error.message);}).catch(()=>{});}
  };
  useEffect(()=>{if(!householdId||demo)return;supabase.from("plans").select("data").eq("id",`${householdId}:cook-schedule`).maybeSingle().then(({data})=>{if(!data?.data)return;try{const s=JSON.parse(data.data);if(!s||!Object.keys(s).length)return;const v=new Set(memberNames);// Split into dow-keyed (standing schedule) and date-keyed (per-day overrides)
          const dowKeys={},dateKeys={};
          Object.entries(s).forEach(([k,val])=>{
            if(/^\d{4}-\d{2}-\d{2}$/.test(k)) dateKeys[k]=val;
            else dowKeys[k]=val;
          });
          if(Object.keys(dowKeys).length>0&&Object.values(dowKeys).every(n=>v.has(n))){
            setCookAssignment(dowKeys);
            try{localStorage.setItem(COOK_KEY,JSON.stringify(dowKeys));}catch{}}
          // Group date-keyed overrides by weekOffset for weekCookOverrides
          if(Object.keys(dateKeys).length>0){
            const byWeek={};
            Object.entries(dateKeys).forEach(([date,name])=>{
              // Find which weekOffset this date falls into (check -1,0,1,2)
              for(let wo=-1;wo<=2;wo++){
                if(getWindowDates(wo).includes(date)){if(!byWeek[wo])byWeek[wo]={};byWeek[wo][date]=name;break;}
              }
            });
            if(Object.keys(byWeek).length>0) setWeekCookOverrides(prev=>({...prev,...byWeek}));
          }}catch{}}).catch(()=>{});},[householdId]);

  // Cook color: cycle through aaron/alona colors by member index
  const COOK_COLORS=[C.aaron,"#7A5FA8",C.alona,"#4A7A6A"];
  const getCookColor=(name)=>{
    const idx=memberNames.indexOf(name);
    return COOK_COLORS[idx>=0?idx:0];
  };
  // Plan row key: household-scoped for real users, demo prefix for demo mode
  const planRowPrefix=demo?"demo":(householdId||"anon");

  const [weekOffset,setWeekOffset]=useState(()=>{
    try{ return parseInt(sessionStorage.getItem("forknight_week")||"0"); }catch{ return 0; }
  });
  const setWeekOffsetPersist=(v)=>{
    setWeekOffset(v);
    setRecipeDay(null); // collapse open recipes when switching weeks
    try{ sessionStorage.setItem("forknight_week",String(v)); }catch{}
  };
  // NOTE (2026-09-06): intentionally NOT personalized by favorite-protein prefs.
  // This `rotated` feeds generateDefaultPlan() for days nobody has explicitly chosen
  // yet, and its output gets auto-saved to the shared household `plans` row. It must
  // be identical for every household member and every session, or different people
  // (or a fresh session with no localStorage) silently write different "default"
  // meals into the same shared day. Personalized favorite-protein reordering still
  // applies in MealSelector's own `rotated` (search UI) above, which is fine since
  // that's only ever used for an explicit, deliberate user pick.
  const rotated=useMemo(()=>{
    return seededShuffle(MEALS,getWeekSeed(weekOffset));
  },[weekOffset]);
  const windowDates=useMemo(()=>getWindowDates(weekOffset),[weekOffset]);

  // Per-week plan storage: weekOffset -> plan
  const [weekPlans,setWeekPlans]=useState(()=>{
    const encoded=getEncodedFromURL();
    const seed0=seededShuffle(MEALS,getWeekSeed(0));
    const base={0:generateDefaultPlan(seed0,getWindowDates(0))};
    if(encoded){const p=decodePlan(encoded);if(p) base[0]=p;}
    return base;
  });
  const [loadedFromURL]=useState(()=>!!getEncodedFromURL());
  const [fetchedEmpty,setFetchedEmpty]=useState(()=>new Set());

  // Get or lazily generate plan for current week offset
  const plan=useMemo(()=>{
    const p=weekPlans[weekOffset];
    if(p&&typeof p==='object'&&Object.keys(p).length>0) return p;
    return generateDefaultPlan(rotated,windowDates);
  },[weekOffset,weekPlans,rotated]);

  const setPlan=(newPlan)=>{
    setWeekPlans(prev=>({...prev,[weekOffset]:newPlan}));
  };
  const [syncStatus,setSyncStatus]=useState(
    householdId?"loading":"local"
  ); // "loading" | "saved" | "saving" | "local" | "error"
  const saveTimer=useRef(null);
  const [expandedDay,setExpandedDay]=useState(null);
  const [loadingDays,setLoadingDays]=useState(new Set());
  const [leftoverBursts,setLeftoverBursts]=useState({});
  const [eatOutBursts,setEatOutBursts]=useState({});
  const [dragDay,setDragDay]=useState(null);
  const dragDayRef=useRef(null);  // ref mirror so pointer handlers see current value
  const [dragOver,setDragOver]=useState(null);
  const longPressTimer=useRef(null);
  const dragOriginPlan=useRef(null);
  const [recipeDay,setRecipeDay]=useState(null);
  const [showGrocery,setShowGrocery]=useState(false);
  const [showPaywallPlanner,setShowPaywallPlanner]=useState(false);
  const [paywallHighlight,setPaywallHighlight]=useState(null);
  const [swipeOffset,setSwipeOffset]=useState(0);
  const [stickyWeek,setStickyWeek]=useState(false);
  const [customEditingDay,setCustomEditingDay]=useState(null); // tracks which day's custom recipe is in edit mode
  // ── One-time migration: all plan rows → rolling ISO-date-keyed seeds ───────────
  // Reads every plan row for this household and rewrites with:
  //   - ISO date string keys instead of day-name keys
  //   - New rolling seed (daysSinceEpoch) instead of legacy seed


  // Custom meals saved to DB by this household
  const [savedCustomMeals,setSavedCustomMeals]=useState([]);
  useEffect(()=>{
    if(!householdId)return;
    supabase.from("custom_meals").select("*").eq("household_id",householdId).order("created_at",{ascending:false})
      .then(({data})=>{
        if(data)setSavedCustomMeals(data.map(r=>({
          id:r.id,name:r.name,rawText:r.raw_text,isCustom:true,
          protein:"custom",time:null,servings:null,cal:null,desc:"",
        })));
      }).catch(()=>{});
  },[householdId]);
  const handleRemoveCustomMeal=async(mealId)=>{
    const isDbId=mealId&&!String(mealId).startsWith("custom-");
    if(isDbId)await supabase.from("custom_meals").delete().eq("id",mealId);
    setSavedCustomMeals(prev=>prev.filter(m=>m.id!==mealId));
  };
  const refreshCustomMeals=async()=>{
    if(!householdId)return;
    const{data}=await supabase.from("custom_meals").select("*").eq("household_id",householdId).order("created_at",{ascending:false});
    if(data)setSavedCustomMeals(data.map(r=>({id:r.id,name:r.name,rawText:r.raw_text,isCustom:true,protein:"custom",time:null,servings:null,cal:null,desc:""})));
  };
  const [showOffline,setShowOffline]=useState(false);
  useEffect(()=>{
    const onScroll=()=>setStickyWeek(window.scrollY>80);
    window.addEventListener("scroll",onScroll,{passive:true});
    return()=>window.removeEventListener("scroll",onScroll);
  },[]);

  // Midnight rollover: re-fetch the plan when the date changes so "today" always
  // lands at slot 0 and yesterday rolls off correctly into the previous week.
  useEffect(()=>{
    let timeoutId;
    const scheduleRollover=()=>{
      const now=new Date();
      const msUntilMidnight=
        new Date(now.getFullYear(),now.getMonth(),now.getDate()+1,0,0,0,0)-now+500;
      timeoutId=setTimeout(()=>{
        // Clear fetched state so all weeks re-fetch with the new "today" as anchor
        setWeekPlans({});
        setFetchedEmpty(new Set());
        scheduleRollover(); // re-arm for the next midnight
      },msUntilMidnight);
    };
    scheduleRollover();
    return()=>clearTimeout(timeoutId);
  },[]);
  const [showShareSheet,setShowShareSheet]=useState(false);
  const [shareMsg,setShareMsg]=useState("");
  const [showProfileMenu,setShowProfileMenu]=useState(false);
  const [editingName,setEditingName]=useState(false);
  const [editNameVal,setEditNameVal]=useState("");
  const [confirmSignOut,setConfirmSignOut]=useState(false);
  const [showHouseholdSettings,setShowHouseholdSettings]=useState(false);
  const [showFeedback,setShowFeedback]=useState(false);
  const [feedbackType,setFeedbackType]=useState("Problem with the app");
  const [feedbackText,setFeedbackText]=useState("");
  const [feedbackSent,setFeedbackSent]=useState(false);
  const [feedbackSending,setFeedbackSending]=useState(false);
  const [showAppearanceSheet,setShowAppearanceSheet]=useState(false);
  const [householdSize,setHouseholdSize]=useState(()=>{
    try{ return parseInt(localStorage.getItem(`forknight_hsize_${householdId||"demo"}`)||String(householdMembers.length||2)); }
    catch{ return 2; }
  });
  const [ratings,setRatings]=useState(()=>loadRatings());
  const [usage,setUsage]=useState(()=>loadUsage(householdId));
  useEffect(()=>{if(!currentUserId||demo)return;supabase.from("meal_ratings").select("meal_id,stars").eq("user_id",currentUserId).then(({data})=>{if(!data?.length)return;const p={};data.forEach(({meal_id,stars})=>{p[Number(meal_id)]=Number(stars);});saveRatings(p);setRatings(p);}).catch(()=>{});},[currentUserId]);
  const [communityRatings,setCommunityRatings]=useState(()=>loadRatings());
  useEffect(()=>{if(demo)return;supabase.from("meal_ratings").select("meal_id,stars").then(({data,error})=>{if(error||!data?.length)return;const t={},c={};data.forEach(({meal_id,stars})=>{const k=Number(meal_id);t[k]=(t[k]||0)+Number(stars);c[k]=(c[k]||0)+1;});const avg={};Object.keys(t).forEach(id=>{avg[Number(id)]=+(t[id]/c[id]).toFixed(1);});setCommunityRatings(avg);}).catch(()=>{});},[]);
  const favProteins=useMemo(()=>{
    try{const p=localStorage.getItem(`forknight_fav_proteins_${currentUserId||householdId||"local"}`);return p?new Set(JSON.parse(p)):null;}
    catch{return null;}
  },[householdId]);

  const handleSetRating=(mealId,stars)=>{
    const next=setRating(mealId,stars);
    setRatings({...next});
    if(householdId&&currentUserId){
      if(stars>0){
        supabase.from("meal_ratings").upsert(
          {meal_id:mealId,user_id:currentUserId,household_id:householdId,stars},
          {onConflict:"meal_id,user_id"}
        ).then(({error})=>{if(error)console.error("[meal_ratings] upsert error:",error.message);else console.log("[meal_ratings] saved",mealId,"★",stars);}).catch(e=>console.error("[meal_ratings]",e.message));
      } else {
        supabase.from("meal_ratings").delete()
          .eq("meal_id",mealId).eq("user_id",currentUserId)
          .then(({error})=>{if(error)console.error("[meal_ratings] delete error:",error.message);}).catch(()=>{});
      }
    }
  };

  const handleUpdateMealText=(day,updatedMeal)=>{
    setWeekPlans(prev=>{
      const cur=prev[weekOffset]||plan;
      const next={...cur,[day]:{...cur[day],meal:updatedMeal}};
      scheduleSave(next);
      return{...prev,[weekOffset]:next};
    });
  };
  const handleRecordUsage=(mealId)=>{
    recordUsage(mealId,householdId);
    setUsage(loadUsage(householdId));
  };
  // Per-day cook overrides - tap the chip to cycle Aaron ↔ Alona
  // On mount or week change: fetch plan for this week from Supabase
  useEffect(()=>{
    if(!householdId&&!demo){setSyncStatus("local");return;}
    // If we already have this week's plan in memory, don't show loading
    const alreadyLoaded=!!weekPlans[weekOffset];
    if(!alreadyLoaded) setSyncStatus("loading");
    // The rolling 7-day window always spans TWO Monday-anchored DB rows.
    // Fetch both primary seed and next-calendar-week seed so every visible day loads.
    const seed0=getWeekSeed(weekOffset);
    const seed1=getWeekSeed(weekOffset+1);
    const rowId =demo?`demo-${seed0}`:`${householdId}:week-${seed0}`;
    const rowId1=demo?`demo-${seed1}`:`${householdId}:week-${seed1}`;
    let cancelled=false;
    const fetchBoth=Promise.all([
      supabase.from("plans").select("data").eq("id",rowId).maybeSingle(),
      supabase.from("plans").select("data").eq("id",rowId1).maybeSingle(),
    ]);
    const timeoutP=new Promise(r=>setTimeout(()=>r([{data:null,error:{message:"Fetch timeout"}},{data:null}]),6000));
    Promise.race([fetchBoth,timeoutP]).then(([res0,res1])=>{
        if(cancelled)return;
        const error=res0?.error;
        const hasAny=!!(res0?.data?.data||res1?.data?.data);
        console.log(`[plans] fetch weekOffset=${weekOffset} rowId=${rowId}`,
          {hasData:!!res0?.data?.data, hasData1:!!res1?.data?.data, error:error?.message, alreadyLoaded, fetchedEmpty: [...fetchedEmpty]});
        if(error) console.error("[plans] fetch error:",error.message);
        if(hasAny&&!loadedFromURL){
          // Merge both rows — primary first, secondary fills in any missing dates
          const dbPlan={};
          if(res1?.data?.data) Object.assign(dbPlan,JSON.parse(res1.data.data));
          if(res0?.data?.data) Object.assign(dbPlan,JSON.parse(res0.data.data)); // primary wins on conflict
          const dates=getWindowDates(weekOffset);
          const defaultPlan=generateDefaultPlan(rotated,dates);
          const rehydrated={};
          dates.forEach(day=>{
            const d=dbPlan[day];
            if(!d){rehydrated[day]=defaultPlan[day];return;}
            let meal;
            if(d.isCustom){meal={id:d.id||`custom-${day}`,name:d.name,isCustom:true,protein:"custom",time:null,servings:2,desc:"",rawText:d.rawText||""};}
            else{meal=MEALS.find(m=>m.id===d.mealId)||rotated[0];}
            rehydrated[day]={meal,isLeftover:!!d.isLeftover,isDoubled:!!d.isDoubled,isEatOut:!!d.isEatOut,_fromDB:true,_manual:!!d.manual};
          });
          setWeekPlans(prev=>{
            const existing=prev[weekOffset]||{};
            const merged={...rehydrated};
            dates.forEach(day=>{ if(existing[day]?._carried&&!merged[day]?._fromDB) merged[day]=existing[day]; });
            return {...prev,[weekOffset]:merged};
          });
          setFetchedEmpty(prev=>{const n=new Set(prev);n.delete(weekOffset);return n;});
          // Auto-save unpersisted days, but ONLY today or past — never future dates.
          // Writing defaults for future dates would overwrite real plans when the week arrives.
          const todayStr=new Date().toISOString().slice(0,10);
          const autoSaveBySeed={};
          dates.forEach(day=>{
            if(rehydrated[day]?._fromDB) return;
            if(day>todayStr) return;
            const daySeed=getWeekSeedForDate(day);
            if(!autoSaveBySeed[daySeed]) autoSaveBySeed[daySeed]={};
            const d=rehydrated[day];
            autoSaveBySeed[daySeed][day]={mealId:d.meal?.isCustom?null:d.meal?.id,
              isCustom:!!d.meal?.isCustom,name:d.meal?.name,
              rawText:d.meal?.rawText||"",isLeftover:d.isLeftover,
              isDoubled:!!d.isDoubled,isEatOut:d.isEatOut,manual:!!d._manual};
          });
          if(Object.keys(autoSaveBySeed).length>0&&householdId&&!demo){
            Object.entries(autoSaveBySeed).forEach(([daySeed,newEntries])=>{
              const rid=`${householdId}:week-${daySeed}`;
              supabase.from("plans").select("data").eq("id",rid).maybeSingle()
                .then(({data:existing})=>{
                  const existingData=existing?.data?JSON.parse(existing.data):{};
                  // existingData always wins — never overwrite a saved pick with a default
                  const merged={...newEntries,...existingData};
                  return supabase.from("plans").upsert({id:rid,household_id:householdId,
                    data:JSON.stringify(merged),updated_at:new Date().toISOString()});
                })
                .catch(()=>{});
            });
          }

        } else if(!loadedFromURL&&!alreadyLoaded){
          const curSeed=getWeekSeed(weekOffset);
          const tryIds=Array.from({length:14},(_,i)=>`${householdId}:week-${curSeed+i+1}`);
          supabase.from("plans").select("id,data").in("id",tryIds).maybeSingle().then(({data:fb})=>{
            if(fb?.data){
              // Found data in a nearby row — display only, no DB write
              const parsed=JSON.parse(fb.data);
              const dates=getWindowDates(weekOffset);const rehydrated={};
              dates.forEach(day=>{const d=parsed[day];if(!d){rehydrated[day]=generateDefaultPlan(rotated,dates)[day];return;}
                const meal=d.isCustom?{id:d.id||`custom-${day}`,name:d.name,isCustom:true,protein:"custom",time:null,servings:2,desc:"",rawText:d.rawText||""}:MEALS.find(m=>m.id===d.mealId)||rotated[0];
                rehydrated[day]={meal,isLeftover:!!d.isLeftover,isDoubled:!!d.isDoubled,isEatOut:!!d.isEatOut,_fromDB:true,_manual:!!d.manual};
              });
              setWeekPlans(prev=>({...prev,[weekOffset]:rehydrated}));setFetchedEmpty(prev=>{const n=new Set(prev);n.delete(weekOffset);return n;});
            }else{setFetchedEmpty(prev=>new Set([...prev,weekOffset]));}
          }).catch(()=>setFetchedEmpty(prev=>new Set([...prev,weekOffset])));
          console.log(`[plans] weekOffset=${weekOffset} has no DB row - marking fetchedEmpty`);
        }
        setSyncStatus("saved");
      }).catch(()=>{ if(!cancelled) setSyncStatus("saved"); }); // network error on load doesn't block
    return ()=>{ cancelled=true; if(!alreadyLoaded) setSyncStatus("saved"); };
  },[weekOffset,householdId]);



  // Pre-fetch adjacent weeks so cross-week leftover badges show on refresh
  useEffect(()=>{
    if(!householdId)return;
    [-1,1].forEach(delta=>{
      const adj=weekOffset+delta;
      if(weekPlans[adj])return;
      const rowId=`${householdId}:week-${getWeekSeed(adj)}`;
      supabase.from("plans").select("data").eq("id",rowId).maybeSingle()
        .then(({data})=>{
          if(!data?.data)return;
          const dbPlan=JSON.parse(data.data);
          const r={};
          getWindowDates(adj).forEach(day=>{
            const d=dbPlan[day];if(!d)return;
            const meal=d.isCustom?{id:d.id,name:d.name,isCustom:true,protein:"custom",time:null,servings:2}:MEALS.find(m=>m.id===d.mealId);
            if(meal)r[day]={meal,isLeftover:!!d.isLeftover,isDoubled:!!d.isDoubled,isEatOut:!!d.isEatOut,_fromDB:true,_manual:!!d.manual};
          });
          if(Object.keys(r).length)setWeekPlans(prev=>prev[adj]?prev:{...prev,[adj]:r});
        }).catch(()=>{});
    });
  },[weekOffset,householdId]);
  const scheduleSave=(newPlan)=>{
    if(!householdId&&!demo)return;
    // Don't flash 'Saving' immediately — only show it if the debounce timer
    // is still pending after 1.5s (i.e. the user is typing/tapping continuously)
    if(saveTimer.current) clearTimeout(saveTimer.current);
    const capturedOffset=weekOffset; // capture at call time, not at fire time
    saveTimer.current=setTimeout(async()=>{
      try{
        // Each day in the plan belongs to the DB row for its own Monday-anchored seed.
        // Group by seed and do read-modify-write per row so we NEVER overwrite dates
        // from adjacent weeks that share the same row (e.g. yesterday in last-week view).
        const bySeed={};
        Object.keys(newPlan).forEach(day=>{
          const rid=demo
            ?`demo-${getWeekSeedForDate(day)}`
            :`${householdId}:week-${getWeekSeedForDate(day)}`;
          if(!bySeed[rid]) bySeed[rid]={};
          const d=newPlan[day];
          bySeed[rid][day]={mealId:d.meal?.isCustom?null:d.meal?.id,
            isCustom:!!d.meal?.isCustom,name:d.meal?.name,
            rawText:d.meal?.rawText||"",isLeftover:d.isLeftover,
            isDoubled:!!d.isDoubled,isEatOut:d.isEatOut,manual:!!d._manual};
        });
        const timeoutP=new Promise(r=>setTimeout(()=>r({error:{message:"Timeout"},isTimeout:true}),15000));
        const saveP=Promise.all(Object.entries(bySeed).map(async([rid,entries])=>{
          const {data:existing}=await supabase.from("plans").select("data").eq("id",rid).maybeSingle();
          const merged={...(existing?.data?JSON.parse(existing.data):{}),...entries};
          return supabase.from("plans").upsert({
            id:rid,household_id:demo?null:householdId,
            data:JSON.stringify(merged),updated_at:new Date().toISOString()});
        }));
        const saveResult=await Promise.race([saveP,timeoutP]);
        const saveErr=Array.isArray(saveResult)
          ?saveResult.find(r=>r?.error)?.error
          :saveResult?.error;
        if(saveErr){
          console.error("[plans] save error:",saveErr?.message,"isTimeout:",saveResult?.isTimeout);
          if(!saveResult?.isTimeout) setShowOffline(true);
        }
        else{console.log("[plans] saved:",Object.keys(bySeed).join(", "));}
      }catch(e){console.error("[plans] save exception:",e.message);setShowOffline(true);}
    },1200);
  };

  const pastDays=getPastDayIndices(weekOffset);

  // Get adjacent week plans for cross-week leftover display
  // Always keep current plan accessible in weekPlans for adjacent week lookups
  // Do this in render, not in useEffect, to avoid loops
  const allWeekPlans = {...weekPlans, [weekOffset]: plan};

  // Get adjacent week plans - use allWeekPlans so current week is always available
  const prevWeekPlan = allWeekPlans[weekOffset-1] || null;
  const nextWeekPlan = allWeekPlans[weekOffset+1] || null;
  const orderedDays=getWindowDates(weekOffset);

  // Debug cross-week leftovers
  if(weekOffset===1&&prevWeekPlan){
    const prevOrdered=getWindowDates(0);
    const prevLast=prevOrdered[prevOrdered.length-1];
    const thisFirst=getWindowDates(1)[0];
    console.log("[crossweek] prevLast:",prevLast,"meal:",prevWeekPlan[prevLast]?.meal?.name,"thisFirst:",thisFirst,"isLeftover:",plan[thisFirst]?.isLeftover,"mealMatch:",plan[thisFirst]?.meal?.id===prevWeekPlan[prevLast]?.meal?.id);
  }

  const groups=groupDays(plan,prevWeekPlan,nextWeekPlan,orderedDays,weekOffset);

  const updatePlan=(newPlan,changedDay=null)=>{
    if(changedDay) markLoading(changedDay);
    setPlan(newPlan);
    setWeekPlans(prev=>({...prev,[weekOffset]:newPlan}));
    scheduleSave(newPlan);
  };

  const clearLoading=(day)=>setLoadingDays(prev=>{const n=new Set(prev);n.delete(day);return n;});
  const fireEatOutBurst=(day)=>{
    const id=Date.now();
    setEatOutBursts(prev=>({...prev,[day]:id}));
    setTimeout(()=>setEatOutBursts(prev=>{const n={...prev};if(n[day]===id)delete n[day];return n;}),600);
  };
  const startDrag=(day)=>{
    if(!plan[day]?.meal||plan[day]?.isLeftover) return;
    haptic(25);
    dragOriginPlan.current={...plan};
    dragDayRef.current=day;
    setDragDay(day);
  };
  const commitDrag=(targetDay)=>{
    const src=dragDayRef.current;
    if(!src||!targetDay||src===targetDay){dragDayRef.current=null;setDragDay(null);setDragOver(null);return;}
    const orig=dragOriginPlan.current||plan;
    const next={...orig,
      [src]:{...orig[targetDay],_manual:!!orig[targetDay]?._manual},
      [targetDay]:{...orig[src],_manual:!!orig[src]?._manual},
    };
    haptic(15);
    dragDayRef.current=null;
    updatePlan(next);
    setDragDay(null);setDragOver(null);
  };
  const cancelDrag=()=>{dragDayRef.current=null;setDragDay(null);setDragOver(null);};
  const fireLeftoverBurst=(day)=>{
    const id=Date.now();
    setLeftoverBursts(prev=>({...prev,[day]:id}));
    setTimeout(()=>setLeftoverBursts(prev=>{const n={...prev};if(n[day]===id)delete n[day];return n;}),600);
  };
  const markLoading=(day)=>{
    setLoadingDays(prev=>{const n=new Set(prev);n.add(day);return n;});
    // Clear after two animation frames — skeleton shows for one paint then snaps to real content
    requestAnimationFrame(()=>requestAnimationFrame(()=>clearLoading(day)));
  };
  const haptic=(ms=10)=>{try{navigator.vibrate&&navigator.vibrate(ms);}catch{}};
  const handleSetMeal=(day,meal)=>{ haptic();
    const oi=orderedDays.indexOf(day);
    const p={...plan,[day]:{meal,isLeftover:false,isEatOut:false,_manual:true}};
    for(let d=oi+1;d<orderedDays.length;d++){
      const dd=orderedDays[d],prevd=orderedDays[d-1],cur=p[dd];
      if(!cur||!cur.isLeftover)continue;
      if(p[prevd]&&!p[prevd].isEatOut&&canBeLeftover(p[prevd].meal)){
        p[dd]={...cur,meal:p[prevd].meal,isDoubled:needsDoubling(p[prevd].meal)};
      } else {
        const used=new Set(orderedDays.slice(0,d).map(x=>p[x]?.meal?.id));
        const fb=rotated.find(m=>!used.has(m.id))||rotated[d%rotated.length];
        p[dd]={meal:fb,isLeftover:false,isDoubled:false,isEatOut:false};
      }
    }
    updatePlan(p);
    if(meal?.id) handleRecordUsage(meal.id);
    setExpandedDay(null);
  };
  const handleLeftoverToggle=(day,make)=>{ haptic(); markLoading(day); if(make) fireLeftoverBurst(day);
    const oi=orderedDays.indexOf(day);
    // Previous day in ordered view - or last day of previous week's window if oi===0
    const prevDay=oi>0 ? orderedDays[oi-1] : null;
    const prevWindowDays=getWindowDates(weekOffset-1);
    const prevWindowLastDay=prevWindowDays[prevWindowDays.length-1];
    const prev=prevDay ? plan[prevDay] : (prevWeekPlan ? prevWeekPlan[prevWindowLastDay] : null);
    const p={...plan};

    if(make&&prev?.meal&&canBeLeftover(prev.meal)&&!prev.isEatOut){
      p[day]={meal:prev.meal,isLeftover:true,isDoubled:needsDoubling(prev.meal),isEatOut:false};
    } else {
      // Turning off leftover - assign a fresh meal
      const usedBefore=new Set(orderedDays.slice(0,oi).map(dd=>p[dd]?.meal?.id));
      const fresh=rotated.find(m=>!usedBefore.has(m.id)&&m.protein!==prev?.meal?.protein)||rotated[oi%rotated.length];
      p[day]={meal:fresh,isLeftover:false,isDoubled:false,isEatOut:false};
    }

    // Recalc forward in ordered-day sequence
    const result={...p};
    for(let d=oi+1;d<orderedDays.length;d++){
      const dd=orderedDays[d],prevd=orderedDays[d-1],cur=result[dd];
      if(!cur?.isLeftover)continue;
      if(result[prevd]&&!result[prevd].isEatOut&&canBeLeftover(result[prevd].meal)){
        result[dd]={...cur,meal:result[prevd].meal,isDoubled:needsDoubling(result[prevd].meal)};
      } else {
        const used=new Set(orderedDays.slice(0,d).map(x=>result[x]?.meal?.id));
        const fb=rotated.find(m=>!used.has(m.id))||rotated[d%rotated.length];
        result[dd]={meal:fb,isLeftover:false,isDoubled:false,isEatOut:false};
      }
    }
    updatePlan(result);
  };
  const toggleEatOut=(day)=>{ markLoading(day);
    const oi=orderedDays.indexOf(day);
    const isCurrentlyOut=plan[day]?.isEatOut;
    if(!isCurrentlyOut) fireEatOutBurst(day);
    const next={...plan,[day]:{...plan[day],isEatOut:!isCurrentlyOut}};
    if(isCurrentlyOut&&!next[day].meal){
      const used=new Set(windowDates.filter(d=>d!==day).map(d=>next[d]?.meal?.id));
      next[day].meal=rotated.find(m=>!used.has(m.id))||rotated[0];
      next[day].isLeftover=false;
    }
    // Recalc forward in ordered-day sequence
    for(let d=oi;d<orderedDays.length;d++){
      const dd=orderedDays[d],prevd=orderedDays[d-1],cur=next[dd];
      if(!cur||!cur.isLeftover)continue;
      if(prevd&&next[prevd]&&!next[prevd].isEatOut&&canBeLeftover(next[prevd].meal)){
        next[dd]={...cur,meal:next[prevd].meal,isDoubled:needsDoubling(next[prevd].meal)};
      } else {
        const used=new Set(orderedDays.slice(0,d).map(x=>next[x]?.meal?.id));
        const fb=rotated.find(m=>!used.has(m.id))||rotated[d%rotated.length];
        next[dd]={meal:fb,isLeftover:false,isDoubled:false,isEatOut:false};
      }
    }
    updatePlan(next);
  };

  const copyLink=(url)=>{
    const tryModern=navigator.clipboard?.writeText(url).then(()=>true).catch(()=>false);
    Promise.resolve(tryModern).then(ok=>{
      if(ok===true){setShareMsg("✅ Link copied!");setTimeout(()=>setShareMsg(""),2500);return;}
      const ta=document.createElement("textarea");
      ta.value=url;ta.style.cssText="position:fixed;top:0;left:0;opacity:0;pointer-events:none";
      document.body.appendChild(ta);ta.focus();ta.select();
      let copied=false;try{copied=document.execCommand("copy");}catch{}
      document.body.removeChild(ta);
      setShareMsg(copied?"✅ Link copied!":"🔗 Copy the link above");
      setTimeout(()=>setShareMsg(""),2500);
    });
  };

  const handleIMessage=(url)=>{
    let msg="This week's dinners:\n\n";
    windowDates.forEach(day=>{
      const d=plan[day],cook=getCook(day);
      msg+=`${dayLabel(day,true)} (${cook}): ${d.isEatOut?"🍴 Eat out!":(d.meal?.name+(d.isLeftover?" ♻️":""))}\n`;
    });
    msg+=`\nOpen our plan: ${url}`;
    window.open(`sms:&body=${encodeURIComponent(msg)}`,"_blank");
  };

  // Sync status - only show when actively doing something
  // sync badge only shows during initial load
  const sync=syncStatus==="loading"?{show:true,label:"Loading…",color:C.muted,retry:false}:{show:false};

  const ptrRef=useRef(null);
  useEffect(()=>{
    const el=ptrRef.current; if(!el) return;
    const TRIGGER=90,HOLD_MS=350;
    let startY=0,pulling=false,triggered=false,holdTimer=null,cont=null,pill=null,topCirc=null,botCirc=null,raf=null;
    const ns='http://www.w3.org/2000/svg';
    // App bar height , pill stretches from screen top to just above the bar
    const BAR_H=56;

    function mkIndicator(){
      cont=document.createElement('div');
      cont.style.cssText='position:fixed;inset:0;z-index:9999;pointer-events:none;overflow:hidden;';
      const svg=document.createElementNS(ns,'svg');
      svg.id='ptr-svg';svg.style.cssText='position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;';
      pill=document.createElementNS(ns,'rect');
      pill.setAttribute('x','0');pill.setAttribute('y','0');pill.setAttribute('width','28');pill.setAttribute('height','20');
      pill.setAttribute('rx','10');pill.style.cssText='fill:#FF6B35;opacity:0;';
      svg.appendChild(pill);
      cont.appendChild(svg);
      document.body.appendChild(cont);
    }

    function updIndicator(dy){
      if(!pill) return;
      const pct=Math.min(dy/TRIGGER,1);
      // Pill sits centered horizontally, top edge at screen top + 6px, 
      // bottom edge approaches app bar as pull grows
      const midX=window.innerWidth/2;
      const pillTop=6;
      const pillBot=Math.min(dy*0.85, BAR_H-8); // bottom trails finger, caps just above bar
      const h=Math.max(20, pillBot-pillTop);
      // Width squishes as it stretches , peanut effect at full pull
      const squeeze=triggered?Math.sin(Date.now()/90)*3:0;
      const w=Math.max(10, 28-pct*10+squeeze);
      const rx=Math.min(w/2,10);
      pill.setAttribute('x',String(midX-w/2));
      pill.setAttribute('y',String(pillTop));
      pill.setAttribute('width',String(w));
      pill.setAttribute('height',String(h));
      pill.setAttribute('rx',String(rx));
      pill.setAttribute('ry',String(rx));
      pill.style.opacity=String(Math.min(pct*1.8,1));
    }

    function snap(){
      if(!pill||!cont) return;
      const svg=document.getElementById('ptr-svg');
      if(!svg) return;
      const midX=window.innerWidth/2;
      pill.style.display='none';
      // Two circles split apart vertically from the ends of the pill
      topCirc=document.createElementNS(ns,'circle');
      botCirc=document.createElementNS(ns,'circle');
      topCirc.setAttribute('cx',String(midX));topCirc.setAttribute('cy','12');topCirc.setAttribute('r','9');topCirc.style.fill='#FF6B35';
      botCirc.setAttribute('cx',String(midX));botCirc.setAttribute('cy',String(BAR_H-12));botCirc.setAttribute('r','9');botCirc.style.fill='#FF6B35';
      svg.appendChild(topCirc);svg.appendChild(botCirc);
      let f=0;
      (function step(){
        f++;
        topCirc.setAttribute('cy',String(12-f*2));
        botCirc.setAttribute('cy',String(BAR_H-12+f*2));
        const op=Math.max(0,1-f/10);
        topCirc.style.opacity=botCirc.style.opacity=String(op);
        if(f<10){raf=requestAnimationFrame(step);}
        else{cont&&cont.remove();cont=null;pill=null;topCirc=null;botCirc=null;}
      })();
    }

    const ts=(e)=>{if(window.scrollY>2)return;if(document.querySelector('[data-meal-picker-open]')||document.querySelector('[data-expanded-day]'))return;startY=e.touches[0].clientY;pulling=true;triggered=false;};
    const tm=(e)=>{
      if(!pulling||window.scrollY>2){pulling=false;return;}
      const dy=e.touches[0].clientY-startY;if(dy<6)return;
      if(!cont)mkIndicator();
      updIndicator(dy);
      if(dy>=TRIGGER&&!triggered){
        triggered=true;
        try{navigator.vibrate&&navigator.vibrate([25]);}catch{}
        holdTimer=setTimeout(()=>{pulling=false;snap();setTimeout(()=>window.location.reload(),260);},HOLD_MS);
      }else if(dy<TRIGGER&&triggered){triggered=false;clearTimeout(holdTimer);}
    };
    const te=()=>{
      pulling=false;
      if(!triggered){
        clearTimeout(holdTimer);
        if(cont){cont.style.opacity='0';cont.style.transition='opacity 0.18s';setTimeout(()=>{cont&&cont.remove();cont=null;pill=null;},200);}
      }
    };
    el.addEventListener('touchstart',ts,{passive:true});
    el.addEventListener('touchmove',tm,{passive:true});
    el.addEventListener('touchend',te,{passive:true});
    return()=>{el.removeEventListener('touchstart',ts);el.removeEventListener('touchmove',tm);el.removeEventListener('touchend',te);
      clearTimeout(holdTimer);if(raf)cancelAnimationFrame(raf);if(cont)cont.remove();};
  },[]);


return (
    <div ref={ptrRef} data-expanded-day={expandedDay||undefined} style={{fontFamily:"system-ui,sans-serif",background:C.bg,width:"100%",position:"relative"}}>
      <style>{`
        html, body { background: ${C.bg} !important; }
        input:-webkit-autofill, input:-webkit-autofill:focus { -webkit-box-shadow: 0 0 0 1000px ${C.card} inset !important; -webkit-text-fill-color: ${C.text} !important; }
        input:focus { outline: none; box-shadow: none; }
        input, textarea, select { font-size: max(16px, 1em); touch-action: manipulation; }
        @keyframes syncPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes loOrangeBurst{0%{transform:translate(-50%,-50%) scale(1);opacity:1}100%{transform:translate(calc(-50% + var(--tx)),calc(-50% + var(--ty))) scale(0);opacity:0}} @keyframes loDotBurst{0%{transform:translate(-50%,-50%) scale(1);opacity:1}100%{transform:translate(calc(-50% + var(--tx)),calc(-50% + var(--ty))) scale(0);opacity:0}} @keyframes loadSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes glowPulse { 0%{box-shadow:0 0 0 0 transparent} 40%{box-shadow:0 0 16px 5px ${C.accent}55} 100%{box-shadow:0 0 0 0 transparent} }
        @keyframes iconWiggle { 0%,100%{transform:rotate(0deg)} 20%{transform:rotate(-18deg)} 50%{transform:rotate(14deg)} 70%{transform:rotate(-8deg)} 90%{transform:rotate(5deg)} }
        .fk-wiggle svg { animation: iconWiggle 0.4s ease-out; }
        .fk-press:active { animation: ${C.bg==="#0D0D0B"?"glowPulse 0.45s ease-out forwards":"none"}; }
        input::placeholder, textarea::placeholder { color: ${C.muted}; opacity: 1; }
        input, select, textarea { color-scheme: ${C.bg==='#0D0D0B'?'dark':'light'}; }
        input[type="range"]::-webkit-slider-runnable-track { background: ${C.mutedBg}; height: 4px; border-radius: 2px; }
        input[type="range"]::-moz-range-track { background: ${C.mutedBg}; height: 4px; border-radius: 2px; }
        input[type="range"]::-webkit-slider-thumb { border: 3px solid ${C.subtle}; background: ${C.accent}; width: 36px; height: 20px; border-radius: 10px; margin-top: -8px; -webkit-appearance: none; cursor: pointer; }
        input[type="range"] { -webkit-appearance: none; appearance: none; background: transparent; }
        select { background: ${C.card}; color: ${C.text}; border-color: ${C.border}; }
      `}</style>

      {/* Offline overlay */}
      {showOffline&&(
        <div style={{position:"fixed",inset:0,zIndex:50,background:C.overlay,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,padding:24}}
          onClick={()=>{if(navigator.onLine)setShowOffline(false);}}>
          <div style={{background:C.card,borderRadius:20,padding:"28px 24px",maxWidth:320,width:"100%",textAlign:"center",boxShadow:"0 8px 40px rgba(0,0,0,0.3)"}}>
            <div style={{marginBottom:16,display:"flex",justifyContent:"center"}}><WifiOff size={40} strokeWidth={1.5} color={C.muted}/></div>
            <div style={{fontSize:17,fontWeight:700,color:C.text,marginBottom:8}}>Check your connection</div>
            <div style={{fontSize:14,color:C.textSub,lineHeight:1.6,marginBottom:20}}>Your plan couldn't be saved. Make sure you're connected to the internet and try again.</div>
            <button onClick={()=>{
              setShowOffline(false);scheduleSave(plan);
            }} style={{width:"100%",padding:"14px",borderRadius:12,border:"none",background:C.accent,color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer"}}>
              Try again
            </button>
            <button onClick={()=>setShowOffline(false)} style={{marginTop:8,width:"100%",padding:"10px",borderRadius:12,border:"none",background:"transparent",color:C.muted,fontSize:13,cursor:"pointer"}}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Loading/Saving overlay - Forknight logo spinner */}
      {syncStatus==="loading"&&(
        <div style={{
          position:"fixed",inset:0,zIndex:30,
          background:C.bg==="#0D0D0B"?"rgba(0,0,0,0.7)":"rgba(255,255,255,0.7)",
          backdropFilter:"blur(2px)",
          display:"flex",alignItems:"center",justifyContent:"center",
          pointerEvents:syncStatus==="saving"?"none":"auto",
          transition:"opacity 0.2s ease",
        }}>
          <div style={{position:"relative",width:150,height:150,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <svg width="150" height="150" style={{position:"absolute",inset:0,animation:"loadSpin 1.1s linear infinite"}}>
              <circle cx="75" cy="75" r="68" fill="none" stroke={C.border} strokeWidth="4"/>
              <circle cx="75" cy="75" r="68" fill="none" stroke={C.accent} strokeWidth="4" strokeDasharray="100 330" strokeLinecap="round" style={{filter:C.bg==="#0D0D0B"?"drop-shadow(0 0 8px #FF6B3588)":"none"}}/>
            </svg>
<div style={{fontFamily:"'Playfair Display',Georgia,serif",fontSize:22,fontWeight:600,color:C.text,letterSpacing:"-0.5px",lineHeight:1,textAlign:"center"}}>
              Fork<br/>night
            </div>
          </div>
        </div>
      )}

      {/* Header - full width bg, constrained content */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,width:"100%"}}>
        <div style={{maxWidth:650,margin:"0 auto",padding:"22px 18px 14px"}}>

        {/* Row 1: Logo + sync badge + avatar */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
<div style={{fontFamily:"'Playfair Display', Georgia, serif",fontSize:32,fontWeight:600,color:C.text,letterSpacing:"-1.6px",lineHeight:1}}><span style={{letterSpacing:"-0.05em"}}>F</span>orknight<sup style={{fontSize:"0.22em",fontWeight:400,verticalAlign:"super",letterSpacing:0,position:"relative",top:"-6px"}}>®</sup></div>
            {sync.show&&(
              <span onClick={sync.retry?()=>{
              // Retry immediately, no debounce
              const capturedOffset=weekOffset;
              const capturedPlan=plan;
              (async()=>{
                try{
                  const retrySeed={};
                  Object.keys(capturedPlan).forEach(d=>{
                    const rid2=demo?`demo-${getWeekSeedForDate(d)}`:`${householdId}:week-${getWeekSeedForDate(d)}`;
                    if(!retrySeed[rid2]) retrySeed[rid2]={};
                    const v=capturedPlan[d];
                    retrySeed[rid2][d]={mealId:v.meal?.isCustom?null:v.meal?.id,isCustom:!!v.meal?.isCustom,name:v.meal?.name,rawText:v.meal?.rawText||"",isLeftover:v.isLeftover,isDoubled:!!v.isDoubled,isEatOut:v.isEatOut,manual:!!v._manual};
                  });
                  const retryP=Promise.all(Object.entries(retrySeed).map(async([rid2,entries])=>{
                    const {data:ex}=await supabase.from("plans").select("data").eq("id",rid2).maybeSingle();
                    const merged={...(ex?.data?JSON.parse(ex.data):{}),...entries};
                    return supabase.from("plans").upsert({id:rid2,household_id:demo?null:householdId,data:JSON.stringify(merged),updated_at:new Date().toISOString()});
                  }));
                  const timeoutP2=new Promise(r=>setTimeout(()=>r([{error:{message:"Timeout"}}]),15000));
                  const rr=await Promise.race([retryP,timeoutP2]);
                  const saveErr=Array.isArray(rr)?rr.find(r=>r?.error)?.error:rr?.error;
                  if(saveErr){console.error("[retry] save error:",saveErr?.message);setShowOffline(true);}
                  else{console.log("[retry] saved ok");setShowOffline(false);}
                }catch(e){console.error("[retry] exception:",e.message);}
              })();
            }:undefined} style={{fontSize:11,fontWeight:700,color:sync.color,background:sync.color+"18",padding:"3px 9px",borderRadius:20,cursor:sync.retry?"pointer":"default",animation:syncStatus==="saving"?"syncPulse 1.2s ease-in-out infinite":"none"}}>
                {sync.label}
              </span>
            )}
          </div>
          {/* Profile avatar - opens Household Settings */}
          <button
            onClick={()=>setShowHouseholdSettings(true)}
            style={{width:34,height:34,borderRadius:"50%",background:C.mutedBg,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",flexShrink:0}}
          >
            {memberNames.length>1?<Users size={17} strokeWidth={2}/>:<User size={17} strokeWidth={2}/>}
          </button>
          
        </div>

        {demo&&<div style={{marginTop:4,fontSize:11,fontWeight:600,color:C.muted}}>Demo mode - changes won't be saved</div>}

        {/* Row 2: Week selector - also pinned sticky below header via portal div */}
        <div id="fk-week-select-source" style={{marginTop:8}}>
          <select value={weekOffset} onChange={e=>setWeekOffsetPersist(Number(e.target.value))}
            style={{width:"100%",padding:"7px 10px",borderRadius:8,border:`1px solid ${C.border}`,fontSize:12,fontWeight:600,color:C.text,background:C.card,cursor:"pointer"}}>
            <option value={-1}>Last week · {weekLabel(-1)}</option>
            <option value={0}>This week · {weekLabel(0)}</option>
            <option value={1}>Next week · {weekLabel(1)}</option>
          </select>
        </div>

        {loadedFromURL&&syncStatus==="local"&&(
          <div style={{marginTop:8,padding:"6px 10px",background:C.greenTint,borderRadius:8,fontSize:11,color:C.green,fontWeight:600}}>
            🔗 Viewing a shared plan
          </div>
        )}
        </div>{/* end header inner 650 */}
      </div>{/* end full-width header */}

      {/* Sticky frosted week selector - fades in/out smoothly */}
      <div style={{
        position:"fixed",top:0,left:"50%",transform:"translateX(-50%)",
        width:"100%",maxWidth:650,zIndex:25,
        padding:"8px 18px",
        background:C.bg==="#0D0D0B"?"rgba(30,30,28,0.65)":"rgba(237,238,232,0.70)",
        backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",
        borderBottom:`1px solid ${C.border}40`,
        opacity:stickyWeek?1:0,
        pointerEvents:stickyWeek?"auto":"none",
        transition:"opacity 0.25s ease",
      }}>
        <select value={weekOffset} onChange={e=>setWeekOffsetPersist(Number(e.target.value))}
          style={{width:"100%",padding:"6px 10px",borderRadius:8,border:`1px solid ${C.border}`,fontSize:12,fontWeight:600,color:C.text,background:"transparent",cursor:"pointer"}}>
          <option value={-1}>Last week · {weekLabel(-1)}</option>
          <option value={0}>This week · {weekLabel(0)}</option>
          <option value={1}>Next week · {weekLabel(1)}</option>
        </select>
      </div>

      <div style={{maxWidth:650,margin:"0 auto",width:"100%"}}>

      {/* Top pagination dots - just above the first card */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"14px 0 0"}}>
        {[-1,0,1].map(w=>(
          <button key={w} onClick={()=>setWeekOffsetPersist(w)} className="fk-press" style={{padding:0,border:"none",background:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
            {w===weekOffset
              ?<div style={{width:22,height:8,borderRadius:4,background:C.accent,transition:"all 0.2s"}}/>
              :<div style={{width:8,height:8,borderRadius:"50%",background:C.mutedBg,transition:"all 0.2s"}}/>
            }
          </button>
        ))}
      </div>

      {/* Empty state for last week , no row, OR row exists with zero real days */}
      {/* Empty state: last week, fetch complete, no DB row found */}
      {/* Empty state: last week, fetch complete, no DB row AND no pre-fetched meals */}
      {weekOffset===-1&&syncStatus==="saved"&&fetchedEmpty.has(-1)&&
        Object.values(plan).every(d=>!d?.meal?.id&&!d?.meal?.name)&&(
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"60px 24px",gap:16,textAlign:"center"}}>
          <UtensilsCrossed size={64} strokeWidth={1.2} color={C.mutedBg}/>
          <div style={{fontSize:14,color:C.muted,lineHeight:1.6,maxWidth:240}}>This is where your previous meals will show.</div>
        </div>
      )}

      {/* Day cards with carousel swipe */}
      <div style={{overflow:"hidden",position:"relative"}}>
      <div
        style={{display:"flex",flexDirection:"column",gap:10,padding:"8px 12px 0",
          transform:swipeOffset?`translateX(${swipeOffset}px)`:"none",
          transition:swipeOffset===0?"transform 0.25s cubic-bezier(0.25,0.46,0.45,0.94)":"none",
          willChange:"transform",
        }}
        onTouchStart={e=>{
          const t=e.touches[0];
          e.currentTarget.__swipeX=t.clientX;
          e.currentTarget.__swipeY=t.clientY;
          e.currentTarget.__swipeMoved=false;
          setSwipeOffset(0);
        }}
        onTouchMove={e=>{
          const t=e.touches[0];
          const dx=t.clientX-(e.currentTarget.__swipeX||0);
          const dy=t.clientY-(e.currentTarget.__swipeY||0);
          if(Math.abs(dx)>Math.abs(dy)){
            e.currentTarget.__swipeMoved=true;
            // Rubber-band resistance at the limits
            if((dx>0&&weekOffset<=-1)||(dx<0&&weekOffset>=1)){
              setSwipeOffset(dx*0.15); // heavy resistance at limits
            } else {
              setSwipeOffset(dx*0.35); // lighter follow during active swipe
            }
          }
        }}
        onTouchEnd={e=>{
          setSwipeOffset(0); // snap back - transition handles the animation
          if(!e.currentTarget.__swipeMoved)return;
          const dx=e.changedTouches[0].clientX-(e.currentTarget.__swipeX||0);
          if(Math.abs(dx)<60)return;
          haptic(8);
          if(dx<0&&weekOffset<1)setWeekOffsetPersist(weekOffset+1);
          else if(dx>0&&weekOffset>-1)setWeekOffsetPersist(weekOffset-1);
        }}
      >
        {groups.map((group,gi)=>{
          const {days,crossWeek,tail}=group;
          const today0=dateStr(0);
          const isPastGroup=days.every(day=>day<today0);

          // For last week: show a bare faded outline for days with no real data
          if(weekOffset===-1&&!fetchedEmpty.has(-1)&&weekPlans[-1]&&days.every(day=>!plan[day]?._fromDB)){
            // Only show blank outlines for partial weeks (DB row exists but this group has no real data)
            return(
              <div key={gi} style={{
                borderRadius:14,
                border:`1.5px solid ${C.border}`,
                minHeight:80,
                opacity:0.35,
              }}/>
            );
          }
          return (
          <div key={gi}>
            {/* Cross-week banner: this meal continues into next week */}
            {crossWeek==="next"&&(
              <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.muted,padding:"0 4px 6px"}}>
                <RefreshCw size={11} strokeWidth={2}/> Leftovers continue into next week
              </div>
            )}
            {/* Cross-week banner: this is the leftover tail from last week */}
            {crossWeek==="prev"&&(
              <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.muted,padding:"0 4px 6px"}}>
                <RefreshCw size={11} strokeWidth={2}/> Leftovers from last week
              </div>
            )}
            <div style={{
              background:C.card,
              borderRadius:14,
              border:weekOffset===0&&days.includes(orderedDays[0])
                ?`2px solid ${C.sage}`
                :`1px solid ${crossWeek?C.green+"66":C.border}`,
              overflow:"hidden",
              boxShadow:"0 2px 10px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.05)",
              opacity:isPastGroup?0.55:1,
            }}>
            {days.map((day,rowIdx)=>{
              const d=plan[day]||{meal:null,isEatOut:false,isLeftover:false,isDoubled:false};
              const isOut=d.isEatOut,meal=d.meal;
              const cook=getCook(day);
              const cookColor=getCookColor(cook);
              const isLeftoverRow=d.isLeftover,isDoubled=!!d.isDoubled,isExpanded=expandedDay===day,isRecipeOpen=recipeDay===day;
              const di=windowDates.indexOf(day);
              // Use ordered window for next/prev day
              const oi=orderedDays.indexOf(day);
              const nextDayInWindow=oi<orderedDays.length-1?orderedDays[oi+1]:null;
              const isLastInWindow=oi===orderedDays.length-1;
              const isFirstInWindow=oi===0;
              // Cross-week: last day of window leads into next window's first day
              const nextWindowFirstDay=getWindowDates(weekOffset+1)[0];
              const nextIsLeftover=isLastInWindow
                ?(nextWeekPlan?.[nextWindowFirstDay]?.isLeftover&&nextWeekPlan?.[nextWindowFirstDay]?.meal?.id===meal?.id)
                :(nextDayInWindow?plan[nextDayInWindow]?.isLeftover:false);
              const nextDayLabel=isLastInWindow?`${nextWindowFirstDay} (next week)`:nextDayInWindow;
              // Can offer leftover if this day has a meal and next day exists (in window or next window)
              const canOfferLeftover=!isOut&&canBeLeftover(meal)&&(nextDayInWindow||isLastInWindow)&&!isLeftoverRow;
              const showRecipeBtn=!meal?.isCustom&&(meal?.recipe||meal?.steps) || meal?.isCustom; // custom meals always tappable
              const isPast=weekOffset===0&&day<dateStr(0);
              const isDisabled=weekOffset<0||isPast;
              const isToday=day===dateStr(0);

              return (
                <div key={day}
                  onPointerDown={(e)=>{
                    // Only start long-press timer on the card background, not on buttons/inputs
                    if(e.target.closest("button,input,textarea,select,a")) return;
                    const el=e.currentTarget;
                    const pid=e.pointerId;
                    longPressTimer.current=setTimeout(()=>{
                      el.setPointerCapture(pid);
                      startDrag(day);
                    },500);
                  }}
                  onPointerUp={()=>{
                    clearTimeout(longPressTimer.current);
                    if(dragDayRef.current) commitDrag(day);
                  }}
                  onPointerLeave={()=>clearTimeout(longPressTimer.current)}
                  onPointerEnter={()=>{ if(dragDayRef.current&&dragDayRef.current!==day) setDragOver(day); }}
                  onPointerCancel={cancelDrag}
                  style={{padding:"13px 14px",
                    borderTop:rowIdx>0?`1px dashed ${C.border}`:"none",
                    background:dragOver===day&&dragDay?C.accentTint:isLeftoverRow?C.leftover:"transparent",
                    outline:dragDay===day?`2px dashed ${C.accent}`:"none",
                    opacity:dragDay===day?0.45:1,
                    transition:"opacity 0.15s,background 0.12s",
                    cursor:dragDay?"grabbing":"default"}}>
                  {/* Header row */}
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                    <span style={{fontSize:11,fontWeight:800,color:C.bg,background:isPast?C.daypast:isToday?C.green:C.text,padding:"3px 9px",borderRadius:6,letterSpacing:"0.06em"}}>{dayLabel(day).toUpperCase()}</span>
                    {(()=>{
                      if(isLeftoverRow) return null;
                      const isMealManual=!!d?._manual; // filled = user explicitly picked this meal
                      const chipBg=isMealManual?(cookColor||C.muted):"transparent";
                      const chipColor=isMealManual?C.bg:(cookColor||C.muted);
                      const chipBorder=isMealManual?"none":`1px solid ${(cookColor||C.muted)+"44"}`;
                      return (
                        <button
                          onClick={()=>!isDisabled&&toggleCook(day)}
                          style={{display:"flex",alignItems:"center",gap:5,fontSize:11,fontWeight:600,color:chipColor,background:chipBg,border:chipBorder,borderRadius:20,padding:"3px 9px",cursor:isDisabled?"default":"pointer",transition:"all 0.15s"}}
                          title="Tap to assign cook"
                        >
                          <ChefHat size={12} strokeWidth={2}/> {cook||"Unassigned"}
                        </button>
                      );
                    })()}
                    {isLeftoverRow&&(
                      <span style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:C.muted}}>
                        <RefreshCw size={11} strokeWidth={2}/> Leftovers
                      </span>
                    )}
                    {isOut&&(
                      <span style={{display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,color:C.accent}}>
                        <UtensilsCrossed size={12} strokeWidth={2}/> Eat out!
                      </span>
                    )}
                    {isPast&&<span style={{fontSize:10,color:C.daypast,fontStyle:"italic"}}>past</span>}
                    <div style={{flex:1}}/>
                    {/* Leftover chip */}
                    {canOfferLeftover&&!isDisabled&&(
                      <span style={{position:"relative",display:"inline-flex"}}>
                      {leftoverBursts[day]&&[...Array(7)].map((_,bi)=>{
                        const angle=(bi/7)*2*Math.PI;
                        // Start from the chip perimeter (~16px half-height from center)
                        const edgeDist=16;
                        const travelDist=22+Math.round(Math.random()*14);
                        const size=3+Math.round(Math.random()*3);
                        // Start position = on the chip edge
                        const sx=Math.round(Math.cos(angle)*edgeDist);
                        const sy=Math.round(Math.sin(angle)*edgeDist);
                        // Travel distance beyond the edge
                        const tx=Math.round(Math.cos(angle)*(edgeDist+travelDist));
                        const ty=Math.round(Math.sin(angle)*(edgeDist+travelDist));
                        return <span key={bi} style={{
                          position:"absolute",
                          top:`calc(50% + ${sy}px)`,left:`calc(50% + ${sx}px)`,
                          width:size,height:size,borderRadius:"50%",background:C.green,
                          pointerEvents:"none",zIndex:10,
                          '--tx':(tx-sx)+'px','--ty':(ty-sy)+'px',
                          animation:"loDotBurst 0.5s ease-out forwards",
                          animationDelay:(bi*15)+"ms",
                        }}/>;
                      })}
                      <button onClick={()=>{
                        if(isLastInWindow){
                          const nextWOff=weekOffset+1;
                          const nextWOrdered=getWindowDates(nextWOff);
                          const nextFirst=nextWindowFirstDay;
                          const nextSecond=nextWOrdered[1];
                          const nextWPlan=weekPlans[nextWOff]||generateDefaultPlan(seededShuffle(MEALS,getWeekSeed(nextWOff)),getWindowDates(nextWOff));
                          const newNextPlan={...nextWPlan};
                          if(!nextIsLeftover){
                            // Set first day as leftover of this week's last meal
                            newNextPlan[nextFirst]={meal:plan[day].meal,isLeftover:true,isDoubled:needsDoubling(plan[day].meal),isEatOut:false};
                            // If second day was a leftover of first day, break the chain - assign fresh meal
                            if(nextSecond&&newNextPlan[nextSecond]?.isLeftover){
                              const usedIds=new Set([plan[day].meal?.id]);
                              const nextRotated=seededShuffle(MEALS,getWeekSeed(nextWOff));
                              const fresh=nextRotated.find(m=>!usedIds.has(m.id))||nextRotated[0];
                              newNextPlan[nextSecond]={meal:fresh,isLeftover:false,isDoubled:false,isEatOut:false};
                            }
                          } else {
                            // Remove the cross-week leftover - restore a fresh meal for first day
                            const usedIds=new Set(Object.values(nextWPlan).map(d=>d?.meal?.id));
                            const nextRotated=seededShuffle(MEALS,getWeekSeed(nextWOff));
                            const fr=nextRotated.find(m=>!usedIds.has(m.id))||nextRotated[0];
                            newNextPlan[nextFirst]={meal:fr,isLeftover:false,isDoubled:false,isEatOut:false};
                          }
                          setWeekPlans(prev=>({...prev,[nextWOff]:newNextPlan}));
                          if(householdId){
                            const cwSeed={};
                            Object.keys(newNextPlan).forEach(d=>{
                              const v=newNextPlan[d]; if(!v) return;
                              const rid=`${householdId}:week-${getWeekSeedForDate(d)}`;
                              if(!cwSeed[rid]) cwSeed[rid]={};
                              cwSeed[rid][d]={mealId:v.meal?.isCustom?null:v.meal?.id,isCustom:!!v.meal?.isCustom,name:v.meal?.name,rawText:v.meal?.rawText||"",isLeftover:v.isLeftover,isDoubled:!!v.isDoubled,isEatOut:v.isEatOut,manual:!!v._manual};
                            });
                            Object.entries(cwSeed).forEach(([rid,entries])=>{
                              supabase.from("plans").select("data").eq("id",rid).maybeSingle()
                                .then(({data:ex})=>{
                                  const merged={...(ex?.data?JSON.parse(ex.data):{}),...entries};
                                  return supabase.from("plans").upsert({id:rid,household_id:householdId,data:JSON.stringify(merged),updated_at:new Date().toISOString()});
                                }).catch(()=>{});
                            });
                          }
                        } else {
                          if(!nextIsLeftover) fireLeftoverBurst(day); handleLeftoverToggle(nextDayInWindow,!nextIsLeftover);
                        }
                      }} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,fontWeight:700,padding:"6px 10px",minHeight:32,borderRadius:10,border:`1.5px solid ${nextIsLeftover?C.green:C.mutedBg}`,background:nextIsLeftover?C.greenTint:"transparent",color:nextIsLeftover?C.green:C.muted,cursor:"pointer"}}>
                        <RefreshCw size={11} strokeWidth={2}/> {nextIsLeftover?`Leftovers ✓`:"Leftovers?"}
                      </button>
                      </span>
                    )}
                    {/* Eat out chip */}
                    {!isDisabled&&(
                      <span style={{position:"relative",display:"inline-flex"}}>
                      {eatOutBursts[day]&&[...Array(7)].map((_,bi)=>{
                        const angle=(bi/7)*2*Math.PI;
                        const edgeDist=16;
                        const travelDist=22+Math.round(Math.random()*14);
                        const size=3+Math.round(Math.random()*3);
                        const sx=Math.round(Math.cos(angle)*edgeDist);
                        const sy=Math.round(Math.sin(angle)*edgeDist);
                        const tx=Math.round(Math.cos(angle)*(edgeDist+travelDist));
                        const ty=Math.round(Math.sin(angle)*(edgeDist+travelDist));
                        return <span key={bi} style={{
                          position:"absolute",
                          top:`calc(50% + ${sy}px)`,left:`calc(50% + ${sx}px)`,
                          width:size,height:size,borderRadius:"50%",background:C.accent,
                          pointerEvents:"none",zIndex:10,
                          '--tx':(tx-sx)+'px','--ty':(ty-sy)+'px',
                          animation:"loOrangeBurst 0.5s ease-out forwards",
                          animationDelay:(bi*15)+"ms",
                        }}/>;
                      })}
                      <button onClick={()=>toggleEatOut(day)} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,fontWeight:700,padding:"6px 10px",minHeight:32,borderRadius:10,border:`1.5px solid ${C.accent}`,background:isOut?C.accent:"transparent",color:isOut?"#fff":C.accent,cursor:"pointer"}}>
                        <UtensilsCrossed size={11} strokeWidth={2}/> {isOut?"Out ✓":"Eat out?"}
                      </button>
                      </span>
                    )}
                  </div>

                  {(()=>{
                    const isCardLoading=loadingDays.has(day);
                    if(isCardLoading) return (
                      <div style={{padding:"4px 0 8px",display:"flex",gap:10,alignItems:"flex-start"}}>
                        <div style={{width:20,height:20,borderRadius:4,background:C.border,flexShrink:0,marginTop:2,opacity:0.5}}/>
                        <div style={{flex:1,display:"flex",flexDirection:"column",gap:8}}>
                          <div style={{height:18,borderRadius:6,background:C.border,width:"65%",opacity:0.5}}/>
                          <div style={{height:12,borderRadius:6,background:C.border,width:"85%",opacity:0.35}}/>
                          <div style={{height:12,borderRadius:6,background:C.border,width:"50%",opacity:0.35}}/>
                          <div style={{display:"flex",gap:6,marginTop:4}}>
                            <div style={{height:22,width:48,borderRadius:20,background:C.border,opacity:0.35}}/>
                            <div style={{height:22,width:60,borderRadius:20,background:C.border,opacity:0.35}}/>
                            <div style={{height:22,width:40,borderRadius:20,background:C.border,opacity:0.35}}/>
                          </div>
                        </div>
                      </div>
                    );
                    return isOut?(
                    <div style={{textAlign:"center",padding:"16px 0 10px",color:C.muted}}>
                      <UtensilsCrossed size={36} strokeWidth={1.5} color={C.accent}/>
                      <div style={{fontWeight:700,fontSize:15,marginTop:10,color:C.text}}>Enjoy your night out!</div>
                    </div>
                  ):(
                    <>
                      <div
                        onClick={(e)=>{e.preventDefault();if(showRecipeBtn&&!isLeftoverRow){setRecipeDay(isRecipeOpen?null:day);if(!isRecipeOpen&&meal?.id)handleRecordUsage(meal.id);}}}
                        style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:8,cursor:showRecipeBtn?"pointer":"default"}}>
                        <span style={{color:C.muted,flexShrink:0,paddingTop:2}}>
                          {meal?.isCustom
                            ? <Pencil size={20} strokeWidth={1.8}/>
                            : (() => { const {Icon}=PROTEIN_META[meal?.protein||"chicken"]||PROTEIN_META.all; return <Icon size={20} strokeWidth={1.8}/>; })()
                          }
                        </span>
                        <div style={{flex:1}}>
                          {meal?.isCustom?<CustomMealNameEditor meal={meal} day={day} onUpdateMeal={handleUpdateMealText} C={C}/>:<div style={{fontSize:15,fontWeight:700,color:C.text,lineHeight:1.3}}>{meal?.name}</div>}
                          {!meal?.isCustom&&!isLeftoverRow&&<div style={{fontSize:12,color:C.textSub,lineHeight:1.5,marginTop:3}}>{meal?.desc}</div>}
                          {isLeftoverRow&&<div style={{fontSize:12,color:C.muted,marginTop:3}}>Same as last night - no cooking needed</div>}
                          {meal?.isCustom&&<CustomRecipePreview meal={meal} C={C}/>}
                          {!isLeftoverRow&&(
                            <>
                              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginTop:16}}>
                                {meal?.isCustom&&(
                                  <span style={{fontSize:9,fontWeight:700,color:C.accent,background:C.accentTint,padding:"2px 7px",borderRadius:8,letterSpacing:"0.04em",textTransform:"uppercase"}}>Custom</span>
                                )}
                                {meal?.isCustom&&(
                                  <span style={{display:"flex",alignItems:"center",gap:4,fontSize:10,background:C.subtle,color:C.textSub,padding:"2px 7px",borderRadius:8}}>
                                    <Clock size={10} strokeWidth={2}/> -
                                  </span>
                                )}
                                {meal?.isCustom&&(
                                  <span style={{display:"flex",alignItems:"center",gap:4,fontSize:10,background:C.subtle,color:C.textSub,padding:"2px 7px",borderRadius:8}}>
                                    <Users size={10} strokeWidth={2}/> -
                                  </span>
                                )}
                                {meal?.time&&!meal?.isCustom&&(
                                  <span style={{display:"flex",alignItems:"center",gap:4,fontSize:10,background:C.subtle,color:C.textSub,padding:"2px 7px",borderRadius:8}}>
                                    <Clock size={10} strokeWidth={2}/> {meal.time}m
                                  </span>
                                )}
                                {!meal?.isCustom&&(
                                <span style={{display:"flex",alignItems:"center",gap:4,fontSize:10,background:C.subtle,color:C.textSub,padding:"2px 7px",borderRadius:8}}>
                                  <Users size={10} strokeWidth={2}/> serves {Math.round(householdSize*(nextIsLeftover?2:1))}
                                </span>
                                )}
                                {meal?.cal&&!meal?.isCustom&&(
                                  <span style={{display:"flex",alignItems:"center",gap:4,fontSize:10,background:C.subtle,color:C.textSub,padding:"2px 7px",borderRadius:8}}>
                                    {meal.cal} cal
                                  </span>
                                )}
                                {showRecipeBtn&&!isLeftoverRow&&(
                                  <span style={{fontSize:13,fontWeight:600,color:C.accent,marginLeft:"auto",flexShrink:0}}>
                                    {isRecipeOpen?"▲ Hide":"▼ Recipe"}
                                  </span>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                      {isRecipeOpen&&meal?.recipe&&(()=>{
                        const scaleFactor=meal.servings?householdSize/meal.servings:1;
                        return <RecipePanel meal={meal} doubled={nextIsLeftover} ratings={ratings} onSetRating={handleSetRating} scaleFactor={scaleFactor} day={day} onUpdateMeal={handleUpdateMealText} householdId={householdId} currentUserId={currentUserId}/>;
                      })()}
                      {isRecipeOpen&&meal?.isCustom&&(
                        <CustomRecipeExpandedCard meal={meal} day={day} onUpdateMeal={handleUpdateMealText} C={C} householdId={householdId} currentUserId={currentUserId} onRefreshCustomMeals={refreshCustomMeals} onEditingChange={(editing)=>setCustomEditingDay(editing?day:null)}/>
                      )}
                      {!isDisabled&&(
                        customEditingDay===day?(
                          <button
                            onClick={()=>{
                              const ta=document.querySelector(`[data-custom-day="${day}"] textarea`);
                              if(ta)ta.blur();else setCustomEditingDay(null);
                            }}
                            style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginTop:16,width:"100%",fontSize:13,fontWeight:700,padding:"11px",borderRadius:10,border:`1.5px solid ${C.accent}`,background:"transparent",color:C.accent,cursor:"pointer",minHeight:42}}
                          >
                            Save Recipe
                          </button>
                        ):(
                          <button onClick={()=>{setExpandedDay(day);setRecipeDay(null);}} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginTop:16,width:"100%",fontSize:13,fontWeight:600,padding:"11px",borderRadius:10,border:`1.5px solid ${C.border}`,background:"transparent",color:C.textSub,cursor:"pointer",minHeight:42}}>
                            <ArrowLeftRight size={14} strokeWidth={2}/> Pick a meal
                          </button>
                        )
                      )}
                    </>
                  )
                  })()}
                </div>
              );
            })}
          </div>
          </div>
          );
        })}
      </div>{/* end swipeable inner */}
      </div>{/* end carousel overflow wrapper */}

      {/* Bottom pagination dots */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"20px 0 4px"}}>
        {[-1,0,1].map(w=>(
          <button key={w} onClick={()=>setWeekOffsetPersist(w)} className="fk-press" style={{padding:0,border:"none",background:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
            {w===weekOffset?(
              <div style={{width:22,height:8,borderRadius:4,background:C.accent,transition:"all 0.2s"}}/>
            ):(
              <div style={{width:8,height:8,borderRadius:"50%",background:C.mutedBg,transition:"all 0.2s"}}/>
            )}
          </button>
        ))}
      </div>

      {/* Grocery + Share */}
      <div style={{padding:"32px 12px 0",display:"flex",flexDirection:"column",gap:8}}>
        <button onClick={()=>(!plannerShowPremiumUi||plannerTier!=="free")?setShowGrocery(true):(setPaywallHighlight("grocery"),setShowPaywallPlanner(true))} className="fk-press" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,width:"100%",padding:"16px",borderRadius:14,border:"none",background:C.text,color:C.bg,fontSize:15,fontWeight:800,cursor:"pointer",minHeight:52}}>
          <ShoppingCart size={18} strokeWidth={2.5}/> Grocery List
        </button>
        <button onClick={()=>(!plannerShowPremiumUi||plannerTier!=="free")?setShowShareSheet(true):(setPaywallHighlight("members"),setShowPaywallPlanner(true))} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,width:"100%",padding:"16px",borderRadius:14,border:"none",background:C.accent,color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",minHeight:52}}>
          <Share2 size={18} strokeWidth={2.5}/> Share Household Invite
        </button>
      </div>

      {showPaywallPlanner&&<PaywallSheet onClose={()=>setShowPaywallPlanner(false)} highlight={paywallHighlight}/>}
      {showGrocery&&<GrocerySheet plan={plan} onClose={()=>setShowGrocery(false)} householdSize={householdSize} orderedDays={orderedDays} nextWeekPlan={nextWeekPlan} nextWeekOrderedDays={getWindowDates(weekOffset+1)}/>}

      {showHouseholdSettings&&(
        <HouseholdSettings
          onClose={()=>setShowHouseholdSettings(false)}
          members={householdMembers}
          currentUserId={currentUserId}
          householdId={householdId}
          inviteCode={inviteCode}
          weekPlans={weekPlans}
          onSignOut={onSignOut}
          cookAssignment={cookAssignment}
          setCookDay={setCookDay}
          memberNames={memberNames}
          COOK_COLORS={COOK_COLORS}
          householdSize={householdSize}
          setHouseholdSize={(n)=>{
            setHouseholdSize(n);
            try{localStorage.setItem(`forknight_hsize_${householdId||"demo"}`,String(n));}catch{}
          }}
          themePref={themePref||"system"}
          setTheme={setTheme}
          onOpenShareSheet={()=>{setShowHouseholdSettings(false);setTimeout(()=>setShowShareSheet(true),320);}}
          showFeedback={showFeedback} setShowFeedback={setShowFeedback}
          feedbackType={feedbackType} setFeedbackType={setFeedbackType}
          feedbackText={feedbackText} setFeedbackText={setFeedbackText}
          feedbackSent={feedbackSent} setFeedbackSent={setFeedbackSent}
          feedbackSending={feedbackSending} setFeedbackSending={setFeedbackSending}
          showAppearanceSheet={showAppearanceSheet} setShowAppearanceSheet={setShowAppearanceSheet}
        />
      )}

      {/* Meal picker bottom sheet - rendered at root so it overlays everything */}
      {expandedDay&&(
        <MealSelector
          currentMeal={plan[expandedDay]?.meal}
          onSelect={m=>handleSetMeal(expandedDay,m)}
          onClose={()=>setExpandedDay(null)}
          ratings={communityRatings}
          usage={usage}
          favoriteProteins={favProteins}
          householdSize={householdSize}
          day={expandedDay}
          weekOffset={weekOffset}
          savedCustomMeals={savedCustomMeals}
          onRemoveCustomMeal={handleRemoveCustomMeal}
        />
      )}

      {/* Footer */}
      <div style={{maxWidth:650,margin:"0 auto",width:"100%"}}>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,padding:"16px 18px 24px",marginTop:8}}>
        <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:16}}>
          <button onClick={()=>{
            const text="Check out Forknight! Plan meals together. Eat meals together. https://forknight.app";
            if(navigator.share){navigator.share({title:"Forknight",text}).catch(()=>{});}
            else{navigator.clipboard.writeText(text).catch(()=>{});}
          }} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:C.muted,textDecoration:"underline",display:"inline-flex",alignItems:"center",gap:5,padding:0}}>
            <Share2 size={13} strokeWidth={2}/> Share the app
          </button>
          <span style={{width:1,height:12,background:C.border,flexShrink:0}}/>
          <button onClick={()=>setShowFeedback(true)}
            style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:C.muted,textDecoration:"underline",display:"inline-flex",alignItems:"center",gap:5,padding:0}}>
            <MessageCircle size={13} strokeWidth={2}/> Feedback
          </button>
          <span style={{width:1,height:12,background:C.border,flexShrink:0}}/>
          <button onClick={()=>setShowAppearanceSheet(true)}
            style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:C.muted,display:"inline-flex",alignItems:"center",gap:5,textDecoration:"underline",padding:0}}>
            {themePref==="dark"?<Moon size={13} strokeWidth={2}/>:themePref==="light"?<Sun size={13} strokeWidth={2}/>:<SunMoon size={13} strokeWidth={2}/>}
            Appearance
          </button>
        </div>
        <span style={{fontSize:10,color:C.muted}}>Forknight<sup style={{fontSize:"0.75em",verticalAlign:"super"}}>®</sup> v1.5.8</span>
      </div>
      </div>{/* end footer max-width */}
      {showFeedback&&(
        <div style={{position:"fixed",inset:0,background:C.overlay,zIndex:80,display:"flex",alignItems:"flex-end"}} onClick={()=>setShowFeedback(false)}>
          <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:480,margin:"0 auto",background:C.card,borderRadius:"20px 20px 0 0",padding:"24px 20px 40px",maxHeight:"85dvh",overflowY:"auto"}}>
            <div style={{width:36,height:4,borderRadius:2,background:C.border,margin:"0 auto 20px"}}/>
            {feedbackSent?(
              <div style={{textAlign:"center",padding:"20px 0"}}>
                <div style={{fontFamily:"'Playfair Display', Georgia, serif",fontSize:28,fontWeight:600,color:C.text,letterSpacing:"-1px",marginBottom:12}}><span style={{letterSpacing:"-0.05em"}}>F</span>orknight</div>
                <div style={{fontSize:17,fontWeight:700,color:C.text,marginBottom:6}}>Thanks for the feedback!</div>
                <div style={{fontSize:14,color:C.muted}}>We read every message.</div>
                <button onClick={()=>{setShowFeedback(false);setFeedbackSent(false);setFeedbackText("");}} style={{marginTop:20,padding:"12px 24px",borderRadius:10,background:C.accent,color:"#fff",border:"none",fontSize:14,fontWeight:700,cursor:"pointer"}}>Done</button>
              </div>
            ):(
              <>
                <div style={{fontSize:18,fontWeight:700,color:C.text,marginBottom:20}}>Send Feedback</div>
                <div style={{marginBottom:20,padding:"14px 16px",borderRadius:12,background:C.subtle,border:`1px solid ${C.border}`}}>
                  <div style={{fontSize:14,color:C.text,lineHeight:1.5}}>
                    Your feedback goes directly to the team and shapes what we build next. We read every message.
                  </div>
                </div>
                <div style={{marginBottom:14}}>
                  <label style={{fontSize:12,fontWeight:600,color:C.muted,display:"block",marginBottom:6}}>FEEDBACK TYPE</label>
                  <div style={{position:"relative"}}>
                    <select value={feedbackType} onChange={e=>setFeedbackType(e.target.value)}
                      style={{width:"100%",padding:"12px 14px",paddingRight:36,borderRadius:10,border:`1.5px solid ${C.border}`,background:C.bg,color:C.text,fontSize:14,appearance:"none",WebkitAppearance:"none"}}>
                      <option>Problem with the app</option>
                      <option>Suggest a recipe</option>
                      <option>Request a feature</option>
                      <option>Meal plan suggestion</option>
                      <option>I like the app!</option>
                      <option>Other</option>
                    </select>
                    <ChevronDown size={16} strokeWidth={2} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none",color:C.muted}}/>
                  </div>
                </div>
                <div style={{marginBottom:20}}>
                  <label style={{fontSize:12,fontWeight:600,color:C.muted,display:"block",marginBottom:6}}>MESSAGE</label>
                  <textarea value={feedbackText} onChange={e=>setFeedbackText(e.target.value.slice(0,2000))}
                    placeholder="Tell us what's on your mind…"
                    rows={5}
                    style={{width:"100%",padding:"12px 14px",borderRadius:10,border:`1.5px solid ${C.border}`,background:C.bg,color:C.text,fontSize:14,resize:"none",fontFamily:"system-ui,sans-serif",boxSizing:"border-box"}}/>
                  <div style={{fontSize:11,color:C.muted,textAlign:"right",marginTop:4}}>{feedbackText.length}/2000</div>
                </div>
                <button
                  disabled={!feedbackText.trim()||feedbackSending}
                  onClick={async()=>{
                    if(!feedbackText.trim())return;
                    setFeedbackSending(true);
                    try{
                      await supabase.from("feedback").insert({
                        type:feedbackType,
                        message:feedbackText.trim(),
                        user_id:currentUserId||null,
                        household_id:householdId||null,
                        created_at:new Date().toISOString(),
                      });
                      setFeedbackSent(true);
                    }catch(e){
                      console.error("[feedback]",e);
                    }finally{
                      setFeedbackSending(false);
                    }
                  }}
                  style={{width:"100%",padding:"14px",borderRadius:10,background:!feedbackText.trim()||feedbackSending?C.border:C.accent,color:!feedbackText.trim()||feedbackSending?C.muted:"#fff",border:"none",fontSize:15,fontWeight:700,cursor:feedbackText.trim()?"pointer":"default",transition:"all 0.15s"}}>
                  {feedbackSending?"Sending…":"Send Feedback"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {showAppearanceSheet&&(
        <>
          <div onClick={()=>setShowAppearanceSheet(false)} style={{position:"fixed",inset:0,background:C.overlay,zIndex:60}}/>
          <div style={{position:"fixed",left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:650,bottom:0,zIndex:61,background:C.card,borderRadius:"20px 20px 0 0",padding:"20px 18px 40px",boxShadow:"0 -4px 24px rgba(0,0,0,0.2)"}}>
            <div style={{width:36,height:4,borderRadius:2,background:C.border,margin:"0 auto 20px"}}/>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
              <div style={{fontSize:16,fontWeight:700,color:C.text}}>Appearance</div>
              <button onClick={()=>setShowAppearanceSheet(false)} style={{background:"none",border:"none",cursor:"pointer",padding:4,color:C.muted}}>
                <X size={20} strokeWidth={2}/>
              </button>
            </div>
            {[{id:"system",label:"System Default",Icon:SunMoon},{id:"light",label:"Light Mode",Icon:Sun},{id:"dark",label:"Dark Mode",Icon:Moon}].map(({id,label,Icon})=>(
              <button key={id} onClick={()=>{setTheme&&setTheme(id);setShowAppearanceSheet(false);}}
                style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"14px 0",background:"none",border:"none",borderBottom:`1px solid ${C.border}`,cursor:"pointer",color:C.text}}>
                <Icon size={18} strokeWidth={1.8} color={themePref===id?C.accent:C.muted}/>
                <span style={{fontSize:15,fontWeight:themePref===id?700:400,color:themePref===id?C.accent:C.text,flex:1,textAlign:"left"}}>{label}</span>
                {themePref===id&&<Check size={16} strokeWidth={2.5} color={C.accent}/>}
              </button>
            ))}
          </div>
        </>
      )}
      {/* Share sheet */}
      {showShareSheet&&(()=>{
        const shareText=inviteCode
          ?`Join my Forknight household!\n\nForknight keeps us synced on what's for dinner all week.\n\nhttps://forknight.app\n\nWhen you create your account, enter this code:\n${inviteCode}`
          :`Check out Forknight! Plan meals together. Eat meals together.\n\n→ forknight.app`;
        const handleShare=()=>{
          if(navigator.share){navigator.share({title:"Join Forknight",text:shareText}).catch(()=>{});}
          else{navigator.clipboard.writeText(shareText).catch(()=>{});setShareMsg("✓ Copied!");setTimeout(()=>setShareMsg(""),2500);}
        };
        const handleCopyCode=async()=>{
          try{await navigator.clipboard.writeText(inviteCode);}catch{}
          setShareMsg("✓ Copied!");
          setTimeout(()=>setShareMsg(""),2500);
        };
        return (
          <>
            <div onClick={()=>{setShowShareSheet(false);setShareMsg("");}} style={{position:"fixed",inset:0,background:C.overlay,zIndex:50}}/>
            <div style={{position:"fixed",left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:650,bottom:0,zIndex:51,background:C.card,borderRadius:"20px 20px 0 0",padding:"0 0 32px",boxShadow:"0 -4px 28px rgba(0,0,0,0.18)"}}>
              <div style={{display:"flex",justifyContent:"center",padding:"10px 0"}}>
                <div style={{width:36,height:4,borderRadius:2,background:C.mutedBg}}/>
              </div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"4px 18px 14px"}}>
                <div style={{fontSize:17,fontWeight:800}}>Invite to Forknight</div>
                <button onClick={()=>{setShowShareSheet(false);setShareMsg("");}} style={{display:"flex",alignItems:"center",justifyContent:"center",background:"none",border:"none",cursor:"pointer",color:C.muted,padding:4}}>
                  <X size={18} strokeWidth={2}/>
                </button>
              </div>

              {inviteCode&&(
                <div style={{margin:"0 18px 16px",background:C.card,border:`2px solid ${C.border}`,borderRadius:16,padding:"20px 24px",textAlign:"center"}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>Household invite code</div>
                  <div style={{fontFamily:"monospace",fontSize:32,fontWeight:800,color:C.text,letterSpacing:"0.2em",marginBottom:14}}>{inviteCode}</div>
                  <button onClick={handleCopyCode} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"8px 18px",borderRadius:10,border:`1.5px solid ${shareMsg?C.green:C.border}`,background:shareMsg?C.greenTint:"transparent",fontSize:13,fontWeight:600,color:shareMsg?C.green:C.muted,cursor:"pointer",transition:"all 0.2s"}}>
                    <Check size={13} strokeWidth={2.5} color={shareMsg?C.green:C.muted}/>
                    {shareMsg||"Copy code"}
                  </button>
                </div>
              )}

              <div style={{padding:"0 18px 12px"}}>
                <button onClick={handleShare} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,width:"100%",padding:"16px",borderRadius:14,border:"none",background:C.text,color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer"}}>
                  <Share2 size={18} strokeWidth={2.5}/> Share Household Invite
                </button>
              </div>
            </div>
          </>
        );
      })()}
      </div>{/* end max-width inner */}
    </div>
  );
}
