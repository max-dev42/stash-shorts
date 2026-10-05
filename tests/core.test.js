"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../plugin/stash-shorts-core.js");

const q = (s) => new URLSearchParams(s);
const defaults = () => C.readSettings({});

test("settings: defaults, invalid values and clamping", () => {
  assert.deepEqual(defaults(), {
    order: "forYou", favoritesOnly: false, subscribedOnly: false, minRating: 0, unseenOnly: false, tags: "", studios: "", performers: "",
    allowLandscape: false, disableMarkers: false, disableGalleries: false, autoAdvance: false, disableDoubleTap: false, disableWakeLock: false, disableSplash: false, disableRelated: false, disableSummary: false, splashOnSubscribe: false, quickActions: false, quickTags: "",
    disablePlayCount: false, playCountAfter: 5, galleryImageSeconds: 4,
  });
  const s = C.readSettings({ order: "sideways", favoritesOnly: "true", minRating: 9, playCountAfter: 0, tags: "3, x,3,5", disablePlayCount: "maybe" });
  assert.equal(s.order, "forYou");
  assert.equal(s.favoritesOnly, true);
  assert.equal(s.minRating, 5);
  assert.equal(s.playCountAfter, 5); // Stash shows an unset NUMBER as 0
  assert.equal(s.tags, "3,5");
  assert.equal(s.disablePlayCount, false);
  assert.equal(C.readSettings({ playCountAfter: 99 }).playCountAfter, 60);
});

test("settingsInput leaves out defaults and normalises values", () => {
  assert.deepEqual(C.settingsInput(defaults()), {});
  assert.deepEqual(C.settingsInput(Object.assign(defaults(), { order: "newest", tags: "5,,2", minRating: "3", disablePlayCount: true })), {
    order: "newest", tags: "5,2", minRating: 3, disablePlayCount: true,
  });
});

test("every setting is declared in the .yml with the same type", () => {
  const yml = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "plugin", "stash-shorts.yml"), "utf8");
  const declared = {};
  let key = null;
  for (const line of yml.split("\n")) {
    const k = line.match(/^  (\w+):\s*$/);
    if (k) key = k[1];
    const t = line.match(/^    type: (\w+)/);
    if (t && key) declared[key] = t[1];
  }
  for (const d of C.SETTINGS) assert.equal(declared[d.key], d.type === "IDS" ? "STRING" : d.type, d.key);
  assert.deepEqual(Object.keys(declared).sort(), C.SETTINGS.map((d) => d.key).sort());
});

test("URL parameters override the stored filter", () => {
  const s = C.readSettings({ order: "newest", tags: "3", favoritesOnly: true });
  assert.deepEqual(C.filtersFrom(s, q("")), { order: "newest", favoritesOnly: true, subscribedOnly: false, minRating: 0, unseenOnly: false, tags: "3", studios: "", performers: "" });
  const f = C.filtersFrom(s, q("tag=7,8&studio=2&performers=x&fav=0&rating=4&order=mostViewed"));
  assert.deepEqual(f, { order: "mostViewed", favoritesOnly: false, subscribedOnly: false, minRating: 4, unseenOnly: false, tags: "7,8", studios: "2", performers: "", });
  // empty parameter clears a stored id list; an unknown boolean value keeps the stored one
  assert.equal(C.filtersFrom(s, q("tag=")).tags, "");
  assert.equal(C.filtersFrom(s, q("fav=perhaps")).favoritesOnly, true);
  assert.equal(C.filtersFrom(s, q("order=bogus")).order, "forYou");
  assert.deepEqual(C.filtersFrom(s, null), C.filtersFrom(s, q("")));
});

test("filterParams writes only what differs from the defaults and reads back the same filter", () => {
  const s = C.readSettings({ tags: "3" });
  assert.equal(C.filterParams(C.filtersFrom(s, q("")), s), "");
  const f = Object.assign(C.filtersFrom(s, q("")), { tags: "4,5", favoritesOnly: true, order: "newest" });
  const p = C.filterParams(f, s);
  assert.equal(p, "order=newest&fav=1&tag=4,5");
  assert.deepEqual(C.filtersFrom(s, q(p)), f);
  assert.equal(C.filterParams(Object.assign({}, f, { tags: "" }), s).includes("tag=&"), false);
  assert.ok(C.filterParams(Object.assign({}, C.filtersFrom(s, q("")), { tags: "" }), s).includes("tag="));
});

test("sceneFilter: portrait only by default, whatever the URL asks, plus the extra criteria", () => {
  assert.deepEqual(C.sceneFilter(C.filtersFrom(defaults(), null)), { orientation: { value: ["PORTRAIT"] } });
  // only the setting "allowLandscape" (off by default) brings landscape scenes in, no URL parameter
  assert.deepEqual(C.SETTINGS.filter((d) => /landscape|orientation/i.test(d.key)).map((d) => [d.key, d.def, !!d.filter]), [["allowLandscape", false, false]]);
  assert.equal(C.FILTER_KEYS.some((k) => /landscape|orientation/i.test(k + C.PARAMS[k])), false);
  const stored = C.readSettings({ includeLandscape: true, orientation: "LANDSCAPE" });
  assert.deepEqual(C.sceneFilter(C.filtersFrom(stored, q("landscape=1&orientation=LANDSCAPE"))).orientation, { value: ["PORTRAIT"] });
  const f = C.filtersFrom(defaults(), q("tag=1,2&studio=3&performers=4&fav=1&rating=3"));
  assert.deepEqual(C.sceneFilter(f), {
    orientation: { value: ["PORTRAIT"] },
    tags: { value: ["1", "2"], modifier: "INCLUDES", depth: 0 },
    studios: { value: ["3"], modifier: "INCLUDES", depth: 0 },
    performers: { value: ["4"], modifier: "INCLUDES" },
    performer_favorite: true,
    rating100: { value: 59, modifier: "GREATER_THAN" }, // 3 stars = 60 and more
  });
  assert.equal(C.hasExtraFilters(C.filtersFrom(defaults(), null)), false);
  assert.equal(C.hasExtraFilters(f), true);
});

test("findFilter: order and stable random seed", () => {
  const f = C.filtersFrom(defaults(), null);
  assert.deepEqual(C.findFilter(f, 2, 20, 1234), { page: 2, per_page: 20, sort: "random_1234" });
  assert.deepEqual(C.findFilter(Object.assign({}, f, { order: "newest" }), 1, 20, 1), { page: 1, per_page: 20, sort: "created_at", direction: "DESC" });
  assert.deepEqual(C.findFilter(Object.assign({}, f, { order: "mostViewed" }), 1, 20, 1), { page: 1, per_page: 20, sort: "play_count", direction: "DESC" });
  assert.match(C.SCENES_QUERY, /findScenes\(filter: \$f, scene_filter: \$s\)/);
});

