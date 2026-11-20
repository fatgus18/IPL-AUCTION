# Pavilion points refresh service

This service connects the website's **Fetch latest data** button to a normal public ESPNcricinfo fetch on a host where the source allows access. It uses the same validated full-table parser as the website. It does not use browser impersonation, proxies, saved browser sessions, Google credentials or CAPTCHA handling.

The host must be online and this process must be running. The website shows **Refresh service online/offline**; previous points remain saved when the service is unavailable. This is a host-dependent service, not an autonomous Vercel scraper.

## Configure

Use Node.js 24 or newer. Generate a random service credential and set `PAVILION_SOURCE_WORKER_TOKEN` on the website's server. Put the same value in a private `.env.season-worker.local` in the app directory:

```dotenv
PAVILION_WORKER_ORIGIN=https://your-pavilion-site.vercel.app
PAVILION_SOURCE_WORKER_TOKEN=replace-with-your-random-secret-at-least-32-characters
```

This file is ignored by Git. Never put its token in a sheet, browser field, client bundle, screenshot or a `NEXT_PUBLIC_` variable. The host needs no database credentials and receives no room tokens, squads or private plans.

Run `npm run season:worker`. The process claims at most one job at a time and checks for requests every ten seconds while idle. Each job can fetch only a validated official ESPN series MVP URL. Completed results retain their actual source capture timestamp and must pass server validation before the requesting room's revision and creator access are checked again.

## Windows background operation

Run `scripts/start-season-source-worker.ps1` to start a hidden background process, or pass `-InstallAtSignIn` to also create the clearly named **Pavilion Points Refresh** shortcut in your Windows Startup folder. It starts after you sign into Windows; it does not run while the computer is asleep or off. Re-running the launcher does not create another active worker.

Logs are in `.data/season-worker.log` and `.data/season-worker.error.log`. They do not contain the service token. To stop the service, end its Node process using the PID in `.data/season-worker.lock` after confirming its command line contains `scripts/season-source-worker.mjs`. To disable sign-in startup, remove only **Pavilion Points Refresh** from Windows **Startup Apps**, or remove that shortcut from `shell:startup`. The saved auction data remains on the website.

The same service can move to an always-on host with permitted source access later; the website button and scoring do not change. A host change alone is not a guarantee that ESPN will accept requests.

## Verify

`node --test tests/season-worker-client.test.mjs` checks origin/redirect restrictions, invalid credentials and source links, leases, failure reporting and preservation of signed points. A real source fetch and an end-to-end website refresh are separate checks. A local mock passing does not demonstrate provider access from another host.
