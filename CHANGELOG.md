# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## 0.2.0 (first public release)

- Modes at the bottom: For you, Subscribed and New. New order "Newest by date" (`order=date`, the scene's
  date) and filter "Only performers I subscribe to" (`subs=1`, through Stash's performer sub-filter on the
  custom field). The home screen shortcut "Unwatched" opens New.
- Galleries as posts (setting, on by default): galleries with pictures in the feed's format and its filters
  are entries of their own, spread over the feed; a sideways swipe flips the pictures (three at most with a
  source), past the last one into the channel; rating on the gallery, orgasm on the picture shown with
  Undo, Share with `/shorts?gallery=<id>`, seconds per picture with "Next clip at the end". In the profile
  a gallery post or picture opens it in the performer's channel.
- Profile button at the top of the action column: the main performer's picture opens their profile.
- Caption: the main performer's name (their profile), favorite heart and Subscribe, others after "with";
  the title in one line, a tap unfolds the post text (the scene's details) to three lines; studio and
  date below.
- Subscribe: follows a performer without making them a favorite, stored in the performer's custom field
  `shorts_subscribed` (other custom fields stay).
- Creator profile (`/shorts?profile=<id>`): banner, avatar, handle, Subscribe, bio, numbers, and the links
  as Stash's performer page shows them (a button per group with Stash's icons and a menu);
  tabs Posts (scenes and galleries merged by date), Media and Favorites, loaded as they scroll into view; a
  post plays in the performer's channel. Opened by the name in the caption, from More and from the name
  at the top of a channel (which opened Stash's performer page before).
- Side previews: up to three related performers (together in scenes, or the same studio; favorites first)
  above the buttons on the right, a tap opens their channel; only performers with scenes in the feed's
  format; fewer or none on short screens; setting to turn them off.
- Action column: profile button, rating, orgasm counter, markers and More (the scene and its performers
  in Stash, Share with the share sheet, the clipboard, or the link to copy by hand on plain HTTP, and the
  filters). The performer avatars and "open the scene" moved to the profile button and to More.
- Splash: white drops rise over the video on an orgasm; settings to turn it off and to add it to
  Subscribe; one fading drop with reduced motion.
- Detail sheet: markers (a tap jumps there; in a marker clip it becomes the whole scene from that time),
  details with code, director and links, tags (a tap filters the feed), people with Subscribe. Opened from
  the new marker count in the action column, from More and from the unfolded caption; the video goes on.
- Quick actions (setting, off by default): a row above the caption with five stars, the drop and up to
  five quick tags, each a toggle that keeps the scene's other tags.
- Session summary: leaving by the back button first shows the time, clips watched, galleries, orgasms and
  new subscriptions of the visit, with Back to the feed and Leave; in the home screen app it replaces the
  hint before closing. The last ten visits under "Recent sessions" in More. Nothing goes to Stash.
- Works next to other UI plugins: the navbar patch passes all of Stash's arguments on (another plugin's
  hook that needs them, as Stash Curator has, left the UI black), and falls back to Stash's own if
  anything goes wrong; the navbar entry and the page have their own error boundary (an error shows a short
  text instead of a black Stash); the navbar icon no longer goes through Stash's patchable Icon; a second
  copy of the plugin is not loaded twice.
- Link to one scene: `/shorts?scene=<id>` starts the feed with it, whatever the filters and the format.
- Sheets: the filter dialog is the first of the panels from the bottom that 0.2.0 adds; on a phone it has a
  grip, and dragging its head down closes it. Esc closes it also when the focus is not inside it.
- Browser check: it leaves the library as it found it (the orgasms of the double tap and the splash are
  taken back from GraphQL, also when the answer is slow), and prints what it measured also after a failure.

## 0.1.0 (first release)

- Shorts page (`/shorts`) with a navbar entry: a full-screen portrait feed, one scene per screen.
- Next and previous by swipe, mouse wheel (one step per gesture) or arrow keys, with snapping.
- Performer channel: a swipe to the left (right arrow key, or a tap on an avatar) shows only the scenes of
  a performer of the current scene, starting with it; again to the left goes to the next performer of
  that scene; to the right (left arrow key, the browser's back button) returns to the same place. The
  label at the top shows the context; the address carries it (`/shorts?performer=12`).
- Portrait scenes only by default (Stash's orientation filter); the setting "Also landscape scenes" adds
  landscape and square scenes, across the full width with the blurred screenshot behind them.
- "For you" order (default), computed in the browser from the library's ratings, orgasm counts, plays,
  favorites and the taste for performers and tags, with a random share; the same performer not twice in
  a row, played scenes less often.
- Home screen: while the Shorts page is open, its own web app manifest (start at `/shorts`, own icon,
  shortcuts "For you", "Unwatched", "Favorites"; one per language) and Safari's tags, so "Add to Home
  Screen" opens the feed; Stash's head tags are back when the page is left. As an app: 5 px more room at
  the edges on top of the safe area, the screen stays on while a video plays (setting), title and
  performers on the lock screen with play, pause, next and previous, and "back" at the bottom asks once
  before it closes the app.
- Continue where you were: the last scene per context (all scenes with a filter, a channel) is kept in
  the browser for 14 days; opening the page there again starts with it, with "Start over".
- Filters: tags, studios, performers, favorite performers only, minimum rating, only unwatched scenes
  (`unseen=1`); order random, newest in
  Stash or most viewed. URL parameters for a view (`/shorts?tag=3&order=newest`; the performer filter is
  `performers=`).
- Turning the phone (with landscape scenes on): a landscape clip fills the screen sideways and the
  overlay fades out until the next tap; upright, a "Rotate" button (full screen and orientation lock
  where the browser allows it, else a hint).
- Performer bar (stories): round avatars at the top, favorites first, then by number of scenes in the
  feed's format; a tap opens the channel. Opened with a button, closed by a step.
- Scene markers as clips (setting, on by default): each marker of the scenes in the filter is an entry of
  its own, playing the scene's stream from the marker's time up to its end or 30 s, with its title and
  primary tag.
- Setting "Next clip at the end": instead of looping, the feed moves on when a clip ends.
- Double tap on the video adds an orgasm, with a short drop and sparks animation; a single tap then
  toggles the sound after 250 ms. Can be turned off. "Undo" for 4 seconds after each orgasm, and holding
  the drop button takes one back.
- Plays Stash's own stream, muted until a tap turns the sound on (remembered for the browser session),
  looping; hold to pause, tap the progress bar to jump. Falls back to Stash's transcoded stream once when
  the browser cannot play a file.
- Only the previous, current and next scene have a video element with a source (three at most), so one
  step in either direction plays without loading.
- Caption at the bottom left with each name once: a studio named after the performer (FansDB style,
  "Name (Fansly)") shows its parent studio, or else the rest of its name; a title that is only the
  performer's name is left out.
- Action column: performer avatars opening their channel, with a favorite heart; rating with stars, orgasm
  counter (+1), open the scene in Stash.
- Counts a play once per scene and visit after 5 seconds of playback (adjustable, can be turned off).
- Settings dialog backed by Stash's plugin settings: a sheet from the bottom on phones with targets of at
  least 44 px, Apply and Reset at the bottom; tags, studios and performers by typing, offered only with
  scenes in the feed's format and with their number.
- Languages: English, German, French, Spanish, Italian.
- No request leaves the Stash origin, no CDN, no runtime dependencies; inline SVG icons.