test("normalizeScene keeps local URLs only", () => {
  const sc = C.normalizeScene({
    id: 7, title: "", date: null, rating100: 60, o_counter: 2, play_count: null,
    paths: { stream: "http://stash.example:9999/scene/7/stream?apikey=k", screenshot: "http://other.host/scene/7/screenshot?t=1" },
    files: [{ path: "/data/a/clip.mp4", width: 1920, height: 1080, duration: 12.5 }],
    studio: { id: 3, name: "S" },
    performers: [{ id: 1, name: "P", favorite: true, image_path: "http://h/performer/1/image?t=2" }],
  });
  assert.equal(sc.stream, "scene/7/stream?apikey=k");
  assert.equal(sc.screenshot, "scene/7/screenshot?t=1");
  assert.equal(sc.title, "clip.mp4");
  assert.equal(sc.duration, 12.5);
  assert.deepEqual(sc.studio, { id: "3", name: "S", parent: null });
  assert.deepEqual(sc.performers, [{ id: "1", name: "P", favorite: true, image: "performer/1/image?t=2" }]);
  assert.deepEqual([sc.details, sc.tags, sc.markerCount, sc.preview], ["", [], 0, null]);
  const more = C.normalizeScene({ id: 8, details: "Text", files: [], performers: [], tags: [{ id: 4, name: "Night" }], scene_markers: [{ id: 1 }, { id: 2 }],
    paths: { webp: "http://h:9999/scene/8/webp" } });
  assert.deepEqual([more.details, more.tags, more.markerCount, more.preview], ["Text", [{ id: "4", name: "Night" }], 2, "scene/8/webp"]);
  const bare = C.normalizeScene({ id: "9", files: [], performers: [] });
  assert.equal(bare.stream, "scene/9/stream");
  assert.equal(bare.title, "#9");
  assert.equal(C.transcodeUrl(bare), "scene/9/stream.mp4");
});

test("format: portrait only by default, all formats with the setting, never from the URL", () => {
  const f = C.filtersFrom(defaults(), q("landscape=1&tag=3"));
  assert.deepEqual(C.sceneFilter(f).orientation, { value: ["PORTRAIT"] });
  assert.deepEqual(C.sceneFilter(f, false).orientation, { value: ["PORTRAIT"] });
  assert.deepEqual(C.sceneFilter(f, true).orientation, { value: ["PORTRAIT", "LANDSCAPE", "SQUARE"] });
  assert.deepEqual(C.sceneFilter(f, true).tags, { value: ["3"], modifier: "INCLUDES", depth: 0 });
  assert.equal(C.readSettings({ allowLandscape: "true" }).allowLandscape, true);
  assert.deepEqual(C.settingsInput(Object.assign(defaults(), { allowLandscape: true })), { allowLandscape: true });
  assert.equal(C.filterParams(f, defaults()).indexOf("landscape"), -1);
});

test("countRefs counts scenes per tag, studio and performer from one list", () => {
  const n = C.countRefs([
    { studio: { id: 4 }, tags: [{ id: 1 }, { id: 2 }], performers: [{ id: 7 }] },
    { studio: { id: 4 }, tags: [{ id: 1 }, { id: 1 }], performers: [{ id: 7 }, { id: 8 }] }, // a repeated id counts once
    { studio: null, tags: [], performers: [] },
  ]);
  assert.deepEqual(n, { tags: { 1: 2, 2: 1 }, studios: { 4: 2 }, performers: { 7: 2, 8: 1 } });
  assert.deepEqual(C.countRefs(null), { tags: {}, studios: {}, performers: {} });
});

test("suggestions: only entries with scenes, start of the name first, then by count", () => {
  const items = [
    { id: "1", name: "Fansly" }, { id: "2", name: "OnlyFans" }, { id: "3", name: "Fantasy Studio" },
    { id: "4", name: "Landscape Only" }, { id: "5", name: "Lumi7ra (Fansly)" },
  ];
  const counts = { 1: 19, 2: 30, 3: 2, 5: 4 }; // 4 has no scene in the format
  const names = (r) => r.map((x) => x.item.name + " · " + x.count);
  assert.deepEqual(names(C.suggestions(items, counts, "")), ["OnlyFans · 30", "Fansly · 19", "Lumi7ra (Fansly) · 4", "Fantasy Studio · 2"]);
  assert.deepEqual(names(C.suggestions(items, counts, "fan")), ["Fansly · 19", "Fantasy Studio · 2", "OnlyFans · 30", "Lumi7ra (Fansly) · 4"]);
  assert.deepEqual(names(C.suggestions(items, counts, "only")), ["OnlyFans · 30"]); // not the one without scenes
  assert.deepEqual(names(C.suggestions(items, counts, "fan", ["1", 2])), ["Fantasy Studio · 2", "Lumi7ra (Fansly) · 4"]);
  assert.equal(C.suggestions(items, counts, "", [], 2).length, 2);
  assert.equal(C.suggestions(items, counts, "zzz").length, 0);
  assert.equal(C.SUGGEST_MAX, 8);
});

// scene as normalizeScene returns it, for the caption tests
const scene = (title, performers, studio, parent) => ({
  title: title || "clip.mp4", titled: !!title,
  performers: performers.map((name, i) => ({ id: String(i + 1), name })),
  studio: studio ? { id: "9", name: studio, parent: parent ? { id: "8", name: parent } : null } : null,
});
const line = (cap) => [cap.performers.map((p) => p.name).join(", "), cap.studio && cap.studio.text].filter(Boolean).join(" · ");

test("caption: a studio named after the performer shows its parent studio", () => {
  const sc = scene("Morning walk", ["Limon1kaaa"], "Limon1kaaa (Fansly)", "Fansly");
  assert.equal(line(C.sceneCaption(sc, null)), "Limon1kaaa · Fansly");
  assert.equal(line(C.sceneCaption(sc, "1")), "Fansly");
  assert.deepEqual(C.sceneCaption(sc, null).studio, { id: "9", text: "Fansly" }); // the link leads to the account
  // the parent's name wins over the rest of the name, whatever the naming
  assert.equal(line(C.sceneCaption(scene("x", ["Limon1kaaa"], "Limon1kaaa @ FY", "Fansly"), null)), "Limon1kaaa · Fansly");
  assert.equal(line(C.sceneCaption(scene("x", ["Limon1kaaa"], "Limon1kaaa", "Fansly"), null)), "Limon1kaaa · Fansly");
  // a studio without the performer keeps its own name, parent or not
  assert.equal(line(C.sceneCaption(scene("x", ["Anna"], "Brazzers Exxtra", "Brazzers"), null)), "Anna · Brazzers Exxtra");
});

test("caption: without a parent studio the rest of the name, else the full name", () => {
  assert.equal(line(C.sceneCaption(scene("x", ["Limon1kaaa"], "Limon1kaaa (Fansly)"), null)), "Limon1kaaa · Fansly");
  assert.equal(line(C.sceneCaption(scene("x", ["Limon1kaaa"], "Limon1kaaa Fansly"), null)), "Limon1kaaa · Fansly");
  assert.equal(line(C.sceneCaption(scene("x", ["Limon1kaaa"], "Limon1kaaa ()"), null)), "Limon1kaaa"); // only the name: once
  assert.equal(C.studioText({ name: "Limon1kaaa (-)" }, [{ name: "Limon1kaaa" }]), null); // punctuation does not count
  assert.equal(C.studioText({ name: "Brazzers" }, [{ name: "Limon1kaaa" }]), "Brazzers");
  assert.equal(C.studioText({ name: "Brazzers", parent: null }, []), "Brazzers");
});

test("caption: FansDB studio named after the performer is shortened to the platform", () => {
  const sc = scene("Morning walk", ["Limon1kaaa"], "Limon1kaaa (Fansly)");
  const out = C.sceneCaption(sc, null);
  assert.equal(out.title, "Morning walk");
  assert.equal(line(out), "Limon1kaaa · Fansly");
  assert.deepEqual(out.studio, { id: "9", text: "Fansly" }); // the link still leads to the studio
  assert.equal(line(C.sceneCaption(sc, "1")), "Fansly"); // in her channel her name is at the top
  assert.equal(C.studioRest("Fansly - limon1kaaa", "Limon1kaaa"), "Fansly");
  assert.equal(C.studioRest("[OnlyFans] Limon1kaaa", "Limon1kaaa"), "OnlyFans");
});

