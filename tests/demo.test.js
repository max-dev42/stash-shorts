"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../plugin/stash-shorts-core.js");
const demo = require("../demo/demo-data.js");
const server = require("../demo/server.js");

test("demo library: 15 portrait and 5 landscape clips, deterministic", () => {
  const a = demo.demoLibrary();
  assert.equal(JSON.stringify(a), JSON.stringify(demo.demoLibrary()));
  assert.equal(a.scenes.filter((s) => s.orientation === "PORTRAIT").length, 15);
  assert.equal(a.scenes.filter((s) => s.orientation === "LANDSCAPE").length, 5);
  for (const s of a.scenes) assert.ok(s.files[0].duration >= 10 && s.files[0].duration <= 30, s.title);
});

test("mock server applies the plugin's filters and orders", () => {
  const all = C.readSettings({});
  const page = (q, page) => {
    const f = C.filtersFrom(all, new URLSearchParams(q));
    return server.findScenes({ f: C.findFilter(f, page || 1, 20, 42), s: C.sceneFilter(f) });
  };
  // the 5 landscape clips are the counter-check: never in the feed
  assert.equal(page("").count, 15);
  assert.equal(page("landscape=1").count, 15);
  const landscape = new Set(demo.demoLibrary().scenes.filter((s) => s.orientation === "LANDSCAPE").map((s) => s.id));
  assert.equal(landscape.size, 5);
  assert.ok(page("").scenes.every((s) => !landscape.has(s.id) && s.files[0].width < s.files[0].height));
  assert.ok(page("tag=1").scenes.every((s) => s.performers.length >= 1));
  assert.equal(page("fav=1").scenes.every((s) => s.performers.some((p) => p.favorite)), true);
  assert.ok(page("rating=4").scenes.every((s) => s.rating100 >= 80));
  const newest = page("order=newest").scenes.map((s) => s.date);
  assert.deepEqual(newest, newest.slice().sort().reverse());
  // the random order is stable for one seed, so pages do not overlap
  const r1 = page("").scenes.map((s) => s.id);
  assert.deepEqual(r1, page("").scenes.map((s) => s.id));
  assert.equal(new Set(r1).size, 15);
  // with the setting "allowLandscape" the 5 landscape clips are in, and the suggestions count them too
  const wide = server.findScenes({ f: C.findFilter(C.filtersFrom(all, null), 1, 40, 42), s: C.sceneFilter(C.filtersFrom(all, null), true) });
  assert.equal(wide.count, 20);
  const refs = (on) => C.countRefs(server.answer({ query: "query StashShortsRefs", variables: { s: C.formatFilter(on) } }).data.findScenes.scenes);
  const sum = (m) => Object.values(m).reduce((a, b) => a + b, 0);
  assert.equal(sum(refs(false).studios), 15);
  assert.equal(sum(refs(true).studios), 20);
  // markers only of scenes in the format
  const markers = (on) => server.answer({ query: "query StashShortsMarkers", variables: { s: C.formatFilter(on) } }).data.findSceneMarkers.scene_markers;
  assert.equal(markers(false).length, 4);
  // GraphQL answers carry absolute URLs like Stash; the plugin makes them local
  const sc = C.normalizeScene(page("").scenes[0]);
  assert.match(sc.stream, /^scene\/\d+\/stream$/);
});

test("mock server: a subscription keeps the favorite and other custom fields", () => {
  const ask = (query, variables) => server.answer({ query, variables });
  const subs = () => ask(C.SUBSCRIPTIONS_QUERY, { f: C.SUBSCRIPTIONS_FILTER }).data.findPerformers.performers.map((p) => p.id);
  assert.deepEqual(subs(), []);
  ask("mutation X { performerUpdate }", { i: { id: "2", custom_fields: { partial: { other: "keep" } } } });
  const on = ask(C.SUBSCRIBE_MUTATION, { i: C.subscribeInput("2", true) }).data.performerUpdate;
  assert.deepEqual(on.custom_fields, { other: "keep", shorts_subscribed: "1" });
  assert.equal(on.favorite, false);
  assert.deepEqual(subs(), ["2"]);
  const off = ask(C.SUBSCRIBE_MUTATION, { i: C.subscribeInput("2", false) }).data.performerUpdate;
  assert.deepEqual(off.custom_fields, { other: "keep" });
  assert.deepEqual(subs(), []);
});
