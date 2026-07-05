const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const envPath = join(__dirname, '.env');
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const value = line.trim();
    if (!value || value.startsWith('#')) return;
    const separator = value.indexOf('=');
    if (separator < 1) return;
    const key = value.slice(0, separator).trim();
    if (!process.env[key]) process.env[key] = value.slice(separator + 1).trim();
  });
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in functions/.env`);
  return value;
}

module.exports = {
  region: required('FUNCTION_REGION'),
  digestCron: required('DIGEST_CRON'),
  digestTimezone: required('DIGEST_TIMEZONE'),
  digestTime: required('DIGEST_TIME')
};