test("caption: studio equal to the performer is shown once", () => {
  const sc = scene("Morning walk", ["Limon1kaaa"], "limon1kaaa");
  assert.equal(line(C.sceneCaption(sc, null)), "Limon1kaaa");
  assert.equal(C.sceneCaption(sc, null).studio, null);
  assert.equal(line(C.sceneCaption(sc, "1")), ""); // only the name at the top
  assert.equal(C.studioRest("Limon1kaaa !", "Limon1kaaa"), ""); // nothing but punctuation left
});

test("caption: studio without the performer's name stays whole", () => {
  const sc = scene("Scene 4", ["Anna"], "Annabelle Studios");
  assert.equal(line(C.sceneCaption(sc, null)), "Anna · Annabelle Studios"); // a part of a word does not count
  assert.equal(line(C.sceneCaption(sc, "1")), "Annabelle Studios");
  assert.equal(line(C.sceneCaption(scene("Scene 4", [], "Brazzers"), null)), "Brazzers");
});

test("caption: several performers, the channel's own is left out and the others stay", () => {
  const sc = scene("Collab", ["Limon1kaaa", "Mia Vale", "Jo"], "Mia Vale (OnlyFans)");
  assert.equal(line(C.sceneCaption(sc, null)), "Limon1kaaa, Mia Vale, Jo · OnlyFans");
  assert.equal(line(C.sceneCaption(sc, "1")), "Mia Vale, Jo · OnlyFans");
  assert.equal(line(C.sceneCaption(sc, "2")), "Limon1kaaa, Jo · OnlyFans");
  assert.equal(line(C.sceneCaption(sc, "77")), "Limon1kaaa, Mia Vale, Jo · OnlyFans"); // channel not in the scene
});

test("caption: a title that is only the performer's or the account's name is left out", () => {
  const p = ["Limon1kaaa"], st = "Limon1kaaa (Fansly)";
  assert.equal(C.sceneCaption(scene("Limon1kaaa", p, st), null).title, null);
  assert.equal(C.sceneCaption(scene("limon1KAAA ", p, st), "1").title, null);
  assert.equal(C.sceneCaption(scene("Limon1kaaa (Fansly)", p, st), null).title, null);
  assert.equal(C.sceneCaption(scene("Zoë", ["Zoe"], null), null).title, null); // accents do not count
  assert.equal(C.sceneCaption(scene("Limon1kaaa at the beach", p, st), null).title, "Limon1kaaa at the beach");
});

test("caption: the file name only when nothing else would be shown", () => {
  assert.equal(C.sceneCaption(scene("", ["Jo"], null), null).title, null);
  assert.equal(C.sceneCaption(scene("", [], null), null).title, "clip.mp4");
  assert.equal(C.sceneCaption(scene("", ["Jo"], "Jo"), "1").title, "clip.mp4");
  const n = C.normalizeScene({ id: 3, title: "", files: [{ path: "/x/clip.mp4" }], performers: [] });
  assert.equal(n.titled, false);
  assert.equal(C.normalizeScene({ id: 3, title: "T", files: [], performers: [] }).titled, true);
});

// pool scenes as POOL_QUERY returns them
const pooled = (id, o) => Object.assign({ id: String(id), rating100: null, o_counter: 0, play_count: 0, performers: [], tags: [] }, o);
const withoutRandom = (fn) => {
  const r = C.FOR_YOU.random;
  C.FOR_YOU.random = 0;
  try { return fn(); } finally { C.FOR_YOU.random = r; }
};

test("for you: deterministic for a seed, different for another", () => {
  const pool = Array.from({ length: 40 }, (_, i) => pooled(i + 1, { performers: [{ id: String(i % 7) }], play_count: i % 3 }));
  const t = C.taste(pool);
  const ids = (seed) => C.forYouOrder(pool, t, seed).map((e) => e.id);
  assert.deepEqual(ids(42), ids(42));
  assert.notDeepEqual(ids(42), ids(43));
  assert.equal(new Set(ids(42)).size, 40);
  assert.deepEqual(C.seeded(7)(), C.seeded(7)());
});

test("for you: rating, orgasms, favorites and taste raise a scene, plays lower it", () => withoutRandom(() => {
  const pool = [
    pooled(1, { play_count: 4 }), // seen, nothing else
    pooled(2), // never played
    pooled(3, { rating100: 100, play_count: 4 }), // 5 stars
    pooled(4, { o_counter: 3, play_count: 4 }), // 3 orgasms
    pooled(5, { play_count: 4, performers: [{ id: "9", favorite: true }] }), // a favorite
  ];
  const order = C.forYouOrder(pool, C.taste([]), 1).map((e) => e.id);
  assert.equal(order[0], "3"); // 5 stars: 1.2 - 0.24
  assert.equal(order[1], "2"); // never played: 0.7, more than a favorite or orgasms seen 4 times (0.8 - 0.24)
  assert.deepEqual(order.slice(2, 4).sort(), ["4", "5"]);
  assert.equal(order[4], "1");
  const parts = C.forYouOrder(pool, C.taste([]), 1).find((e) => e.id === "1").parts;
  assert.equal(parts.fresh, 0);
  assert.ok(Math.abs(parts.seen + C.FOR_YOU.seen * 0.4) < 1e-9);
}));

test("for you: taste from the library, pulled to the average for few scenes", () => {
  const lib = [
    pooled(1, { rating100: 100, o_counter: 3, performers: [{ id: "a" }], tags: [{ id: "x" }] }),
    pooled(2, { rating100: 100, o_counter: 2, performers: [{ id: "a" }], tags: [{ id: "x" }] }),
    pooled(3, { rating100: 100, o_counter: 3, performers: [{ id: "b" }] }), // one good scene only
    pooled(4, { performers: [{ id: "c" }], tags: [{ id: "y" }] }),
    pooled(5, { performers: [{ id: "c" }], tags: [{ id: "y" }] }),
  ];
  const t = C.taste(lib);
  assert.equal(t.performers.a, 1);
  assert.ok(t.performers.b < t.performers.a && t.performers.b > t.performers.c);
  assert.ok(t.tags.x > t.tags.y);
  // an unrated scene of the liked performer comes before one of the other
  const order = withoutRandom(() => C.forYouOrder([pooled(10, { performers: [{ id: "c" }] }), pooled(11, { performers: [{ id: "a" }] })], t, 1));
  assert.deepEqual(order.map((e) => e.id), ["11", "10"]);
  assert.deepEqual(C.taste(null), { performers: {}, tags: {} });
});

test("for you: the same performer not twice in a row while others are left", () => withoutRandom(() => {
  const p = (id) => [{ id }];
  const pool = [
    pooled(1, { rating100: 100, performers: p("a") }), pooled(2, { rating100: 90, performers: p("a") }),
    pooled(3, { rating100: 80, performers: p("a") }), pooled(4, { rating100: 20, performers: p("b") }),
    pooled(5, { rating100: 10, performers: [{ id: "b" }, { id: "c" }] }),
  ];
  const order = C.forYouOrder(pool, C.taste([]), 1).map((e) => e.id);
  assert.deepEqual(order, ["1", "4", "2", "5", "3"]);
  // only one performer left: then it has to repeat
  assert.deepEqual(C.forYouOrder(pool.slice(0, 3), C.taste([]), 1).map((e) => e.id), ["1", "2", "3"]);
}));

