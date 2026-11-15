import type { AuctionAction, Player } from "./auction.ts";
import { AuctionRequestError, requestAuction } from "./auction-client.ts";

export type CatalogSnapshot = { players: Player[]; version: number };
const EDITOR_KEY = "pavilion-catalog-editor";
let editorToken: string | undefined;

async function getEditorToken(renew = false): Promise<string> {
  if (!renew) {
    if (editorToken) return editorToken;
    try {
      const saved = localStorage.getItem(EDITOR_KEY);
      if (saved && /^[a-f0-9]{64}$/i.test(saved)) return (editorToken = saved);
    } catch { /* Editing still works in memory when browser storage is unavailable. */ }
  }
  const { token } = await requestAuction<{ token: string }>("/api/players/catalog/session", {});
  editorToken = token;
  try { localStorage.setItem(EDITOR_KEY, token); } catch { /* No room access depends on this token. */ }
  return token;
}

/** Lobby catalog editing never creates a room or gains auctioneer permissions. */
export async function editLobbyCatalog(action: AuctionAction): Promise<CatalogSnapshot> {
  const token = await getEditorToken();
  try {
    return await requestAuction<CatalogSnapshot>("/api/players/catalog", { action }, token);
  } catch (error) {
    // A 401 guarantees the mutation was rejected. Never replay uncertain writes.
    if (!(error instanceof AuctionRequestError) || error.status !== 401) throw error;
    return requestAuction<CatalogSnapshot>("/api/players/catalog", { action }, await getEditorToken(true));
  }
}
