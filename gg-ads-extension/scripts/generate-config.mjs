import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envText = await readFile(resolve(root, '.env'), 'utf8').catch(() => {
  throw new Error('Missing gg-ads-extension/.env. Copy .env.example to .env first.');
});
const env = Object.fromEntries(envText.split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
const required = ['FIREBASE_API_KEY', 'FIREBASE_PROJECT_ID', 'FIREBASE_AUTH_PAGE'];
required.forEach((key) => { if (!env[key]) throw new Error(`Missing ${key} in gg-ads-extension/.env`); });

const config = {
  firebase: {
    apiKey: env.FIREBASE_API_KEY,
    projectId: env.FIREBASE_PROJECT_ID,
    authPage: env.FIREBASE_AUTH_PAGE
  }
};
await writeFile(resolve(root, 'config.js'), `globalThis.ADS_FOX_CONFIG = ${JSON.stringify(config, null, 2)};\n`);
console.log('Generated gg-ads-extension/config.js');
