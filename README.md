# Pavilion — IPL Mock Auction

A multiplayer mock auction with a human auctioneer, shared team tables, and a clean interface. This first version covers the complete auction flow while leaving the player pool, auction order, and final sale decisions in human hands.

## What works

- Create a room and invite people with a six-character code or room link. Twelve team managers can bid, with additional participants joining as spectators.
- Maintain one database-backed player catalog shared across normal windows, incognito windows, browser profiles, and rooms. Add, edit, remove, search, and filter players across Marquee, Batter, Bowler, All-rounder, and Wicketkeeper categories.
- Choose the next player, open or pause bidding, lock the final bid, and confirm a sale or mark a player unsold. Locked rounds reject further bids on the server. Before a sale or unsold decision, the auctioneer can unlock bidding with the existing leader and bids intact; stale unlocks and competing settlement requests are rejected.
- The current unsettled player has a glowing red LIVE marker alongside the actual bidding phase. Participants browsing another room page receive a small new-player notice with a **View auction** shortcut; initial loads and repeated polls do not replay it. Notices clear when viewed, dismissed, superseded, or settled, and remain queued while a dialog is open.
- Use a one- or two-second bid cooldown, configurable increments, and automatic purse, squad-size, and overseas-limit checks.
- Place the next suggested bid or enter a custom amount in crores (for example, `5` means ₹5 Cr). Custom amounts must meet the current minimum and available purse; they keep the same cooldown, stale-lot, and locking checks as ordinary bids.
- Home is a standalone lobby with Create/Join and Player Pool. Auction controls, Team Squads, and room settings appear only after creating or joining a room. Auctioneers do not see My Squad or Build my XI, including through direct links.
- My Squad is a separate gallery of the participant’s confirmed purchases, prices, purse, and playing-role composition. Sales update it automatically. Marquee players count toward their actual role (Batter, Bowler, All-rounder, or Wicketkeeper); the role counters also filter the gallery. Spectators have an explicit unassigned-team view.
- My Target Picks gives each team manager a private shortlist alongside the full searchable player pool. Add or remove any number of picks before or during the auction, then save; later additions retain existing selections. The shortlist persists across refreshes, preserves drafts while navigating, and detects competing saves from another tab. Other managers, spectators, and the auctioneer cannot read it. A manager's list clears when they leave or switch teams.
- Managers can save a private maximum bid for each target, entered in crores. The plan totals remaining targets against their actual purse, flags missing limits and over-allocation, and excludes purchased players. Saved limits produce quiet reminders when the current or next bid reaches/exceeds the plan, including on other room pages. These are soft planning limits: they neither bid automatically nor block a deliberate higher bid. Budget values share the target list's private storage and revision protection and never enter shared snapshots, posters or exports.
- A saved target coming to the table produces a personal alert on any room page, including the auction floor. Regular player announcements remain available when browsing elsewhere. Alerts are deduplicated, remain queued during dialogs, and do not replay historical lots on initial load. Purchased targets stay listed with their outcome.
- Each team owner sees their franchise’s colours, crest, and room header across the auction and management pages. The same room can look different for RCB and MI managers; the lobby, auctioneer, and spectator views keep the neutral Pavilion theme.
- The profile uses the manager’s franchise crest. **Your spending** reflects only that team’s confirmed purchases; unassigned viewers see a dash.
- Build my XI is a separate participant page with a franchise-themed cricket ground, eleven portrait positions, a five-player bench, leadership controls, and a searchable photo picker. Every position can be filled independently, including No. 7 before No. 1, and empty positions stay in place after saving. Only the team’s manager can edit; duplicate selections and concurrent overwrites are rejected.
- Hover or focus a selected XI or bench player to see matches, runs, wickets, and strike rate with the correct statistics format. The same details are in **Manage** for touch screens; opening stats does not fetch additional data.
- Team Squads shows compact cards with purse remaining, spots filled, and **Owned and Managed by** attribution. Unclaimed franchises are labeled as awaiting a manager. Open a card for the full roster, purchase prices, player details, and saved lineup roles. Chat messages display the authenticated sender’s name and team, retained even after they leave.
- **Team Squads → Compare squads** compares two franchises side by side: budgets, spending, remaining purse, playing roles, overseas players, selected XI/substitutes and leadership. Marquee players count toward their actual playing role.
- **Room settings → Results & final call** lets only the creator correct a confirmed sale between rounds. Change its team or price, or cancel and refund it. Each correction requires a reason and records the creator, time and before/after amounts permanently. Ownership changes clear the old team's affected XI, substitute and leadership selections; stale and concurrent corrections cannot charge twice.
- **End auction** permanently closes bidding without deleting the room. Settle the active player first. Team ownership and player facts are archived; spectators can still join, managers can finalise their XI, and creator corrections remain audited. Auction room becomes **Auction recap** for every participant.
- Completed auctions offer authenticated **PDF recap** and **Excel workbook** downloads. The workbook follows the original THE TEAMS / POINTS structure and includes an overview, all purchased players, individual franchise sheets and audit history. Team/manager names, prices, XI positions, substitutes and C/VC are included, with blank editable match-stat and points columns. Downloads always include the latest saved lineups and corrections, excluding private target lists, chat and credentials. Workbook/PDF libraries and embedded fonts run only on the download server route.
- Completed recaps include six factual auction awards, with all tied winners and their criteria: headline signing, deepest squad, purse protector (at least eleven signings), bidding marathon, busiest table and fiercest rivalry (most distinct players contested by both franchises). Purchase awards reflect corrected sales; accepted bidding remains historical. A compact public counter preserves bidding awards beyond the rolling 2,000-bid feed. Older rooms already missing earlier bids keep purchase awards but do not invent bidding winners. PDF and Excel recaps include the awards.
- After the auction ends, **Auction recap** and **My Squad** offer an on-demand 1440 × 1800 PNG franchise poster with the full purchased squad, local portraits where available, team colours/crest, archived manager, saved XI/substitutes and C/VC. Generation requires authenticated room access and a non-empty completed squad. Downloads and supported native file sharing use the generated file; changed purchases or lineups invalidate its preview. Rendering uses packaged assets only, with no arbitrary URLs or file paths, and never loads rendering libraries in the browser.
- The invitation panel offers separate **Copy invite link** and creator-only **Copy team password** actions. The password stays out of the page, invitation URL, and browser storage; copying failures have an explicit retry.
- Share an HTTPS link to a Google Meet, Zoom, or other voice/video call alongside the auction.
- How it works is a responsive four-step playbook covering room access, private targets, bidding, and building an XI.
- Browse all 249 workbook players, with source-sheet filters, full-catalog search, and readable 24-player pages.
- Fetch a player's profile by name or Cricbuzz/ESPNcricinfo URL, review identity and sources, and add or update the entry without duplicating it.
- See a lightweight static lineup featuring Kohli, Bumrah, Gill, Rishabh Pant, KL Rahul, Shreyas Iyer, Hardik Pandya, and Rohit Sharma. Large overlapping portraits have no visible name captions; copy and actions sit over the lower part of the artwork. Optimized still images are used; management pages do not load them. There is no motion video or continuous hero animation. Optional sound cues are generated only when first used and then cached.

