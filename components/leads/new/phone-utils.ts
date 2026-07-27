export function toUsPhoneDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 10);
}

export function formatUsPhone(value: string) {
  const digits = toUsPhoneDigits(value);
  if (!digits) return "";
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
