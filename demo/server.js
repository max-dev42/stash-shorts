#!/usr/bin/env node
/*
 * Mock Stash for the demo and the browser checks: serves a small host page (index.html, harness.js) that
 * stands in for Stash's UI, the plugin files, the test clips from demo/videos (made by
 * scripts/make-test-videos.sh, with range requests like Stash), generated performer images, and a
 * /graphql endpoint that answers exactly the plugin's own requests (scene pages with the plugin's
 * filters, names for the dialog, settings, play count, orgasm count, rating, favorite).
 * No dependencies. Usage: node demo/server.js [port]   (default 8791; VIDEOS=/dir for another clip folder)
 */
"use strict";
var http = require("http");
var fs = require("fs");
var path = require("path");
var demo = require("./demo-data.js");
var png = require("./png.js");

var ROOT = path.resolve(__dirname, "..");
var PLUGIN = path.join(ROOT, "plugin");
var VIDEOS = path.resolve(process.env.VIDEOS || path.join(__dirname, "videos"));
var PORT = Number(process.argv[2] || process.env.PORT || 8791);
var DATA = demo.demoLibrary();
// three scene markers on the first portrait clips (one without an end, one without a title), and a second
// one on the first clip (to jump from one marker clip to another marker of its scene)
var PORTRAIT = DATA.scenes.filter(function (sc) {
  return sc.orientation === "PORTRAIT";
});
var MARKERS = PORTRAIT.slice(0, 3)
  .map(function (sc, i) {
    return { id: String(i + 1), title: ["Opening", "Close-up", ""][i], seconds: 2 + i, end_seconds: i === 1 ? null : 8 + i, primary_tag: DATA.tags[i % DATA.tags.length], scene: { id: sc.id } };
  })
  .concat([{ id: "4", title: "Finale", seconds: 7, end_seconds: 10, primary_tag: DATA.tags[3], scene: { id: PORTRAIT[0].id } }]);
var settings = {};
var imageCache = {};
var log = []; // mutations received, for the checks (GET /mock-log)

var TYPES = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".mp4": "video/mp4" };

function send(res, code, type, body) {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-cache" });
  res.end(body);
}
function file(res, p) {
  fs.readFile(p, function (err, buf) {
    if (err) return send(res, 404, "text/plain", "not found");
    send(res, 200, TYPES[path.extname(p)] || "application/octet-stream", buf);
  });
}
// video with range requests (browsers need them to seek and to buffer ahead)
function video(req, res, p) {
  fs.stat(p, function (err, st) {
    if (err) return send(res, 404, "text/plain", "not found");
    var m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
    var start = 0, end = st.size - 1, code = 200;
    if (m) {
      start = m[1] ? Number(m[1]) : st.size - Number(m[2]);
      end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      code = 206;
    }
    var head = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": end - start + 1, "Cache-Control": "no-cache" };
    if (code === 206) head["Content-Range"] = "bytes " + start + "-" + end + "/" + st.size;
    res.writeHead(code, head);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(p, { start: start, end: end }).pipe(res);
  });
}
function image(res, key, make) {
  if (!imageCache[key]) imageCache[key] = make();
  send(res, 200, "image/png", imageCache[key]);
}

function performer(id) {
  return DATA.performers.filter(function (p) {
    return p.id === id;
  })[0];
}
function sceneById(id) {
  return DATA.scenes.filter(function (s) {
    return s.id === String(id);
  })[0];
}

function sceneOut(sc) {
  return {
    id: sc.id, title: sc.title, details: sc.details, date: sc.date, rating100: sc.rating100, o_counter: sc.o_counter, play_count: sc.play_count,
    // no animated previews in the demo (webp answers 404), as in a library where none were generated
    paths: { screenshot: "http://127.0.0.1:" + PORT + "/scene/" + sc.id + "/screenshot", stream: "http://127.0.0.1:" + PORT + "/scene/" + sc.id + "/stream",
      webp: "http://127.0.0.1:" + PORT + "/scene/" + sc.id + "/webp" },
    files: sc.files.map(function (f) {
      return { width: f.width, height: f.height, duration: f.duration };
    }),
    studio: sc.studio,
    performers: sc.performers.map(function (pid) {
      var p = performer(pid);
      return { id: p.id, name: p.name, favorite: p.favorite, image_path: "http://127.0.0.1:" + PORT + "/performer/" + p.id + "/image" };
    }),
    tags: sc.tags.map(function (id) {
      return DATA.tags.filter(function (x) {
        return x.id === id;
      })[0];
    }),
    scene_markers: MARKERS.filter(function (m) {
      return m.scene.id === sc.id;
    }).map(function (m) {
      return { id: m.id };
    }),
  };
}

