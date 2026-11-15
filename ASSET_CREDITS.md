# Visual asset credits

Downloaded 13 November 2026. Assets are served locally so browsing Pavilion does not contact the image or font providers. Player photos are presentation assets; the editable starter pool statistics remain illustrative. Jersey imagery reflects the photo season, not a player’s team assignment in a mock auction.

## Player portraits

As of 15 November 2026, all **253 players in the shared catalog** have an individually matched, transparent official player portrait. This includes the 249 workbook players and Andre Russell, Glenn Maxwell, Mahli Beardman, and Josh Philippe. The complete source record is [asset-sources.json](public/ipl/asset-sources.json); it records the catalog identity, published official name, original URL, downloaded size variant, source profile or squad page, photo season where known, and retrieval details. Jersey colors describe the source photo, not ownership in the mock auction.

The expansion uses 214 additional IPL squad portraits, bringing IPL-sourced coverage to 246 players. Named records from the ten official squad APIs for 2026, 2025, and 2024 were checked; the archived 2020 roster was also checked for Josh Philippe. Explicit spelling aliases were checked against existing profile records (for example `Ajay Jadav` / `Ajay Mandal`, and `Smaran Ravichandran` / `Ravichandran Smaran`). Missing or silhouette-only official assets were rejected. The remaining seven cutouts come from the following official sources:

