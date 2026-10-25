# Japanese holiday forecasts

`japanese-holidays-1.0.10.js` vendors the MIT-licensed `japanese-holidays` npm package, version 1.0.10, by Osamu Takeuchi.

- Upstream: https://github.com/osamutake/japanese-holidays-js
- Source: https://cdn.jsdelivr.net/npm/japanese-holidays@1.0.10/lib/japanese-holidays.js
- License: [japanese-holidays-LICENSE.txt](japanese-holidays-LICENSE.txt)
- Adaptation: supply a local CommonJS `module` object, export its result as ESM, and remove the unavailable source-map reference. The holiday implementation is unchanged.

The app ships Cabinet Office data in `js/services/japanese-holidays.js`, including exceptional holiday moves. Later years use this library, through 2099. Future dates follow current rules and may change; the UI shows dates without a provisional suffix. All bundled files are precached for offline use.

The settings screen also provides a manual update button using https://holidays-jp.github.io/api/v1/date.json. It downloads the previous, current and next year's dates, validates complete year coverage, and stores them with a check timestamp in a dedicated localStorage key. Only covered years override the bundled calendar. Failed requests or saves leave existing data intact. Downloads are tied to a fingerprint of the bundled official table, so a newer bundled table automatically supersedes older cached overrides. Other years continue using the bundled calendar and forecasts. No background polling is performed, and no product data is sent or modified.

## Updating holidays

1. Refresh the official data with `python scripts/update-japanese-holidays.py`. Newly published years automatically replace forecasts because the official table has priority.
2. When holiday legislation changes, check the upstream library, vendor the reviewed release with its license, and update the import in `japanese-holiday-calendar.js`. Do not mark forecast years as officially confirmed.
3. Run `node --test tests/*.test.mjs`, bump changed module URLs and service-worker precache entries, then publish the app update normally.

The routine holiday update is maintained with app releases; users do not need to change settings. Existing product records are never modified by a holiday update.
