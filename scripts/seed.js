// ─────────────────────────────────────────────────────────────────────────────
// SmartBrew POS — Firestore seed script
// Usage: node scripts/seed.js
// Requires: scripts/serviceAccountKey.json  (download from Firebase Console →
//           Project Settings → Service Accounts → Generate new private key)
// ─────────────────────────────────────────────────────────────────────────────

const admin = require('firebase-admin');
const path  = require('path');

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ── Seed data ─────────────────────────────────────────────────────────────────

const categories = [
  { id: 'cat-hot',     name: 'Hot Drinks',  sort_order: 1, is_active: true },
  { id: 'cat-cold',    name: 'Cold Drinks', sort_order: 2, is_active: true },
  { id: 'cat-pastry',  name: 'Pastries',    sort_order: 3, is_active: true },
  { id: 'cat-snack',   name: 'Snacks',      sort_order: 4, is_active: true },
];

const modifierGroups = [
  {
    id: 'mod-size',
    name: 'Size',
    is_required: true,
    max_select: 1,
    sort_order: 1,
    is_active: true,
    modifiers: [
      { id: 'mod-size-s',  name: 'Small',  price_delta: 0,   sort_order: 1, is_active: true },
      { id: 'mod-size-m',  name: 'Medium', price_delta: 15,  sort_order: 2, is_active: true },
      { id: 'mod-size-l',  name: 'Large',  price_delta: 30,  sort_order: 3, is_active: true },
    ],
  },
  {
    id: 'mod-temp',
    name: 'Temperature',
    is_required: true,
    max_select: 1,
    sort_order: 2,
    is_active: true,
    modifiers: [
      { id: 'mod-temp-hot',  name: 'Hot',  price_delta: 0, sort_order: 1, is_active: true },
      { id: 'mod-temp-iced', name: 'Iced', price_delta: 0, sort_order: 2, is_active: true },
    ],
  },
  {
    id: 'mod-addon',
    name: 'Add-ons',
    is_required: false,
    max_select: 3,
    sort_order: 3,
    is_active: true,
    modifiers: [
      { id: 'mod-addon-cream',  name: 'Extra Cream',   price_delta: 10, sort_order: 1, is_active: true },
      { id: 'mod-addon-sugar',  name: 'Extra Sugar',   price_delta: 0,  sort_order: 2, is_active: true },
      { id: 'mod-addon-syrup',  name: 'Caramel Syrup', price_delta: 15, sort_order: 3, is_active: true },
      { id: 'mod-addon-pearls', name: 'Pearl Jelly',   price_delta: 20, sort_order: 4, is_active: true },
    ],
  },
];

