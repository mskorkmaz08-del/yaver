// Export meetings to the iPhone Calendar app as a standard .ics file.
// iOS shows an "Add to Calendar" sheet, and the reminder (VALARM) becomes a
// real iPhone notification, with no server needed.
const stamp = iso => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const text = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);

export function toICS(events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Yaver//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@yaver`, `DTSTAMP:${stamp(new Date().toISOString())}`,
      `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`, `SUMMARY:${text(e.title)}`);
    if (e.location) lines.push(`LOCATION:${text(e.location)}`);
    if (e.notes) lines.push(`DESCRIPTION:${text(e.notes)}`);
    if (e.remind) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(e.title)}`, `TRIGGER:-PT${e.remind}M`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export async function openInCalendar(events, name = 'yaver-meeting') {
  const ics = toICS(events);
  const file = new File([ics], `${name}.ics`, { type: 'text/calendar' });
  // From the Home Screen app, the share sheet is the most reliable route on iOS.
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Add to Calendar' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
