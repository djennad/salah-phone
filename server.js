const path = require('node:path');
const { openDb, ensureBaseData, seedDemo } = require('./lib/db');
const { createApp } = require('./lib/app');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'salah-phone.db');

const db = openDb(DB_FILE);
ensureBaseData(db, {
  adminEmail: process.env.ADMIN_EMAIL || 'admin@salahphone.dz',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
});
if (process.env.SEED_DEMO !== '0' && seedDemo(db)) console.log('[salah-phone] Catalogue de démonstration ajouté.');

const app = createApp(db, {
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'),
  secureCookie: process.env.SECURE_COOKIE === '1',
  trustProxy: process.env.TRUST_PROXY === '1',
  dev: process.env.NODE_ENV !== 'production',
});

app.listen(PORT, () => console.log(`[salah-phone] http://localhost:${PORT}  —  admin : http://localhost:${PORT}/admin`));
