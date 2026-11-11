const time = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const date = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
const long = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const day = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Heute um 14:03", "Gestern um 09:12" or "03.11.26, 18:40". */
export function messageTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, now)) return `Heute um ${time.format(d)} Uhr`;
  if (sameDay(d, yesterday)) return `Gestern um ${time.format(d)} Uhr`;
  return `${date.format(d)}, ${time.format(d)}`;
}

export const shortTime = (iso: string) => time.format(new Date(iso));
export const fullTimestamp = (iso: string) => long.format(new Date(iso));
export const dayLabel = (iso: string) => day.format(new Date(iso));
export const isSameDay = (a: string, b: string) => sameDay(new Date(a), new Date(b));

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
