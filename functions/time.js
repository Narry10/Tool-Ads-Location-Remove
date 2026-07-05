function localParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  return Object.fromEntries(formatter.formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
}

function digestWindow(date, timezone, digestTime = '23:00', windowMinutes = 15) {
  try {
    const parts = localParts(date, timezone);
    const [targetHour, targetMinute] = digestTime.split(':').map(Number);
    const current = Number(parts.hour) * 60 + Number(parts.minute);
    const target = targetHour * 60 + targetMinute;
    return {
      due: current >= target && current < target + windowMinutes,
      localDate: `${parts.year}-${parts.month}-${parts.day}`
    };
  } catch {
    return { due: false, localDate: null };
  }
}

module.exports = { digestWindow, localParts };
