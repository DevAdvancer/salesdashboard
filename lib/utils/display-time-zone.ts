export const DEFAULT_DISPLAY_TIME_ZONE = "America/New_York";
export const DISPLAY_TIME_ZONE_STORAGE_KEY = "salesdashboard-display-time-zone";
export const DISPLAY_TIME_ZONE_CHANGE_EVENT = "salesdashboard-time-zone-change";

export const DISPLAY_TIME_ZONES = [
  { value: "America/New_York", label: "Eastern Time (EST/EDT automatically)" },
  { value: "America/Chicago", label: "Central Time (CST/CDT automatically)" },
  { value: "America/Denver", label: "Mountain Time (MST/MDT automatically)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PST/PDT automatically)" },
  { value: "Europe/London", label: "London Time (GMT/BST automatically)" },
  { value: "Asia/Kolkata", label: "India Standard Time (IST)" },
  { value: "UTC", label: "UTC" },
] as const;

export function isDisplayTimeZone(value: string): boolean {
  return DISPLAY_TIME_ZONES.some((zone) => zone.value === value);
}

export function getDisplayTimeZone(): string {
  if (typeof window === "undefined") return DEFAULT_DISPLAY_TIME_ZONE;
  const saved = window.localStorage.getItem(DISPLAY_TIME_ZONE_STORAGE_KEY);
  return saved && isDisplayTimeZone(saved) ? saved : DEFAULT_DISPLAY_TIME_ZONE;
}

export function saveDisplayTimeZone(value: string): void {
  if (!isDisplayTimeZone(value)) throw new Error("Choose a supported time zone.");
  window.localStorage.setItem(DISPLAY_TIME_ZONE_STORAGE_KEY, value);
  window.dispatchEvent(new Event(DISPLAY_TIME_ZONE_CHANGE_EVENT));
}