Existing rooms gain Gujarat Titans, Lucknow Super Giants, Deccan Chargers, and Pune Warriors India through an append-only team upgrade. New seats use that room’s configured starting purse; existing owners, purses, squads, lineups, bids, and historical results are preserved.

## Player catalog and profile lookup

The default pool is imported from `IPL MOCK AUCTION.xlsx`: all 249 rows across MARQUEE SET, both BATTERS lists, both BOWLERS lists, both ALL ROUNDERS lists, and WICKET KEEPERS. THE TEAMS and POINTS are excluded; RULES is not a player list. Historical sale prices, owners, and sold/unsold flags are not imported. Original row provenance, four spelling corrections, and 25 identity disambiguations are recorded in [the import audit](./data/player-catalog-report.json).

Every catalog identity has a sourced Cricbuzz profile and country. The initial verified snapshot contains 226 IPL career summaries, five explicitly labeled T20I summaries, and 18 profiles without published career totals. Missing values are `null` and displayed as a dash, not zero. A zero is shown only when supplied by the provider. All 253 players in the current local catalog have genuine transparent official portraits, served locally and reused across the auction, pool, squad cards, and pickers. See [asset credits](./ASSET_CREDITS.md) and the reproducible [official portrait cache script](./scripts/cache-official-cutouts.mjs).

