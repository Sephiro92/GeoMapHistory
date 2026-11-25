// Compte administrateur et clé de session.
//
// Ordre de priorité pour ADMIN_USERNAME / ADMIN_PASSWORD :
//   1. variables d'environnement (commande, docker compose…)
//   2. fichier data/.env
//   3. génération automatique : ajoutées à data/.env et affichées dans les logs du conteneur.
// La clé de session (JWT_SECRET) est facultative : à défaut, elle est créée dans data/.session-secret.
import { randomBytes } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './content/files.js';

export interface Account {
  username: string;
  password: string;
  jwtSecret: string;
}

const ENV_FILE = path.join(DATA_DIR, '.env');
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');

const readText = (file: string) => readFile(file, 'utf8').catch(() => null);

function parseEnv(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trim().startsWith('#')) continue;
    vars[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
}

/** Mot de passe lisible (sans caractères ambigus), ~95 bits d'entropie. */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return [...randomBytes(17)].map((b) => alphabet[b % alphabet.length]).join('');
}

async function sessionSecret(fileVars: Record<string, string>): Promise<string> {
  const configured = process.env.JWT_SECRET || fileVars.JWT_SECRET;
  if (configured) return configured;
  const stored = (await readText(SECRET_FILE))?.trim();
  if (stored) return stored;
  const secret = randomBytes(48).toString('base64url');
  await writeFile(SECRET_FILE, `${secret}\n`, { mode: 0o600 });
  return secret;
}

export async function loadAccount(): Promise<Account> {
  const envText = await readText(ENV_FILE);
  const fileVars = envText ? parseEnv(envText) : {};

  let username = process.env.ADMIN_USERNAME || fileVars.ADMIN_USERNAME || '';
  let password = process.env.ADMIN_PASSWORD || fileVars.ADMIN_PASSWORD || '';
  const generated: Record<string, string> = {};
  if (!username) generated.ADMIN_USERNAME = username = 'admin';
  if (!password) generated.ADMIN_PASSWORD = password = generatePassword();

  if (Object.keys(generated).length) {
    const lines = Object.entries(generated).map(([k, v]) => `${k}=${v}`);
    const prefix = envText === null ? '# Compte administrateur de GeoMapHistory\n' : envText.endsWith('\n') || envText === '' ? '' : '\n';
    await appendFile(ENV_FILE, `${prefix}# Généré automatiquement le ${new Date().toISOString()}\n${lines.join('\n')}\n`);

    const banner = [
      `Compte administrateur ${Object.keys(generated).length === 2 ? 'généré' : 'complété'} automatiquement (enregistré dans data/.env) :`,
      `  identifiant  : ${username}`,
      `  mot de passe : ${generated.ADMIN_PASSWORD ?? '(inchangé, voir data/.env ou la commande)'}`,
    ];
    const width = Math.max(...banner.map((l) => l.length)) + 2;
    console.log(['', `╔${'═'.repeat(width)}╗`, ...banner.map((l) => `║ ${l.padEnd(width - 1)}║`), `╚${'═'.repeat(width)}╝`, ''].join('\n'));
  } else {
    console.log(`Compte administrateur : ${username} (mot de passe dans data/.env ou fourni au lancement)`);
  }

  return { username, password, jwtSecret: await sessionSecret(fileVars) };
}