test("double tap: a second tap close in time and place, a third starts anew", () => {
  const d = new C.DoubleTap();
  assert.equal(d.tap(0, 100, 100), "first");
  assert.equal(d.tap(C.DOUBLE_TAP_MS, 120, 90), "double");
  assert.equal(d.tap(C.DOUBLE_TAP_MS + 50, 120, 90), "first"); // the third tap
  assert.equal(d.tap(1000, 100, 100), "first");
  assert.equal(d.tap(1000 + C.DOUBLE_TAP_MS + 1, 100, 100), "first"); // too late
  assert.equal(d.tap(2000, 100, 100), "first");
  assert.equal(d.tap(2100, 100 + C.DOUBLE_TAP_PX + 1, 100), "first"); // too far away
  d.reset();
  assert.equal(d.tap(2150, 100, 100), "first");
  assert.equal(C.SETTING.disableDoubleTap.invert, true); // on by default, stored as its negative
});

test("stories: only performers with scenes in the format, favorites first, then by count", () => {
  const ps = [
    { id: "1", name: "Ann", favorite: false }, { id: "2", name: "Bea", favorite: true }, { id: "3", name: "Cid", favorite: false },
    { id: "4", name: "Dee", favorite: true }, { id: "5", name: "Eve", favorite: false }, { id: "6", name: "Abe", favorite: false },
  ];
  const counts = { 1: 5, 2: 1, 3: 9, 5: 5, 6: 5 }; // 4 is a favorite without scenes in the format
  assert.deepEqual(C.storyPerformers(ps, counts).map((p) => p.name), ["Bea", "Cid", "Abe", "Ann", "Eve"]);
  assert.deepEqual(C.storyPerformers(ps, counts, 2).map((p) => p.name), ["Bea", "Cid"]);
  assert.deepEqual(C.storyPerformers(ps, {}), []);
  assert.deepEqual(C.storyPerformers(null, counts), []);
});

test("turning the phone: fill only sideways with a wide scene, the button only upright", () => {
  const m = (touch, sideways, wide) => C.orientationMode(touch, sideways, wide);
  assert.deepEqual(m(true, true, true), { fill: true, rotate: false }); // phone sideways, landscape clip
  assert.deepEqual(m(true, true, false), { fill: false, rotate: false }); // phone sideways, portrait clip: column
  assert.deepEqual(m(true, false, true), { fill: false, rotate: true }); // phone upright, landscape clip
  assert.deepEqual(m(true, false, false), { fill: false, rotate: false });
  assert.deepEqual(m(false, true, true), { fill: false, rotate: false }); // desktop window: nothing changes
  assert.ok(C.IDLE_MS >= 2000 && C.IDLE_MS <= 3000);
});

test("unseen only: a filter and URL parameter, Stash's play count 0, pages by id", () => {
  const f = C.filtersFrom(defaults(), q("unseen=1&order=newest"));
  assert.equal(f.unseenOnly, true);
  assert.deepEqual(C.sceneFilter(f).play_count, { value: 0, modifier: "EQUALS" });
  assert.equal(C.hasExtraFilters(f), true);
  assert.equal(C.filterParams(f, defaults()), "order=newest&unseen=1");
  assert.equal(C.plannedOrder(f), true); // played scenes drop out: no pages by offset
  assert.equal(C.plannedOrder(C.filtersFrom(defaults(), q("order=newest"))), false);
  assert.equal(C.plannedOrder(C.filtersFrom(defaults(), null)), true); // "For you"
  assert.equal(C.channelFilter(f, "7").unseenOnly, false); // a channel keeps only the order
});

test("continue: the last scene per context, for some days, the oldest contexts dropped", () => {
  const all = C.resumeKey(C.ALL, C.filtersFrom(defaults(), null));
  const tagged = C.resumeKey(C.ALL, C.filtersFrom(defaults(), q("tag=3")));
  const chan = C.resumeKey({ kind: "performer", id: "7" }, C.channelFilter(C.filtersFrom(defaults(), null), "7"));
  assert.notEqual(all, tagged);
  assert.notEqual(all, chan);
  const day = 864e5, t0 = 1e12;
  let m = C.rememberAt({}, all, 12, t0);
  m = C.rememberAt(m, chan, "40", t0 + 1);
  assert.equal(C.resumeAt(m, all, t0 + day), "12");
  assert.equal(C.resumeAt(m, chan, t0 + day), "40");
  assert.equal(C.resumeAt(m, tagged, t0), null);
  assert.equal(C.resumeAt(m, all, t0 + C.RESUME_DAYS * day), null); // too old
  m = C.rememberAt(m, all, 13, t0 + 2);
  assert.equal(C.resumeAt(m, all, t0 + 3), "13");
  for (let i = 0; i < C.RESUME_MAX + 5; i++) m = C.rememberAt(m, "k" + i, i, t0 + 10 + i);
  assert.equal(Object.keys(m).length, C.RESUME_MAX);
  assert.equal(C.resumeAt(m, all, t0 + 100), null); // the oldest went first
  assert.equal(C.resumeAt(null, all, t0), null);
  assert.deepEqual(Object.keys(C.rememberAt({ bad: null, old: { id: "1", at: 0 } }, "x", 1, t0)), ["x"]);
});

test("end of a clip: loop by default, the next one with the setting, the last one from the start", () => {
  assert.equal(C.endAction(false, 0, 10), "loop");
  assert.equal(C.endAction(true, 0, 10), "next");
  assert.equal(C.endAction(true, 9, 10), "replay");
  assert.equal(C.endAction(true, 0, 1), "replay");
  assert.equal(C.SETTING.autoAdvance.def, false);
});

test("markers: an entry of their own from the marker's time, up to its end or 30 s", () => {
  const sc = C.normalizeScene({ id: 9, title: "Scene", files: [{ duration: 100, width: 1080, height: 1920 }], paths: { stream: "/scene/9/stream" },
    performers: [{ id: 1, name: "P" }], studio: { id: 2, name: "S" } });
  const m = C.markerItem(sc, { id: 5, title: "Kiss", seconds: 12, end_seconds: 20, primary_tag: { id: 3, name: "Kissing" }, scene: { id: 9 } });
  assert.equal(m.id, "m5");
  assert.equal(m.sceneId, "9"); // ratings, orgasms, plays and the scene link go to the scene
  assert.equal(m.title, "Kiss");
  assert.equal(m.stream, "scene/9/stream#t=12");
  assert.deepEqual(m.marker, { id: "5", start: 12, end: 20, tag: "Kissing" });
  assert.equal(m.duration, 8);
  assert.equal(m.performers, sc.performers); // the same performer objects (favorites stay in step)
  const open = C.markerItem(sc, { id: 6, title: "", seconds: 85, end_seconds: null, primary_tag: { name: "Dance" } });
  assert.equal(open.title, "Dance"); // no title: the primary tag
  assert.deepEqual([open.marker.start, open.marker.end], [85, 100]); // 30 s, but not past the end of the file
  assert.equal(C.markerItem(sc, { id: 7, seconds: 10, end_seconds: 5 }).marker.end, 10 + C.MARKER_SECONDS); // an end before the start
  assert.equal(C.transcodeUrl(m), "scene/9/stream.mp4");
  assert.equal(sc.sceneId, "9");
});

