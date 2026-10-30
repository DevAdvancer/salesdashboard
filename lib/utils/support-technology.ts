export const SUPPORT_TECHNOLOGIES = [
  "Data Analyst",
  "Software Developer",
  "DevOPs",
  "AIML",
] as const;

export function getSupportTechnologyError(value: string): string | null {
  if (!value.trim()) return "Technology is required.";

  const entries = value.split(",").map((entry) => entry.trim());
  if (entries.length > 3) return "Enter up to 3 comma-separated technologies.";
  if (entries.some((entry) => !entry)) return "Enter a technology between each comma.";
  return null;
}