| Player | Official source |
| --- | --- |
| Mustafizur Rahman | [Delhi Capitals profile](https://www.delhicapitals.in/players/63881-mustafizur-rahman-profile) |
| Ben Duckett | [ECB player directory](https://www.ecb.co.uk/england/men/players) |
| Brydon Carse | [ECB profile](https://www.ecb.co.uk/england/men/players/3550/brydon-carse) |
| Sam Curran | [ECB player directory](https://www.ecb.co.uk/england/men/players) |
| Mahli Beardman | [Cricket Australia profile](https://www.cricket.com.au/players/CA:11619/mahli-beardman) |
| Jack Edwards | [Cricket Australia profile](https://www.cricket.com.au/players/CA:1692) |
| Josh Philippe | [Cricket Australia profile](https://www.cricket.com.au/players/CA:1612) |

The 221 added images retain the providers' actual transparent image bytes. IPL supplies 750px WebP size variants, ECB supplies 480px PNG portraits, and Cricket Australia supplies 440px PNG portraits. Delhi Capitals supplies its own optimized transparent WebP. No faces, kits, bodies, or backgrounds were generated or retouched. The complete 253-image collection is approximately 15.1 MiB, averaging 61 KiB per player; individual views request only the portraits they display. The initial 32 portraits remain unchanged.

Run `node scripts/cache-official-cutouts.mjs` to restore any missing local images from the reviewed manifest, or pass `--refresh` to refresh them explicitly. The script limits requests to two at a time with 200ms minimum spacing, uses a 15-second timeout and 3 MiB limit, checks permitted official image hosts on every redirect, stops on HTTP 429, and checks dimensions and transparency before adding a source. It preserves the franchise logo definitions when generating the player image registry. Metadata inspection does not alter downloaded pixels.

### Initial featured portraits

Thirty player portraits were sourced from the official IPL 2026 squad API, matched by the published player name and image URL. Andre Russell and Glenn Maxwell use official 2025 portraits because the newer squad endpoints returned placeholders. Images are resized to a maximum width of 700 pixels and encoded as WebP (quality 88), with transparency preserved. Original PNG source URLs are recorded below.

IPL/BCCI and the respective rights holders retain rights to the player photography and franchise marks. These are reference assets for the local mock-auction prototype; this project does not grant a commercial redistribution license or imply IPL endorsement. See [IPL image use terms](https://www.iplt20.com/image-use-terms) and [IPL terms](https://www.iplt20.com/terms-and-conditions). Review image rights before public commercial publication.

| Player | Photo season | Original image | Source page |
| --- | --- | --- | --- |
| Andre Russell | 2025 | [Image](https://documents.iplt20.com/ipl/IPLHeadshot2025/141.png) | [Official source](https://www.iplt20.com/teams/kolkata-knight-riders/squad) |
| Arshdeep Singh | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F2040%2F67190.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/punjab-kings?tab=squad) |
| Axar Patel | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1396%2F17616.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/delhi-capitals?tab=squad) |
| Dhruv Jurel | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1558%2F71456.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/rajasthan-royals?tab=squad) |
| Glenn Maxwell | 2025 | [Image](https://documents.iplt20.com/ipl/IPLHeadshot2025/28.png) | [Official source](https://www.iplt20.com/teams/punjab-kings/squad-details/282) |
| Hardik Pandya | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1854%2F16093.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/mumbai-indians?tab=squad) |
| Ishan Kishan | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1153%2F20227.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/sunrisers-hyderabad?tab=squad) |
| Jasprit Bumrah | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1854%2F16096.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/mumbai-indians?tab=squad) |
| Jos Buttler | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F2879%2F16261.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/gujarat-titans?tab=squad) |
| KL Rahul | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1396%2F20451.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/delhi-capitals?tab=squad) |
| Kuldeep Yadav | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1396%2F20030.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/delhi-capitals?tab=squad) |
| Mitchell Starc | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1396%2F14328.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/delhi-capitals?tab=squad) |
| Mohammed Shami | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F2880%2F11458.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/lucknow-super-giants?tab=squad) |
| Nicholas Pooran | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F2880%2F23906.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/lucknow-super-giants?tab=squad) |
| Pat Cummins | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1153%2F14153.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/sunrisers-hyderabad?tab=squad) |
| Rashid Khan | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F2879%2F25242.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/gujarat-titans?tab=squad) |
| Ravindra Jadeja | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1558%2F13143.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/rajasthan-royals?tab=squad) |
| Rinku Singh | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1873%2F33718.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/kolkata-knight-riders?tab=squad) |
| Rishabh Pant | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F2880%2F17617.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/lucknow-super-giants?tab=squad) |
| Rohit Sharma | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1854%2F11326.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/mumbai-indians?tab=squad) |
| Sai Sudharsan | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F2879%2F74538.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/gujarat-titans?tab=squad) |
| Sanju Samson | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1622%2F17613.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/chennai-super-kings?tab=squad) |
| Shivam Dube | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1622%2F63520.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/chennai-super-kings?tab=squad) |
| Shreyas Iyer | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F2040%2F22014.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/punjab-kings?tab=squad) |
| Shubman Gill | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F2879%2F65345.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/gujarat-titans?tab=squad) |
| Sunil Narine | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1873%2F11658.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/kolkata-knight-riders?tab=squad) |
| Suryakumar Yadav | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1854%2F20861.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/mumbai-indians?tab=squad) |
| T Natarajan | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1396%2F37001.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/delhi-capitals?tab=squad) |
| Travis Head | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1153%2F21033.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/sunrisers-hyderabad?tab=squad) |
| Virat Kohli | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F2138%2F13144.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/royal-challengers-bengaluru?tab=squad) |
| Yashasvi Jaiswal | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1558%2F68314.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/rajasthan-royals?tab=squad) |
| Yuzvendra Chahal | 2026 | [Image](https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F2040%2F14621.png&brand=ipl) | [Official source](https://www.iplt20.com/teams/punjab-kings?tab=squad) |

The machine-readable name/source mapping is in [asset-sources.json](public/ipl/asset-sources.json).

## Franchise crests

The eight original vector crests are official assets published on the [IPL teams page](https://www.iplt20.com/teams). They are stored unchanged, with their original colors and transparency. Gujarat Titans and Lucknow Super Giants were added on 15 November 2026 from their current official IPL team pages. These two logos are encoded as transparent 256 × 256 WebP images (quality 94, alpha quality 100), preserving the published artwork and colors while reducing their combined payload from approximately 630 KiB of SVG to 25 KiB. Lucknow uses the current official 2026 crest.

| Franchise | Original image |
| --- | --- |
| Chennai Super Kings | [SVG](https://www.iplt20.com/api/team-assets?pathname=static%2Fteams%2F1622%2Ficon-dark.svg) |
| Mumbai Indians | [SVG](https://www.iplt20.com/api/team-assets?pathname=static%2Fteams%2F1854%2Ficon-dark.svg) |
| Royal Challengers Bengaluru | [SVG](https://www.iplt20.com/api/team-assets?pathname=static%2Fteams%2F2138%2Ficon-dark.svg) |
| Kolkata Knight Riders | [SVG](https://www.iplt20.com/api/team-assets?pathname=static%2Fteams%2F1873%2Ficon-dark.svg) |
| Sunrisers Hyderabad | [SVG](https://www.iplt20.com/api/team-assets?pathname=static%2Fteams%2F1153%2Ficon-dark.svg) |
| Rajasthan Royals | [SVG](https://www.iplt20.com/api/team-assets?pathname=static%2Fteams%2F1558%2Ficon-dark.svg) |
| Delhi Capitals | [SVG](https://www.iplt20.com/api/team-assets?pathname=static%2Fteams%2F1396%2Ficon-dark.svg) |
| Punjab Kings | [SVG](https://www.iplt20.com/api/team-assets?pathname=static%2Fteams%2F2040%2Ficon-dark.svg) |
| Gujarat Titans | [Official team page](https://www.iplt20.com/teams/gujarat-titans) · [SVG source](https://www.iplt20.com/api/team-assets?pathname=static%2Fteams%2F2879%2Ficon-dark.svg) |
| Lucknow Super Giants | [Official team page](https://www.iplt20.com/teams/lucknow-super-giants) · [SVG source](https://www.iplt20.com/api/team-assets?pathname=static%2Fteams%2F2880%2Ficon-dark.svg) |

## Stadium photograph

[Wankhede Stadium cricket match](https://unsplash.com/photos/a-cricket-match-is-being-played-at-a-stadium-Npp5wwx_xCs), by Zoshua Colah, via Unsplash. [Downloaded image](https://images.unsplash.com/photo-1750716413444-c8a957fcf35c?auto=format&fit=crop&w=2000&q=85). Covered by the [Unsplash License](https://unsplash.com/license); photograph saved as JPEG at 2000 × 1250.

## Fonts

- [Barlow Condensed](https://fonts.google.com/specimen/Barlow+Condensed), designed by Jeremy Tribby: Latin WOFF2, normal 700 and 800. Source: Google Fonts CSS API and fonts.gstatic.com. [SIL Open Font License](public/fonts/barlow-OFL.txt).
- [Inter](https://fonts.google.com/specimen/Inter), designed by Rasmus Andersson: Latin variable WOFF2, normal 400–800. Source: Google Fonts CSS API and fonts.gstatic.com. [SIL Open Font License](public/fonts/inter-OFL.txt).

Both font licenses are included with the local fonts.

## Original stadium artwork and static home lineup

The home screen uses the compressed [static stadium](public/hero-player/stadium.webp) derived from [the original generated artwork](public/cinematic/stadium-poster.webp), a fictional cricket ground generated with the built-in image-generation tool on 14 November 2026. It does not depict a real venue. The motion-video feature and video files were removed at the user’s request.

Eight enlarged transparent portraits are served from [hero-player](public/hero-player/): Virat Kohli, Jasprit Bumrah, Shubman Gill, Rishabh Pant, KL Rahul, Shreyas Iyer, Hardik Pandya, and Rohit Sharma use the official IPL sources credited above. Transparent margins are cropped before resizing to 460 pixels tall. The eight images total 208,102 bytes and the background 36,170 bytes; they form a static overlapping poster with no visible name captions. [prepare-static-hero.mjs](scripts/prepare-static-hero.mjs) reproduces these size derivatives without inventing or retouching faces. No new player imagery is generated.

Generation prompt:

> Create an original photorealistic cinematic image for the panoramic hero background of a premium Indian cricket auction website. Very wide 21:9 landscape, 2560 pixels wide if possible. A majestic packed oval Indian cricket stadium at blue hour transitioning into night, seen from a low VIP pavilion viewpoint looking across the pitch. Emerald grass and authentic cream cricket wicket in the middle distance, curved tiers of spectators, dramatic tall floodlight towers with warm ivory light beams cutting through a fine realistic atmospheric haze. Midnight navy sky, restrained champagne gold highlights and tiny warm crowd lights. High-end sports film still, anamorphic lens, believable stadium architecture, rich photographic textures, no artificial futuristic architecture. Composition: darker uncluttered sky and shadow on the left half for large website typography; the brightest floodlights, glorious pavilion roof and stadium detail toward the right half. Elegant premium realistic lighting, not neon, not oversaturated. No foreground people, no athletes, no trophy, no text, no logos, no watermarks. This is an original fictional cricket ground, not an exact depiction of an existing stadium.

The earlier stadium photograph remains archived in the project. Sound effects are original stereo synthesis rendered locally by the Web Audio engine: bat impact, gavel/applause, lock and transition cues. No external recordings or songs are used.

## Expanded player catalog portraits

The expanded workbook catalog uses additional portraits published by [Cricbuzz](https://www.cricbuzz.com/), downloaded from `static.cricbuzz.com` on 14 November 2026. Player identities and original image URLs come from the verified records in [player-profiles.json](data/player-profiles.json); no images are assigned by facial recognition or guessed names. The original image URL, player profile page, retrieval time, dimensions, and any failed downloads are recorded in [the portrait source manifest](public/player-portraits/sources.json).

The initial additional images were stored locally as WebP at quality 84, resized to fit within 480 × 480 without upscaling. On 15 November 2026, nineteen landscape variants that cropped faces were replaced with Cricbuzz's complete square profile thumbnails (`d=high&p=gthumb`). These replacements retain their original JPEG/PNG source bytes at 168 × 168, totaling 127,120 bytes; no face retouching, enlargement, or re-encoding was applied. Existing IPL portraits and other complete profile photos remain unchanged. Photography remains owned by the respective rights holders; these credits do not grant a separate redistribution license or imply Cricbuzz endorsement.

Run `node scripts/cache-player-portraits.mjs` from the application folder to reproduce or resume the cache. The script preserves existing complete portraits, repairs wide editorial crops with bounded square originals, uses at most three concurrent requests spaced at least 250 ms apart, enforces a ten-second download timeout, permits redirects only within the trusted HTTPS image host, and stops further requests after HTTP 429. New thumbnails are saved in their original format with no image transformation. It generates [catalog-portraits.ts](lib/catalog-portraits.ts) for local image lookup. A failed image does not prevent the remaining catalog from being cached.

## Historical franchise crests

The requested Deccan Chargers and Pune Warriors India badges are authentic historical franchise marks, cached locally as transparent 128 × 128 WebP images for lightweight identification in this local mock-auction application. The original proportions and colors are preserved; only empty margins and display resolution are reduced. They total 14,030 bytes. They are not newly designed marks or current IPL franchises.

| Franchise | Local badge | Downloaded source | Provenance |
| --- | --- | --- | --- |
| Deccan Chargers | [dch.webp](public/ipl/teams/dch.webp) | [Transparent PNG](https://assets.stickpng.com/images/627d08638a632ca996477e83.png) | [StickPNG source listing](https://www.stickpng.com/img/sports/cricket-teams/deccan-chargers-logo); the badge design is independently documented in [designer Chris Mitchell / Epic Icons’ original project](https://www.epicicons.com/work/deccan-chargers). |
| Pune Warriors India | [pwi.webp](public/ipl/teams/pwi.webp) | [Original PNG](https://upload.wikimedia.org/wikipedia/en/4/4a/Pune_Warriors_India_IPL_Logo.png) | [English Wikipedia file record](https://en.wikipedia.org/wiki/File:Pune_Warriors_India_IPL_Logo.png), which identifies `www.iplt20.com` as the original source. |

Retrieved 14 November 2026. These logos remain owned by their respective rights holders and do not imply endorsement. StickPNG identifies its derivative as personal-use only; Wikipedia identifies the Pune mark as copyrighted non-free logo content. Neither source provides a general commercial redistribution license. These provenance notes preserve the source restrictions and do not confer additional rights.
