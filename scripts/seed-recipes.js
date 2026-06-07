// ─────────────────────────────────────────────────────────────────────────────
// SmartBrew POS — Recipe seed script
// Patches the `recipe` field on existing product documents.
// Usage: node scripts/seed-recipes.js
// ─────────────────────────────────────────────────────────────────────────────

const admin = require('firebase-admin');
const path  = require('path');

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();

// Each entry patches products/<productId> with a `recipe` object.
// ingredients: [{ name, qty?, unit? }]
// steps: string[]
const recipes = [

  // ── Americano ────────────────────────────────────────────────────────────────
  {
    productId: 'HG-01',
    recipe: {
      ingredients: [
        { name: 'Hot Water',  qty: 250, unit: 'ml' },
        { name: 'Espresso',   qty: 36,  unit: 'ml' },
      ],
      steps: [],
    },
  },
  {
    productId: 'CG-01',
    recipe: {
      ingredients: [
        { name: 'Ice',      qty: 16,  unit: 'oz' },
        { name: 'Espresso', qty: 36,  unit: 'ml' },
        { name: 'Water',    qty: 150, unit: 'ml' },
      ],
      steps: [],
    },
  },

  // ── Coffee Latte ─────────────────────────────────────────────────────────────
  {
    productId: 'HG-02',
    recipe: {
      ingredients: [
        { name: 'Arla Milk', qty: 250, unit: 'ml' },
        { name: 'Espresso',  qty: 36,  unit: 'ml' },
      ],
      steps: [],
    },
  },
  {
    productId: 'CG-02',
    recipe: {
      ingredients: [
        { name: 'Milk',     qty: 150, unit: 'ml' },
        { name: 'Espresso', qty: 36,  unit: 'ml' },
        { name: 'Ice',      qty: 16,  unit: 'oz' },
      ],
      steps: [],
    },
  },

  // ── Spanish Latte ────────────────────────────────────────────────────────────
  {
    productId: 'HG-03',
    recipe: {
      ingredients: [
        { name: 'Arla Milk',      qty: 250, unit: 'ml' },
        { name: 'Espresso',       qty: 36,  unit: 'ml' },
        { name: 'Condensed Milk', unit: 'to taste' },
      ],
      steps: [],
    },
  },
  {
    productId: 'CG-03',
    recipe: {
      ingredients: [
        { name: 'Milk Lab',       qty: 150, unit: 'ml' },
        { name: 'Espresso',       qty: 36,  unit: 'ml' },
        { name: 'Condensed Milk', unit: 'to taste' },
      ],
      steps: [],
    },
  },

  // ── Mocha ────────────────────────────────────────────────────────────────────
  {
    productId: 'HG-04',
    recipe: {
      ingredients: [
        { name: 'Arla Milk',    qty: 250, unit: 'ml' },
        { name: 'Espresso',     qty: 36,  unit: 'ml' },
        { name: 'OV Choco Sauce', qty: 15, unit: 'ml' },
      ],
      steps: [],
    },
  },
  {
    productId: 'CG-04',
    recipe: {
      ingredients: [
        { name: 'Milk Lab',   qty: 150, unit: 'ml' },
        { name: 'Espresso',   qty: 36,  unit: 'ml' },
        { name: 'Choco Sauce', qty: 30, unit: 'ml' },
      ],
      steps: [],
    },
  },

  // ── White Mocha ──────────────────────────────────────────────────────────────
  {
    productId: 'HG-06',
    recipe: {
      ingredients: [
        { name: 'Arla Milk',          qty: 250, unit: 'ml' },
        { name: 'Espresso',           qty: 36,  unit: 'ml' },
        { name: 'OV White Choco Sauce', qty: 15, unit: 'ml' },
      ],
      steps: [],
    },
  },
  {
    productId: 'CG-06',
    recipe: {
      ingredients: [
        { name: 'Milk Lab',           qty: 150, unit: 'ml' },
        { name: 'Espresso',           qty: 36,  unit: 'ml' },
        { name: 'OV White Choco Sauce', qty: 30, unit: 'ml' },
      ],
      steps: [],
    },
  },

  // ── Seasalt Latte ────────────────────────────────────────────────────────────
  {
    productId: 'HG-07',
    recipe: {
      ingredients: [
        { name: 'Arla Milk',                  qty: 200,  unit: 'ml'  },
        { name: 'Espresso',                   qty: 36,   unit: 'ml'  },
        { name: 'Milk (sea salt cream)',       qty: 30,   unit: 'ml'  },
        { name: 'Heavy Cream (sea salt cream)',qty: 30,   unit: 'ml'  },
        { name: 'Salt (sea salt cream)',       qty: 0.25, unit: 'tsp' },
        { name: 'Condensed Milk (sea salt cream)', qty: 1, unit: 'tbsp' },
      ],
      steps: [
        'Froth sea salt cream (milk, heavy cream, salt, condensed milk)',
        'Pour espresso, add steamed milk',
        'Pour sea salt cream on top',
      ],
    },
  },
  {
    productId: 'CG-07',
    recipe: {
      ingredients: [
        { name: 'Milk Lab',                    qty: 100,  unit: 'ml'  },
        { name: 'Espresso',                    qty: 36,   unit: 'ml'  },
        { name: 'Milk (sea salt cream)',        qty: 30,   unit: 'ml'  },
        { name: 'Heavy Cream (sea salt cream)', qty: 30,   unit: 'ml'  },
        { name: 'Salt (sea salt cream)',        qty: 0.25, unit: 'tsp' },
        { name: 'Condensed Milk (sea salt cream)', qty: 1, unit: 'tbsp' },
        { name: 'Ice',                          qty: 16,   unit: 'oz'  },
      ],
      steps: [
        'Froth sea salt cream (milk, heavy cream, salt, condensed milk)',
        'Fill glass with ice, add milk and espresso',
        'Pour sea salt cream on top',
      ],
    },
  },

  // ── Caramel Macchiato ────────────────────────────────────────────────────────
  {
    productId: 'HG-08',
    recipe: {
      ingredients: [
        { name: 'Arla Milk',          qty: 250, unit: 'ml' },
        { name: 'Espresso',           qty: 36,  unit: 'ml' },
        { name: 'OV Caramel Sauce',   qty: 10,  unit: 'ml' },
        { name: 'French Vanilla Syrup', qty: 5, unit: 'ml' },
      ],
      steps: [],
    },
  },
  {
    productId: 'CG-08',
    recipe: {
      ingredients: [
        { name: 'Milk Lab',           qty: 150, unit: 'ml' },
        { name: 'Espresso',           qty: 36,  unit: 'ml' },
        { name: 'OV Caramel Sauce',   qty: 25,  unit: 'ml' },
        { name: 'French Vanilla Syrup', qty: 5, unit: 'ml' },
      ],
      steps: [],
    },
  },

  // ── Butterscotch Latte (Butter Ball) ─────────────────────────────────────────
  {
    productId: 'HG-09',
    recipe: {
      ingredients: [
        { name: 'Arla Milk',               qty: 250, unit: 'ml' },
        { name: 'Espresso',                qty: 36,  unit: 'ml' },
        { name: 'Butterscotch Sauce',      qty: 10,  unit: 'ml' },
        { name: 'Shortbread Cookies Syrup', qty: 5,  unit: 'ml' },
      ],
      steps: [],
    },
  },
  {
    productId: 'CG-09',
    recipe: {
      ingredients: [
        { name: 'Milk Lab',                qty: 150, unit: 'ml' },
        { name: 'Espresso',                qty: 36,  unit: 'ml' },
        { name: 'Butterscotch Sauce',      qty: 20,  unit: 'ml' },
        { name: 'Shortbread Cookies Syrup', qty: 10, unit: 'ml' },
      ],
      steps: [],
    },
  },

  // ── Tiramisu Cloud Latte (cold only) ─────────────────────────────────────────
  {
    productId: 'CG-13',
    recipe: {
      ingredients: [
        { name: 'Milk Lab',                      qty: 150, unit: 'ml'   },
        { name: 'Espresso',                      qty: 36,  unit: 'ml'   },
        { name: 'Ice',                           qty: 16,  unit: 'oz'   },
        { name: 'Tiramisu Syrup',                qty: 10,  unit: 'ml'   },
        { name: 'Cream Cheese (cloud foam)',      qty: 30,  unit: 'g'    },
        { name: 'Heavy Cream (cloud foam)',       qty: 10,  unit: 'ml'   },
        { name: 'Milk (cloud foam)',              qty: 10,  unit: 'ml'   },
        { name: 'Vanilla Syrup (cloud foam)',     qty: 1,   unit: 'pump' },
        { name: 'Cocoa Powder',                  unit: 'garnish'        },
        { name: 'Ladyfinger Biscuit',            qty: 1,   unit: 'pc'   },
      ],
      steps: [
        'Fill glass with ice cubes',
        'Add tiramisu syrup and milk',
        'Pour espresso slowly to create layered effect',
        'Make cloud foam: combine cream cheese, milk, heavy cream and vanilla syrup with handheld frother. Whisk until light, smooth and foamy',
        'Add cloud foam on top',
        'Dust with cocoa powder and serve with ladyfinger biscuit',
      ],
    },
  },
];

// ── Patch products ────────────────────────────────────────────────────────────

async function seedRecipes() {
  console.log('🌱 Seeding recipes...\n');

  for (const { productId, recipe } of recipes) {
    await db.collection('products').doc(productId).update({ recipe });
    console.log(`  ✓ ${productId}`);
  }

  console.log(`\n✅ Done — ${recipes.length} recipes written.`);
  process.exit(0);
}

seedRecipes().catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
