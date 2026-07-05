const DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com']);

function validateDiscordWebhookUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && DISCORD_HOSTS.has(url.hostname)
      && /^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+$/.test(url.pathname);
  } catch {
    return false;
  }
}

function formatAction(action) {
  const countries = action.countries || [];
  const countryText = countries.length
    ? countries.map((country) => `${country.name} (${country.actionType || action.actionType})`).join(', ')
    : 'Không có quốc gia';
  const notes = action.note || countries.filter((country) => country.note)
    .map((country) => `${country.name}: ${country.note}`).join(' • ');
  return {
    name: `${action.campaignName || 'Unknown campaign'} — ${action.actionType || 'action'}`.slice(0, 256),
    value: `${countryText}${notes ? `\n📝 ${notes}` : ''}`.slice(0, 1024),
    inline: false
  };
}

function buildDiscordPayload(digest, isTest = false) {
  const fields = digest.actions.slice(0, 25).map(formatAction);
  return {
    username: 'ADS-FOX Reminder',
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `${isTest ? '🧪 Test — ' : '📋 '}Google Ads report ${digest.localDate}`,
      description: digest.actions.length
        ? `Đã xử lý ${digest.actions.length} campaign.`
        : 'Hôm nay chưa có action nào.',
      color: isTest ? 3447003 : 5763719,
      fields,
      footer: { text: digest.actions.length > 25 ? `Hiển thị 25/${digest.actions.length} campaign` : 'ADS-FOX Action Reminder' },
      timestamp: new Date().toISOString()
    }]
  };
}

class DiscordWebhookAdapter {
  async send(user, digest, options = {}) {
    if (!user.discordWebhookUrl || !validateDiscordWebhookUrl(user.discordWebhookUrl)) {
      return { status: 'missing_webhook', deliveryRef: null };
    }
    const response = await fetch(`${user.discordWebhookUrl}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildDiscordPayload(digest, options.isTest))
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Discord webhook failed (${response.status}): ${message.slice(0, 200)}`);
    }
    const result = await response.json();
    return { status: 'sent', deliveryRef: result.id || null };
  }
}

module.exports = { DiscordWebhookAdapter, buildDiscordPayload, validateDiscordWebhookUrl };
