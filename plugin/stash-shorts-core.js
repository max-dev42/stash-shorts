/*
 * stash-shorts -- core logic without DOM, network or Stash UI dependencies.
 *
 * Loaded before stash-shorts.js (see the .yml) and exposed as window.StashShortsCore; the same file is
 * require()d by the tests (tests/*.test.js, run with `node --test`). Keep it free of document/window
 * access so both work without a build step.
 */
(function (root) {
  "use strict";

  var PLUGIN_ID = "stash-shorts"; // must match the .yml file name and plugin folder
  var ROUTE = "/shorts"; // not /plugin/...: Stash serves /plugin/* server-side (reload -> 404)

  // ------------------------------------------------------------------ icons
  // Own simple SVG paths in a 16x16 box (no emoji, no third-party icon set), drawn with
  // fill="currentColor". Paths with holes use fill-rule evenodd.
  var ICON_BOX = 16;
  var ICONS = {
    heart: "M8 14.5C7 13 0 8.5 0 5C0 1.5 4.5 0.5 8 4C11.5 0.5 16 1.5 16 5C16 8.5 9 13 8 14.5Z",
    heartOutline:
      "M8 14.5C7 13 0 8.5 0 5C0 1.5 4.5 0.5 8 4C11.5 0.5 16 1.5 16 5C16 8.5 9 13 8 14.5Z" +
      "M8 12.4C9.6 10.9 14.4 7.4 14.4 5C14.4 2.6 11.2 2 8 5.6C4.8 2 1.6 2.6 1.6 5C1.6 7.4 6.4 10.9 8 12.4Z",
    star: "M8 0.9 9.82 5.99 15.23 6.15 10.95 9.46 12.47 14.65 8 11.6 3.53 14.65 5.05 9.46 0.77 6.15 6.18 5.99Z",
    // drop with a small highlight, for the orgasm counter
    drop: "M8 0.5C8 0.5 2.5 7 2.5 10.5A5.5 5.5 0 0 0 13.5 10.5C13.5 7 8 0.5 8 0.5Z" + "M5.2 10.2A3 3 0 0 0 7.4 13.3L7.1 14.1A3.8 3.8 0 0 1 4.4 10.2Z",
    open: "M9 1H15V7L12.7 4.7 7.7 9.7 6.3 8.3 11.3 3.3ZM2 3H7V5H4V12H11V9H13V14H2Z",
    back: "M10.6 1.6 12 3 7 8 12 13 10.6 14.4 4.2 8Z",
    sliders:
      "M1 3H9V2H11V3H15V5H11V6H9V5H1ZM1 11H4V10H6V11H15V13H6V14H4V13H1ZM1 7H12V6H14V7H15V9H14V10H12V9H1Z",
    soundOff: "M1 5.5H4L8 2V14L4 10.5H1ZM10.3 5.7 11.7 4.3 13 5.6 14.3 4.3 15.7 5.7 14.4 7 15.7 8.3 14.3 9.7 13 8.4 11.7 9.7 10.3 8.3 11.6 7Z",
    soundOn: "M1 5.5H4L8 2V14L4 10.5H1ZM10 5.2A3.5 3.5 0 0 1 10 10.8L9.2 9.6A2 2 0 0 0 9.2 6.4ZM11.5 2.6A6.5 6.5 0 0 1 11.5 13.4L10.7 12.2A5 5 0 0 0 10.7 3.8Z",
    play: "M4 2 14 8 4 14Z",
    pause: "M3 2H6.5V14H3ZM9.5 2H13V14H9.5Z",
    // an upright phone with an arrow turning it to the right
    rotate:
      "M2.5 1H7.5A1 1 0 0 1 8.5 2V14A1 1 0 0 1 7.5 15H2.5A1 1 0 0 1 1.5 14V2A1 1 0 0 1 2.5 1ZM3 2.5V13.5H7V2.5Z" +
      "M10 3A6 6 0 0 1 14.9 9.6L16 9.9 14.3 12.6 12 10.4 13.4 10.1A4.5 4.5 0 0 0 10 4.5Z",
    // two people, for the stories bar
    people:
      "M5.5 2A2.5 2.5 0 1 1 5.5 7A2.5 2.5 0 1 1 5.5 2ZM0.5 14C0.5 11 2.8 9 5.5 9C8.2 9 10.5 11 10.5 14Z" +
      "M11.2 3A2.2 2.2 0 1 1 11.2 7.4A2.2 2.2 0 1 1 11.2 3ZM11.4 9.2C13.8 9.5 15.5 11.4 15.5 14H11.7C11.7 12.2 11.6 10.6 11.4 9.2Z",
    person: "M8 1.5A3.25 3.25 0 1 1 8 8A3.25 3.25 0 1 1 8 1.5ZM1.5 15C1.5 11.5 4.5 9.5 8 9.5C11.5 9.5 14.5 11.5 14.5 15Z",
    close: "M3.4 2 8 6.6 12.6 2 14 3.4 9.4 8 14 12.6 12.6 14 8 9.4 3.4 14 2 12.6 6.6 8 2 3.4Z",
    // an arrow leaving a box, for Share
    share: "M8 0.5 12 4.5 10.6 5.9 9 4.3V10H7V4.3L5.4 5.9 4 4.5ZM2 7H5V9H4V13.5H12V9H11V7H14V15.5H2Z",
    // three dots, for More
    more: "M2 6.5A1.5 1.5 0 1 1 2 9.5A1.5 1.5 0 1 1 2 6.5ZM8 6.5A1.5 1.5 0 1 1 8 9.5A1.5 1.5 0 1 1 8 6.5ZM14 6.5A1.5 1.5 0 1 1 14 9.5A1.5 1.5 0 1 1 14 6.5Z",
    // a person with a plus, for Subscribe, and with a tick, for Subscribed
    subscribe: "M6 1.5A3 3 0 1 1 6 7.5A3 3 0 1 1 6 1.5ZM0.5 14.5C0.5 11.3 3 9 6 9C7.6 9 9 9.6 10 10.6V14.5ZM12 6H13.5V8H15.5V9.5H13.5V11.5H12V9.5H10V8H12Z",
    subscribed: "M6 1.5A3 3 0 1 1 6 7.5A3 3 0 1 1 6 1.5ZM0.5 14.5C0.5 11.3 3 9 6 9C7.6 9 9 9.6 10 10.6V14.5ZM10 8.6 11.1 7.5 12.3 8.7 14.9 6.1 16 7.2 12.3 10.9Z",
    // a picture (mountains in a frame), for galleries and images
    picture: "M1 2H15V14H1ZM2.5 3.5V10.5L5.5 7 8.5 10.5 10.5 8.5 13.5 11.5V3.5ZM10.5 4.5A1.5 1.5 0 1 1 10.5 7.5A1.5 1.5 0 1 1 10.5 4.5Z",
    // a flag on a line, for markers
    markers: "M3 1H5V15H3ZM6 2H14L12 5 14 8H6Z",
    // a solid drop without highlight, for the splash
    splash: "M8 0C8 0 2 7 2 10.8A6 6 0 0 0 14 10.8C14 7 8 0 8 0Z",
  };

  // ------------------------------------------------------------------ helpers

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  // Stash returns absolute URLs built from the request's host; keep only path and query so that the
  // browser always asks the origin it is on (e.g. behind a reverse proxy).
  function localUrl(u) {
    if (!u) return null;
    try {
      var x = new URL(u, "http://localhost/"); // base only for parsing; absolute URLs keep their path
      return x.pathname.replace(/^\//, "") + x.search;
    } catch (e) {
      return null;
    }
  }

  // "1, 2,,3 " -> ["1", "2", "3"]; only numeric ids, no duplicates
  function idList(v) {
    if (Array.isArray(v)) v = v.join(",");
    var out = [];
    String(v == null ? "" : v)
      .split(",")
      .forEach(function (s) {
        s = s.trim();
        if (/^\d+$/.test(s) && out.indexOf(s) < 0) out.push(s);
      });
    return out;
  }

  // ------------------------------------------------------------------ i18n
  // Placeholders are {name}; a numeric {count} parameter selects "<key>_one"/"<key>_other" etc. through
  // Intl.PluralRules. Numbers in parameters are formatted for the locale. A missing key falls back to
  // the fallback messages (en.json), then to the key itself.
  function I18n(locale, messages, fallback) {
    this.locale = locale;
    this.messages = messages || {};
    this.fallback = fallback || {};
    this.plural = new Intl.PluralRules(locale);
    this.numberFormat = new Intl.NumberFormat(locale);
    this.dateFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }
  I18n.prototype.lookup = function (key) {
    if (Object.prototype.hasOwnProperty.call(this.messages, key)) return this.messages[key];
    if (Object.prototype.hasOwnProperty.call(this.fallback, key)) return this.fallback[key];
    return null;
  };
  I18n.prototype.t = function (key, params) {
    var self = this, text = null;
    if (params && typeof params.count === "number") {
      text = this.lookup(key + "_" + this.plural.select(params.count));
      if (text == null) text = this.lookup(key + "_other");
    }
    if (text == null) text = this.lookup(key);
    if (text == null) return key;
    return String(text).replace(/\{(\w+)\}/g, function (m, name) {
      if (!params || !(name in params)) return m;
      var v = params[name];
      return typeof v === "number" ? self.numberFormat.format(v) : String(v);
    });
  };
  I18n.prototype.n = function (v) {
    return this.numberFormat.format(v);
  };
  // Stash's dates ("2026-09-04", also "2026-09" or "2026") in the language's short form; anything else as it is
  I18n.prototype.date = function (v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ""));
    return m ? this.dateFormat.format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))) : String(v || "");
  };

  // ------------------------------------------------------------------ settings
  // One table for every persistent setting. Stored in Stash's plugin settings (configuration.plugins /
  // configurePlugin), so they are the same on every device and also appear under Settings -> Plugins;
  // each key needs a matching entry under "settings" in the .yml. Booleans whose default is on are
  // stored "negatively" (disablePlayCount), because Stash shows a missing BOOLEAN as off; "invert" makes
  // the dialog show the positive wording. Filter settings (filter: true) are the defaults of the feed;
  // URL parameters override them for one view.
  // date: by the scene's date (the post date with FansDB), newest first; newest: by the time it came into Stash
  var ORDERS = { forYou: "orderForYou", random: "orderRandom", date: "orderDate", newest: "orderNewest", mostViewed: "orderMostViewed" };
  var SETTINGS = [
    { key: "order", type: "STRING", def: "forYou", options: ORDERS, filter: true, label: "setOrder" },
    { key: "favoritesOnly", type: "BOOLEAN", def: false, filter: true, label: "setFavorites" },
    { key: "subscribedOnly", type: "BOOLEAN", def: false, filter: true, label: "setSubscribed" },
    { key: "minRating", type: "NUMBER", def: 0, min: 0, max: 5, filter: true, label: "setMinRating" },
    { key: "unseenOnly", type: "BOOLEAN", def: false, filter: true, label: "setUnseen" },
    { key: "tags", type: "IDS", def: "", filter: true, label: "setTags" },
    { key: "studios", type: "IDS", def: "", filter: true, label: "setStudios" },
    { key: "performers", type: "IDS", def: "", filter: true, label: "setPerformers" },
    { key: "allowLandscape", type: "BOOLEAN", def: false, label: "setLandscape", help: "setLandscapeHelp" },
    { key: "disableMarkers", type: "BOOLEAN", def: false, invert: true, label: "setMarkers", help: "setMarkersHelp" },
    { key: "disableGalleries", type: "BOOLEAN", def: false, invert: true, label: "setGalleries", help: "setGalleriesHelp" },
    { key: "autoAdvance", type: "BOOLEAN", def: false, label: "setAutoAdvance", help: "setAutoAdvanceHelp" },
    { key: "disableDoubleTap", type: "BOOLEAN", def: false, invert: true, label: "setDoubleTap", help: "setDoubleTapHelp" },
    { key: "disableWakeLock", type: "BOOLEAN", def: false, invert: true, label: "setWakeLock", help: "setWakeLockHelp" },
    { key: "disableSplash", type: "BOOLEAN", def: false, invert: true, label: "setSplash", help: "setSplashHelp" },
    { key: "disableRelated", type: "BOOLEAN", def: false, invert: true, label: "setRelated", help: "setRelatedHelp" },
    { key: "disableSummary", type: "BOOLEAN", def: false, invert: true, label: "setSummary", help: "setSummaryHelp" },
    { key: "quickActions", type: "BOOLEAN", def: false, label: "setQuick", help: "setQuickHelp" },
    { key: "quickTags", type: "IDS", def: "", label: "setQuickTags" },
    { key: "splashOnSubscribe", type: "BOOLEAN", def: false, label: "setSplashSubscribe" },
    { key: "disablePlayCount", type: "BOOLEAN", def: false, invert: true, label: "setPlayCount", help: "setPlayCountHelp" },
    { key: "playCountAfter", type: "NUMBER", def: 5, min: 1, max: 60, zeroIsDefault: true, label: "setPlayCountAfter" },
    { key: "galleryImageSeconds", type: "NUMBER", def: 4, min: 2, max: 15, zeroIsDefault: true, label: "setGallerySeconds" },
  ];
  var SETTING = {};
  SETTINGS.forEach(function (d) {
    SETTING[d.key] = d;
  });

  // invalid or missing values fall back to the default
  function settingValue(d, raw) {
    if (raw == null || raw === "") return d.def;
    if (d.type === "BOOLEAN") return typeof raw === "boolean" ? raw : raw === "true" ? true : raw === "false" ? false : d.def;
    if (d.type === "NUMBER") {
      var n = Number(raw);
      if (n === 0 && d.zeroIsDefault) return d.def; // Stash shows an unset NUMBER as 0
      return isFinite(n) ? clamp(Math.round(n), d.min, d.max) : d.def;
    }
    if (d.type === "IDS") return idList(raw).join(",");
    raw = String(raw);
    return d.options && !Object.prototype.hasOwnProperty.call(d.options, raw) ? d.def : raw;
  }

  function readSettings(stored) {
    var out = {};
    SETTINGS.forEach(function (d) {
      out[d.key] = settingValue(d, stored ? stored[d.key] : null);
    });
    return out;
  }

  // the map sent to configurePlugin (it replaces the whole map): values equal to the default are left out
  function settingsInput(values) {
    var input = {};
    SETTINGS.forEach(function (d) {
      var v = settingValue(d, values[d.key]);
      if (v !== d.def) input[d.key] = v;
    });
    return input;
  }

  // ------------------------------------------------------------------ filters and URL parameters
  // A filter is {order, favoritesOnly, minRating, tags, studios, performers}; id lists
  // are comma separated strings. URL parameters (e.g. /shorts?tag=3,5&order=newest) override the stored
  // defaults for one view.
  var PARAMS = {
    order: "order",
    favoritesOnly: "fav",
    subscribedOnly: "subs",
    minRating: "rating",
    unseenOnly: "unseen",
    tags: "tag",
    studios: "studio",
    performers: "performers", // "performer" (singular) is the performer channel, see contextFromQuery
  };
  var FILTER_KEYS = Object.keys(PARAMS);

  function paramValue(d, v) {
    if (d.type === "BOOLEAN") return v === "1" || v === "true" ? true : v === "0" || v === "false" ? false : null;
    var out = settingValue(d, v);
    return v === "" && d.type === "IDS" ? "" : out;
  }

  // q: URLSearchParams-like (get); settings: readSettings() result
  function filtersFrom(settings, q) {
    var f = {};
    FILTER_KEYS.forEach(function (k) {
      var d = SETTING[k], v = q ? q.get(PARAMS[k]) : null;
      var p = v == null ? null : paramValue(d, v);
      f[k] = p == null ? settings[k] : p;
    });
    return f;
  }

  // the URL parameters for a filter, only where it differs from the stored defaults
  function filterParams(f, settings) {
    var out = [];
    FILTER_KEYS.forEach(function (k) {
      var d = SETTING[k], v = settingValue(d, f[k]);
      if (v === settings[k]) return;
      out.push([PARAMS[k], d.type === "BOOLEAN" ? (v ? "1" : "0") : String(v)]);
    });
    return out
      .map(function (p) {
        return p[0] + "=" + encodeURIComponent(p[1]).replace(/%2C/g, ",");
      })
      .join("&");
  }

  function hasExtraFilters(f) {
    return !!(f.favoritesOnly || f.subscribedOnly || f.minRating || f.unseenOnly || f.tags || f.studios || f.performers);
  }

  // The format part of every scene filter: portrait only unless the setting "allowLandscape" is on (not a
  // URL parameter, so a link cannot change it). Scenes without a video file have no orientation and are
  // left out by the criterion itself, in both cases.
  function formatFilter(allowLandscape) {
    return { orientation: { value: allowLandscape ? ["PORTRAIT", "LANDSCAPE", "SQUARE"] : ["PORTRAIT"] } };
  }

  // Stash's SceneFilterType for a filter, in the format of formatFilter
  function sceneFilter(f, allowLandscape) {
    var s = formatFilter(allowLandscape);
    var tags = idList(f.tags), studios = idList(f.studios), performers = idList(f.performers);
    if (tags.length) s.tags = { value: tags, modifier: "INCLUDES", depth: 0 };
    if (studios.length) s.studios = { value: studios, modifier: "INCLUDES", depth: 0 };
    if (performers.length) s.performers = { value: performers, modifier: "INCLUDES" };
    if (f.favoritesOnly) s.performer_favorite = true;
    // performers subscribed to: their custom field, through Stash's performer sub-filter (no id list needed)
    if (f.subscribedOnly) s.performers_filter = { custom_fields: SUBSCRIPTIONS_FILTER.custom_fields.slice() };
    if (f.unseenOnly) s.play_count = { value: 0, modifier: "EQUALS" };
    var stars = Number(f.minRating) || 0;
    if (stars > 0) s.rating100 = { value: stars * 20 - 1, modifier: "GREATER_THAN" };
    return s;
  }

  // Stash's FindFilterType for one page. "random_<seed>" keeps the random order stable across pages.
  // ("forYou" is ordered in the browser, see forYouOrder; its pages are loaded by id.)
  function findFilter(f, page, perPage, seed) {
    var out = { page: page, per_page: perPage };
    if (f.order === "newest") {
      out.sort = "created_at";
      out.direction = "DESC";
    } else if (f.order === "date") {
      out.sort = "date";
      out.direction = "DESC";
    } else if (f.order === "mostViewed") {
      out.sort = "play_count";
      out.direction = "DESC";
    } else {
      out.sort = "random_" + (seed >>> 0);
    }
    return out;
  }

  // details and tags for the caption and the detail sheet, the animated preview (webp) for tiles, the
  // markers' ids for their number in the action column
  // a gallery as the feed and the profile show it (Core.normalizeGallery)
  var GALLERY_FIELDS = "id title date details rating100 image_count paths { cover } studio { id name } performers { id name favorite image_path }";

  // everything the detail sheet shows of one scene, loaded when it opens
  var DETAIL_QUERY =
    "query StashShortsScene($id: ID!) { findScene(id: $id) { id title details date code director urls" +
    " studio { id name parent_studio { id name } } performers { id name favorite image_path } tags { id name }" +
    " scene_markers { id title seconds end_seconds primary_tag { id name } } } }";

  var SCENE_FIELDS =
    "id title details date rating100 o_counter play_count paths { screenshot stream webp } files { width height duration }" +
    " studio { id name parent_studio { id name } } performers { id name favorite image_path } tags { id name } scene_markers { id }";
  var SCENES_QUERY =
    "query StashShortsScenes($f: FindFilterType, $s: SceneFilterType) {" +
    " findScenes(filter: $f, scene_filter: $s) { count scenes { " + SCENE_FIELDS + " } } }";

  // ------------------------------------------------------------------ suggestions in the filter dialog
  // Tags, studios and performers are offered only when scenes in the current format have them, with the
  // number of those scenes. One query loads the references of all those scenes (ids only) and they are
  // counted here, instead of one count query per tag, studio or performer.
  var REFS_QUERY =
    "query StashShortsRefs($s: SceneFilterType) { findScenes(filter: {per_page: -1}, scene_filter: $s) {" +
    " scenes { studio { id } tags { id } performers { id } } } }";

  // scenes of REFS_QUERY -> { tags: {id: n}, studios: {id: n}, performers: {id: n} }
  function countRefs(scenes) {
    var out = { tags: {}, studios: {}, performers: {} };
    function add(map, id) {
      map[id] = (map[id] || 0) + 1;
    }
    (scenes || []).forEach(function (sc) {
      if (sc.studio) add(out.studios, String(sc.studio.id));
      var seen = {};
      (sc.tags || []).forEach(function (x) {
        if (!seen["t" + x.id]) add(out.tags, String(x.id));
        seen["t" + x.id] = true;
      });
      (sc.performers || []).forEach(function (x) {
        if (!seen["p" + x.id]) add(out.performers, String(x.id));
        seen["p" + x.id] = true;
      });
    });
    return out;
  }

  var SUGGEST_MAX = 8;
  // The entries offered for what was typed: only those with scenes (counts), not those already chosen;
  // names starting with the text first, then those containing it, each by number of scenes, then name.
  // Empty text: the ones with the most scenes. items: [{id, name, ...}] -> [{item, count}]
  function suggestions(items, counts, text, chosen, max) {
    var q = nameKey(text), skip = {};
    (chosen || []).forEach(function (x) {
      skip[String(x)] = true;
    });
    var out = [];
    (items || []).forEach(function (it) {
      var id = String(it.id), n = (counts && counts[id]) || 0;
      if (!n || skip[id]) return;
      var key = nameKey(it.name), at = q ? key.indexOf(q) : 0;
      if (at < 0) return;
      out.push({ item: it, count: n, rank: at === 0 ? 0 : 1, key: key });
    });
    out.sort(function (a, b) {
      return a.rank - b.rank || b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    });
    return out.slice(0, max || SUGGEST_MAX).map(function (r) {
      return { item: r.item, count: r.count };
    });
  }

  // ------------------------------------------------------------------ "For you" order
  // Ordered in the browser from the library's own numbers (ratings, orgasm counts, plays, favorites);
  // nothing is sent anywhere. Each scene of the pool gets a score, the parts weighted by FOR_YOU; then the
  // list is walked so that a scene does not share a performer with the one before it, where possible.
  var FOR_YOU = {
    rating: 1.2, // the scene's own rating (5 stars = 1)
    o: 0.8, // the scene's orgasm count (3 or more = 1)
    favorite: 0.8, // a favorite performer in the scene
    performer: 1.0, // taste for the scene's best liked performer (0 to 1, see taste)
    tag: 0.6, // taste for the scene's tags, on average
    fresh: 0.7, // never played
    seen: 0.6, // played: up to this much less (10 plays or more = all of it)
    random: 0.6, // a random share, so the feed is different on each visit
    prior: 2, // taste: as if everyone had this many more scenes of average liking
    lookahead: 30, // how far down the list a scene without the previous scene's performers is looked for
  };
  var POOL_QUERY =
    "query StashShortsPool($s: SceneFilterType) { findScenes(filter: {per_page: -1}, scene_filter: $s) {" +
    " scenes { id rating100 o_counter play_count performers { id favorite } tags { id } } } }";
  // the whole library (every format), for the taste
  var TASTE_QUERY =
    "query StashShortsTaste { findScenes(filter: {per_page: -1}) { scenes { rating100 o_counter play_count performers { id } tags { id } studio { id } } } }";
  // one scene by id within a filter (Stash's id criterion), for continuing where one was
  var RESUME_QUERY = "query StashShortsResume($s: SceneFilterType) { findScenes(filter: {per_page: 1}, scene_filter: $s) { scenes { " + SCENE_FIELDS + " } } }";
  var BY_IDS_QUERY = "query StashShortsByIds($ids: [ID!]) { findScenes(ids: $ids, filter: {per_page: -1}) { scenes { " + SCENE_FIELDS + " } } }";

  // Pages that do not shift: with "unseen only", a scene played in this view drops out of the filter, so
  // Stash's pages (by offset) would skip scenes. Then the ids are loaded once in the order of the filter,
  // like "For you", and the pages by id.
  var IDS_QUERY = "query StashShortsIds($f: FindFilterType, $s: SceneFilterType) { findScenes(filter: $f, scene_filter: $s) { scenes { id } } }";
  function plannedOrder(f, markers, galleries) {
    return f.order === "forYou" || !!f.unseenOnly || !!markers || !!galleries;
  }

  // a small seeded random number generator (mulberry32): the same seed gives the same order
  function seeded(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // how much a scene was liked, 0 to 1: its rating, its orgasm count, and a little for being played
  function liking(sc) {
    var r = sc.rating100 == null ? 0 : Number(sc.rating100) / 100;
    return 0.5 * r + 0.35 * Math.min(Number(sc.o_counter) || 0, 3) / 3 + 0.15 * Math.min(Number(sc.play_count) || 0, 5) / 5;
  }

  // Taste for performers and tags from the scenes of the library: the average liking of their scenes,
  // pulled towards the library's average for those with few scenes (FOR_YOU.prior), then scaled so that
  // the best liked is 1. -> { performers: {id: 0..1}, tags: {id: 0..1} }
  function taste(scenes) {
    var sums = { performers: {}, tags: {} }, total = 0, n = 0;
    (scenes || []).forEach(function (sc) {
      var l = liking(sc);
      total += l;
      n++;
      ["performers", "tags"].forEach(function (k) {
        (sc[k] || []).forEach(function (x) {
          var e = sums[k][x.id] || (sums[k][x.id] = { sum: 0, n: 0 });
          e.sum += l;
          e.n++;
        });
      });
    });
    var mean = n ? total / n : 0, out = { performers: {}, tags: {} };
    ["performers", "tags"].forEach(function (k) {
      var max = 0;
      Object.keys(sums[k]).forEach(function (id) {
        var e = sums[k][id], v = (e.sum + FOR_YOU.prior * mean) / (e.n + FOR_YOU.prior);
        out[k][id] = v;
        if (v > max) max = v;
      });
      Object.keys(out[k]).forEach(function (id) {
        out[k][id] = max > 0 ? out[k][id] / max : 0;
      });
    });
    return out;
  }

  // the weighted parts of one scene's score (rand: 0 to 1)
  function forYouParts(sc, tasteOf, rand) {
    var w = FOR_YOU, plays = Number(sc.play_count) || 0, performers = sc.performers || [], tags = sc.tags || [];
    var best = 0, tagSum = 0;
    performers.forEach(function (p) {
      best = Math.max(best, tasteOf.performers[p.id] || 0);
    });
    tags.forEach(function (x) {
      tagSum += tasteOf.tags[x.id] || 0;
    });
    return {
      rating: w.rating * (sc.rating100 == null ? 0 : Number(sc.rating100) / 100),
      o: w.o * Math.min(Number(sc.o_counter) || 0, 3) / 3,
      favorite: performers.some(function (p) {
        return p.favorite;
      }) ? w.favorite : 0,
      performer: w.performer * best,
      tag: tags.length ? w.tag * tagSum / tags.length : 0,
      fresh: plays ? 0 : w.fresh,
      seen: -w.seen * Math.min(plays, 10) / 10,
      random: w.random * rand,
    };
  }

  // The pool (scenes of POOL_QUERY) in "For you" order: [{ id, score, parts }]. Deterministic for a seed.
  // markers: [{ id: "m..", sceneId }]: each scored like its scene (with a random share of its own), so the
  // walk keeps it away from its scene and its performers.
  function forYouOrder(pool, tasteOf, seed, markers) {
    var rand = seeded(seed), t = tasteOf || { performers: {}, tags: {} }, byId = {};
    (pool || []).forEach(function (sc) {
      byId[String(sc.id)] = sc;
    });
    var all = (pool || []).concat(
      (markers || [])
        .filter(function (m) {
          return byId[m.sceneId];
        })
        .map(function (m) {
          return Object.assign({}, byId[m.sceneId], { id: m.id, sceneId: m.sceneId });
        })
    );
    var list = all.map(function (sc) {
      var parts = forYouParts(sc, t, rand()), score = 0;
      Object.keys(parts).forEach(function (k) {
        score += parts[k];
      });
      return { id: String(sc.id), sceneId: sc.sceneId, score: score, parts: parts, who: (sc.performers || []).map(function (p) {
        return String(p.id);
      }) };
    });
    list.sort(function (a, b) {
      return b.score - a.score || (a.id < b.id ? -1 : 1);
    });
    // the next scene: the best one that shares no performer with the previous, within FOR_YOU.lookahead
    var taken = [], out = [], start = 0;
    while (out.length < list.length) {
      while (taken[start]) start++;
      var pick = start, prev = out.length ? out[out.length - 1].who : [];
      if (prev.length)
        for (var i = start, seen = 0; i < list.length && seen < FOR_YOU.lookahead; i++) {
          if (taken[i]) continue;
          seen++;
          if (!list[i].who.some(function (id) {
            return prev.indexOf(id) >= 0;
          })) {
            pick = i;
            break;
          }
        }
      taken[pick] = true;
      out.push(list[pick]);
    }
    return out.map(function (e) {
      return e.sceneId ? { id: e.id, sceneId: e.sceneId, score: e.score, parts: e.parts } : { id: e.id, score: e.score, parts: e.parts };
    });
  }

  // ------------------------------------------------------------------ stories bar
  // The performers in the round avatars at the top: only those with scenes in the feed's format (counts of
  // countRefs), favorites first, then by number of scenes, then by name.
  // ------------------------------------------------------------------ side previews: related performers
  // Who comes up next to a scene: performers who appear in scenes together with the scene's performers
  // (counted over the whole library), then those of the scene's studio; never one of the scene; favorites
  // first, then by how often; at most max. library: scenes with performers { id } and studio { id } (the
  // list TASTE_QUERY loads); favorite: id -> true; inFormat (optional): id -> number of their scenes in the
  // feed's format (countRefs), so that a tile never leads to an empty channel.
  var RELATED_MAX = 3;
  function related(scene, library, favorite, max, inFormat) {
    var cast = {}, score = {};
    (scene.performers || []).forEach(function (p) {
      cast[String(p.id)] = true;
    });
    var studio = scene.studio ? String(scene.studio.id) : null;
    (library || []).forEach(function (sc) {
      var ids = (sc.performers || []).map(function (p) {
        return String(p.id);
      });
      var together = ids.some(function (id) {
        return cast[id];
      });
      var same = studio && sc.studio && String(sc.studio.id) === studio;
      if (!together && !same) return;
      ids.forEach(function (id) {
        if (!cast[id]) score[id] = (score[id] || 0) + (together ? 10 : 0) + (same ? 1 : 0);
      });
    });
    return Object.keys(score)
      .filter(function (id) {
        return !inFormat || inFormat[id] > 0;
      })
      .sort(function (a, b) {
        return (favorite && !!favorite[b]) - (favorite && !!favorite[a]) || score[b] - score[a] || Number(a) - Number(b);
      })
      .slice(0, max || RELATED_MAX);
  }

  var STORIES_MAX = 40;
  function storyPerformers(performers, counts, max) {
    return (performers || [])
      .filter(function (p) {
        return (counts && counts[String(p.id)]) > 0;
      })
      .map(function (p) {
        return { p: p, n: counts[String(p.id)], key: nameKey(p.name) };
      })
      .sort(function (a, b) {
        return (b.p.favorite ? 1 : 0) - (a.p.favorite ? 1 : 0) || b.n - a.n || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
      })
      .slice(0, max || STORIES_MAX)
      .map(function (e) {
        return e.p;
      });
  }

  // ------------------------------------------------------------------ markers as shorts
  // Scene markers of the scenes in the filter are entries of their own in the feed (setting, on by
  // default): the scene's stream from the marker's time, up to its end or MARKER_SECONDS, title and primary
  // tag from the marker. Same video element as any scene, so the limit of three stays.
  var MARKER_SECONDS = 30;
  var MARKERS_QUERY =
    "query StashShortsMarkers($s: SceneFilterType) { findSceneMarkers(scene_marker_filter: {scene_filter: $s}, filter: {per_page: -1}) {" +
    " scene_markers { id title seconds end_seconds primary_tag { id name } scene { id } } } }";

  // the entry for marker m (from MARKERS_QUERY) of the scene sc (normalizeScene)
  function markerItem(sc, m) {
    var start = Math.max(0, Number(m.seconds) || 0), len = sc.duration > 0 ? sc.duration : Infinity;
    var end = m.end_seconds != null && Number(m.end_seconds) > start ? Number(m.end_seconds) : start + MARKER_SECONDS;
    end = Math.min(end, len);
    var tag = m.primary_tag ? m.primary_tag.name : "";
    return Object.assign({}, sc, {
      id: "m" + m.id,
      sceneId: sc.sceneId || sc.id,
      title: m.title || tag || sc.title,
      titled: !!(m.title || tag),
      stream: sc.stream + "#t=" + start, // the browser loads from there
      duration: end > start && isFinite(end) ? end - start : 0,
      marker: { id: String(m.id), start: start, end: end, tag: tag },
    });
  }

  // the part of the video an entry plays: a marker its range, a scene all of it
  function clipRange(sc, duration) {
    if (sc && sc.marker) return { start: sc.marker.start, end: sc.marker.end };
    return { start: 0, end: duration > 0 ? duration : (sc && sc.duration) || 0 };
  }
  // seconds as "1:05" or "1:02:03", for the marker list
  function clock(seconds) {
    var t = Math.max(0, Math.floor(Number(seconds) || 0)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    var ss = (s < 10 ? "0" : "") + s;
    return h ? h + ":" + (m < 10 ? "0" : "") + m + ":" + ss : m + ":" + ss;
  }

  // A marker clip turned into its whole scene from a time (a marker picked in the detail sheet while a marker
  // clip plays): the scene's entry with startAt, under an id of its own ("j<scene>-<seconds>"), so it does not
  // clash with the scene or the marker elsewhere in the feed. scene: the scene's own entry (normalizeScene),
  // never a marker entry, whose length and stream are those of the clip (null then).
  function jumpEntry(scene, seconds) {
    if (!scene || scene.marker) return null;
    var at = Math.max(0, Number(seconds) || 0);
    return Object.assign({}, scene, { id: "j" + scene.sceneId + "-" + Math.round(at), startAt: at, marker: null });
  }

  // position in the entry 0..1, and the time for a tap at x of width w on the progress bar
  function clipProgress(sc, t, duration) {
    var r = clipRange(sc, duration), len = r.end - r.start;
    return len > 0 ? clamp((t - r.start) / len, 0, 1) : 0;
  }
  function clipSeek(sc, x, w, duration) {
    var r = clipRange(sc, duration);
    return r.start + seekTime(x, w, r.end - r.start);
  }
  // a marker is over (its end is before the end of the file, so the video does not end by itself)
  function clipOver(sc, t) {
    return !!(sc && sc.marker && sc.marker.end > 0 && t >= sc.marker.end - 0.05);
  }

  // The markers among the ids of a plain order: right after their scene for "newest" and "most viewed",
  // at seeded random places for "random" (and anywhere when their scene is not in the list).
  // order: [{ id }], markers: [{ id: "m..", sceneId }] -> [{ id, sceneId? }]
  function mixMarkers(order, markers, how, seed) {
    var out = order.slice(), rand = seeded(seed), at = {};
    if (how !== "random") {
      var after = {};
      (markers || []).forEach(function (m) {
        (after[m.sceneId] = after[m.sceneId] || []).push(m);
      });
      out = [];
      order.forEach(function (e) {
        out.push(e);
        (after[e.id] || []).forEach(function (m) {
          out.push(m);
          at[m.id] = true;
        });
      });
    }
    (markers || []).forEach(function (m) {
      if (at[m.id]) return;
      out.splice(Math.floor(rand() * (out.length + 1)), 0, m);
    });
    return out;
  }

  // ------------------------------------------------------------------ galleries as posts in the feed
  // A gallery is an entry of its own (id "g<id>"), its pictures in a row to flip through. Which: those with
  // the feed's filters (tags, studios, performers, favorites, rating) and pictures in the feed's format;
  // none with "only unwatched" (a gallery has no play count) or the setting "disableGalleries".
  function galleryFilter(f, allowLandscape) {
    if (f.unseenOnly) return null;
    var g = { image_count: { value: 0, modifier: "GREATER_THAN" },
      images_filter: { orientation: { value: allowLandscape ? ["PORTRAIT", "LANDSCAPE", "SQUARE"] : ["PORTRAIT"] } } };
    var tags = idList(f.tags), studios = idList(f.studios), performers = idList(f.performers);
    if (tags.length) g.tags = { value: tags, modifier: "INCLUDES", depth: 0 };
    if (studios.length) g.studios = { value: studios, modifier: "INCLUDES", depth: 0 };
    if (performers.length) g.performers = { value: performers, modifier: "INCLUDES" };
    if (f.favoritesOnly) g.performer_favorite = true;
    if (f.subscribedOnly) g.performers_filter = { custom_fields: SUBSCRIPTIONS_FILTER.custom_fields.slice() };
    var stars = Number(f.minRating) || 0;
    if (stars > 0) g.rating100 = { value: stars * 20 - 1, modifier: "GREATER_THAN" };
    return g;
  }
  function galleryFromQuery(q) {
    return idList(q ? q.get("gallery") : "")[0] || null;
  }
  // the ids of the galleries in the filter (newest first for "newest", else by rating), for the plan
  var GALLERY_IDS_QUERY =
    "query StashShortsGalleryIds($f: FindFilterType, $g: GalleryFilterType) { findGalleries(filter: $f, gallery_filter: $g) {" +
    " galleries { id rating100 } } }";
  var GALLERIES_BY_IDS_QUERY =
    "query StashShortsGalleriesByIds($ids: [ID!]) { findGalleries(ids: $ids, filter: {per_page: -1}) { galleries { " + GALLERY_FIELDS + " } } }";
  // the pictures of one gallery, in the gallery's order (by path, as Stash shows a folder)
  var GALLERY_IMAGES_QUERY =
    "query StashShortsGalleryImages($i: ImageFilterType) { findImages(image_filter: $i, filter: {per_page: -1, sort: \"path\", direction: \"ASC\"}) {" +
    " images { id o_counter paths { thumbnail image } } } }";
  var RATE_GALLERY_MUTATION = "mutation StashShortsRateGallery($i: GalleryUpdateInput!) { galleryUpdate(input: $i) { id rating100 } }";
  var IMAGE_O_MUTATION = "mutation StashShortsImageO($id: ID!) { imageIncrementO(id: $id) }";
  var IMAGE_UNDO_O_MUTATION = "mutation StashShortsImageUndoO($id: ID!) { imageDecrementO(id: $id) }";

  // Galleries spread over the feed: one after every few entries (as many as there are entries per gallery,
  // at least every GALLERY_EVERY), in the order of the list for "newest", the best rated first with a random
  // share for "For you", else at random; the rest at the end.
  var GALLERY_EVERY = 4;
  function mixGalleries(order, galleries, how, seed) {
    if (!galleries || !galleries.length) return order;
    var rand = seeded((seed >>> 0) ^ 0x9e3779b9), list = galleries.slice();
    if (how === "forYou") {
      var key = {};
      list.forEach(function (g) {
        key[g.id] = (g.rating100 == null ? 50 : g.rating100) + rand() * 40;
      });
      list.sort(function (a, b) {
        return key[b.id] - key[a.id];
      });
    } else if (how !== "newest" && how !== "date")
      for (var i = list.length - 1; i > 0; i--) {
        var j = Math.floor(rand() * (i + 1)), x = list[i];
        list[i] = list[j];
        list[j] = x;
      }
    var every = Math.max(GALLERY_EVERY, Math.round(order.length / list.length)), out = [], gi = 0;
    order.forEach(function (e, n) {
      out.push(e);
      if ((n + 1) % every === 0 && gi < list.length) out.push(list[gi++]);
    });
    while (gi < list.length) out.push(list[gi++]);
    return out;
  }

  // the picture of a gallery entry shown first, and which ones have an <img> with a source (it and its
  // neighbours, three at most)
  function galleryWindow(at, count) {
    var out = [];
    for (var k = at - 1; k <= at + 1; k++) if (k >= 0 && k < count) out.push(k);
    return out;
  }

  // ------------------------------------------------------------------ continue where one was
  // The scene last shown in each context (all scenes with a filter, or a channel), kept in the browser
  // (localStorage) for RESUME_DAYS, at most RESUME_MAX contexts; opening the page there again starts with it.
  var RESUME_STORE = PLUGIN_ID + ":resume", RESUME_DAYS = 14, RESUME_MAX = 30;
  function resumeKey(ctx, f) {
    return contextKey(ctx) + "|" + FILTER_KEYS.map(function (k) {
      return k + "=" + (f ? f[k] : "");
    }).join("&");
  }
  // map: { key: { id, at } } -> a new map with the scene for this key, the oldest dropped
  function rememberAt(map, key, sceneId, now) {
    var out = {}, keys;
    Object.keys(map || {}).forEach(function (k) {
      var e = map[k];
      if (e && e.id && now - e.at < RESUME_DAYS * 864e5) out[k] = { id: String(e.id), at: Number(e.at) };
    });
    out[key] = { id: String(sceneId), at: now };
    keys = Object.keys(out).sort(function (a, b) {
      return out[b].at - out[a].at;
    });
    keys.slice(RESUME_MAX).forEach(function (k) {
      delete out[k];
    });
    return out;
  }
  // the scene to start with for this key, or null (none, or too old)
  function resumeAt(map, key, now) {
    var e = map && map[key];
    return e && e.id && now - e.at < RESUME_DAYS * 864e5 ? String(e.id) : null;
  }

  function fileName(path) {
    return path ? String(path).split(/[\\/]/).pop() : "";
  }

  // GraphQL scene -> what the feed needs
  function normalizeScene(sc) {
    var file = (sc.files && sc.files[0]) || {};
    var w = Number(file.width) || 0, hgt = Number(file.height) || 0;
    return {
      id: String(sc.id),
      sceneId: String(sc.id), // the scene in Stash (a marker entry has its own id, see markerItem)
      title: sc.title || fileName(file.path) || "#" + sc.id,
      titled: !!sc.title, // false: title is the file name or the id
      date: sc.date || "",
      rating100: sc.rating100 == null ? null : Number(sc.rating100),
      o_counter: Number(sc.o_counter) || 0,
      play_count: Number(sc.play_count) || 0,
      stream: localUrl(sc.paths && sc.paths.stream) || "scene/" + sc.id + "/stream",
      screenshot: localUrl(sc.paths && sc.paths.screenshot),
      // Stash gives the path also when no preview was generated; an <img> falls back to the screenshot
      preview: localUrl(sc.paths && sc.paths.webp),
      details: sc.details || "",
      tags: (sc.tags || []).map(function (x) {
        return { id: String(x.id), name: x.name };
      }),
      markerCount: (sc.scene_markers || []).length,
      width: w,
      height: hgt,
      duration: Number(file.duration) || 0,
      studio: sc.studio
        ? { id: String(sc.studio.id), name: sc.studio.name, parent: sc.studio.parent_studio ? { id: String(sc.studio.parent_studio.id), name: sc.studio.parent_studio.name } : null }
        : null,
      performers: (sc.performers || []).map(function (p) {
        return { id: String(p.id), name: p.name, favorite: !!p.favorite, image: localUrl(p.image_path) };
      }),
    };
  }

  // Stash's transcoding endpoint, tried once when the direct stream cannot be played by the browser
  function transcodeUrl(scene) {
    return "scene/" + (scene.sceneId || scene.id) + "/stream.mp4";
  }

  // ------------------------------------------------------------------ caption (bottom left)
  // Every piece of information once: fan site accounts are named after the FansDB convention, so the
  // performer "Limon1kaaa" has the studio "Limon1kaaa (Fansly)", and often a title that is just the name.

  // for comparing names: case, accents, spaces and punctuation do not count
  function nameKey(s) {
    return String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // the studio's name without the performer's: "Limon1kaaa (Fansly)" -> "Fansly", "" when nothing else
  // is left, null when the performer's name is not in it as a whole word
  function studioRest(studio, performer) {
    var name = String(performer || "").trim();
    if (!name) return null;
    if (nameKey(studio) === nameKey(name)) return "";
    var re = new RegExp("(^|[^\\p{L}\\p{N}])" + escapeRegExp(name) + "(?![\\p{L}\\p{N}])", "iu");
    if (!re.test(studio)) return null;
    var rest = studio.replace(re, "$1").replace(/[()[\]{}]/g, " ").replace(/^[\s\-_.,:;|/·]+|[\s\-_.,:;|/·]+$/g, "").replace(/\s+/g, " ");
    return nameKey(rest) ? rest : "";
  }

  // The studio's text in the caption (null: not shown). Only a studio named after a performer of the
  // scene is changed: it shows its parent studio when it has one (FansDB: "Limon1kaaa (Fansly)" belongs to
  // "Fansly"), else the rest of its name, and nothing when it is just the performer's name. Any other
  // studio, or a rest with nothing in it, keeps its full name.
  function studioText(studio, performers) {
    for (var i = 0; i < performers.length; i++) {
      var rest = studioRest(studio.name, performers[i].name);
      if (rest === null) continue;
      if (studio.parent && studio.parent.name) return studio.parent.name;
      if (nameKey(studio.name) === nameKey(performers[i].name)) return null;
      return rest || studio.name;
    }
    return studio.name;
  }

  // What the bottom left shows for a scene: the title (null: none) and one line of performers and the
  // studio (studioText). channelId: the performer whose channel is open (named at the top, so left out).
  function sceneCaption(scene, channelId) {
    var performers = scene.performers || [];
    var others = performers.filter(function (p) {
      return channelId == null || String(p.id) !== String(channelId);
    });
    var text = scene.studio ? studioText(scene.studio, performers) : null;
    var studio = text ? { id: scene.studio.id, text: text } : null;
    // a title that is only the name of a performer or the studio says nothing new
    var names = performers.map(function (p) {
      return nameKey(p.name);
    });
    if (scene.studio) names.push(nameKey(scene.studio.name));
    var title = scene.titled === false ? null : scene.title;
    if (title && (!nameKey(title) || names.indexOf(nameKey(title)) >= 0)) title = null;
    // without a title and without anything else the file name is better than nothing
    if (!title && !others.length && !studio && scene.titled === false) title = scene.title;
    return { title: title || null, performers: others, studio: studio };
  }

  // ------------------------------------------------------------------ feed window
  // The previous, the current and the next scene get a video element with a source (so one step in
  // either direction plays without loading); the pool has POOL_SIZE elements, and every element that is
  // not wanted has its source removed. Order = priority: current, next, previous.
  var POOL_SIZE = 3;

  function wantedScenes(index, length) {
    var out = [];
    if (index >= 0 && index < length) out.push(index);
    if (index + 1 < length) out.push(index + 1);
    if (index - 1 >= 0 && index - 1 < length) out.push(index - 1);
    return out;
  }

  // slots: array (POOL_SIZE) of scene index or null. Keeps a slot whose scene is still wanted, frees the
  // others, and gives free slots to wanted scenes without one. Returns the new array.
  function assignSlots(slots, wanted) {
    var next = slots.map(function (s) {
      return s != null && wanted.indexOf(s) >= 0 ? s : null;
    });
    wanted.forEach(function (w) {
      if (next.indexOf(w) >= 0) return;
      var free = next.indexOf(null);
      if (free >= 0) next[free] = w;
    });
    return next;
  }

  // How a video fills its box: "cover" (cropped a little) when the shapes are close, else "contain"
  // (whole picture with dark bars, e.g. a 3:4 portrait video).
  function fitMode(vw, vh, bw, bh) {
    if (!(vw > 0 && vh > 0 && bw > 0 && bh > 0) || vw >= vh) return "contain";
    var r = vw / vh / (bw / bh);
    return r >= 0.8 && r <= 1.25 ? "cover" : "contain";
  }

  // Turning the phone: what the page does for the current scene. touch: a touch screen (phones, tablets;
  // a desktop window is landscape too, but nothing changes there); sideways: the screen is landscape;
  // wide: the scene is landscape or square and the setting "allowLandscape" lets it in.
  // fill: the video takes the whole screen and the overlay hides after IDLE_MS without a touch;
  // rotate: the button that turns the phone (or says to) is shown.
  var IDLE_MS = 2500;
  function orientationMode(touch, sideways, wide) {
    return { fill: !!(touch && sideways && wide), rotate: !!(touch && !sideways && wide) };
  }

  // What happens when the current clip ends: "loop" (the video element loops by itself; the default),
  // "next" (setting "autoAdvance": the next clip), "replay" (autoAdvance on the last clip: from the start)
  function endAction(autoAdvance, index, loaded) {
    if (!autoAdvance) return "loop";
    return index < loaded - 1 ? "next" : "replay";
  }

  // load the next page once the viewer is this close to the end of what is loaded
  function needMore(index, loaded, total, ahead) {
    return loaded < total && index >= loaded - (ahead || 5);
  }

  // ------------------------------------------------------------------ gestures
  // A vertical drag of dy pixels (negative = up) in dt milliseconds on a screen of the given height:
  // +1 = next scene, -1 = previous, 0 = snap back. A quarter of the height or a quick flick is enough.
  function swipeStep(dy, dt, height) {
    var dist = Math.abs(dy), v = dt > 0 ? dist / dt : 0;
    if (dist >= height * 0.25 || (dist >= 30 && v >= 0.4)) return dy < 0 ? 1 : -1;
    return 0;
  }

  // Mouse wheel and touchpads: one step per gesture. Deltas are summed until THRESHOLD; then the gate is
  // closed until the wheel has been quiet for QUIET ms (touchpad inertia sends events for a while).
  function WheelGate(threshold, quiet) {
    this.threshold = threshold || 40;
    this.quiet = quiet || 220;
    this.sum = 0;
    this.last = -Infinity;
    this.locked = false;
  }
  // deltaY in pixels (line mode already converted), now in ms; returns +1, -1 or 0
  WheelGate.prototype.push = function (deltaY, now) {
    if (now - this.last > this.quiet) {
      this.locked = false;
      this.sum = 0;
    }
    this.last = now;
    if (this.locked) return 0;
    this.sum += deltaY;
    if (Math.abs(this.sum) < this.threshold) return 0;
    var step = this.sum > 0 ? 1 : -1;
    this.locked = true;
    this.sum = 0;
    return step;
  };

  // Sideways = change the context (the performer channel), vertical = next scene in the context. The
  // direction of a drag is decided once, after MIN px, by its angle: up to SIDE_ANGLE degrees from the
  // horizontal it is sideways, anything steeper is vertical. So an oblique swipe (30 degrees and more)
  // never changes the context.
  var AXIS_MIN = 10;
  var SIDE_ANGLE = 25;

  function angleFromHorizontal(dx, dy) {
    return (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
  }

  // "x", "y", or null while the drag is still shorter than `min` px
  function dragAxis(dx, dy, min) {
    if (Math.sqrt(dx * dx + dy * dy) < (min == null ? AXIS_MIN : min)) return null;
    return angleFromHorizontal(dx, dy) <= SIDE_ANGLE ? "x" : "y";
  }

  // A sideways drag (dx, dy) in dt ms on a screen of the given width: +1 = swiped to the left (into the
  // performer channel), -1 = to the right (back to the previous context), 0 = snap back. The whole drag
  // must stay flat too, so one that started flat and bent away does not count.
  function sideStep(dx, dy, dt, width) {
    if (angleFromHorizontal(dx, dy) > SIDE_ANGLE) return 0;
    var dist = Math.abs(dx), v = dt > 0 ? dist / dt : 0;
    if (dist >= width * 0.25 || (dist >= 30 && v >= 0.4)) return dx < 0 ? 1 : -1;
    return 0;
  }

  // keyboard sideways: as the swipe, ArrowRight shows what is to the right (the channel)
  function sideKey(key) {
    if (key === "ArrowRight") return 1;
    if (key === "ArrowLeft") return -1;
    return 0;
  }

  // Double tap: a second tap within DOUBLE_TAP_MS and DOUBLE_TAP_PX of the first. A single tap only counts
  // once that time is over (so a double tap does not also toggle the sound); a third tap starts anew.
  var DOUBLE_TAP_MS = 250, DOUBLE_TAP_PX = 40;
  function DoubleTap() {
    this.last = null;
  }
  // a tap at time t (ms) and x, y: "double" when it completes a double tap, else "first"
  DoubleTap.prototype.tap = function (t, x, y) {
    var l = this.last;
    if (l && t - l.t <= DOUBLE_TAP_MS && Math.abs(x - l.x) <= DOUBLE_TAP_PX && Math.abs(y - l.y) <= DOUBLE_TAP_PX) {
      this.last = null;
      return "double";
    }
    this.last = { t: t, x: x, y: y };
    return "first";
  };
  DoubleTap.prototype.reset = function () {
    this.last = null;
  };

  // keyboard: +1, -1 or 0
  function keyStep(key) {
    if (key === "ArrowDown" || key === "PageDown" || key === "j") return 1;
    if (key === "ArrowUp" || key === "PageUp" || key === "k") return -1;
    return 0;
  }

  // a tap on the progress bar at x of a bar `width` wide -> time in seconds
  function seekTime(x, width, duration) {
    if (!(width > 0) || !(duration > 0)) return 0;
    return clamp(x / width, 0, 1) * duration;
  }

  // ------------------------------------------------------------------ rating and play count

  function ratingStars(rating100) {
    return rating100 == null ? 0 : clamp(Math.round(Number(rating100) / 20), 0, 5);
  }

  // clicking star n (1..5): the same value again clears the rating, as in Stash
  function ratingAfterClick(rating100, n) {
    return ratingStars(rating100) === n ? null : n * 20;
  }

  // Counts played seconds from the video's currentTime; jumps (seeking, the loop restarting) do not add
  // time. done() is true once `after` seconds were played; the caller reports the play once.
  function PlayTracker(after) {
    this.after = after;
    this.played = 0;
    this.last = null;
    this.reported = false;
  }
  PlayTracker.prototype.update = function (t) {
    if (this.last != null) {
      var d = t - this.last;
      if (d > 0 && d < 1.5) this.played += d;
    }
    this.last = t;
    return !this.reported && this.played >= this.after;
  };
  PlayTracker.prototype.pause = function () {
    this.last = null;
  };
  PlayTracker.prototype.markReported = function () {
    this.reported = true;
  };

  // ------------------------------------------------------------------ contexts (all scenes, a performer's channel)
  // A context is {kind: "all"} or {kind: "performer", id, name}. The URL shows it: /shorts?performer=<id>.

  var ALL = { kind: "all" };

  function contextKey(ctx) {
    return ctx && ctx.kind === "performer" ? "performer:" + ctx.id : "all";
  }

  // q: URLSearchParams-like; only the first id of performer= counts
  function contextFromQuery(q) {
    var id = idList(q ? q.get("performer") : "")[0];
    return id ? { kind: "performer", id: id, name: null } : ALL;
  }

  // A link to one scene (/shorts?scene=<id>, from Share): the feed opens with it, whatever the filter, and
  // goes on with the scenes of the context. Only the first id counts; null without one.
  function sceneFromQuery(q) {
    return idList(q ? q.get("scene") : "")[0] || null;
  }

  // The performers of the caption: the main one (the channel's performer in a channel, else the first one
  // subscribed to, else the first favorite, else the first) with avatar, name and Subscribe, and the others
  // in the scene's order.
  function captionPeople(performers, channelId) {
    var list = performers || [];
    function pick(ok) {
      for (var i = 0; i < list.length; i++) if (ok(list[i])) return list[i];
      return null;
    }
    var main =
      (channelId != null &&
        pick(function (p) {
          return String(p.id) === String(channelId);
        })) ||
      pick(function (p) {
        return p.subscribed;
      }) ||
      pick(function (p) {
        return p.favorite;
      }) ||
      list[0] ||
      null;
    return { main: main, others: list.filter(function (p) {
      return p !== main;
    }) };
  }

  // The address of one scene for Share: the Shorts page here, with scene=<id> (sceneFromQuery). base is the
  // page's own address (location.href); its path is kept, so a Stash behind a path prefix works too.
  function shareUrl(base, id, kind) {
    var m = /^([^?#]*)/.exec(String(base || ""));
    return m[1] + "?" + (kind === "gallery" ? "gallery" : "scene") + "=" + encodeURIComponent(id);
  }

  // ------------------------------------------------------------------ creator profile (/shorts?profile=<id>)

  function profileFromQuery(q) {
    return idList(q ? q.get("profile") : "")[0] || null;
  }

  // A performer's links in groups as Stash shows them on the performer page (ExternalLinkButtons): twitter
  // or x.com, instagram, and all others; each group a button with a menu. Only http(s) links; empty
  // groups are left out.
  function linkGroups(urls) {
    var web = (urls || []).filter(function (u) {
      return /^https?:\/\//i.test(String(u));
    });
    var twitter = web.filter(function (u) {
      return /^https?:\/\/(?:www\.)?(?:twitter|x)\.com\//i.test(u);
    });
    var instagram = web.filter(function (u) {
      return /^https?:\/\/(?:www\.)?instagram\.com\//i.test(u);
    });
    var others = web.filter(function (u) {
      return twitter.indexOf(u) < 0 && instagram.indexOf(u) < 0;
    });
    return [
      { kind: "link", icon: "faLink", library: "FontAwesomeSolid", urls: others },
      { kind: "twitter", icon: "faTwitter", library: "FontAwesomeBrands", urls: twitter },
      { kind: "instagram", icon: "faInstagram", library: "FontAwesomeBrands", urls: instagram },
    ].filter(function (g) {
      return g.urls.length;
    });
  }

  // the handle under the name: the name in lower case without spaces and punctuation ("Limon1kaaa" ->
  // "@limon1kaaa"), as fan sites show it; empty for a name of punctuation only
  function handleOf(name) {
    var k = nameKey(name);
    return k ? "@" + k : "";
  }

  var PROFILE_QUERY =
    "query StashShortsProfile($id: ID!) { findPerformer(id: $id) { id name disambiguation details urls image_path favorite" +
    " rating100 scene_count gallery_count image_count o_counter custom_fields } }";
  var GALLERIES_QUERY =
    "query StashShortsGalleries($f: FindFilterType, $g: GalleryFilterType) { findGalleries(filter: $f, gallery_filter: $g) {" +
    " count galleries { " + GALLERY_FIELDS + " } } }";
  var IMAGES_QUERY =
    "query StashShortsImages($f: FindFilterType, $i: ImageFilterType) { findImages(filter: $f, image_filter: $i) {" +
    " count images { id title date paths { thumbnail } galleries { id } } } }";

  // the performer's scenes in the feed's format (what their channel shows), and their galleries and images
  function profileSceneFilter(performerId, allowLandscape) {
    return Object.assign(formatFilter(allowLandscape), { performers: { value: [String(performerId)], modifier: "INCLUDES" } });
  }
  function profileGalleryFilter(performerId) {
    return { performers: { value: [String(performerId)], modifier: "INCLUDES" } };
  }
  // their favorites: 4 stars or more, or with orgasms (Stash's OR repeats the other criteria)
  function profileFavoritesFilter(performerId, allowLandscape) {
    var base = profileSceneFilter(performerId, allowLandscape);
    return Object.assign({}, base, { rating100: { value: 79, modifier: "GREATER_THAN" },
      OR: Object.assign({}, base, { o_counter: { value: 0, modifier: "GREATER_THAN" } }) });
  }
  // one page of a profile list: newest first by date, or best first
  function profilePage(page, perPage, sort) {
    return { page: page, per_page: perPage, sort: sort || "date", direction: "DESC" };
  }

  function normalizeGallery(g) {
    return {
      id: "g" + g.id,
      galleryId: String(g.id),
      kind: "gallery",
      title: g.title || "",
      date: g.date || "",
      details: g.details || "",
      rating100: g.rating100 == null ? null : Number(g.rating100),
      imageCount: Number(g.image_count) || 0,
      cover: localUrl(g.paths && g.paths.cover),
      studio: g.studio ? { id: String(g.studio.id), name: g.studio.name, parent: null } : null,
      performers: (g.performers || []).map(function (p) {
        return { id: String(p.id), name: p.name, favorite: !!p.favorite, image: localUrl(p.image_path) };
      }),
    };
  }

  // Two lists, each sorted newest first by date and loaded page by page, merged into one (the profile's
  // posts: scenes and galleries). a, b: { items: [...], done } (done: no more pages). Takes up to max of
  // what is certain: the newer head while both have items, the rest of one when the other is done; those
  // without a date count as oldest. need: the source to load next before more can be taken (null: none).
  function takeByDate(a, b, max) {
    var out = [];
    function key(x) {
      return x.date || "";
    }
    while (out.length < max) {
      var ha = a.items[0], hb = b.items[0];
      if (ha && hb) out.push(key(ha) >= key(hb) ? a.items.shift() : b.items.shift());
      else if (ha && b.done) out.push(a.items.shift());
      else if (hb && a.done) out.push(b.items.shift());
      else break;
    }
    var need = !a.items.length && !a.done ? "a" : !b.items.length && !b.done ? "b" : null;
    return { out: out, need: need };
  }

  // ------------------------------------------------------------------ quick actions (a row above the caption)
  // Up to QUICK_TAGS_MAX tags of one's own choice, each a toggle on the scene. Stash's sceneUpdate takes the
  // whole list, so the scene's other tags go with it unchanged.
  var QUICK_TAGS_MAX = 5;
  function quickTagIds(setting) {
    return idList(setting).slice(0, QUICK_TAGS_MAX);
  }
  function toggledTags(tags, id) {
    var ids = (tags || []).map(function (x) {
      return String(x.id);
    });
    id = String(id);
    return ids.indexOf(id) >= 0 ? ids.filter(function (x) {
      return x !== id;
    }) : ids.concat([id]);
  }
  var TAGS_MUTATION = "mutation StashShortsTags($i: SceneUpdateInput!) { sceneUpdate(input: $i) { id tags { id name } } }";

  // ------------------------------------------------------------------ session summary
  // What a visit of the page did, shown when it is left by its back button: time, clips watched (entries
  // shown for SEEN_MS or longer, galleries apart), orgasms added (minus those taken back), performers
  // subscribed to. Nothing goes to Stash; the last SUMMARY_MAX are kept in the browser.
  var SEEN_MS = 3000, SUMMARY_STORE = PLUGIN_ID + ":sessions", SUMMARY_MAX = 10;
  function newSession(now) {
    return { start: now, seen: {}, galleries: {}, o: 0, subscribed: {} };
  }
  function sessionSummary(s, now) {
    var subs = Object.keys(s.subscribed).filter(function (id) {
      return s.subscribed[id];
    });
    return { at: now, seconds: Math.max(0, Math.round((now - s.start) / 1000)), clips: Object.keys(s.seen).length,
      galleries: Object.keys(s.galleries).length, o: Math.max(0, s.o), subscribed: subs.length };
  }
  // worth showing: something was watched or done
  function summaryWorth(sum) {
    return sum.clips + sum.galleries + sum.o + sum.subscribed > 0;
  }
  function addSummary(list, sum) {
    return [sum].concat(Array.isArray(list) ? list : []).slice(0, SUMMARY_MAX);
  }
  // 75 -> "1:15", 3725 -> "1:02:05" (as clock)
  function duration(seconds) {
    return clock(seconds);
  }

  // ------------------------------------------------------------------ modes (the bar at the bottom)
  // For you: the stored filters in the "For you" order. Subscribed: the performers subscribed to, newest
  // first by date, like a timeline. New: what has not been watched yet, newest first by date. Each is a
  // filter (so the address carries it, see filterParams); a filter that is none of them shows no mode.
  var MODES = ["forYou", "subscribed", "new"];
  function modeFilter(mode, settings) {
    var f = filtersFrom(settings, null);
    if (mode === "subscribed") return Object.assign(f, { order: "date", subscribedOnly: true, unseenOnly: false });
    if (mode === "new") return Object.assign(f, { order: "date", unseenOnly: true, subscribedOnly: false });
    return Object.assign(f, { order: "forYou", unseenOnly: false, subscribedOnly: false });
  }
  function modeOf(f) {
    if (!f) return null;
    if (f.subscribedOnly && !f.unseenOnly && f.order === "date") return "subscribed";
    if (f.unseenOnly && !f.subscribedOnly && f.order === "date") return "new";
    if (!f.unseenOnly && !f.subscribedOnly && f.order === "forYou") return "forYou";
    return null;
  }

  // ------------------------------------------------------------------ navbar patch
  // Arguments for the patch.before("MainNavBar.MenuItems") callback: the props with item appended to the
  // children, all other arguments unchanged (another plugin's after hook may need them). Whatever goes
  // wrong, the original arguments come back, so Stash's own menu items still render. toArray is
  // React.Children.toArray.
  function withNavChild(args, item, toArray) {
    args = Array.prototype.slice.call(args || []);
    try {
      var props = args[0];
      if (!props || typeof props !== "object") return args;
      var children = toArray(props.children).concat([item]);
      return [Object.assign({}, props, { children: children })].concat(args.slice(1));
    } catch (e) {
      return args;
    }
  }

  // ------------------------------------------------------------------ subscriptions
  // Subscribing to a performer is not Stash's favorite (one may follow someone here without making them a
  // favorite there). It is a custom field on the performer, written with "partial" so other custom fields
  // stay, and the same on every device.
  var SUBSCRIBED_FIELD = "shorts_subscribed";
  var SUBSCRIPTIONS_QUERY =
    "query StashShortsSubscriptions($f: PerformerFilterType) { findPerformers(performer_filter: $f, filter: {per_page: -1}) { performers { id } } }";
  var SUBSCRIPTIONS_FILTER = { custom_fields: [{ field: SUBSCRIBED_FIELD, modifier: "NOT_NULL" }] };
  var SUBSCRIBE_MUTATION =
    "mutation StashShortsSubscribe($i: PerformerUpdateInput!) { performerUpdate(input: $i) { id custom_fields } }";
  function subscribeInput(id, on) {
    var partial = {};
    partial[SUBSCRIBED_FIELD] = "1";
    return { id: String(id), custom_fields: on ? { partial: partial } : { remove: [SUBSCRIBED_FIELD] } };
  }
  // performerUpdate's custom_fields -> subscribed or not
  function isSubscribed(customFields) {
    var v = customFields ? customFields[SUBSCRIBED_FIELD] : null;
    return v != null && v !== "" && v !== false;
  }

  // the channel shows only the performer's portrait scenes; of the feed's filters only the order stays
  function channelFilter(base, performerId) {
    return { order: base.order, favoritesOnly: false, subscribedOnly: false, minRating: 0, unseenOnly: false, tags: "", studios: "", performers: String(performerId) };
  }

  // The performer a swipe into the channel picks from a scene's cast: favorites first, then the others in
  // the scene's order. In the channel of one of them, the next one after them (wrapping round); null when
  // there is nobody (else) to go to.
  function nextPerformer(performers, currentId) {
    var list = (performers || []).filter(function (p) {
      return p.favorite;
    }).concat((performers || []).filter(function (p) {
      return !p.favorite;
    }));
    var at = -1;
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(currentId)) at = i;
    if (at < 0) return list[0] || null;
    return list.length > 1 ? list[(at + 1) % list.length] : null;
  }

  // The contexts left behind, newest on top. A frame is whatever the view needs to come back to the same
  // place (scenes, index, ...) plus `ctx`.
  function ContextStack() {
    this.frames = [];
  }
  ContextStack.prototype.push = function (frame) {
    this.frames.push(frame);
  };
  ContextStack.prototype.pop = function () {
    return this.frames.pop() || null;
  };
  ContextStack.prototype.depth = function () {
    return this.frames.length;
  };
  ContextStack.prototype.clear = function () {
    this.frames = [];
  };
  // the frames to take off until the one for this context is on top (0 = it is on top), -1 = not there
  ContextStack.prototype.distance = function (key) {
    for (var i = this.frames.length - 1; i >= 0; i--) if (contextKey(this.frames[i].ctx) === key) return this.frames.length - 1 - i;
    return -1;
  };
  // takes frames off up to and including the one for this context and returns it (null: not there)
  ContextStack.prototype.popTo = function (key) {
    var d = this.distance(key);
    if (d < 0) return null;
    this.frames.length -= d;
    return this.frames.pop();
  };

  var Core = {
    PLUGIN_ID: PLUGIN_ID,
    ROUTE: ROUTE,
    ICONS: ICONS,
    ICON_BOX: ICON_BOX,
    clamp: clamp,
    localUrl: localUrl,
    idList: idList,
    I18n: I18n,
    ORDERS: ORDERS,
    SETTINGS: SETTINGS,
    SETTING: SETTING,
    settingValue: settingValue,
    readSettings: readSettings,
    settingsInput: settingsInput,
    PARAMS: PARAMS,
    FILTER_KEYS: FILTER_KEYS,
    filtersFrom: filtersFrom,
    filterParams: filterParams,
    hasExtraFilters: hasExtraFilters,
    formatFilter: formatFilter,
    sceneFilter: sceneFilter,
    REFS_QUERY: REFS_QUERY,
    countRefs: countRefs,
    SUGGEST_MAX: SUGGEST_MAX,
    suggestions: suggestions,
    STORIES_MAX: STORIES_MAX,
    RELATED_MAX: RELATED_MAX,
    related: related,
    storyPerformers: storyPerformers,
    findFilter: findFilter,
    SCENES_QUERY: SCENES_QUERY,
    normalizeScene: normalizeScene,
    transcodeUrl: transcodeUrl,
    nameKey: nameKey,
    studioRest: studioRest,
    studioText: studioText,
    sceneCaption: sceneCaption,
    POOL_SIZE: POOL_SIZE,
    wantedScenes: wantedScenes,
    assignSlots: assignSlots,
    fitMode: fitMode,
    needMore: needMore,
    endAction: endAction,
    IDLE_MS: IDLE_MS,
    orientationMode: orientationMode,
    swipeStep: swipeStep,
    WheelGate: WheelGate,
    keyStep: keyStep,
    DOUBLE_TAP_MS: DOUBLE_TAP_MS,
    DOUBLE_TAP_PX: DOUBLE_TAP_PX,
    DoubleTap: DoubleTap,
    AXIS_MIN: AXIS_MIN,
    SIDE_ANGLE: SIDE_ANGLE,
    dragAxis: dragAxis,
    sideStep: sideStep,
    sideKey: sideKey,
    ALL: ALL,
    contextKey: contextKey,
    contextFromQuery: contextFromQuery,
    sceneFromQuery: sceneFromQuery,
    withNavChild: withNavChild,
    profileFromQuery: profileFromQuery,
    handleOf: handleOf,
    linkGroups: linkGroups,
    PROFILE_QUERY: PROFILE_QUERY,
    GALLERIES_QUERY: GALLERIES_QUERY,
    IMAGES_QUERY: IMAGES_QUERY,
    profileSceneFilter: profileSceneFilter,
    profileGalleryFilter: profileGalleryFilter,
    profileFavoritesFilter: profileFavoritesFilter,
    profilePage: profilePage,
    normalizeGallery: normalizeGallery,
    takeByDate: takeByDate,
    QUICK_TAGS_MAX: QUICK_TAGS_MAX,
    quickTagIds: quickTagIds,
    toggledTags: toggledTags,
    TAGS_MUTATION: TAGS_MUTATION,
    SEEN_MS: SEEN_MS,
    SUMMARY_STORE: SUMMARY_STORE,
    SUMMARY_MAX: SUMMARY_MAX,
    newSession: newSession,
    sessionSummary: sessionSummary,
    summaryWorth: summaryWorth,
    addSummary: addSummary,
    duration: duration,
    MODES: MODES,
    modeFilter: modeFilter,
    modeOf: modeOf,
    galleryFilter: galleryFilter,
    galleryFromQuery: galleryFromQuery,
    GALLERY_IDS_QUERY: GALLERY_IDS_QUERY,
    GALLERIES_BY_IDS_QUERY: GALLERIES_BY_IDS_QUERY,
    GALLERY_IMAGES_QUERY: GALLERY_IMAGES_QUERY,
    RATE_GALLERY_MUTATION: RATE_GALLERY_MUTATION,
    IMAGE_O_MUTATION: IMAGE_O_MUTATION,
    IMAGE_UNDO_O_MUTATION: IMAGE_UNDO_O_MUTATION,
    GALLERY_EVERY: GALLERY_EVERY,
    mixGalleries: mixGalleries,
    galleryWindow: galleryWindow,
    captionPeople: captionPeople,
    shareUrl: shareUrl,
    SUBSCRIBED_FIELD: SUBSCRIBED_FIELD,
    SUBSCRIPTIONS_QUERY: SUBSCRIPTIONS_QUERY,
    SUBSCRIPTIONS_FILTER: SUBSCRIPTIONS_FILTER,
    SUBSCRIBE_MUTATION: SUBSCRIBE_MUTATION,
    subscribeInput: subscribeInput,
    isSubscribed: isSubscribed,
    channelFilter: channelFilter,
    nextPerformer: nextPerformer,
    ContextStack: ContextStack,
    seekTime: seekTime,
    ratingStars: ratingStars,
    ratingAfterClick: ratingAfterClick,
    PlayTracker: PlayTracker,
    FOR_YOU: FOR_YOU,
    POOL_QUERY: POOL_QUERY,
    TASTE_QUERY: TASTE_QUERY,
    BY_IDS_QUERY: BY_IDS_QUERY,
    RESUME_QUERY: RESUME_QUERY,
    seeded: seeded,
    IDS_QUERY: IDS_QUERY,
    plannedOrder: plannedOrder,
    MARKER_SECONDS: MARKER_SECONDS,
    MARKERS_QUERY: MARKERS_QUERY,
    markerItem: markerItem,
    clipRange: clipRange,
    clock: clock,
    jumpEntry: jumpEntry,
    DETAIL_QUERY: DETAIL_QUERY,
    clipProgress: clipProgress,
    clipSeek: clipSeek,
    clipOver: clipOver,
    mixMarkers: mixMarkers,
    RESUME_STORE: RESUME_STORE,
    RESUME_DAYS: RESUME_DAYS,
    RESUME_MAX: RESUME_MAX,
    resumeKey: resumeKey,
    rememberAt: rememberAt,
    resumeAt: resumeAt,
    liking: liking,
    taste: taste,
    forYouParts: forYouParts,
    forYouOrder: forYouOrder,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  else root.StashShortsCore = Core;
})(this);
