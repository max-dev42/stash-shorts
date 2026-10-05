# Contributing

Never use data, images or videos from a real library in tests, demo, screenshots or issues. Test and
demo data are invented (`demo/demo-data.js`); test clips are generated (`scripts/make-test-videos.sh`).

## Demo

`demo/` runs the plugin page without Stash: a mock server (Node, no dependencies) with an invented
library, generated performer images and the generated test clips, answering exactly the plugin's GraphQL
requests.

```sh
sh scripts/make-test-videos.sh   # demo/videos/: 15 portrait and 5 landscape clips (needs ffmpeg)
node demo/server.js              # http://127.0.0.1:8791/shorts  (?lang=de, fr, es or it for other languages)
```

The landscape clips are a counter-check: they are in the mock library but must never show up in the
feed. The demo page stands in for Stash's UI and mounts the page through `window.StashShortsMount`.
`GET /mock-log` lists the mutations the mock received.

## Tests

```sh
npm test                         # = scripts/test.sh = node --test tests/*.test.js  (Node 20+, no dependencies)
```

The tests cover the logic in `plugin/stash-shorts-core.js` (settings and their declaration in the
`.yml`, URL parameters, the GraphQL filter (portrait only), scene normalising, which scenes get a video
element, gestures, wheel steps, rating, play counting, i18n), the locale files (keys, plural forms,
placeholders, every key used), the demo data and mock server, and the absence of emoji and dashes
(U+2012 to U+2015) in code, texts and docs. Logic that can be tested without a browser belongs in the
core file (no `document`, no `window`, no network); add a test there for every behaviour you change.

## Browser check

```sh
node scripts/check.mjs                               # against the demo (needs Chromium, Node 22+)
BASE=http://localhost:9999 ACTIONS=1 NAVBAR=1 node scripts/check.mjs   # against a Stash with the plugin
FRESH=1 ACTIONS=1 BASE=http://localhost:9999 node scripts/check.mjs     # the screenshots for docs/
CURATOR=1 NAVBAR=only BASE=http://localhost:9999 node scripts/check.mjs  # next to another plugin's navbar hook
```

Headless Chromium at 390x844 (touch) and 1440x900 (mouse wheel and keys) over the DevTools protocol. It
prints JSON with: time from navigation to the first playing video, time from each step to the
`playing` event and to the first advancing frame (forward and backward), the most `<video>` elements in
the page, long tasks while stepping, requests to other hosts, page errors, the format of every loaded
scene checked against GraphQL, and on the phone the tap, hold and progress-bar gestures. Then one part per
feature, each with its own numbers and counter-checks: sheet, action column and splash, scene links,
detail sheet, creator profile, modes, side previews, session summary, quick actions and galleries (the
video parts run with galleries off, the gallery part with them on; quick actions on for their part only;
the plugin settings come back at the end). `ACTIONS=1` rates, adds an orgasm, toggles the favorite and a
subscription and waits for the play count, reading the scene back from GraphQL.

What the check writes it takes back: orgasms (also of the double tap), ratings, tags, favorites and
subscriptions are as before after a run; only the play counts grow. Still, use a test instance. Scene
markers are not made by the check: for the detail sheet part on a library without markers, add two to a
portrait scene for the run. `FRESH=1` starts every page without "Continuing where you were", for the
screenshots in `docs/`. `CURATOR=1` adds another plugin's after hook on Stash's navbar items that needs all of
their arguments (as Stash Curator has); with `NAVBAR=1` (or `NAVBAR=only`, the navbar part alone) the check
reports whether Stash's UI and the entry are still there. Screenshots go to `demo/screenshots/` (not committed). The browser and the mock
server are always ended, also on errors and Ctrl-C, and the JSON is printed also after a failure.

## Translations

See [docs/translating.md](docs/translating.md). `npm test` checks every file listed in
`plugin/locales/index.json`.

## Code layout

- `plugin/stash-shorts-core.js` holds the logic without DOM or network access; `stash-shorts.js` holds
  the page. Stash loads both in this order (see the `.yml`); there is no build step.
- Identifiers that depend on the plugin name are defined once: `PLUGIN_ID` and `ROUTE` in the core file,
  the CSS prefix (`sst-`) and the session key at the top of `stash-shorts.js`.
- All settings are defined in one table (`SETTINGS` in the core file: key, type, default, label key). A
  new setting is one entry there plus one under `settings` in the `.yml` (a test checks both match).
- Icons are small SVG paths in the core file (`ICONS`), drawn in `currentColor`; no emoji in code, CSS or
  texts.
- `window.stashShorts` holds the current view (scenes, index, timings) for debugging in the browser
  console; the browser check reads its `timing`.

## Style

- No build step and no dependencies, neither at runtime nor for development.
- Code, comments and commit messages in English; UI texts only through the locale files.

## Versions

The version is in `plugin/stash-shorts.yml` and `package.json`; changes are listed in
[CHANGELOG.md](CHANGELOG.md). Versions follow [Semantic Versioning](https://semver.org/).
