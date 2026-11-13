# Pavilion — IPL Mock Auction

A multiplayer mock auction with a human auctioneer, shared team tables, and a clean interface. This first version covers the complete auction flow while leaving the player pool, auction order, and final sale decisions in human hands.

## What works

- Create a room and invite people with a six-character code or room link. Eight team managers can bid, with additional participants joining as spectators.
- Add, edit, remove, search, and filter players across Marquee, Batter, Bowler, All-rounder, and Wicketkeeper categories.
- Choose the next player, open or pause bidding, lock the final bid, and confirm a sale or mark a player unsold. Locked rounds reject further bids on the server.
- Use a one- or two-second bid cooldown, configurable increments, and automatic purse, squad-size, and overseas-limit checks.
- Follow bids, team tables, raised flags, room messages, and completed squads. An interactive practice room is available before creating a shared room.
- Share an HTTPS link to a Google Meet, Zoom, or other voice/video call alongside the auction.

## Local setup

Requires Node.js **22.13 or newer** and npm. Run commands from this project directory.

```sh
npm install
npm run build
```

The build creates the local Worker configuration. Apply the existing initial database migration **once per fresh local database**:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_chunky_peter_parker.sql
```

Start development:

```sh
npm run dev
```

Open the URL printed by the server, normally `http://127.0.0.1:5173`. The development server and built preview share local D1 data under `.wrangler/state`. To preview the built Worker instead, stop the development server and run `npm start`.

Only run `npm run db:generate` after changing [the database schema](./db/schema.ts). Apply each newly generated migration in order; do not replay migrations already applied. Rebuild when bindings change. Local migrations affect the local preview database; hosted database migrations are handled separately during publication.

## Running an auction

1. Create a room as the auctioneer and share its invite link. Participants choose an available team or join as spectators.
2. Review the player pool and room settings. Set starting purses before the first bid; change bidding rules between player rounds.
3. Select a player from the pool, return to the auction floor, and open bidding.
4. Lock bidding when ready. Confirm the winning sale, or mark the player unsold if nobody bid.
5. Choose the next player. An unsold player can be selected again later.

The server validates each action and rejects outdated or simultaneous conflicting bids. A bid is accepted only when its player, amount, cooldown, and team eligibility still match the current room state.

Room sessions use random bearer credentials saved in the browser’s `localStorage`; only credential hashes are stored on the server. Credentials are not included in invite links or room snapshots. Auctioneer access can be recovered by reopening the room link **on the same site in the same browser profile**, provided browser storage has not been cleared. There is no account-based host recovery yet. Use separate browser profiles or devices when testing multiple participants.

A private Sites deployment also requires every participant to have access to the site itself. An auction room code does not bypass the site’s access policy.

## Architecture

- **Interface:** React 19 with Vinext, responsive CSS, and Lucide icons. [The auction app](./components/auction-app.tsx) connects the room floor and [management panels](./components/auction-panels.tsx).
- **Auction rules:** [The auction engine](./lib/auction.ts) is a pure state transition function shared by the practice room and server. Money uses integer lakhs to avoid floating-point bid calculations.
- **API and persistence:** [Room endpoints](./app/api/rooms/) use [the server service](./lib/auction-server.ts), Drizzle, and Cloudflare D1. Each room is stored as a JSON document with a version number. Conditional updates compare that version before writing, so competing bids, team claims, room locks, and purse changes cannot silently overwrite one another.
- **Synchronization:** Clients fetch shared state about every 650 ms while visible, and every 3 seconds in a background tab. Submitted actions return the authoritative state immediately. Polls normally read data only, with periodic presence heartbeats.
- **Hosting:** [The hosting manifest](./.openai/hosting.json) declares the `DB` binding. [The Worker entrypoint](./worker/index.ts) and generated build configuration support Cloudflare deployment through Sites.

## Validation

Run the auction rule tests:

```sh
node --experimental-strip-types --test tests/auction.test.ts
```

With the local database initialized and the server running, run the API integration checks in a second terminal:

```sh
node tests/api-integration.mjs
```

The API checks default to `http://127.0.0.1:5173` and create test rooms in that database. Set `BASE_URL` to test another local preview port. For example, in PowerShell:

```powershell
$env:BASE_URL = "http://127.0.0.1:8787"
node tests/api-integration.mjs
```

Additional checks:

```sh
npx tsc --noEmit
npm run lint
npm run build
```

## First-version limits and next steps

This version is intended for small, organized mock auctions. Rooms currently support eight team seats and up to 50 participants. Starter player statistics are illustrative and can be edited by the organizer.

Voice/video uses a shared external HTTPS call link; embedded audio/video is not implemented. Synchronization uses polling rather than a persistent, horizontally scaled socket service. The current JSON-per-room storage is suitable for the initial scope and has not been validated for large public events.

There are no administrator accounts, cross-device host recovery, room admission approvals, or dedicated brute-force and API rate-limit infrastructure yet. These, along with account-backed invitations and moderation, should precede an unrestricted public launch. Useful next improvements include WebSocket room updates, embedded calling, CSV player imports, configurable franchises, and auction result exports.
