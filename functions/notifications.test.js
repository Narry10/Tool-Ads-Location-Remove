const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDiscordPayload, validateDiscordWebhookUrl } = require('./notifications');

test('accepts only official Discord webhook URLs', () => {
  assert.equal(validateDiscordWebhookUrl('https://discord.com/api/webhooks/123456/token_ABC-xyz'), true);
  assert.equal(validateDiscordWebhookUrl('https://evil.example/api/webhooks/123456/token'), false);
  assert.equal(validateDiscordWebhookUrl('http://discord.com/api/webhooks/123456/token'), false);
});

test('formats a campaign with countries into one Discord field', () => {
  const payload = buildDiscordPayload({ localDate: '2026-07-05', actions: [{
    campaignName: 'A147_WW_Identifier_1/6', actionType: 'exclude',
    countries: [{ name: 'Ukraine', actionType: 'exclude' }, { name: 'Greece', actionType: 'exclude' }]
  }] });
  assert.equal(payload.embeds[0].fields.length, 1);
  assert.match(payload.embeds[0].fields[0].value, /Ukraine.*Greece/);
});
