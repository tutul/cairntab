// Inbox ageing. Pure.

export const DAY_MS = 24 * 60 * 60 * 1000;

export function ageDays(dateAdded, now) {
  if (!dateAdded) return 0;
  return Math.max(0, Math.floor((now - dateAdded) / DAY_MS));
}

/** Items whose age reached `archiveDays`. archiveDays <= 0 (or not a number) disables archiving. */
export function dueItems(items, archiveDays, now) {
  const days = Number(archiveDays);
  if (!Number.isFinite(days) || days <= 0) return [];
  return items.filter((it) => it.dateAdded && now - it.dateAdded >= days * DAY_MS);
}

/** Days left before an item is archived; null when archiving is off. */
export function daysLeft(dateAdded, archiveDays, now) {
  const days = Number(archiveDays);
  if (!Number.isFinite(days) || days <= 0 || !dateAdded) return null;
  return Math.max(0, days - ageDays(dateAdded, now));
}

/** "今天", "昨天", "N 天前". */
export function relativeDay(ts, now) {
  if (!ts) return "";
  const d = ageDays(ts, now);
  if (d === 0) return "今天";
  if (d === 1) return "昨天";
  return `${d} 天前`;
}
