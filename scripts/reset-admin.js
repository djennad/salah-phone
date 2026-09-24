// Réinitialise (ou crée) un compte administrateur.
// Usage : node scripts/reset-admin.js                       -> affiche les emails des admins
//         node scripts/reset-admin.js <email> <mot-de-passe> -> change le mot de passe (crée le compte s'il n'existe pas)
const path = require('node:path');
const { openDb } = require('../lib/db');
const { hashPassword } = require('../lib/security');

const db = openDb(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'salah-phone.db'));
const [email, password] = process.argv.slice(2);

if (!email) {
  const admins = db.prepare('SELECT email FROM users WHERE is_admin = 1').all();
  console.log(admins.length ? `Administrateurs : ${admins.map((a) => a.email).join(', ')}` : 'Aucun administrateur.');
  process.exit(0);
}
if (!password || password.length < 6) {
  console.error('Mot de passe manquant ou trop court (6 caractères minimum).');
  process.exit(1);
}

const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
if (user) {
  db.prepare('UPDATE users SET password_hash = ?, is_admin = 1 WHERE id = ?').run(hashPassword(password), user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  console.log(`Mot de passe changé pour ${email} (administrateur).`);
} else {
  db.prepare(`INSERT INTO users (first_name, last_name, email, password_hash, phone, is_admin)
              VALUES ('Salah', 'Admin', ?, ?, '0550000000', 1)`).run(email.toLowerCase(), hashPassword(password));
  console.log(`Compte administrateur créé : ${email}`);
}
