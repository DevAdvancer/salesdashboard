export function normalizeSource(value: unknown): string {
    if (typeof value !== "string") return "";
    return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isReferralSource(source: unknown): boolean {
    return normalizeSource(source) === "referral";
}