Use **Player pool → Add player** to search a name or paste a profile URL. Namesakes produce a choice of identities. Review country, career format, source links, auction category, and base price before saving. Existing identities are updated rather than added twice. The manual editor remains available, and statistics can be left blank. Players without confirmed country/overseas eligibility cannot enter bidding until the auctioneer reviews them. Sold players and players currently being bid on remain protected from edits.

Cricbuzz supplies public profile data without an API key. If ESPNcricinfo presents an access challenge, the app offers explicitly labeled Cricbuzz matches for confirmation; it does not bypass the challenge or pretend that fallback data came from ESPN. Provider failures, absent photos, and absent statistics remain visible. Lookups use timeouts, restricted hosts/redirects, a bounded six-hour cache, and process-local request limits. No arbitrary URL fetching or evaluation of page scripts is performed.

The workbook snapshot seeds a single shared catalog on first startup. Visitors can curate the catalog from the lobby; auctioneers can also edit it inside their rooms. The first lobby edit creates an expiring catalog-only credential, without creating an auction or granting room access. Read-only visits create neither rooms nor editor credentials. Every room receives catalog changes through version-aware synchronization. Only player profiles are shared: bids, purchases, squads, and purses remain private to each auction room. Active and completed lots retain their agreed base price and eligibility terms. A global removal is refused while any room has that player on its table or in a purchased squad. Older bid references are retained as archived history.

The existing local installation preserves Andre Russell, Glenn Maxwell, and the user-added Mahli Beardman alongside all 249 workbook players, for 252 shared entries. The one-time audited migration created a database backup. `npm run players:enrich` and `npm run players:cache-images` maintain the bundled source snapshot and image cache; they do not silently overwrite the running shared catalog. Refresh a shared profile through its review dialog to apply new facts.

## Sound and readability

Sound is off by default. The compact sound panel contains only the enabled switch and volume control, without preview tiles or descriptive copy. Sounds are original WebAudio synthesis and require a user gesture. Initial history, reconnections, duplicate events, and muted activity do not replay effects. Confirmed bids and sales produce their corresponding cues; page changes use a brief, quieter transition.

Visible controls and supporting text use readable sizing and improved contrast. Player tables scroll within their container on narrow screens; dialogs retain keyboard focus and respect reduced-motion preferences.

## Local setup

Requires Node.js **24 LTS** and npm. Run commands from this project directory:

```sh
npm install
```

If you previously created rooms in the local Cloudflare version, follow the optional import below **before** starting the server for the first time.

For testing an auction with several participants, start the built local app:

```sh
npm run preview
```