test("markers: range, progress, seeking and the end", () => {
  const m = { marker: { start: 10, end: 20 } }, sc = { duration: 60 };
  assert.deepEqual(C.clipRange(m, 60), { start: 10, end: 20 });
  assert.deepEqual(C.clipRange(sc, 0), { start: 0, end: 60 });
  assert.equal(C.clipProgress(m, 15, 60), 0.5);
  assert.equal(C.clipProgress(m, 5, 60), 0);
  assert.equal(C.clipProgress(sc, 30, 60), 0.5);
  assert.equal(C.clipSeek(m, 50, 100, 60), 15);
  assert.equal(C.clipOver(m, 19.9), false);
  assert.equal(C.clipOver(m, 19.96), true);
  assert.equal(C.clipOver(sc, 59.99), false); // a scene ends by itself
});

test("markers in the order: after their scene, or at seeded places for random", () => {
  const ids = [{ id: "1" }, { id: "2" }, { id: "3" }];
  const ms = [{ id: "m7", sceneId: "2" }, { id: "m8", sceneId: "1" }, { id: "m9", sceneId: "5" }];
  const newest = C.mixMarkers(ids, ms, "newest", 1).map((e) => e.id);
  assert.deepEqual(newest.filter((x) => x !== "m9"), ["1", "m8", "2", "m7", "3"]);
  assert.equal(newest.length, 6); // m9 (scene not in the list) at a seeded place
  const r = C.mixMarkers(ids, ms, "random", 4).map((e) => e.id);
  assert.deepEqual(r, C.mixMarkers(ids, ms, "random", 4).map((e) => e.id));
  assert.deepEqual(r.filter((x) => x[0] !== "m"), ["1", "2", "3"]);
  assert.equal(r.length, 6);
  assert.deepEqual(C.mixMarkers(ids, [], "random", 4), ids);
  // "For you": a marker is scored like its scene and kept away from it
  const pool = [pooled(1, { performers: [{ id: "a" }] }), pooled(2, { performers: [{ id: "b" }] }), pooled(3, { performers: [{ id: "c" }] })];
  const fy = C.forYouOrder(pool, C.taste([]), 3, [{ id: "m7", sceneId: "2" }, { id: "m9", sceneId: "99" }]);
  assert.deepEqual(fy.map((e) => e.id).sort(), ["1", "2", "3", "m7"]);
  assert.equal(fy.find((e) => e.id === "m7").sceneId, "2");
  // next to its scene only when nothing else is left (the end of the list)
  const big = Array.from({ length: 8 }, (_, i) => pooled(i + 1, { performers: [{ id: "p" + i }] }));
  for (let seed = 1; seed <= 20; seed++) {
    const at = C.forYouOrder(big, C.taste([]), seed, [{ id: "m7", sceneId: "2" }]).map((e) => e.id);
    const i = at.indexOf("m7"), j = at.indexOf("2");
    if (Math.abs(i - j) === 1) assert.equal(Math.max(i, j), at.length - 1, "seed " + seed);
  }
  assert.equal(C.plannedOrder(C.filtersFrom(defaults(), q("order=newest")), true), true); // markers: pages by id
});

test("window: previous, current and next scene, never more than the pool", () => {
  assert.deepEqual(C.wantedScenes(0, 10), [0, 1]);
  assert.deepEqual(C.wantedScenes(4, 10), [4, 5, 3]);
  assert.deepEqual(C.wantedScenes(9, 10), [9, 8]);
  assert.deepEqual(C.wantedScenes(0, 1), [0]);
  assert.deepEqual(C.wantedScenes(0, 0), []);
  assert.equal(C.POOL_SIZE, 3);
});

test("assignSlots keeps loaded videos and reuses the freed one", () => {
  let slots = [null, null, null];
  slots = C.assignSlots(slots, C.wantedScenes(0, 50));
  assert.deepEqual(slots, [0, 1, null]);
  slots = C.assignSlots(slots, C.wantedScenes(1, 50));
  assert.deepEqual(slots, [0, 1, 2]); // 0 stays as the previous scene
  slots = C.assignSlots(slots, C.wantedScenes(2, 50));
  assert.deepEqual(slots, [3, 1, 2]); // 0 freed, its element now holds 3
  slots = C.assignSlots(slots, C.wantedScenes(1, 50));
  assert.deepEqual(slots, [0, 1, 2]);
  // a long walk: at most 3 scenes with a slot, always the wanted ones
  for (let i = 0; i < 40; i++) {
    const idx = (i * 7) % 50;
    slots = C.assignSlots(slots, C.wantedScenes(idx, 50));
    assert.deepEqual(slots.filter((s) => s != null).sort((a, b) => a - b), C.wantedScenes(idx, 50).sort((a, b) => a - b));
  }
});

test("needMore asks for the next page close to the end", () => {
  assert.equal(C.needMore(10, 20, 100), false);
  assert.equal(C.needMore(15, 20, 100), true);
  assert.equal(C.needMore(19, 20, 20), false);
});

test("fitMode: cover for close shapes, contain otherwise", () => {
  assert.equal(C.fitMode(1080, 1920, 390, 844), "cover"); // 9:16 on a 9:19.5 phone
  assert.equal(C.fitMode(1080, 1920, 506, 900), "cover");
  assert.equal(C.fitMode(1920, 1080, 390, 844), "contain");
  assert.equal(C.fitMode(1080, 1080, 390, 844), "contain");
  assert.equal(C.fitMode(720, 960, 390, 844), "contain"); // 3:4 would lose too much
  assert.equal(C.fitMode(0, 0, 390, 844), "contain");
});

test("swipeStep: distance or flick, direction", () => {
  assert.equal(C.swipeStep(-300, 400, 844), 1);
  assert.equal(C.swipeStep(300, 400, 844), -1);
  assert.equal(C.swipeStep(-100, 600, 844), 0); // slow and short: snap back
  assert.equal(C.swipeStep(-60, 100, 844), 1); // quick flick
  assert.equal(C.swipeStep(-20, 10, 844), 0); // too short to be a flick
  assert.equal(C.swipeStep(-50, 0, 844), 0);
});

test("WheelGate: one step per gesture, also with touchpad inertia", () => {
  const g = new C.WheelGate(40, 220);
  assert.equal(g.push(30, 0), 0);
  assert.equal(g.push(30, 16), 1);
  // inertia keeps sending events: no further step
  let t = 16, steps = 0;
  for (let i = 0; i < 60; i++) steps += Math.abs(g.push(20, (t += 16)));
  assert.equal(steps, 0);
  // after a quiet pause the next gesture counts again, upwards this time
  assert.equal(g.push(-100, t + 300), -1);
  // a mouse wheel notch (100 px) is one step each, when notches are apart
  const m = new C.WheelGate();
  assert.equal(m.push(100, 0), 1);
  assert.equal(m.push(100, 500), 1);
});

test("keyStep", () => {
  assert.equal(C.keyStep("ArrowDown"), 1);
  assert.equal(C.keyStep("ArrowUp"), -1);
  assert.equal(C.keyStep("PageDown"), 1);
  assert.equal(C.keyStep("x"), 0);
});

// a drag of `len` px at `deg` degrees from the horizontal, to the left (dir -1) or right (dir 1), upwards
const at = (len, deg, dir) => [dir * len * Math.cos((deg * Math.PI) / 180), -len * Math.sin((deg * Math.PI) / 180)];

