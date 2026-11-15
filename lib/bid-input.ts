/** Convert rupee-crore text to whole lakhs without floating-point rounding. */
export function parseCroreBid(input: string): number | null {
  const text = input.trim();
  if (!/^(?:\d{1,6}(?:\.\d{0,2})?|\.\d{1,2})$/.test(text)) return null;
  const [whole = "0", fraction = ""] = text.split(".");
  const lakhs = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(lakhs) && lakhs > 0 ? lakhs : null;
}
