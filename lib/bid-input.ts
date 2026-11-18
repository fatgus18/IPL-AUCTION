/** Bids use quarter-crore steps; private planning limits may remain arbitrary. */
export const BID_STEP_LAKHS = 25;

export function isValidBidAmount(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount > 0 && amount % BID_STEP_LAKHS === 0;
}

export function roundUpToBidGrid(amount: number): number {
  return Math.max(BID_STEP_LAKHS, Math.ceil(amount / BID_STEP_LAKHS) * BID_STEP_LAKHS);
}

/** Existing rooms can contain older 5/10-lakh increments. Never emit an off-grid bid. */
export function normalizeBidIncrement(increment: number): number {
  return Number.isSafeInteger(increment) && increment > 0 ? roundUpToBidGrid(increment) : BID_STEP_LAKHS;
}

/** Convert rupee-crore text to whole lakhs without floating-point rounding. */
export function parseCroreBid(input: string): number | null {
  const text = input.trim();
  if (!/^(?:\d{1,6}(?:\.\d{0,2})?|\.\d{1,2})$/.test(text)) return null;
  const [whole = "0", fraction = ""] = text.split(".");
  const lakhs = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(lakhs) && lakhs > 0 ? lakhs : null;
}