test("dragAxis: decided after the first pixels by the angle, oblique drags are vertical", () => {
  assert.equal(C.dragAxis(4, 5), null); // too short to tell
  assert.equal(C.dragAxis(...at(12, 0, -1)), "x");
  assert.equal(C.dragAxis(...at(12, 20, 1)), "x");
  assert.equal(C.dragAxis(...at(12, C.SIDE_ANGLE, -1)), "x");
  assert.equal(C.dragAxis(...at(12, 30, -1)), "y"); // 30 degrees: no context change
  assert.equal(C.dragAxis(...at(12, 45, 1)), "y");
  assert.equal(C.dragAxis(0, -12), "y");
  assert.ok(C.SIDE_ANGLE < 30);
});

test("sideStep: left = into the channel, right = back, oblique or short = nothing", () => {
  assert.equal(C.sideStep(...at(200, 0, -1), 300, 390), 1);
  assert.equal(C.sideStep(...at(200, 10, 1), 300, 390), -1);
  assert.equal(C.sideStep(...at(200, 30, -1), 300, 390), 0); // started flat, ended oblique
  assert.equal(C.sideStep(...at(200, 60, -1), 100, 390), 0);
  assert.equal(C.sideStep(-50, 0, 600, 390), 0); // slow and short: snap back
  assert.equal(C.sideStep(-60, 5, 100, 390), 1); // quick flick
  assert.equal(C.sideStep(-20, 0, 10, 390), 0);
});

test("sideKey", () => {
  assert.equal(C.sideKey("ArrowRight"), 1);
  assert.equal(C.sideKey("ArrowLeft"), -1);
  assert.equal(C.sideKey("ArrowDown"), 0);
});

test("contexts: key, URL parameter and the channel's filter", () => {
  assert.equal(C.contextKey(C.ALL), "all");
  assert.equal(C.contextKey(null), "all");
  assert.equal(C.contextKey({ kind: "performer", id: "7" }), "performer:7");
  assert.deepEqual(C.contextFromQuery(q("performer=7")), { kind: "performer", id: "7", name: null });
  assert.deepEqual(C.contextFromQuery(q("performer=7,8")), { kind: "performer", id: "7", name: null });
  assert.equal(C.contextFromQuery(q("performer=abc")), C.ALL);
  assert.equal(C.sceneFromQuery(q("scene=12,13")), "12");
  assert.equal(C.sceneFromQuery(q("scene=x")), null);
  assert.equal(C.sceneFromQuery(q("")), null);
  assert.equal(C.contextFromQuery(q("performers=7")), C.ALL); // the filter, not the channel
  assert.equal(C.contextFromQuery(null), C.ALL);
  const base = C.filtersFrom(defaults(), q("tag=3&fav=1&rating=4&order=newest&performers=1,2"));
  const ch = C.channelFilter(base, 7);
  assert.deepEqual(ch, { order: "newest", favoritesOnly: false, subscribedOnly: false, minRating: 0, unseenOnly: false, tags: "", studios: "", performers: "7" });
  assert.deepEqual(C.sceneFilter(ch), { orientation: { value: ["PORTRAIT"] }, performers: { value: ["7"], modifier: "INCLUDES" } });
});

test("nextPerformer: favorites first, then the next one of the scene, wrapping round", () => {
  const a = { id: "1", name: "A" }, b = { id: "2", name: "B", favorite: true }, c = { id: "3", name: "C" };
  assert.equal(C.nextPerformer([a, b, c], null), b);
  assert.equal(C.nextPerformer([a, c], null), a);
  assert.equal(C.nextPerformer([a, b, c], "2"), a);
  assert.equal(C.nextPerformer([a, b, c], "1"), c);
  assert.equal(C.nextPerformer([a, b, c], "3"), b);
  assert.equal(C.nextPerformer([a, b, c], "9"), b); // channel of somebody not in this scene
  assert.equal(C.nextPerformer([a], "1"), null); // nobody else
  assert.equal(C.nextPerformer([], null), null);
  assert.equal(C.nextPerformer(undefined, null), null);
});

test("ContextStack: back to the same place, popTo for the browser's back button", () => {
  const st = new C.ContextStack();
  assert.equal(st.pop(), null);
  st.push({ ctx: C.ALL, index: 4 });
  st.push({ ctx: { kind: "performer", id: "1" }, index: 2 });
  assert.equal(st.depth(), 2);
  assert.equal(st.distance("performer:1"), 0);
  assert.equal(st.distance("all"), 1);
  assert.equal(st.distance("performer:9"), -1);
  assert.equal(st.pop().index, 2);
  assert.equal(st.pop().index, 4);
  assert.equal(st.depth(), 0);
  st.push({ ctx: C.ALL, index: 4 });
  st.push({ ctx: { kind: "performer", id: "1" }, index: 2 });
  st.push({ ctx: { kind: "performer", id: "2" }, index: 0 });
  assert.equal(st.popTo("performer:9"), null);
  assert.equal(st.depth(), 3);
  assert.equal(st.popTo("all").index, 4);
  assert.equal(st.depth(), 0);
  st.push({ ctx: C.ALL });
  st.clear();
  assert.equal(st.depth(), 0);
});

test("seekTime clamps to the bar", () => {
  assert.equal(C.seekTime(50, 200, 20), 5);
  assert.equal(C.seekTime(-5, 200, 20), 0);
  assert.equal(C.seekTime(500, 200, 20), 20);
  assert.equal(C.seekTime(50, 0, 20), 0);
});

test("rating: stars from rating100, clicking the same star clears", () => {
  assert.equal(C.ratingStars(null), 0);
  assert.equal(C.ratingStars(60), 3);
  assert.equal(C.ratingStars(55), 3);
  assert.equal(C.ratingAfterClick(null, 4), 80);
  assert.equal(C.ratingAfterClick(80, 4), null);
  assert.equal(C.ratingAfterClick(80, 2), 40);
});

test("PlayTracker counts played time once, not seeks or loops", () => {
  const tr = new C.PlayTracker(5);
  let fired = 0;
  const run = (from, to) => {
    for (let x = from; x <= to + 1e-9; x += 0.25) if (tr.update(x)) { fired++; tr.markReported(); }
  };
  run(0, 3); // 3 s
  tr.update(10); // seek forward: not counted
  run(10, 11); // 4 s
  tr.update(0); // loop restarts: not counted, and nothing negative
  run(0, 0.75); // 4.75 s
  assert.equal(fired, 0);
  run(1, 2); // played 5 s now
  assert.equal(fired, 1);
  run(2, 20);
  assert.equal(fired, 1);
  const p = new C.PlayTracker(2);
  p.update(0); p.update(1); p.pause(); p.update(5); p.update(5.5);
  assert.equal(p.played, 1.5);
});

test("idList and localUrl", () => {
  assert.deepEqual(C.idList(" 1,2,,a,2 "), ["1", "2"]);
  assert.deepEqual(C.idList(["3", 4]), ["3", "4"]);
  assert.deepEqual(C.idList(null), []);
  assert.equal(C.localUrl("http://x:1/a/b?c=1"), "a/b?c=1");
  assert.equal(C.localUrl("/a"), "a");
  assert.equal(C.localUrl(null), null);
});

test("icons are plain SVG path data", () => {
  for (const [name, d] of Object.entries(C.ICONS)) assert.match(d, /^[MLHVCSQTAZmlhvcsqtaz0-9 .,-]+$/, name);
});

