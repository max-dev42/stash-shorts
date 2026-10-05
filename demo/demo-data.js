/*
 * Invented demo library for tests and the mock server: 20 test clips (15 portrait, and 5 landscape that the feed must never show; made by
 * scripts/make-test-videos.sh), with made-up performers, studios and tags, and four galleries whose images are
 * the clips' screenshots. Performer images are generated placeholders (see png.js). No data comes from a
 * real Stash library.
 */
"use strict";

var PERFORMERS = [
  { id: "1", name: "Ada Quillmere" },
  { id: "2", name: "Bram Foxley" },
  { id: "3", name: "Cleo Vanewick", favorite: true },
  { id: "4", name: "Dario Mossford" },
  { id: "5", name: "Elin Larkdale" },
  { id: "6", name: "Juno Ashcombe", favorite: true },
  { id: "7", name: "Kai Brookstow" },
];
var STUDIOS = [
  { id: "1", name: "Northwind Pictures" },
  { id: "2", name: "Lantern Films" },
  { id: "3", name: "Harbor Home Video" },
];
var TAGS = [
  { id: "1", name: "Outdoor" },
  { id: "2", name: "Night" },
  { id: "3", name: "Dance" },
  { id: "4", name: "Rooftop" },
];

// clip n (1..20): the same numbering, sizes and lengths as scripts/make-test-videos.sh
function clip(n) {
  var landscape = n > 15;
  return {
    n: n,
    file: (landscape ? "landscape-" : "portrait-") + (n < 10 ? "0" : "") + n,
    width: landscape ? 1920 : 1080,
    height: landscape ? 1080 : 1920,
    duration: 10 + ((n * 7) % 21),
  };
}

function demoLibrary() {
  var scenes = [];
  for (var n = 1; n <= 20; n++) {
    var c = clip(n);
    var cast = [PERFORMERS[n % PERFORMERS.length]];
    if (n % 3 === 0) cast.push(PERFORMERS[(n + 3) % PERFORMERS.length]);
    scenes.push({
      id: String(100 + n),
      file: c.file,
      title: "Short " + (n < 10 ? "0" : "") + n,
      // a post text on every other scene, like FansDB keeps it in details
      details: n % 2 ? "" : "Post " + n + ": a made-up caption for the demo. Second line of the text, to see how it wraps.",
      date: "2026-09-" + (n < 10 ? "0" : "") + n,
      created_at: "2026-09-" + (n < 10 ? "0" : "") + n + "T12:00:00Z",
      rating100: n % 4 === 0 ? 80 : n % 5 === 0 ? 60 : null,
      o_counter: n % 6 === 0 ? 1 : 0,
      play_count: (n * 5) % 7,
      files: [{ path: "/data/shorts/" + c.file + ".mp4", width: c.width, height: c.height, duration: c.duration }],
      orientation: c.width > c.height ? "LANDSCAPE" : c.width < c.height ? "PORTRAIT" : "SQUARE",
      studio: STUDIOS[n % STUDIOS.length],
      performers: cast.map(function (p) {
        return p.id;
      }),
      tags: [TAGS[n % TAGS.length].id],
    });
  }
  // galleries: a post of pictures each, with the screenshots of some portrait clips as its images
  var galleries = [
    { id: "1", title: "Rooftop set", date: "2026-09-14", performers: ["3"], clips: [1, 4, 7, 10, 13], rating100: 80 },
    { id: "2", title: "", date: "2026-09-08", performers: ["1"], clips: [2, 5, 8], rating100: null },
    { id: "3", title: "Night walk", date: "2026-09-03", performers: ["6", "2"], clips: [3, 6, 9, 12], rating100: 60 },
    { id: "4", title: "Behind the scenes", date: "", performers: ["3"], clips: [11, 14, 15], rating100: null },
  ].map(function (g, i) {
    return Object.assign({}, g, {
      details: i % 2 ? "" : "Gallery " + g.id + ": a made-up post text for the demo.",
      studio: STUDIOS[i % STUDIOS.length],
      images: g.clips.map(function (n, k) {
        return { id: String(Number(g.id) * 100 + k + 1), file: clip(n).file, date: g.date, o_counter: k === 1 ? 2 : 0 };
      }),
    });
  });
  return {
    scenes: scenes,
    galleries: galleries,
    performers: PERFORMERS.map(function (p, i) {
      return { id: p.id, name: p.name, favorite: !!p.favorite, details: i % 2 ? "" : "Made-up bio of " + p.name + " for the demo. Likes rooftops and night walks.",
        // made-up addresses; the first performer has one of each group the profile shows (Core.linkGroups)
        urls: i % 3 ? [] : ["https://example.org/" + p.name.split(" ")[0].toLowerCase()].concat(i ? [] : ["https://x.com/demo_ada", "https://www.instagram.com/demo_ada", "https://example.net/ada"]) };
    }),
    studios: STUDIOS,
    tags: TAGS,
  };
}

module.exports = { demoLibrary: demoLibrary, clip: clip };
