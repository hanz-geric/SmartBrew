// ─────────────────────────────────────────────────────────────────────────────
// SmartBrew POS — User seed script
// Usage: node scripts/seed-users.js
// Requires: scripts/serviceAccountKey.json
//
// Creates Firebase Auth accounts + Firestore /users/{uid} documents.
// Existing users (matched by email) are updated, not duplicated.
// ─────────────────────────────────────────────────────────────────────────────

const admin = require('firebase-admin');
const path  = require('path');

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const auth = admin.auth();
const db   = admin.firestore();

const DOMAIN = '@smartbrew.app';

// ── Users to seed ─────────────────────────────────────────────────────────────
// Change passwords before deploying to production.

const users = [
  {
    username:  'admin',
    full_name: 'Admin User',
    role:      'admin',
    password:  'Admin@1234',
  },
  {
    username:  'manager',
    full_name: 'Store Manager',
    role:      'manager',
    password:  'Manager@1234',
  },
  {
    username:  'cashier1',
    full_name: 'Juan dela Cruz',
    role:      'cashier',
    password:  'Cashier@1234',
  },
  {
    username:  'cashier2',
    full_name: 'Maria Santos',
    role:      'cashier',
    password:  'Cashier@1234',
  },
];

// ── Seed ──────────────────────────────────────────────────────────────────────

async function seedUsers() {
  console.log('👤 Seeding users...\n');

  for (const u of users) {
    const email = `${u.username}${DOMAIN}`;

    // Create or update the Firebase Auth account
    let uid;
    try {
      const existing = await auth.getUserByEmail(email);
      uid = existing.uid;
      await auth.updateUser(uid, { password: u.password, displayName: u.full_name });
      console.log(`  ↻ Updated Auth: ${email}`);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        const created = await auth.createUser({
          email,
          password:    u.password,
          displayName: u.full_name,
        });
        uid = created.uid;
        console.log(`  + Created Auth: ${email}`);
      } else {
        throw err;
      }
    }

    // Write the Firestore profile document
    await db.collection('users').doc(uid).set({
      username:  u.username,
      full_name: u.full_name,
      role:      u.role,
      is_active: true,
    });
    console.log(`  ✓ Firestore /users/${uid}  (${u.role})\n`);
  }

  console.log('✅ Users seeded!');
  console.log('\nCredentials:');
  for (const u of users) {
    console.log(`  ${u.role.padEnd(8)}  ${u.username.padEnd(10)}  ${u.password}`);
  }
  console.log('\n⚠  Change passwords before going to production.\n');
  process.exit(0);
}

seedUsers().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