test("subscriptions are a custom field, written partially, never the favorite", () => {
  assert.deepEqual(C.subscribeInput(7, true), { id: "7", custom_fields: { partial: { shorts_subscribed: "1" } } });
  assert.deepEqual(C.subscribeInput("7", false), { id: "7", custom_fields: { remove: ["shorts_subscribed"] } });
  assert.ok(!("favorite" in C.subscribeInput(7, true)));
  assert.equal(C.isSubscribed({ shorts_subscribed: "1", other: "x" }), true);
  assert.equal(C.isSubscribed({ other: "x" }), false);
  assert.equal(C.isSubscribed(null), false);
  assert.deepEqual(C.SUBSCRIPTIONS_FILTER, { custom_fields: [{ field: "shorts_subscribed", modifier: "NOT_NULL" }] });
});

test("caption people: the channel's performer, else subscribed, else favorite, else the first", () => {
  const a = { id: "1", name: "A" }, b = { id: "2", name: "B", favorite: true }, c = { id: "3", name: "C", subscribed: true };
  assert.deepEqual(C.captionPeople([a, b, c], null), { main: c, others: [a, b] });
  assert.deepEqual(C.captionPeople([a, b], null), { main: b, others: [a] });
  assert.deepEqual(C.captionPeople([a, b, c], "1"), { main: a, others: [b, c] });
  assert.deepEqual(C.captionPeople([a], "9"), { main: a, others: [] });
  assert.deepEqual(C.captionPeople([], null), { main: null, others: [] });
});

test("share link: the Shorts page with scene=, path prefix kept, query and hash dropped", () => {
  assert.equal(C.shareUrl("http://nas:9999/shorts?performer=3#x", "115"), "http://nas:9999/shorts?scene=115");
  assert.equal(C.shareUrl("https://h.example/stash/shorts", 7), "https://h.example/stash/shorts?scene=7");
  assert.equal(C.sceneFromQuery(new URL(C.shareUrl("http://h/shorts", "42")).searchParams), "42");
});

test("dates in the language's short form", () => {
  const de = new C.I18n("de", {}), en = new C.I18n("en", {});
  assert.equal(de.date("2026-09-04"), "4. Sept. 2026");
  assert.equal(en.date("2026-09-04"), "Sep 4, 2026");
  assert.equal(en.date("2026"), "2026");
  assert.equal(en.date(""), "");
});

