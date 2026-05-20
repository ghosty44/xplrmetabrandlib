export function getPlanStartMonday(createdAt: string): Date {
  const d = new Date(createdAt);
  const dow = d.getDay(); // 0=dim, 1=lun, ...6=sam
  const diff = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export function getSessionDate(createdAt: string, week: number, day: number): Date {
  const monday = getPlanStartMonday(createdAt);
  const date = new Date(monday);
  date.setDate(monday.getDate() + (week - 1) * 7 + (day - 1));
  return date;
}

export function formatDateYYYYMMDD(date: Date): string {
  return date.toISOString().slice(0, 10);
}
