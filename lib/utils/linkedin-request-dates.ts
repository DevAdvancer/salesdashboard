export function getLinkedinRequestDateFilterValue(dateSent: string) {
  const parsed = new Date(dateSent);
  if (Number.isNaN(parsed.getTime())) return "";

  return parsed.toISOString().slice(0, 10);
}
