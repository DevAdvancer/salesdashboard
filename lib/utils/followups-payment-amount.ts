/** Refunds are stored as nonnegative magnitudes; status supplies the sign. */
export function getFollowupsPaymentAmount(payment: { amount?: unknown; status?: unknown }): number {
  const amount = Number(payment.amount);
  if (!Number.isFinite(amount)) return 0;
  return payment.status === "refunded" || amount < 0 ? -Math.abs(amount) : amount;
}

export function getStoredFollowupsPaymentAmount(amount: number): number {
  if (!Number.isSafeInteger(amount)) {
    throw new Error("Payment amount must be a valid whole number within the supported range.");
  }
  return Math.abs(amount);
}
