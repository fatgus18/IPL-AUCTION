function authorityOrigin(protocol: string, authority: string): string | null {
  if ((protocol !== "http:" && protocol !== "https:") || !authority || /[\s/\\?#@,]/.test(authority)) return null;
  // Permit a hostname (with an optional numeric port) or a bracketed IPv6 host.
  // URL alone is too permissive: it accepts credentials, paths and an empty port.
  if (!(authority.startsWith("[") ? /^\[[0-9a-f:.]+\](?::\d+)?$/i : /^[^:]+(?::\d+)?$/).test(authority)) return null;
  try { return new URL(`${protocol}//${authority}`).origin; } catch { return null; }
}

/**
 * Check a browser's Origin against the host actually addressed by the request.
 * Next may reconstruct request.url with its listening hostname (localhost), even
 * when the browser used 127.0.0.1. Forwarded headers are deliberately not trusted.
 * Non-browser tools without Origin retain access; an explicitly invalid Origin
 * (including the opaque "null" origin) is rejected.
 */
export function hasSameRequestOrigin(request: Pick<Request, "headers" | "url">): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  const match = /^(https?):\/\/([^/\\?#\s]+)$/i.exec(origin);
  if (!match) return false;
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    const expected = authorityOrigin(new URL(request.url).protocol, host);
    const actual = authorityOrigin(`${match[1].toLowerCase()}:`, match[2]);
    return expected !== null && actual !== null && expected === actual;
  } catch { return false; }
}
