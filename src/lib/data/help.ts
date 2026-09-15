// ─────────────────────────────────────────────────────────────
// RUCHI — contextual help library
// ─────────────────────────────────────────────────────────────
// Structured, curated answers to the questions beginners actually ask
// mid-cook. The AI layer can extend/rewrite these per-recipe, but the
// deterministic answers must stand on their own.

export interface HelpEntry {
  id: string;
  question: string; // as shown on the chip
  answer: string; // short, warm, direct
}

export const HELP_LIBRARY: Record<string, HelpEntry> = {
  "medium-flame": {
    id: "medium-flame",
    question: "What does medium flame mean?",
    answer:
      "Dial knob to the middle (4–5 out of 9, roughly). The pan sizzles gently when a drop of water dances on it — it should NOT spit violently or smoke.",
  },
  "high-flame-stirfry": {
    id: "high-flame-stirfry",
    question: "How hot is 'high heat'?",
    answer:
      "Highest or second-highest dial. The pan crackles loudly the moment food touches it. Keep the food moving — that's why everything is chopped before you start.",
  },
  "toss-vs-stir": {
    id: "toss-vs-stir",
    question: "Toss or stir?",
    answer:
      "Stir with a spatula if you're unsure — it's gentler and nothing lands on the stove. Tossing (lifting the pan and flicking) just moves things faster once you're comfortable.",
  },
  "pressure-cooker-dal": {
    id: "pressure-cooker-dal",
    question: "How many whistles?",
    answer:
      "3 whistles on medium for soft dal, then let the pressure settle on its own for 5 minutes before opening. Never force the lid — steam burns are real.",
  },
  "why-cool-first": {
    id: "why-cool-first",
    question: "Why cool the rice first?",
    answer:
      "Hot rice steams and clumps; cooled rice grains stay separate and fry instead of mush. 10 minutes spread on a plate is enough.",
  },
  "pan-heat-test": {
    id: "pan-heat-test",
    question: "How do I know the pan is hot?",
    answer:
      "Flick a tiny drop of water at the pan. If it sizzles and evaporates in 1–2 seconds, it's ready. If it sits and steams, wait 30 more seconds.",
  },
  "tawa-temp": {
    id: "tawa-temp",
    question: "Is my tawa ready?",
    answer:
      "Hold your palm 10cm above it — you should feel clear heat in 2 seconds. Or flick water: it should dance and evaporate instantly.",
  },
  "saute-onion": {
    id: "saute-onion",
    question: "How do I know the onion is ready?",
    answer:
      "It stops looking white/opaque, turns translucent with golden edges, and the sharp raw smell fades into something sweeter. If it's browning fast, drop the flame.",
  },
  "masala-ready-cue": {
    id: "masala-ready-cue",
    question: "How do I know the masala is done?",
    answer:
      "The tomatoes have fully collapsed, the mix thickens, and you'll see tiny oil bubbles separating at the edges. That oil = your spices are cooked out properly.",
  },
  "tempering-tadka": {
    id: "tempering-tadka",
    question: "What is a tadka/tempering?",
    answer:
      "Blooming whole spices in hot oil for ~20 seconds so they release flavour. Cumin darkens a shade, mustard seeds pop. 20 seconds, not 60 — burned spices turn the whole dish bitter.",
  },
  "is-it-cooked": {
    id: "is-it-cooked",
    question: "How do I know it's ready?",
    answer:
      "Eggs: no visible liquid, curds look set but still glossy. Press the centre with the spatula — it should spring back, not slosh. When unsure, 30 more seconds on low is safer than raw.",
  },
  "why-rubbery-eggs": {
    id: "why-rubbery-eggs",
    question: "Why did my eggs turn rubbery?",
    answer:
      "Heat was too high or they cooked too long. Eggs keep cooking from residual heat — pull them off the flame while they still look slightly wet. Low and slow wins.",
  },
  "why-paneer-rubber": {
    id: "why-paneer-rubber",
    question: "How do I keep paneer soft?",
    answer:
      "Add it last, keep the flame low, and cook max 2–3 minutes. Paneer only needs to warm through. Long cooking pushes the moisture out — that's the rubber.",
  },
  "crack-egg-clean": {
    id: "crack-egg-clean",
    question: "Easiest way to crack eggs?",
    answer:
      "One firm tap on a flat surface (not the pan edge — shell shards), thumbs into the crack, open over the bowl. If a shell bit falls in, use half a shell to fish it out — it works like a magnet.",
  },
  "how-whisk": {
    id: "how-whisk",
    question: "How long should I whisk?",
    answer:
      "About 30 seconds with a fork — until you can't see separate egg whites and the surface has small bubbles. You're mixing, not making meringue.",
  },
  "flip-omelette": {
    id: "flip-omelette",
    question: "My omelette keeps breaking when I flip",
    answer:
      "Wait longer before flipping — the top should be mostly set with only a glossy sheen. Slide the spatula fully under first, one confident motion. Broken omelette is just… bhurji. Nobody will know.",
  },
  "knife-basics": {
    id: "knife-basics",
    question: "Chopping basics?",
    answer:
      "Curl your fingertips under (knuckle guides the blade), let the knife do the work, keep the tip anchored for small cuts. Halve the onion pole-to-pole for easy slices. Slow and even beats fast and ragged.",
  },
  "mise-en-place": {
    id: "mise-en-place",
    question: "Why prep everything first?",
    answer:
      "Because once the pan is hot, there's no time to chop. Every fast recipe assumes everything is within arm's reach. Plates and bowls, not bags of raw veg.",
  },
  "cook-rice": {
    id: "cook-rice",
    question: "How do I cook rice properly?",
    answer:
      "Rinse until water runs clear. 1 cup rice : 2 cups water, bring to a boil, lowest flame, lid on, 12 minutes. Off the flame, rest 5 minutes, fluff with a fork. No stirring while cooking.",
  },
  "wash-rice": {
    id: "wash-rice",
    question: "Do I really need to rinse rice?",
    answer:
      "Yes — 2–3 rinses until the water isn't milky. Loose starch is what makes rice gummy. 30 seconds that changes everything.",
  },
  "wash-dal": {
    id: "wash-dal",
    question: "How do I wash dal?",
    answer:
      "Put it in a pot, cover with water, swirl with your hand, pour off the cloudy water. Repeat 2–3 times until mostly clear.",
  },
  "no-peeking": {
    id: "no-peeking",
    question: "Why can't I lift the lid?",
    answer:
      "Steam is the cooking engine. Every lift dumps it and adds ~2 minutes and uneven rice. Trust the timer; the lid stays down.",
  },
  "rolling-boil": {
    id: "rolling-boil",
    question: "What's a rolling boil?",
    answer:
      "Big bubbles that don't stop when you stir — the whole surface is moving, not just the edges. Small-edge bubbles are a 'coming soon', not a boil.",
  },
  "boil-eggs": {
    id: "boil-eggs",
    question: "Perfect boiled eggs?",
    answer:
      "Water boiling first, lower eggs in gently, then 9 minutes for firm yolks. Straight into cold/running water after — stops the green ring and makes peeling easy.",
  },
  "curd-split-fix": {
    id: "curd-split-fix",
    question: "My curd is splitting in the curry",
    answer:
      "Heat is the enemy of curd. Take the pan off the flame, whisk the curd smooth, stir it in, then return on the LOWEST flame for a minute or two. Never a rolling boil after curd.",
  },
  "curd-split-fix-2": {
    id: "curd-split-fix-2",
    question: "Why did my curry look curdled?",
    answer:
      "Curd boiled too hard. Off-heat stirring fixes most of it; a teaspoon of besan whisked into the curd before adding prevents it next time.",
  },
  "fix-watery": {
    id: "fix-watery",
    question: "It's too watery. Fix it?",
    answer:
      "Take the lid off, raise the flame to medium, and let steam escape. Stir every minute so the bottom doesn't catch. Most gravies thicken in 3–5 minutes.",
  },
  "fix-too-salty": {
    id: "fix-too-salty",
    question: "I added too much salt",
    answer:
      "Add a chunk of raw potato or a ball of dough and simmer 10 minutes (they absorb some salt), or dilute with water/unsalted tomato and rebalance the spices. Also: next time, salt in halves.",
  },
  "fix-burnt": {
    id: "fix-burnt",
    question: "I think I burned it",
    answer:
      "Smell it. If the burn is on the bottom only: DO NOT scrape the bottom — move the good top layer to a fresh pot immediately, keep the burnt layer behind. Add a little hot water to the fresh pot and continue. Burnt is a flavour, not a life sentence.",
  },
  "fix-bitter": {
    id: "fix-bitter",
    question: "It tastes bitter",
    answer:
      "Usually burned garlic/chili powder or over-fried cumin. A pinch of sugar + a squeeze of lemon rebalances. If it's truly burned, the fresh-pot rescue is the only fix.",
  },
  "why-watery-curry": {
    id: "why-watery-curry",
    question: "Why is this watery?",
    answer:
      "Tomatoes release a lot of water, and lids trap it. Cook uncovered on medium to reduce, or mash a couple of veggie pieces into the gravy for body.",
  },
  "utensil-missing": {
    id: "utensil-missing",
    question: "I don't have this utensil",
    answer:
      "Kadai → any deep frying pan. Tawa → any flat pan. Pressure cooker → covered pot with 50% more time. Non-stick makes beginner life easier but isn't required.",
  },
  "no-lumps": {
    id: "no-lumps",
    question: "How do I avoid lumps?",
    answer:
      "Two hands: one sprinkles the rava/oats slowly like rain, the other stirs non-stop. Lumps happen when a whole pile hits the water at once.",
  },
  "why-roast-rava": {
    id: "why-roast-rava",
    question: "Why roast the rava first?",
    answer:
      "Raw rava clumps into glue. Roasted rava stays grainy and separate, and it tastes nutty. 4 minutes now or regret later.",
  },
  "poha-rinse": {
    id: "poha-rinse",
    question: "Rinse or soak poha?",
    answer:
      "Rinse. 10 seconds in a colander, drain, done. Soaked poha is baby food. Thick poha can handle a 30-second rinse; thin poha barely needs to touch water.",
  },
  "fix-soggy-poha": {
    id: "fix-soggy-poha",
    question: "My poha is soggy",
    answer:
      "It soaked too long or the pan was crowded. Next time: rinse-drain fast, and cook on a wide pan. Still tastes good — just call it a different style.",
  },
  "fry-peanuts": {
    id: "fry-peanuts",
    question: "How do I know peanuts are fried?",
    answer:
      "They darken one shade and smell nutty — around 2 minutes on medium. They also crisp more as they cool, so pull them a touch early.",
  },
  "why-squeeze-soya": {
    id: "why-squeeze-soya",
    question: "Why squeeze the soya chunks?",
    answer:
      "Boiled soya is a water sponge. Squeezed soya is an empty sponge — it soaks up your curry instead of staying bland and squeaky.",
  },
  "why-blanch": {
    id: "why-blanch",
    question: "Why blanch the spinach?",
    answer:
      "90 seconds of boiling + cold water stops the enzymes that turn spinach khaki-green, and softens it for a silky purée. Skip it and you'll get dark, grassy paneer saag.",
  },
  "knead-dough": {
    id: "knead-dough",
    question: "How do I knead dough?",
    answer:
      "Add water gradually — you'll use less than you think. Push with the heel of your palm, fold, quarter-turn, repeat 5 minutes. Soft and slightly tacky is correct; dry dough cracks.",
  },
  "roll-paratha": {
    id: "roll-paratha",
    question: "My paratha filling is leaking",
    answer:
      "Roll gently with even pressure, seal the pouch properly, and don't rush the thickness. A small leak is fine — patch it with a pinch of dry atta.",
  },
  "raw-chicken-safety": {
    id: "raw-chicken-safety",
    question: "Raw chicken safety basics?",
    answer:
      "Wash hands with soap after touching it. Wash the knife and board before anything else touches them. Don't rinse raw chicken in the sink — it sprays bacteria around. Cook until no pink inside.",
  },
  "chicken-done-temp": {
    id: "chicken-done-temp",
    question: "How do I know chicken is cooked?",
    answer:
      "Cut the thickest piece: meat should be white to the centre with clear juices — never pink (that's 74°C, the safe temperature). If there's any pink, 2–3 more minutes simmering.",
  },
  "substitute": {
    id: "substitute",
    question: "I don't have this ingredient",
    answer:
      "Check the substitutions card on the meal — every recipe in RUCHI lists its honest swaps. The best general fixes: onion→spring onion, curd→milk+lemon, ghee→butter/oil, green chili→chili powder.",
  },
  "protein-lower": {
    id: "protein-lower",
    question: "Can I get more protein from this?",
    answer:
      "Easy adds: one extra egg, 50g more paneer, or a handful of peanuts on top. The meal detail screen recalculates protein live when you change servings.",
  },
};

export const GENERIC_HELP_IDS = ["substitute", "protein-lower", "utensil-missing"] as const;

export function getHelp(id: string): HelpEntry | undefined {
  return HELP_LIBRARY[id];
}
