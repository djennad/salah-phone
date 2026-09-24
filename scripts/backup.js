// Sauvegarde à chaud de la base SQLite (sans arrêter le site).
// Usage : node scripts/backup.js [dossier]   — garde les 14 dernières sauvegardes.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dbFile = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'salah-phone.db');
const dir = process.argv[2] || process.env.BACKUP_DIR || path.join(path.dirname(dbFile), 'backups');
const keep = Number(process.env.BACKUP_KEEP) || 14;

fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const out = path.join(dir, `salah-phone-${stamp}.db`);
const db = new DatabaseSync(dbFile, { readOnly: true });
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();
console.log('Sauvegarde :', out);

const old = fs.readdirSync(dir).filter((f) => /^salah-phone-.*\.db$/.test(f)).sort().reverse().slice(keep);
for (const f of old) fs.rmSync(path.join(dir, f));