const products = [
  // ── Hot Drinks ──────────────────────────────────────────────────────────────
  {
    id: 'prod-001',
    name: 'Brewed Coffee',
    category_id: 'cat-hot', category_name: 'Hot Drinks',
    price: 80, cost: 25,
    tracking_mode: 'none', stock_item_id: null, image: null,
    needs_kitchen: false, is_active: true,
    modifier_group_ids: ['mod-size', 'mod-addon'],
    modifier_groups: getModifierGroupsForProduct(['mod-size', 'mod-addon']),
  },
  {
    id: 'prod-002',
    name: 'Americano',
    category_id: 'cat-hot', category_name: 'Hot Drinks',
    price: 95, cost: 30,
    tracking_mode: 'none', stock_item_id: null, image: null,
    needs_kitchen: false, is_active: true,
    modifier_group_ids: ['mod-size', 'mod-addon'],
    modifier_groups: getModifierGroupsForProduct(['mod-size', 'mod-addon']),
  },
  {
    id: 'prod-003',
    name: 'Café Latte',
    category_id: 'cat-hot', category_name: 'Hot Drinks',
    price: 110, cost: 40,
    tracking_mode: 'none', stock_item_id: null, image: null,
    needs_kitchen: false, is_active: true,
    modifier_group_ids: ['mod-size', 'mod-addon'],
    modifier_groups: getModifierGroupsForProduct(['mod-size', 'mod-addon']),
  },

  // ── Cold Drinks ─────────────────────────────────────────────────────────────
  {
    id: 'prod-004',
    name: 'Iced Coffee',
    category_id: 'cat-cold', category_name: 'Cold Drinks',
    price: 100, cost: 35,
    tracking_mode: 'none', stock_item_id: null, image: null,
    needs_kitchen: false, is_active: true,
    modifier_group_ids: ['mod-size', 'mod-addon'],
    modifier_groups: getModifierGroupsForProduct(['mod-size', 'mod-addon']),
  },
  {
    id: 'prod-005',
    name: 'Matcha Latte',
    category_id: 'cat-cold', category_name: 'Cold Drinks',
    price: 120, cost: 45,
    tracking_mode: 'none', stock_item_id: null, image: null,
    needs_kitchen: false, is_active: true,
    modifier_group_ids: ['mod-size', 'mod-temp', 'mod-addon'],
    modifier_groups: getModifierGroupsForProduct(['mod-size', 'mod-temp', 'mod-addon']),
  },
  {
    id: 'prod-006',
    name: 'Strawberry Milk Tea',
    category_id: 'cat-cold', category_name: 'Cold Drinks',
    price: 115, cost: 40,
    tracking_mode: 'none', stock_item_id: null, image: null,
    needs_kitchen: false, is_active: true,
    modifier_group_ids: ['mod-size', 'mod-addon'],
    modifier_groups: getModifierGroupsForProduct(['mod-size', 'mod-addon']),
  },

  // ── Pastries ────────────────────────────────────────────────────────────────
  {
    id: 'prod-007',
    name: 'Butter Croissant',
    category_id: 'cat-pastry', category_name: 'Pastries',
    price: 75, cost: 30,
    tracking_mode: 'none', stock_item_id: null, image: null,
    needs_kitchen: true, is_active: true,
    modifier_group_ids: [],
    modifier_groups: [],
  },
  {
    id: 'prod-008',
    name: 'Chocolate Muffin',
    category_id: 'cat-pastry', category_name: 'Pastries',
    price: 70, cost: 25,
    tracking_mode: 'none', stock_item_id: null, image: null,
    needs_kitchen: true, is_active: true,
    modifier_group_ids: [],
    modifier_groups: [],
  },

  // ── Snacks ───────────────────────────────────────────────────────────────────
  {
    id: 'prod-009',
    name: 'Club Sandwich',
    category_id: 'cat-snack', category_name: 'Snacks',
    price: 150, cost: 65,
    tracking_mode: 'none', stock_item_id: null, image: null,
    needs_kitchen: true, is_active: true,
    modifier_group_ids: [],
    modifier_groups: [],
  },
  {
    id: 'prod-010',
    name: 'Caesar Salad',
    category_id: 'cat-snack', category_name: 'Snacks',
    price: 135, cost: 55,
    tracking_mode: 'none', stock_item_id: null, image: null,
    needs_kitchen: true, is_active: true,
    modifier_group_ids: [],
    modifier_groups: [],
  },
];

// Helper — embed modifier group data directly on each product (denormalized)
function getModifierGroupsForProduct(groupIds) {
  return modifierGroups
    .filter(g => groupIds.includes(g.id))
    .map(({ id, name, is_required, max_select, modifiers }) =>
      ({ id, name, is_required, max_select, modifiers }));
}

// ── Write to Firestore ────────────────────────────────────────────────────────

async function seed() {
  console.log('🌱 Seeding Firestore...\n');

  // Categories
  console.log('Writing categories...');
  for (const cat of categories) {
    const { id, ...data } = cat;
    await db.collection('categories').doc(id).set(data);
    console.log(`  ✓ ${cat.name}`);
  }

  // Modifier groups
  console.log('\nWriting modifier groups...');
  for (const group of modifierGroups) {
    const { id, ...data } = group;
    await db.collection('modifier_groups').doc(id).set(data);
    console.log(`  ✓ ${group.name} (${group.modifiers.length} options)`);
  }

  // Products
  console.log('\nWriting products...');
  for (const product of products) {
    const { id, ...data } = product;
    await db.collection('products').doc(id).set(data);
    console.log(`  ✓ ${product.name} — ₱${product.price}`);
  }

  console.log('\n✅ Seed complete!');
  console.log(`   ${categories.length} categories`);
  console.log(`   ${modifierGroups.length} modifier groups`);
  console.log(`   ${products.length} products`);
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
