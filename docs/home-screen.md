# On the home screen

The Shorts page can sit on the phone's home screen like an app: it opens straight at `/shorts`, full
screen, without the browser's address bar.

## iPhone and iPad (Safari)

1. Open the Shorts page in Safari (`https://<your stash>/shorts`).
2. Tap the share button, then **Add to Home Screen**.
3. Keep the name "Shorts" or change it, then **Add**.

## Android (Chrome)

1. Open the Shorts page in Chrome (`https://<your stash>/shorts`).
2. Open the menu (three dots), then **Add to Home screen** and **Install** (or **Create shortcut**,
   depending on the version).

## How it works

Stash has its own web app manifest, which starts at `/`. While the Shorts page is open, the plugin changes
a few tags in the page's head and puts them back when the page is left; Stash's files are not changed:

- the manifest link points to the plugin's own manifest (`plugin/app/manifest.json`, and
  `manifest.<language>.json` for the other languages of the plugin): start at `/shorts`, its own `id`
  (a separate app next to Stash), black theme and background, any orientation, the plugin's own icon
  (192 and 512 px, also as maskable) and three shortcuts on a long press of the icon (Android): "For you",
  "Unwatched" (`/shorts?unseen=1&order=date`, the mode New) and "Favorites" (`/shorts?fav=1`);
- for Safari: `apple-mobile-web-app-capable`, the status bar `black-translucent`, the title "Shorts" and
  the plugin's `apple-touch-icon` (180 px);
- the viewport gets `viewport-fit=cover`, so the page reaches under the notch and the status bar; the
  controls keep clear of them with the browser's safe area values (`env(safe-area-inset-*)`, 0 where
  there is none);
- the theme colour is black, and the page does not bounce or pull to refresh.

The icon's source is `plugin/app/icon.svg`; `scripts/make-icons.sh` renders the PNGs from it with
headless Chromium.

## As an app

Opened from the home screen (display mode `standalone`, or `navigator.standalone` on iOS), the page:

- keeps 5 px more room at the bottom, left and right, on top of the safe area, for the caption, the
  buttons on the right, the progress bar and the top bar;
- does not open the browser's menu on a long press on the video (the press pauses it, as in the browser);
- **back** (the gesture or Android's back button) at the bottom of the history, where it would close the
  app, shows the session summary once (see [features.md](features.md#session-summary); "Go back again to
  leave" when it is off or nothing was watched); the next back leaves. This needs one touch on the page first
  (browsers skip history entries made without one). The back button at the top left goes to Stash's start
  page when the app was opened straight at the Shorts page.

In the browser and in the app:

- the screen stays on while a video plays (Screen Wake Lock API, where the browser allows it), and may
  dim again on pause and when the page is left; setting "Keep the screen on" (on by default);
- the lock screen and the notification show the clip's title, performers, studio and screenshot (Media
  Session API) with play, pause, and next and previous clip.

Notes:

- Browsers only offer this over HTTPS (or on `localhost`); the wake lock also needs HTTPS.
- The manifest uses root paths for the start page and the shortcuts (`/shorts`). If Stash is served under
  a sub path behind a reverse proxy, the start page would be wrong; then add the page as a bookmark to
  the home screen instead.
- Behind Stash's login, the app asks for the login once, like the browser.
- Checked in headless Chromium (manifest, installability, distances with simulated safe area values, wake
  lock, media session, back); not on a real iPhone or Android phone yet.
