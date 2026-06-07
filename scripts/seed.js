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
    id: 'mod-addon',
    name: 'Add-ons',
    is_required: false,
    max_select: 3,
    sort_order: 1,
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
  // ── Hot Drinks / HG (12oz) ───────────────────────────────────────────────────
  { id: 'HG-01', name: 'HG Americano',         category_id: 'cat-hot', category_name: 'Hot Drinks', price: 95,  cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'HG-02', name: 'HG Coffee Latte',      category_id: 'cat-hot', category_name: 'Hot Drinks', price: 145, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'HG-03', name: 'HG Spanish Latte',     category_id: 'cat-hot', category_name: 'Hot Drinks', price: 150, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'HG-04', name: 'HG Mocha',             category_id: 'cat-hot', category_name: 'Hot Drinks', price: 155, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'HG-05', name: 'HG Vanilla Latte',     category_id: 'cat-hot', category_name: 'Hot Drinks', price: 155, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'HG-06', name: 'HG White Mocha',       category_id: 'cat-hot', category_name: 'Hot Drinks', price: 160, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'HG-07', name: 'HG Seasalt Latte',     category_id: 'cat-hot', category_name: 'Hot Drinks', price: 160, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'HG-08', name: 'HG Caramel Macchiato', category_id: 'cat-hot', category_name: 'Hot Drinks', price: 160, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'HG-09', name: 'HG Butterscotch Latte',category_id: 'cat-hot', category_name: 'Hot Drinks', price: 160, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'HG-10', name: 'HG Dirty Matcha',      category_id: 'cat-hot', category_name: 'Hot Drinks', price: 160, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'HG-11', name: 'HG Chocolate Danish',  category_id: 'cat-hot', category_name: 'Hot Drinks', price: 170, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'HG-12', name: 'HG The Smart Shot',    category_id: 'cat-hot', category_name: 'Hot Drinks', price: 175, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },

  // ── Cold Drinks / CG (22oz) ──────────────────────────────────────────────────
  { id: 'CG-01', name: 'CG Americano',          category_id: 'cat-cold', category_name: 'Cold Drinks', price: 100, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'CG-02', name: 'CG Coffee Latte',       category_id: 'cat-cold', category_name: 'Cold Drinks', price: 155, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'CG-03', name: 'CG Spanish Latte',      category_id: 'cat-cold', category_name: 'Cold Drinks', price: 160, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'CG-04', name: 'CG Mocha',              category_id: 'cat-cold', category_name: 'Cold Drinks', price: 165, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'CG-05', name: 'CG Vanilla Latte',      category_id: 'cat-cold', category_name: 'Cold Drinks', price: 160, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'CG-06', name: 'CG White Mocha',        category_id: 'cat-cold', category_name: 'Cold Drinks', price: 170, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'CG-07', name: 'CG Seasalt Latte',      category_id: 'cat-cold', category_name: 'Cold Drinks', price: 170, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'CG-08', name: 'CG Caramel Macchiato',  category_id: 'cat-cold', category_name: 'Cold Drinks', price: 170, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'CG-09', name: 'CG Butterscotch Latte', category_id: 'cat-cold', category_name: 'Cold Drinks', price: 165, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'CG-10', name: 'CG Dirty Matcha',       category_id: 'cat-cold', category_name: 'Cold Drinks', price: 165, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'CG-11', name: 'CG Chocolate Danish',   category_id: 'cat-cold', category_name: 'Cold Drinks', price: 175, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'CG-12', name: 'CG The Smart Shot',     category_id: 'cat-cold', category_name: 'Cold Drinks', price: 180, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },
  { id: 'CG-13', name: 'CG Tiramisu Cloud Latte',category_id: 'cat-cold', category_name: 'Cold Drinks', price: 185, cost: 0, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: false, is_active: true, modifier_group_ids: ['mod-addon'], modifier_groups: getModifierGroupsForProduct(['mod-addon']) },

  // ── Pastries ────────────────────────────────────────────────────────────────
  { id: 'prod-p01', name: 'Butter Croissant', category_id: 'cat-pastry', category_name: 'Pastries', price: 75, cost: 30, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: true, is_active: true, modifier_group_ids: [], modifier_groups: [] },
  { id: 'prod-p02', name: 'Chocolate Muffin', category_id: 'cat-pastry', category_name: 'Pastries', price: 70, cost: 25, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: true, is_active: true, modifier_group_ids: [], modifier_groups: [] },

  // ── Snacks ───────────────────────────────────────────────────────────────────
  { id: 'prod-s01', name: 'Club Sandwich', category_id: 'cat-snack', category_name: 'Snacks', price: 150, cost: 65, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: true, is_active: true, modifier_group_ids: [], modifier_groups: [] },
  { id: 'prod-s02', name: 'Caesar Salad',  category_id: 'cat-snack', category_name: 'Snacks', price: 135, cost: 55, tracking_mode: 'none', stock_item_id: null, image: null, needs_kitchen: true, is_active: true, modifier_group_ids: [], modifier_groups: [] },
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
