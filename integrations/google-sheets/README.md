# Pavilion Google Sheets feed

**Prepared and locally tested; execution on Google Apps Script is not yet verified.** ESPNcricinfo may reject requests from Google as it currently rejects requests from the deployed website. This integration reports that error and keeps the previous successful feed. It does not bypass provider restrictions.

## Install in your spreadsheet

1. Open the destination spreadsheet while signed in as an owner/editor. Choose **Extensions → Apps Script**.
2. Paste [Code.gs](./Code.gs) into the bound script project and save. Reload the spreadsheet.
3. Choose **Pavilion → Set up season feed**. Complete Google's authorization yourself when requested. The script uses the current spreadsheet and ordinary external HTTP requests; no service account, password, token or web-app deployment is required.
4. In **Pavilion Config**, set **B2** to the desired official ESPNcricinfo/Cricinfo series `most-valuable-players` URL.
5. Choose **Pavilion → Fetch latest MVP data**. Confirm that Status reports success, the expected number of player rows appears, and Source Captured At updates. **A successful run on Google is required before calling this integration operational.**

The script creates only **Pavilion Config** and **Pavilion MVP Feed**. Existing tabs remain untouched. It refuses to overwrite a pre-existing tab with either name unless that tab has Pavilion's ownership metadata. Re-running setup preserves the configured link and existing player data. The feed tab is script-managed; put personal notes or calculations elsewhere.

The CSV export URL appears in **Pavilion Config B8**. Exporting does not change sharing permissions: anonymous consumers need viewer access or a separately published feed. Do not expose a workbook containing private auction data. Website support for a Google Sheets URL must be verified separately; creating this script alone does not connect the site.

## Integrity and refresh behaviour

- The source is the complete embedded ESPN MVP JSON, not the visually truncated HTML table. Exact provider player IDs/names, full Total Impact precision and negative values are retained; missing stats remain blank.
- Every data row repeats **Source URL**, **Source Captured At** and **Expected Row Count**. The capture time is when Google received a successful source response. Reading/exporting the spreadsheet later never updates that capture time.
- Refreshes are manual. No scheduled trigger, automatic `onOpen` fetch, proxy or public web app is installed. Reloading/downloading a sheet does not force an `IMPORTHTML` refresh; this integration does not use `IMPORTHTML`.
- A document lock prevents overlapping script writes. The feed is replaced in one range write only after the entire response passes identity, series, count and numeric validation. HTTP errors, incomplete tables and source changes during a fetch leave prior feed values intact.
- Requests use HTTPS with an exact provider host/path allowlist, up to three validated redirects and a 4 MB accepted-response limit. Apps Script has no supported per-request timeout or streaming fetch; a 45-second elapsed-time check rejects late responses and prevents further redirect requests, but cannot interrupt an in-flight Google request.
- Player/team text is escaped before writing so it cannot become a spreadsheet formula. No credentials or private application data are sent to ESPNcricinfo.

## Local checks

From the app directory, run `node --test tests/google-sheets-script.test.mjs`. These checks execute the script in a mocked Apps Script environment against a small fixture extracted from the actual public provider response. They do **not** prove that Google can fetch ESPNcricinfo or that Google authorization has completed.

Google references: [UrlFetchApp options](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app), [spreadsheet range values](https://developers.google.com/apps-script/reference/spreadsheet/range#setValues(Object)), [document locks](https://developers.google.com/apps-script/reference/lock/lock-service).