Open [http://localhost:3000](http://localhost:3000). This is a standalone Next.js app: no ChatGPT sign-in, Sites service, or Cloudflare account is needed. The server binds to `127.0.0.1`, so it is available on this computer only. Use separate browser profiles to test multiple participants locally; remote guests will need a later deployment.

`npm run preview` builds the app and starts it locally with all API routes registered. This avoids an observed Windows development-server route-discovery problem where nested join/action endpoints were missing and returned HTML 404 pages. It does not publish or deploy the app. For editing with live reload, stop the preview and use `npm run dev`; run `npm run test:api` before relying on that development session for a shared auction.

To test a second person, create a room in your normal window, then open its invite URL in an incognito window on the same computer. Spectators can join with a name and room code. To take a team, choose an unclaimed franchise and enter the team password shared by the creator. The creator can reveal or copy that password under **Room settings → Room access**. Invite links never contain it.

Team passwords are generated per room. Only the creator’s authenticated session can retrieve one; spectators and bidders cannot read it from room snapshots or the private endpoint. Both direct team joins and later team claims enforce the password on the server. Existing memberships keep their seats. For older rooms, the creator opens Room settings once to initialize protected team access; until then, new visitors can join only as spectators.

The creator can delete a room under **Room settings → Room access → Delete room** by typing its room code. This removes that room’s bids, purchases, squads, and memberships while preserving the common player pool and other rooms. Open participants return Home when the server confirms deletion. A durable deletion record prevents old links, cached credentials, or repeated creation requests from restoring the deleted auction.

Opening `/` always shows Home, including when this browser has a saved auction seat. Explicit room links restore that browser’s saved membership. Joining the same code from Home also recovers the original seat instead of overwriting auctioneer or bidder credentials. Old `?practice=1` links now open the lobby. Historical practice records remain available to the compatibility API but are never created or restored by the homepage.

Every new room starts with the current common catalog, empty squads, and full purses. The auctioneer chooses which player to bring to the table. A successful selection automatically returns them from Player Pool to the current Auction Room; bidding opens only when they explicitly start it. My Squad derives directly from confirmed room purchases and uses the same synchronized snapshot as Team Squads.

Open **Build my XI** and click any numbered XI or substitute position to choose a purchased player. Use **Manage** on a player to appoint your captain or vice captain, swap batting positions, or move them between the XI and bench. Removing a player leaves that position empty; later positions do not shift. Click **Save lineup** to persist selections across reloads. Unsaved drafts survive auction polling, new purchases, and navigation within that room, including visits to My Squad. If another tab saves a newer lineup, local edits stay visible until you explicitly reload the saved version. Moving a captain out of the XI clears that leadership assignment. The field is lightweight CSS and existing player portraits, with no video or continuous animation.

The first database-backed request automatically creates and initializes a SQLite database at `.data/pavilion.db` in this application directory. No database command or external service is needed for local setup. Room data persists across server restarts; the development and production servers use the same database unless configured otherwise. Back up this database before deleting local project data or changing the schema.

To try the production build, stop the development server and run:

```sh
npm run build
npm start
```

Both modes use port 3000. From the parent workspace, the equivalent commands are `npm run setup`, `npm run preview`, `npm run dev`, `npm run build`, and `npm start`.

### Optional: import previous local rooms

After installing dependencies and before creating the new local database, run:

```sh
npm run db:import-local-d1
```

The importer finds the old local D1 SQLite database under `.wrangler/state/v3/d1`, copies its room data into `.data/pavilion.db`, and leaves the source database in place. It refuses to overwrite an existing destination database. If more than one matching source exists, choose it explicitly with `npm run db:import-local-d1 -- --source "path/to/old.sqlite"`.

This imports server data from the previous local version only. Browser session credentials remain tied to their original origin; importing a room does not restore auctioneer access on a different origin. Create a fresh local room if you do not need to retain an old one.

`npm run db:init` can initialize the configured database explicitly, though normal app usage also initializes it automatically.

## Recovering room creation

The browser saves a cryptographically random creation key in this tab’s session storage before creating a room. If the response is interrupted, the same form offers **Retry room creation**; refreshing the tab restores that pending attempt. Retrying uses the same key and recovers the original room and host access, including after a server restart. It cannot create duplicate rooms with that key. Keep the tab available until room access has been saved. Existing calls without a key remain compatible.

The writer queue is bounded; an expired request is rejected before executing. An uncertain bid or sale is never automatically replayed.

Local SQLite reads use a separate connection from the serialized writer. If a lock prevents a transaction from starting, the writer connection is refreshed before retrying; the native driver can otherwise retain a failed statement and break later commits. Work that already began is never automatically repeated. The native-lock regression test exercises this against a real temporary SQLite database.

## Running an auction

1. Create a room as the auctioneer and share its invite link for spectator access. Copy the team password from Room settings and share it privately with team owners.
2. Review the player pool and room settings. Set starting purses before the first bid; change bidding rules between player rounds.
3. Select a player from the pool. The app returns you to the auction floor, where you open bidding.
4. Lock bidding when ready. Confirm the winning sale, or mark the player unsold if nobody bid.
5. Choose the next player. An unsold player can be selected again later.

The server validates each action and rejects outdated or simultaneous conflicting bids. A bid is accepted only when its player, amount, cooldown, and team eligibility still match the current room state.

Room sessions use random bearer credentials saved in the browser’s `localStorage`; only credential hashes are stored on the server. Credentials are not included in invite links or room snapshots. Auctioneer access can be recovered by reopening the room link **on the same site in the same browser profile**, provided browser storage has not been cleared. There is no account-based host recovery yet. Use separate browser profiles or devices when testing multiple participants.

Browser credentials belong to their origin. Use the same URL consistently: `localhost` and `127.0.0.1` have separate browser storage. Existing hosted-site sessions will not automatically become local sessions.

## Architecture

- **Interface:** Next.js 16, React 19, responsive CSS, and Lucide icons. [The auction app](./components/auction-app.tsx) connects the room floor and [management panels](./components/auction-panels.tsx).
- **Auction rules:** [The auction engine](./lib/auction.ts) is a pure state transition function shared by the practice room and server. Money uses integer lakhs to avoid floating-point bid calculations.
- **API and persistence:** [Room endpoints](./app/api/rooms/) use [the server service](./lib/auction-server.ts), Drizzle, and `@libsql/client`. Storage defaults to local SQLite and can use a remote libSQL database. Each room is stored as a JSON document with a version number. Conditional updates compare that version before writing, so competing bids, team claims, room locks, and purse changes cannot silently overwrite one another.
- **Synchronization:** Active live-auction views check shared state every 750 ms; other room views, including My Squad, every 2.5 seconds; background room tabs every 15 seconds. The lobby checks the catalog every 10 seconds on Home, 2.5 seconds in Player Pool, and 30 seconds in the background. Focus and tab notifications trigger immediate updates. Stable polls query version numbers and return a tiny unchanged response. Submitted actions return authoritative state immediately.
- **Runtime:** Standard Next.js development and production servers on Node.js. The application is independent of the previous Sites and Cloudflare Worker hosting setup.

## Vercel and Turso deployment

The production setup uses Vercel with a dedicated Turso database. Functions and the database run in Mumbai (`bom1`). Local development continues to use the local SQLite database unless cloud variables are explicitly supplied.

1. Connect a dedicated Turso database to the Production environment using Vercel Marketplace. Local SQLite files are unsuitable for Vercel's ephemeral runtime; the app rejects a file database when running on Vercel.
2. Use the Next.js framework preset. In the GitHub repository, the application is at the repository root; select `.` as the project root directory.
3. The integration supplies `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Explicit `DATABASE_URL` and `DATABASE_AUTH_TOKEN` overrides remain supported. Keep credentials server-side and out of source control; Preview and Development should use separate databases.
4. Build on Vercel with Node.js 24 and `npm ci`; do not upload a Windows prebuilt output. Create rooms on the deployed origin. Local room credentials remain tied to localhost.

The production database was initialized with the current 253-player common catalog. Local auction histories and browser credentials remain local. To check a deployment, run `BASE_URL=https://your-site.vercel.app EXPECTED_CATALOG_COUNT=253 node tests/deployment-smoke.mjs` (or set those environment variables in PowerShell). This suite creates and deletes its own test room and never edits the shared player catalog.

The same environment variables can be supplied in a local `.env.local` file to test remote storage before deployment. Leave them unset to keep using the local database. Review the first-version limits below before opening the app to the public.

## Validation

Run the auction rule tests:

```sh
npm test
```

After building, run the isolated API integration checks:

```sh
npm run build
npm run test:api
```

The API runner starts a separate built server on an ephemeral port with a temporary database. It verifies independent browser sessions, global catalog changes, concurrent mutations, and isolated room accounting without touching the user’s shared catalog. Individual suites require an explicitly isolated test environment. The older local `BASE_URL` example below applies only when running a deliberately separate test server:

```powershell
$env:BASE_URL = "http://127.0.0.1:3001"
node tests/api-integration.mjs
```

The focused browser suites exercise lock/unlock across three independent sessions and invitation copying, clipboard failures, private-password concealment, and responsive controls:

```sh
node tests/run-isolated-api.mjs tests/unlock-browser-integration.mjs tests/invite-panel-browser.mjs
```

Browser suites use `PLAYWRIGHT_MODULE` and `BROWSER_EXECUTABLE` when supplied; otherwise they use the local browser-tool installation and Brave executable configured in the test files.

Additional checks:

```sh
npx tsc --noEmit
npm run lint
npm run build
```

## First-version limits and next steps

This version is intended for small, organized mock auctions. Rooms currently support twelve team seats and up to 50 participants. Player statistics are attributed snapshots with a fetch date and format, and organizers may enter manual corrections. They are not a licensed live statistics feed.

Voice/video uses a shared external HTTPS call link; embedded audio/video is not implemented. Synchronization uses polling rather than a persistent, horizontally scaled socket service. The current JSON-per-room storage is suitable for the initial scope and has not been validated for large public events.

There are no administrator accounts, cross-device host recovery, or room admission approvals yet. Player lookup has bounded process-local rate limits, but multi-instance public hosting needs shared rate limiting, account-backed invitations, and moderation. Useful next improvements include WebSocket room updates, embedded calling, and configurable franchises.