// the subset of Stash's scene filter the plugin sends
// the subset of Stash's scene filter the plugin sends; OR: this filter or the one in OR, as in Stash
function matches(sc, s) {
  return matchOne(sc, s) || (s.OR ? matches(sc, s.OR) : false);
}
function matchOne(sc, s) {
  if (s.orientation && s.orientation.value.indexOf(sc.orientation) < 0) return false;
  function any(list, crit) {
    return !crit || crit.value.some(function (v) {
      return list.indexOf(v) >= 0;
    });
  }
  if (!any(sc.tags, s.tags) || !any([sc.studio.id], s.studios) || !any(sc.performers, s.performers)) return false;
  if (s.performer_favorite && !sc.performers.some(function (pid) {
    return performer(pid).favorite;
  })) return false;
  if (s.rating100 && !(sc.rating100 > s.rating100.value)) return false;
  if (s.play_count && sc.play_count !== s.play_count.value) return false;
  if (s.o_counter && !(sc.o_counter > s.o_counter.value)) return false;
  if (s.performers_filter && !sc.performers.some(function (pid) {
    return performerMatches(performer(pid), s.performers_filter);
  })) return false;
  if (s.id && Number(sc.id) !== s.id.value) return false;
  return true;
}

function seeded(seed) {
  var x = seed >>> 0;
  return function () {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

// newest first by date, those without one last (as Stash sorts by date, descending)
function byDate(a, b) {
  return (b.date || "") < (a.date || "") ? -1 : (b.date || "") > (a.date || "") ? 1 : Number(b.id) - Number(a.id);
}
function page(list, f) {
  var per = f.per_page > 0 ? f.per_page : list.length, from = ((f.page || 1) - 1) * per;
  return list.slice(from, from + per);
}
function galleryOut(g) {
  return { id: g.id, title: g.title, date: g.date, details: g.details, rating100: g.rating100, image_count: g.images.length,
    paths: { cover: "http://127.0.0.1:" + PORT + "/gallery/" + g.id + "/cover" }, studio: g.studio,
    performers: g.performers.map(function (pid) {
      var p = performer(pid);
      return { id: p.id, name: p.name, favorite: p.favorite, image_path: "http://127.0.0.1:" + PORT + "/performer/" + p.id + "/image" };
    }) };
}
function withPerformer(crit, list) {
  return !crit || crit.value.some(function (v) {
    return list.indexOf(v) >= 0;
  });
}
// the subset of Stash's gallery filter the plugin sends (Core.galleryFilter); the demo's pictures are all
// portrait (screenshots of portrait clips)
function galleryMatches(g, f) {
  f = f || {};
  if (f.images_filter && f.images_filter.orientation && f.images_filter.orientation.value.indexOf("PORTRAIT") < 0) return false;
  if (f.tags) return false; // no tags on the demo's galleries
  if (f.studios && f.studios.value.indexOf(g.studio.id) < 0) return false;
  if (!withPerformer(f.performers, g.performers)) return false;
  if (f.performer_favorite && !g.performers.some(function (pid) {
    return performer(pid).favorite;
  })) return false;
  if (f.rating100 && !(g.rating100 > f.rating100.value)) return false;
  if (f.performers_filter && !g.performers.some(function (pid) {
    return performerMatches(performer(pid), f.performers_filter);
  })) return false;
  return true;
}
// the performer sub-filter the plugin sends: custom fields set (NOT_NULL)
function performerMatches(p, f) {
  return (f.custom_fields || []).every(function (c) {
    return p.custom_fields && p.custom_fields[c.field] != null;
  });
}
function galleryById(id) {
  return DATA.galleries.filter(function (g) {
    return g.id === String(id);
  })[0];
}
function imageById(id) {
  for (var i = 0; i < DATA.galleries.length; i++)
    for (var k = 0; k < DATA.galleries[i].images.length; k++) if (DATA.galleries[i].images[k].id === String(id)) return DATA.galleries[i].images[k];
  return null;
}

function findScenes(v) {
  var f = v.f || {}, list = DATA.scenes.filter(function (sc) {
    return matches(sc, v.s || {});
  });
  var m = /^random_(\d+)$/.exec(f.sort || "");
  if (m) {
    var r = seeded(Number(m[1])), keyed = list.map(function (sc) {
      return [r(), sc];
    });
    keyed.sort(function (a, b) {
      return a[0] - b[0];
    });
    list = keyed.map(function (k) {
      return k[1];
    });
  } else if (f.sort === "created_at") list.sort(function (a, b) {
    return a.created_at < b.created_at ? 1 : -1;
  });
  else if (f.sort === "play_count") list.sort(function (a, b) {
    return b.play_count - a.play_count || Number(a.id) - Number(b.id);
  });
  else if (f.sort === "date") list.sort(byDate);
  else if (f.sort === "rating") list.sort(function (a, b) {
    return (b.rating100 || 0) - (a.rating100 || 0) || Number(a.id) - Number(b.id);
  });
  var per = f.per_page || 25, from = ((f.page || 1) - 1) * per;
  return { count: list.length, scenes: list.slice(from, from + per).map(sceneOut) };
}

function answer(body) {
  var q = body.query || "", v = body.variables || {};
  if (q.indexOf("query StashShortsScenes") >= 0) return { data: { findScenes: findScenes(v) } };
  // "For you": the pool in the filter, the whole library for the taste, then pages by id
  function light(sc) {
    return { id: sc.id, rating100: sc.rating100, o_counter: sc.o_counter, play_count: sc.play_count, studio: { id: sc.studio.id }, tags: sc.tags.map(function (id) {
      return { id: id };
    }), performers: sc.performers.map(function (pid) {
      return { id: pid, favorite: performer(pid).favorite };
    }) };
  }
  if (q.indexOf("query StashShortsPool") >= 0)
    return { data: { findScenes: { scenes: DATA.scenes.filter(function (sc) {
      return matches(sc, v.s || {});
    }).map(light) } } };
  if (q.indexOf("query StashShortsTaste") >= 0) return { data: { findScenes: { scenes: DATA.scenes.map(light) } } };
  if (q.indexOf("query StashShortsIds") >= 0) return { data: { findScenes: { scenes: findScenes({ f: Object.assign({}, v.f, { per_page: 100000 }), s: v.s }).scenes.map(function (sc) {
    return { id: sc.id };
  }) } } };
  if (q.indexOf("query StashShortsResume") >= 0) return { data: { findScenes: findScenes({ f: { per_page: 1 }, s: v.s }) } };
  if (q.indexOf("query StashShortsMarkers") >= 0)
    return { data: { findSceneMarkers: { scene_markers: MARKERS.filter(function (m) {
      return matches(sceneById(m.scene.id), v.s || {});
    }) } } };
  if (q.indexOf("query StashShortsByIds") >= 0) return { data: { findScenes: { scenes: (v.ids || []).map(sceneById).filter(Boolean).map(sceneOut) } } };
  // the browser check's counter-checks (scripts/check.mjs): file sizes and performers of the scenes the
  // feed loaded, and the number of scenes for a filter
  if (q.indexOf("findScenes(ids:") >= 0)
    return { data: { findScenes: { scenes: (v.ids || []).map(sceneById).filter(Boolean).map(function (sc) {
      return { id: sc.id, date: sc.date, play_count: sc.play_count, files: sc.files.map(function (f) {
        return { width: f.width, height: f.height };
      }), performers: sc.performers.map(function (pid) {
        return { id: pid };
      }) };
    }) } } };
  if (q.indexOf("findScenes(scene_filter:") >= 0) return { data: { findScenes: findScenes({ f: { per_page: 1000 }, s: v.s }) } };
  // the creator profile: the performer with their numbers, their galleries and images
  if (q.indexOf("query StashShortsProfile") >= 0) {
    var pp = performer(v.id);
    if (!pp) return { data: { findPerformer: null } };
    var mine = DATA.scenes.filter(function (sc) {
      return sc.performers.indexOf(pp.id) >= 0;
    });
    var theirs = DATA.galleries.filter(function (g) {
      return g.performers.indexOf(pp.id) >= 0;
    });
    return { data: { findPerformer: { id: pp.id, name: pp.name, disambiguation: "", details: pp.details, urls: pp.urls, favorite: !!pp.favorite,
      image_path: "http://127.0.0.1:" + PORT + "/performer/" + pp.id + "/image", rating100: pp.id === "3" ? 80 : null,
      scene_count: mine.length, gallery_count: theirs.length, image_count: theirs.reduce(function (n, g) {
        return n + g.images.length;
      }, 0), o_counter: mine.reduce(function (n, sc) {
        return n + sc.o_counter;
      }, 0), custom_fields: pp.custom_fields || {} } } };
  }
  // galleries in the feed: the ids for the plan, pages by id, the pictures of one
  if (q.indexOf("query StashShortsGalleryIds") >= 0) {
    var gl = DATA.galleries.filter(function (g) {
      return galleryMatches(g, v.g);
    });
    if ((v.f || {}).sort === "rating") gl.sort(function (a, b) {
      return (b.rating100 || 0) - (a.rating100 || 0);
    });
    else gl.sort(byDate);
    return { data: { findGalleries: { galleries: gl.map(function (g) {
      return { id: g.id, rating100: g.rating100 };
    }) } } };
  }
  if (q.indexOf("query StashShortsGalleriesByIds") >= 0)
    return { data: { findGalleries: { galleries: (v.ids || []).map(galleryById).filter(Boolean).map(galleryOut) } } };
  if (q.indexOf("query StashShortsGalleryImages") >= 0) {
    var one = galleryById(((v.i || {}).galleries || { value: [] }).value[0]);
    return { data: { findImages: { images: (one ? one.images : []).map(function (im) {
      return { id: im.id, o_counter: im.o_counter, paths: { thumbnail: "http://127.0.0.1:" + PORT + "/image/" + im.id + "/thumbnail", image: "http://127.0.0.1:" + PORT + "/image/" + im.id + "/image" } };
    }) } } };
  }
  // the reads of scripts/check.mjs for galleries: a picture's orgasms, a gallery's rating
  if (q.indexOf("findImage(id:") >= 0) {
    var ci = imageById(v.id);
    return { data: { findImage: ci && { id: ci.id, o_counter: ci.o_counter } } };
  }
  if (q.indexOf("findGallery(id:") >= 0) {
    var cgal = galleryById(v.id);
    return { data: { findGallery: cgal && { id: cgal.id, rating100: cgal.rating100, performers: cgal.performers.map(function (id) {
      return { id: id };
    }) } } };
  }
  if (q.indexOf("query StashShortsGalleries") >= 0) {
    var gs = DATA.galleries.filter(function (g) {
      return withPerformer((v.g || {}).performers, g.performers);
    }).sort(byDate);
    return { data: { findGalleries: { count: gs.length, galleries: page(gs, v.f || {}).map(galleryOut) } } };
  }
  if (q.indexOf("query StashShortsImages") >= 0) {
    var ims = [];
    DATA.galleries.forEach(function (g) {
      var crit = (v.i || {}).performers, gal = (v.i || {}).galleries;
      if (!withPerformer(crit, g.performers) || (gal && gal.value.indexOf(g.id) < 0)) return;
      g.images.forEach(function (im) {
        ims.push({ id: im.id, title: "", date: im.date, paths: { thumbnail: "http://127.0.0.1:" + PORT + "/image/" + im.id + "/thumbnail",
          image: "http://127.0.0.1:" + PORT + "/image/" + im.id + "/image" }, galleries: [{ id: g.id }] });
      });
    });
    if (!(v.i || {}).galleries) ims.sort(byDate);
    return { data: { findImages: { count: ims.length, images: page(ims, v.f || {}) } } };
  }
  // the detail sheet of one scene
  if (q.indexOf("query StashShortsScene(") >= 0) {
    var ds = sceneById(v.id);
    if (!ds) return { data: { findScene: null } };
    var o = sceneOut(ds);
    return { data: { findScene: { id: o.id, title: o.title, details: o.details, date: o.date, code: "DEMO-" + o.id, director: null,
      urls: ["https://example.org/post/" + o.id], studio: o.studio, performers: o.performers, tags: o.tags,
      scene_markers: MARKERS.filter(function (m) {
        return m.scene.id === ds.id;
      }) } } };
  }
  // the reads of scripts/check.mjs: every performer's links
  if (q.indexOf("performers { id urls }") >= 0)
    return { data: { findPerformers: { performers: DATA.performers.map(function (p) {
      return { id: p.id, urls: p.urls };
    }) } } };
  // the first tags by name (for the quick tags of its run)
  if (q.indexOf("findTags(filter:") >= 0 && q.indexOf("query StashShortsNames") < 0)
    return { data: { findTags: { tags: DATA.tags.slice().sort(function (a, b) {
      return a.name < b.name ? -1 : 1;
    }).slice(0, 2).map(function (x) {
      return { id: x.id };
    }) } } };
  // how many performers have a custom field
  if (q.indexOf("findPerformers(performer_filter:") >= 0 && q.indexOf("query StashShortsSubscriptions") < 0)
    return { data: { findPerformers: { count: DATA.performers.filter(function (p) {
      return performerMatches(p, v.f || {});
    }).length } } };
  // a performer's galleries with their dates
  if (q.indexOf("findGalleries(gallery_filter:") >= 0) {
    var cg = DATA.galleries.filter(function (g) {
      return galleryMatches(g, v.g);
    });
    return { data: { findGalleries: { count: cg.length, galleries: cg.map(function (g) {
      return { id: g.id, date: g.date };
    }) } } };
  }
  // all markers with their scene's file size
  if (q.indexOf("findSceneMarkers(filter:") >= 0)
    return { data: { findSceneMarkers: { scene_markers: MARKERS.map(function (m) {
      var ms = sceneById(m.scene.id);
      return { id: m.id, seconds: m.seconds, scene: { id: ms.id, files: ms.files.map(function (f) {
        return { width: f.width, height: f.height };
      }) } };
    }) } } };
  if (q.indexOf("findScene(id: $id) { tags") >= 0 || q.indexOf("findScene(id: $id) { rating100 tags") >= 0 || q.indexOf("findScene(id: $id) { performers") >= 0) {
    var ts = sceneById(v.id);
    return { data: { findScene: ts && { rating100: ts.rating100, tags: ts.tags.map(function (id) {
      return { id: id };
    }), performers: ts.performers.map(function (id) {
      return { id: id };
    }), studio: { id: ts.studio.id } } } };
  }
  // the reads of ACTIONS=1 in scripts/check.mjs
  if (q.indexOf("findScene(id:") >= 0) {
    var one = sceneById(v.id);
    return { data: { findScene: one && { id: one.id, title: one.title, rating100: one.rating100, o_counter: one.o_counter, play_count: one.play_count } } };
  }
  if (q.indexOf("findPerformer(id:") >= 0) {
    var who = performer(v.id);
    return { data: { findPerformer: who && { favorite: !!who.favorite, custom_fields: who.custom_fields || {} } } };
  }
  if (q.indexOf("query StashShortsPerformer") >= 0) return { data: { findPerformer: performer(v.id) || null } };
  // the performers with a custom field (NOT_NULL, as the plugin asks for its subscriptions)
  if (q.indexOf("query StashShortsSubscriptions") >= 0)
    return { data: { findPerformers: { performers: DATA.performers.filter(function (p) {
      return (v.f && v.f.custom_fields || []).every(function (c) {
        return p.custom_fields && p.custom_fields[c.field] != null;
      });
    }).map(function (p) {
      return { id: p.id };
    }) } } };
  if (q.indexOf("query StashShortsSettings") >= 0) return { data: { configuration: { plugins: { "stash-shorts": settings } } } };
  if (q.indexOf("query StashShortsNames") >= 0)
    return { data: { findTags: { tags: DATA.tags }, findStudios: { studios: DATA.studios }, findPerformers: { performers: DATA.performers.map(function (p) {
      return { id: p.id, name: p.name, favorite: p.favorite, image_path: "http://127.0.0.1:" + PORT + "/performer/" + p.id + "/image" };
    }) } } };
  if (q.indexOf("query StashShortsRefs") >= 0)
    return { data: { findScenes: { scenes: DATA.scenes.filter(function (sc) {
      return matches(sc, v.s || {});
    }).map(function (sc) {
      return { studio: { id: sc.studio.id }, tags: sc.tags.map(function (id) {
        return { id: id };
      }), performers: sc.performers.map(function (id) {
        return { id: id };
      }) };
    }) } } };
  log.push({ query: q.split("(")[0].trim(), variables: v });
  if (q.indexOf("configurePlugin") >= 0) {
    settings = v.i || {};
    return { data: { configurePlugin: settings } };
  }
  if (q.indexOf("sceneAddPlay") >= 0) {
    var a = sceneById(v.id);
    return { data: { sceneAddPlay: { count: ++a.play_count } } };
  }
  if (q.indexOf("sceneAddO") >= 0) {
    var b = sceneById(v.id);
    return { data: { sceneAddO: { count: ++b.o_counter } } };
  }
  if (q.indexOf("imageIncrementO") >= 0) return { data: { imageIncrementO: ++imageById(v.id).o_counter } };
  if (q.indexOf("imageDecrementO") >= 0) {
    var di = imageById(v.id);
    di.o_counter = Math.max(0, di.o_counter - 1);
    return { data: { imageDecrementO: di.o_counter } };
  }
  if (q.indexOf("galleryUpdate") >= 0) {
    var ug = galleryById(v.i.id);
    ug.rating100 = v.i.rating100;
    return { data: { galleryUpdate: { id: ug.id, rating100: ug.rating100 } } };
  }
  if (q.indexOf("sceneDeleteO") >= 0) {
    var o = sceneById(v.id);
    o.o_counter = Math.max(0, o.o_counter - 1);
    return { data: { sceneDeleteO: { count: o.o_counter } } };
  }
  if (q.indexOf("sceneUpdate") >= 0) {
    var c = sceneById(v.i.id);
    if ("rating100" in v.i) c.rating100 = v.i.rating100;
    if (v.i.tag_ids) c.tags = v.i.tag_ids.map(String);
    return { data: { sceneUpdate: { id: c.id, rating100: c.rating100, tags: c.tags.map(function (id) {
      return DATA.tags.filter(function (x) {
        return x.id === id;
      })[0] || { id: id, name: "#" + id };
    }) } } };
  }
  if (q.indexOf("performerUpdate") >= 0) {
    var p = performer(v.i.id), cf = v.i.custom_fields;
    if ("favorite" in v.i) p.favorite = !!v.i.favorite;
    p.custom_fields = p.custom_fields || {};
    if (cf && cf.partial) Object.assign(p.custom_fields, cf.partial);
    if (cf && cf.remove) cf.remove.forEach(function (k) {
      delete p.custom_fields[k];
    });
    return { data: { performerUpdate: { id: p.id, favorite: p.favorite, custom_fields: p.custom_fields } } };
  }
  return { errors: [{ message: "mock server: unsupported query" }] };
}

var server = http.createServer(function (req, res) {
  var u = new URL(req.url, "http://localhost");
  var p = u.pathname, m;
  if (req.method === "POST" && p === "/graphql") {
    var chunks = [];
    req.on("data", function (c) {
      chunks.push(c);
    });
    req.on("end", function () {
      var body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch (e) {
        /* empty */
      }
      send(res, 200, "application/json", JSON.stringify(answer(body)));
    });
    return;
  }
  if (p === "/" || p === "/shorts") return file(res, path.join(__dirname, "index.html"));
  if (p === "/mock-log") return send(res, 200, "application/json", JSON.stringify(log));
  if (p === "/harness.js" || p === "/harness.css") return file(res, path.join(__dirname, p.slice(1)));
  if ((m = p.match(/^\/plugin-files\/([\w.-]+\.(js|css))$/))) return file(res, path.join(PLUGIN, m[1]));
  if ((m = p.match(/^\/plugin\/stash-shorts\/assets\/locales\/([\w-]+\.json)$/))) return file(res, path.join(PLUGIN, "locales", m[1]));
  if ((m = p.match(/^\/performer\/(\d+)\/image$/))) return image(res, "p" + m[1], function () {
    return png.avatar(Number(m[1]) * 3);
  });
  var sc;
  if ((m = p.match(/^\/scene\/(\d+)\/stream$/)) && (sc = sceneById(m[1]))) return video(req, res, path.join(VIDEOS, sc.file + ".mp4"));
  if ((m = p.match(/^\/scene\/(\d+)\/screenshot$/)) && (sc = sceneById(m[1]))) return file(res, path.join(VIDEOS, sc.file + ".jpg"));
  // gallery covers and images are clip screenshots
  var im, gal;
  if ((m = p.match(/^\/image\/(\d+)\/(thumbnail|image)$/)) && (im = imageById(m[1]))) return file(res, path.join(VIDEOS, im.file + ".jpg"));
  if ((m = p.match(/^\/gallery\/(\d+)\/cover$/)) && (gal = DATA.galleries.filter(function (g) {
    return g.id === m[1];
  })[0])) return file(res, path.join(VIDEOS, gal.images[0].file + ".jpg"));
  send(res, 404, "text/plain", "not found");
});

if (require.main === module)
  server.listen(PORT, "127.0.0.1", function () {
    console.log("demo: http://127.0.0.1:" + PORT + "/shorts  (mock Stash with invented data, clips from " + VIDEOS + ")");
  });

module.exports = { answer: answer, findScenes: findScenes };
