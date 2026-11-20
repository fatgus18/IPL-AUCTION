# Managed season refreshes

On Vercel, **Auction Season → Fetch latest data** runs an on-demand cloud task. Any room creator can use it from the website. No participant or project owner needs to keep a computer online, run a scraper, install an extension or connect Google Sheets.

The task uses the existing ESPNcricinfo MVP parser, retaining full Total Impact precision, player IDs, negative values and the actual response capture time. The normal room scoring rules and creator authorization apply. The previously saved snapshot stays intact if fetching or validation fails.

## Configuration

Vercel deployments default to `cloud` mode. `PAVILION_SEASON_FETCH_MODE=cloud` can make this explicit. The Sandbox SDK authenticates with Vercel's project OIDC; no personal API key or long-lived worker credential is required. Sandbox access and usage are subject to the project's Vercel plan and quotas.

Local development defaults to `direct`. A developer deliberately testing managed execution locally needs the linked project's Vercel authentication. Legacy desktop mode requires explicit `PAVILION_SEASON_FETCH_MODE=worker` and is not a production fallback.

## Execution boundaries

- Only official HTTPS ESPN/Cricinfo series MVP links are accepted. Existing redirect and complete-table validation remains active.
- The sandbox receives two fixed code assets and the validated URL as a process argument. It receives no application environment, account tokens, room credentials, squads or private plans.
- Networking is restricted to the four supported ESPN/Cricinfo hostnames. There are no exposed ports, proxies, user-agent impersonation or challenge-solving steps.
- Each task uses one virtual CPU, nonpersistent storage, a 45-second lifetime, a 32-second work deadline and up to six seconds for explicit cleanup. It is stopped after success and failure.
- Persistent database reservations permit one active source task. Concurrent requests for that source share its result; another season receives a busy response. At most four tasks can start per minute. Failed attempts also count.
- Every accepted result must match the source and season, have a fresh capture time, and contain a complete validated set of player rows. Room revision and creator-access checks run again before the result is saved.

The UI identifies the managed service as **Cloud refresh ready**. This means the cloud execution path is configured; it does not promise that an upstream provider or platform quota can never reject a request. Errors retain the last successful data and its original timestamp.

## Verification

`npm test` includes mode-selection and mocked cloud lifecycle tests. `npm run test:season-cloud` checks cloud readiness without a desktop heartbeat, disabled desktop-worker access, shared jobs, limits, failure preservation and room revision/deletion races in a temporary database. It does not issue real cloud requests.

A release also requires a real production button refresh with the desktop worker stopped, confirming the complete provider dataset, a new capture timestamp, saved standings, reload persistence and Excel output. The cloud task must stop afterward. Local mocks alone do not establish provider access or deployed OIDC authentication.