test("clock and the jump entry of a marker clip", () => {
  assert.equal(C.clock(0), "0:00");
  assert.equal(C.clock(65.9), "1:05");
  assert.equal(C.clock(3723), "1:02:03");
  const scene = C.normalizeScene({ id: 5, title: "S", files: [{ duration: 100 }], performers: [] });
  const marker = C.markerItem(scene, { id: 9, title: "M", seconds: 20, end_seconds: 30, primary_tag: null });
  assert.equal(C.jumpEntry(marker, 42.4), null); // the clip's length and stream would be wrong
  const j = C.jumpEntry(scene, 42.4);
  assert.equal(j.id, "j5-42");
  assert.equal(j.sceneId, "5");
  assert.equal(j.marker, null);
  assert.equal(j.startAt, 42.4);
  assert.deepEqual(C.clipRange(j), { start: 0, end: 100 }); // the whole scene, the progress bar too
  assert.equal(j.stream, scene.stream);
  assert.ok(!/#t=/.test(j.stream));
});

test("profile: handle, filters and the merge of two lists by date", () => {
  assert.equal(C.handleOf("Limon1kaaa"), "@limon1kaaa");
  assert.equal(C.handleOf("Zoë Ann-Marie"), "@zoeannmarie");
  assert.equal(C.handleOf("!!"), "");
  assert.equal(C.profileFromQuery(q("profile=12")), "12");
  assert.deepEqual(C.profileSceneFilter(3, false), { orientation: { value: ["PORTRAIT"] }, performers: { value: ["3"], modifier: "INCLUDES" } });
  const fav = C.profileFavoritesFilter(3, false);
  assert.deepEqual(fav.rating100, { value: 79, modifier: "GREATER_THAN" });
  assert.deepEqual(fav.OR.o_counter, { value: 0, modifier: "GREATER_THAN" });
  assert.deepEqual(fav.OR.performers, fav.performers); // Stash's OR needs the other criteria again
  const d = (date, id) => ({ id, date });
  // both loaded: the newer head first; a source that is empty but not done stops the merge
  let a = { items: [d("2026-09-10", "s1"), d("2026-09-01", "s2")], done: false };
  let b = { items: [d("2026-09-05", "g1")], done: false };
  let r = C.takeByDate(a, b, 10);
  assert.deepEqual(r.out.map((x) => x.id), ["s1", "g1"]);
  assert.equal(r.need, "b");
  b.done = true;
  r = C.takeByDate(a, b, 10);
  assert.deepEqual(r.out.map((x) => x.id), ["s2"]);
  assert.equal(r.need, "a");
  // no date counts as oldest; max is kept
  a = { items: [d("", "s3"), d("", "s4")], done: true };
  b = { items: [d("2020-01-01", "g2")], done: true };
  r = C.takeByDate(a, b, 2);
  assert.deepEqual(r.out.map((x) => x.id), ["g2", "s3"]);
  assert.equal(r.need, null);
  const g = C.normalizeGallery({ id: 4, title: "", image_count: 12, paths: { cover: "http://h/gallery/4/cover" }, performers: [] });
  assert.deepEqual([g.id, g.galleryId, g.kind, g.imageCount, g.cover], ["g4", "4", "gallery", 12, "gallery/4/cover"]);
});

test("galleries in the feed: filter, placement, the pictures with a source", () => {
  const f = C.filtersFrom(defaults(), q("tag=3&fav=1&rating=4&performers=7"));
  const g = C.galleryFilter(f, false);
  assert.deepEqual(g.images_filter, { orientation: { value: ["PORTRAIT"] } });
  assert.deepEqual(g.image_count, { value: 0, modifier: "GREATER_THAN" });
  assert.deepEqual(g.tags, { value: ["3"], modifier: "INCLUDES", depth: 0 });
  assert.equal(g.performer_favorite, true);
  assert.deepEqual(g.rating100, { value: 79, modifier: "GREATER_THAN" });
  assert.deepEqual(g.performers, { value: ["7"], modifier: "INCLUDES" });
  assert.equal(C.galleryFilter(C.filtersFrom(defaults(), q("unseen=1")), false), null); // no play count
  assert.equal(C.galleryFromQuery(q("gallery=5")), "5");
  assert.equal(C.plannedOrder({ order: "random" }, false, true), true);
  // every GALLERY_EVERY entries one, in the given order for "newest"; all of them, each once
  const order = Array.from({ length: 10 }, (_, i) => ({ id: String(i) }));
  const gs = [{ id: "g1", rating100: 20 }, { id: "g2", rating100: 100 }, { id: "g3" }, { id: "g4" }];
  const newest = C.mixGalleries(order, gs, "newest", 1).map((e) => e.id);
  assert.deepEqual(newest, ["0", "1", "2", "3", "g1", "4", "5", "6", "7", "g2", "8", "9", "g3", "g4"]);
  for (const how of ["forYou", "random", "newest"]) {
    const ids = C.mixGalleries(order, gs, how, 7).map((e) => e.id);
    assert.equal(ids.length, 14, how);
    assert.equal(new Set(ids).size, 14, how);
    assert.deepEqual(ids.filter((x) => !/^g/.test(x)), order.map((e) => e.id), how); // the feed's order stays
  }
  assert.deepEqual(C.mixGalleries(order, gs, "random", 7), C.mixGalleries(order, gs, "random", 7)); // seeded
  assert.equal(C.mixGalleries(order, [], "random", 7), order);
  assert.deepEqual(C.galleryWindow(0, 5), [0, 1]);
  assert.deepEqual(C.galleryWindow(2, 5), [1, 2, 3]);
  assert.deepEqual(C.galleryWindow(0, 1), [0]);
  assert.equal(C.shareUrl("http://h/shorts?x=1", "4", "gallery"), "http://h/shorts?gallery=4");
});

test("modes: For you, Subscribed, New as filters, and back from a filter", () => {
  const s = C.readSettings({ order: "random", tags: "3", unseenOnly: true });
  const you = C.modeFilter("forYou", s), sub = C.modeFilter("subscribed", s), nu = C.modeFilter("new", s);
  assert.deepEqual([you.order, you.unseenOnly, you.subscribedOnly, you.tags], ["forYou", false, false, "3"]); // stored filters stay
  assert.deepEqual([sub.order, sub.unseenOnly, sub.subscribedOnly], ["date", false, true]);
  assert.deepEqual([nu.order, nu.unseenOnly, nu.subscribedOnly], ["date", true, false]);
  for (const m of C.MODES) assert.equal(C.modeOf(C.modeFilter(m, s)), m);
  assert.equal(C.modeOf(Object.assign({}, you, { order: "random" })), null);
  // the address carries a mode as filter parameters and reads back the same mode
  const back = C.filtersFrom(C.readSettings({}), q(C.filterParams(nu, C.readSettings({}))));
  assert.equal(C.modeOf(back), "new");
  assert.equal(C.modeOf(C.filtersFrom(C.readSettings({}), q("subs=1&order=date"))), "subscribed");
  // subscribed: the performer sub-filter on the custom field, for scenes and galleries
  assert.deepEqual(C.sceneFilter(sub).performers_filter, { custom_fields: [{ field: "shorts_subscribed", modifier: "NOT_NULL" }] });
  assert.deepEqual(C.galleryFilter(sub, false).performers_filter, C.sceneFilter(sub).performers_filter);
  assert.deepEqual(C.findFilter(nu, 1, 20, 1), { page: 1, per_page: 20, sort: "date", direction: "DESC" });
  assert.equal(C.channelFilter(sub, "4").subscribedOnly, false);
});

test("quick tags: at most five, a toggle keeps the scene's other tags", () => {
  assert.deepEqual(C.quickTagIds("1,2,3,4,5,6"), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(C.quickTagIds(""), []);
  const tags = [{ id: "4", name: "A" }, { id: "9", name: "B" }];
  assert.deepEqual(C.toggledTags(tags, 7), ["4", "9", "7"]);
  assert.deepEqual(C.toggledTags(tags, "4"), ["9"]);
  assert.deepEqual(C.toggledTags([], "4"), ["4"]);
});

test("side previews: co-performers first, then the studio, favorites ahead, never the scene's own", () => {
  const lib = [
    { performers: [{ id: "1" }, { id: "2" }], studio: { id: "s1" } },
    { performers: [{ id: "1" }, { id: "2" }], studio: { id: "s2" } },
    { performers: [{ id: "1" }, { id: "3" }], studio: { id: "s2" } },
    { performers: [{ id: "4" }], studio: { id: "s1" } },
    { performers: [{ id: "5" }], studio: { id: "s9" } },
  ];
  const scene = { performers: [{ id: "1" }], studio: { id: "s1" } };
  assert.deepEqual(C.related(scene, lib, {}), ["2", "3", "4"]);
  assert.deepEqual(C.related(scene, lib, { "4": true }), ["4", "2", "3"]);
  assert.deepEqual(C.related(scene, lib, {}, 2), ["2", "3"]);
  assert.deepEqual(C.related({ performers: [], studio: null }, lib, {}), []);
  assert.ok(!C.related(scene, lib, {}).includes("1"));
  assert.ok(!C.related(scene, lib, {}).includes("5"));
  // only performers with scenes in the feed's format (so a tile never opens an empty channel)
  assert.deepEqual(C.related(scene, lib, {}, 3, { "2": 0, "3": 4, "4": 1 }), ["3", "4"]);
});

test("session summary: time, clips, galleries, orgasms net, new subscriptions; the last ten kept", () => {
  const s = C.newSession(1000);
  s.seen = { "101": true, m3: true };
  s.galleries = { "4": true };
  s.o = 2;
  s.subscribed = { "6": true, "2": false };
  assert.deepEqual(C.sessionSummary(s, 76000), { at: 76000, seconds: 75, clips: 2, galleries: 1, o: 2, subscribed: 1 });
  assert.equal(C.summaryWorth(C.sessionSummary(C.newSession(0), 5000)), false);
  s.o = -1; // more taken back than added in this visit
  assert.equal(C.sessionSummary(s, 2000).o, 0);
  assert.equal(C.duration(75), "1:15");
  let list = [];
  for (let i = 0; i < 12; i++) list = C.addSummary(list, { at: i });
  assert.equal(list.length, 10);
  assert.equal(list[0].at, 11);
  assert.deepEqual(C.addSummary(null, { at: 1 }), [{ at: 1 }]);
});

test("profile links in groups as Stash shows them: others, twitter or x, instagram", () => {
  const g = C.linkGroups(["https://example.org/a", "https://x.com/a", "https://www.twitter.com/b", "https://instagram.com/c", "ftp://x/y", "https://example.org/x.com/z"]);
  assert.deepEqual(g.map((x) => [x.kind, x.urls]), [
    ["link", ["https://example.org/a", "https://example.org/x.com/z"]],
    ["twitter", ["https://x.com/a", "https://www.twitter.com/b"]],
    ["instagram", ["https://instagram.com/c"]],
  ]);
  assert.deepEqual(g.map((x) => x.icon), ["faLink", "faTwitter", "faInstagram"]);
  assert.deepEqual(C.linkGroups([]), []);
  assert.deepEqual(C.linkGroups(null), []);
});

test("withNavChild appends the navbar entry and keeps all other arguments", () => {
  const toArray = (c) => (c == null ? [] : [].concat(c));
  const props = { children: ["a", "b"], other: 1 };
  const ctx = {};
  const [p, second, third] = C.withNavChild([props, ctx, "x"], "item", toArray);
  assert.deepEqual(p, { children: ["a", "b", "item"], other: 1 });
  assert.equal(second, ctx); // an after hook of another plugin gets (props, context, ...) as before
  assert.equal(third, "x");
  assert.deepEqual(props.children, ["a", "b"]); // the original props are not changed
  assert.deepEqual(C.withNavChild([{}], "item", toArray)[0].children, ["item"]);
});

test("withNavChild returns the original arguments when something is off", () => {
  const boom = () => {
    throw new Error("boom");
  };
  const props = { children: ["a"] };
  const ctx = {};
  assert.deepEqual(C.withNavChild([props, ctx], "item", boom), [props, ctx]);
  assert.deepEqual(C.withNavChild([null], "item", (c) => c), [null]);
  assert.deepEqual(C.withNavChild([], "item", (c) => c), []);
  assert.deepEqual(C.withNavChild(undefined, "item", (c) => c), []);
});
