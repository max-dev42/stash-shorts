#!/usr/bin/env node
// Browser check of the feed in headless Chromium over the DevTools protocol (Node's built-in WebSocket,
// Node 22+), no npm dependencies. Against the demo (default: starts demo/server.js, needs demo/videos,
// see scripts/make-test-videos.sh) or a running Stash with the plugin installed (BASE=http://host:9999).
//
// Per viewport (390x844 touch, 1440x900 mouse) it measures: time from navigation to the first playing
// video, time from each step to playback of the next video (20 steps forward, then one back), the most
// <video> elements in the DOM, long tasks while stepping, and requests to other hosts. Screenshots go to
// demo/screenshots/. ACTIONS=1 also clicks rating, orgasm count and favorite, subscribes and unsubscribes,
// waits for the play count, and prints the values before and after from GraphQL.
//
// Counter-check: every scene the feed loaded is checked against GraphQL; with the default settings none may
// be in landscape format or square (QUERY="landscape=1" tries to sneak them in through the URL).
//
// Contexts (per viewport): an oblique swipe (30 degrees) must not change the context; a swipe to the left
// (touch) or a mouse drag (desktop) opens the performer channel, whose scenes are checked against GraphQL
// (each has the performer, the count is that of the performer's portrait scenes); two steps down there,
// then back to the right (swipe or ArrowLeft) must land on the same scene. Then a swipe or ArrowRight
// into the channel and the browser's back button out of it. Measured: time from the change of context to
// the current video advancing, <video> elements, long tasks.
// Quick actions (phone only, on for the run with the first two tags): row, rating synced with the column,
// a quick tag on and off keeping the other tags; the rating is put back.
// Session summary (phone only): numbers after two clips, orgasms and a subscription; stay, again, leave;
// the history; what it did is taken back.
// Side previews (phone only): tiles against GraphQL (related by scene or studio), a tap into the channel,
// none on a short screen.
// Modes (phone only): For you on by default, New only unwatched by date, Subscribed empty and with one
// performer subscribed (taken back), the bar clear of caption and column.
// Galleries (phone only, the setting "disableGalleries" off for this run, on for the others): those loaded
// against GraphQL, flipping, past the last picture into the channel, orgasm on the picture, rating, link.
// Creator profile (phone only): opened by the name in the caption; posts in date order and as many as
// GraphQL has; Media, Favorites; back closes it at the same scene; a post opens the channel at that scene.
// Detail sheet (phone only): from the marker count of a scene with markers; rows against GraphQL, a marker
// seeks, in a marker clip another marker gives the whole scene from there, a tag filters the feed.
// Scene links (phone only): /shorts?scene=<id> starts with that scene, also a landscape one; an unknown id
// gives a hint and the usual feed.
// Channel links (phone only): /shorts?performer=<id> opened directly; on a scene with two performers a
// swipe to the left goes to the other one and the next swipe on to the next one, back twice returns; a
// performer with a single portrait scene gets the hint, and back from a linked channel shows all scenes.
//
// LANDSCAPE=1 turns the setting "allowLandscape" on for the run (and back afterwards): the format check
// then expects landscape scenes among those loaded, and the first landscape slide is measured (video across
// the width, blurred screenshot behind it) and photographed.
//
// CURATOR=1 with NAVBAR=1 (Stash only) adds another plugin's after hook on the navbar items that needs all
// arguments (props, context, result), as Stash Curator has, and reports whether the UI still renders.
// NAVBAR=only runs the navbar part alone.
// Usage: node scripts/check.mjs            BASE=… QUERY="tag=3" ACTIONS=1 LANDSCAPE=1 CHROME=/path/to/chromium
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "demo", "screenshots");
const CDP = 9341;
const CHROME = process.env.CHROME || "chromium";
const QUERY = process.env.QUERY || "";
const STEPS = Number(process.env.STEPS || 20);
const TAG = process.env.TAG || "";
const LANDSCAPE = !!process.env.LANDSCAPE;
let BASE = process.env.BASE;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server = null;
if (!BASE) {
  BASE = "http://127.0.0.1:8791";
  server = spawn(process.execPath, [path.join(ROOT, "demo", "server.js"), "8791"], { stdio: "ignore" });
}
const origin = new URL(BASE).origin;
const profile = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "sst-check-"));
const chrome = spawn(CHROME, ["--headless", "--no-sandbox", "--hide-scrollbars", "--mute-audio", `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", detached: true });
let chromeExited = false;
chrome.on("exit", () => { chromeExited = true; });
function killChrome(signal) {
  if (chromeExited) return;
  try { process.kill(-chrome.pid, signal); } catch (e) { try { chrome.kill(signal); } catch (x) { /* gone */ } }
}
let cleaning = null;
function cleanup() {
  if (!cleaning)
    cleaning = (async () => {
      if (server) server.kill();
      killChrome("SIGTERM");
      for (let i = 0; i < 30 && !chromeExited; i++) await sleep(100);
      killChrome("SIGKILL");
      await sleep(200);
      fs.rmSync(profile, { recursive: true, force: true });
    })();
  return cleaning;
}
process.on("exit", () => { killChrome("SIGKILL"); if (server) server.kill(); });
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => cleanup().then(() => process.exit(130)));
process.on("uncaughtException", (e) => { console.error(e); cleanup().then(() => process.exit(1)); });
process.on("unhandledRejection", (e) => { console.error(e); cleanup().then(() => process.exit(1)); });
setTimeout(() => { console.error("timeout after 5 minutes"); cleanup().then(() => process.exit(1)); }, 300000).unref();

async function json(url, opts) {
  for (let i = 0; i < 50; i++) {
    try { return await (await fetch(url, opts)).json(); } catch (e) { await sleep(200); }
  }
  throw new Error("no answer from " + url);
}
const gql = (query, variables) => json(`${BASE}/graphql`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });

await gql("{ __typename }");

async function page() {
  const target = await json(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: "PUT" });
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map(), errors = [], requests = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    } else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
    else if (m.method === "Network.requestWillBeSent") requests.push(m.params.request.url);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expr, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { const v = await evaluate(expr); if (v) return v; } catch (e) { /* not yet */ } await sleep(50); }
    return null;
  };
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(r.data, "base64"));
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  // CURATOR=1 (with NAVBAR=1 against Stash): another plugin's after hook on the navbar items that needs
  // (props, context, result), as Stash Curator has; a before hook that drops the context makes it fail
  if (process.env.CURATOR) await send("Page.addScriptToEvaluateOnNewDocument", { source:
    "(function wait() { var P = window.PluginApi; if (!P || !P.patch || !P.patch.after) return setTimeout(wait, 5); if (window.__curatorHook) return;" +
    " window.__curatorHook = { calls: 0, lengths: [] }; P.patch.after('MainNavBar.MenuItems', function (props, context, result) {" +
    " window.__curatorHook.calls++; window.__curatorHook.lengths.push(arguments.length); return P.React.cloneElement(result, {}); }); })();" });
  // FRESH=1 (for the screenshots in docs/): no "Continuing where you were" from an earlier page of the run
  if (process.env.FRESH) await send("Page.addScriptToEvaluateOnNewDocument", { source: "try { localStorage.removeItem('stash-shorts:resume'); } catch (e) {}" });
  await send("Page.addScriptToEvaluateOnNewDocument", { source:
    "window.__longTasks = []; try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { window.__longTasks.push({ start: e.startTime, dur: e.duration }); }); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}" });
  return { ws, send, evaluate, waitFor, shot, errors, requests };
}

async function run(name, width, height, touch) {
  const p = await page();
  await p.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: touch });
  if (touch) await p.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const url = `${BASE}/shorts${QUERY ? "?" + QUERY : ""}`;
  await p.send("Page.navigate", { url });
  const first = await p.waitFor("window.stashShorts && window.stashShorts.timing.firstPlayAt");
  // which stream the first scene plays (direct, or the transcoded fallback) and whether it failed
  const firstScene = await p.evaluate("({ id: stashShorts.scenes[0].id, title: stashShorts.scenes[0].title, src: stashShorts.currentVideo().getAttribute('src'), failed: !!document.querySelector('.sst-current.sst-failed') })");
  await sleep(600);
  await p.shot(`${name}${TAG}-1-first`);
  const total = await p.evaluate("window.stashShorts.scenes.length");

  const cx = Math.round(width / 2), stepStart = await p.evaluate("performance.now()");
  let maxVideos = 0, wide = null;
  const step = async (dir, i) => {
    if (touch) {
      const y0 = dir > 0 ? Math.round(height * 0.7) : Math.round(height * 0.3), y1 = dir > 0 ? Math.round(height * 0.3) : Math.round(height * 0.7);
      const x = Math.round(width * 0.4);
      await p.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
      for (let k = 1; k <= 6; k++) {
        await p.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: Math.round(y0 + ((y1 - y0) * k) / 6) }] });
        await sleep(16);
      }
      await p.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else if (i % 2) {
      await p.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: cx, y: Math.round(height / 2), deltaX: 0, deltaY: dir * 100 });
      await sleep(260); // a separate wheel gesture each time
    } else {
      const key = dir > 0 ? "ArrowDown" : "ArrowUp";
      await p.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: dir > 0 ? 40 : 38 });
      await p.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: dir > 0 ? 40 : 38 });
    }
  };
  // STEPS gestures: forward while there is a next scene, then backward. Besides the plugin's own timing
  // (step until the "playing" event), a frame watcher in the page notes when the new current video is
  // really advancing (not paused, currentTime moving).
  const frames = [];
  let dir = 1;
  for (let i = 1; i <= STEPS; i++) {
    const st = await p.evaluate("({ n: stashShorts.timing.switches.length, i: stashShorts.index, last: stashShorts.scenes.length - 1 })");
    if (st.i >= st.last) dir = -1;
    await p.evaluate(`(function () {
      var from = stashShorts.index; window.__frame = null;
      (function f() {
        var v = stashShorts.currentVideo();
        if (stashShorts.index !== from && v && !v.paused && v.readyState >= 3 && v.currentTime > 0.02 && v.currentTime < 1.5) window.__frame = Math.round(performance.now() - stashShorts.timing.lastGo);
        else requestAnimationFrame(f);
      })();
    })()`);
    await step(dir, i);
    await p.waitFor(`window.stashShorts.timing.switches.length > ${st.n}`, 4000);
    frames.push({ dir, ms: await p.waitFor("window.__frame", 4000) });
    maxVideos = Math.max(maxVideos, await p.evaluate("document.querySelectorAll('video').length"));
    if (LANDSCAPE && !wide) {
      wide = await p.evaluate(`(function () {
        var S = stashShorts, sl = document.querySelector('.sst-slide[data-index="' + S.index + '"]'), v = S.currentVideo();
        if (!sl || !sl.classList.contains('sst-wide') || !v) return null;
        var r = sl.getBoundingClientRect(), w = Math.min(r.width, r.height * v.videoWidth / v.videoHeight), h = w * v.videoHeight / v.videoWidth;
        return { scene: S.scenes[S.index].id, slide: [Math.round(r.width), Math.round(r.height)], video: [v.videoWidth, v.videoHeight], shown: [Math.round(w), Math.round(h)],
          top: Math.round((r.height - h) / 2), fit: getComputedStyle(v).objectFit, playing: !v.paused, poster: getComputedStyle(sl.querySelector('.sst-poster')).filter };
      })()`);
      if (wide) {
        await sleep(400); // the step's slide animation
        await p.shot(`${name}${TAG}-landscape`);
      }
    }
    if (i === 3) await p.shot(`${name}${TAG}-2-after-3`);
    await sleep(350);
  }
  const t = await p.evaluate("({ scenes: stashShorts.scenes.map((s) => s.title + ' #' + s.id), index: stashShorts.index, sw: stashShorts.timing.switches, srcs: [...document.querySelectorAll('video')].filter(v => v.getAttribute('src')).length, lt: window.__longTasks })");
  const longDuring = t.lt.filter((x) => x.start >= stepStart).map((x) => Math.round(x.dur));
  const fwd = t.sw.filter((s) => s.to > s.from).map((s) => s.ms), bwd = t.sw.filter((s) => s.to < s.from).map((s) => s.ms);
  const stat = (a) => (a.length ? { n: a.length, max: Math.max(...a), median: a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] } : { n: 0 });
  const foreign = p.requests.filter((u) => /^https?:/.test(u) && new URL(u).origin !== origin);
  const r = {
    viewport: `${width}x${height}${touch ? " touch" : ""}`, url, loadedScenes: total,
    firstPlayMs: first, firstScene, steps: t.sw.length, index: t.index,
    playingEventMs: { forward: stat(fwd), backward: stat(bwd) },
    slowSwitches: t.sw.filter((s) => s.ms >= 300).map((s) => ({ ms: s.ms, to: t.scenes[s.to] })),
    frameAdvanceMs: { forward: stat(frames.filter((f) => f.dir > 0).map((f) => f.ms)), backward: stat(frames.filter((f) => f.dir < 0).map((f) => f.ms)), missing: frames.filter((f) => f.ms == null).length }, maxVideoElements: maxVideos, videosWithSrcAtEnd: t.srcs,
    longTasksWhileStepping: { count: longDuring.length, maxMs: longDuring.length ? Math.max(...longDuring) : 0 },
    requests: p.requests.length, foreignRequests: foreign, pageErrors: p.errors,
  };

  // touch: a tap toggles the sound (after the double tap time), holding pauses until released, a tap on the
  // progress bar seeks; a double tap adds an orgasm (checked in GraphQL) and leaves the sound as it was
  if (touch) {
    const tap = async (x, y, holdMs) => {
      await p.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await sleep(holdMs || 60);
      await p.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    const state = "({ sound: stashShorts.sound, muted: stashShorts.currentVideo().muted, paused: stashShorts.currentVideo().paused, t: stashShorts.currentVideo().currentTime, d: stashShorts.currentVideo().duration })";
    const g = {};
    await tap(Math.round(width * 0.4), Math.round(height * 0.45));
    await sleep(450);
    g.afterTap = await p.evaluate(state);
    await p.shot(`${name}${TAG}-sound-on`);
    await tap(Math.round(width * 0.4), Math.round(height * 0.45));
    await sleep(450);
    g.afterSecondTap = await p.evaluate(state);
    const scene = await p.evaluate("stashShorts.scenes[stashShorts.index].sceneId"); // a marker entry counts for its scene
    const oOf = async () => (await gql("query ($ids: [ID!]) { findScenes(ids: $ids) { scenes { o_counter } } }", { ids: [scene] })).data.findScenes.scenes[0].o_counter;
    const before = { o: await oOf(), sound: (await p.evaluate(state)).sound };
    await tap(Math.round(width * 0.45), Math.round(height * 0.4));
    await sleep(110);
    await tap(Math.round(width * 0.45) + 6, Math.round(height * 0.4) + 4);
    await sleep(150);
    const bursts = await p.evaluate("document.querySelectorAll('.sst-burst').length");
    await p.shot(`${name}${TAG}-double-tap`);
    await sleep(900);
    g.doubleTap = { scene, oBefore: before.o, oAfter: await oOf(), shown: await p.evaluate("document.querySelector('.sst-slide[data-index=\"' + stashShorts.index + '\"] .sst-o').parentNode.querySelector('.sst-count').textContent"),
      bursts, soundBefore: before.sound, soundAfter: (await p.evaluate(state)).sound };
    // the check leaves the library as it was: the orgasm of the double tap is taken back (newest first)
    for (let k = 0; k < g.doubleTap.oAfter - g.doubleTap.oBefore; k++) await gql("mutation ($id: ID!) { sceneDeleteO(id: $id) { count } }", { id: scene });
    g.doubleTap.takenBack = (await oOf()) === before.o;
    await p.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: Math.round(width * 0.4), y: Math.round(height * 0.45) }] });
    await sleep(700);
    g.whileHeld = await p.evaluate(state);
    await p.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(300);
    g.afterRelease = await p.evaluate(state);
    await tap(Math.round(width * 0.5), height - 4);
    await sleep(200);
    g.afterBarTapAtHalf = await p.evaluate(state);
    r.gestures = g;
  }

  // counter-check: the format of every loaded scene, from GraphQL (not from what the plugin says)
  // (a marker entry is checked as its scene)
  const ids = [...new Set(await p.evaluate("stashShorts.scenes.map((s) => s.sceneId)"))];
  const files = (await gql("query ($ids: [ID!]) { findScenes(ids: $ids, filter: { per_page: -1 }) { scenes { id files { width height } } } }", { ids })).data.findScenes.scenes;
  r.formatCheck = {
    loaded: ids.length, checked: files.length,
    notPortrait: files.filter((s) => !s.files[0] || s.files[0].width >= s.files[0].height).map((s) => s.id),
  };
  if (LANDSCAPE) r.landscapeSlide = wide;

  r.contexts = await contexts(p, width, height, touch, step);

  r.sheet = await sheetCheck(p, name, touch);
  r.column = await columnCheck(p, name);
  if (process.env.ACTIONS && !touch) r.actions = await actions(p);
  p.ws.close();
  return r;
}

// the action column and caption of the current slide: what is there, every target at least 44 px; the splash
// (at most one per button, gone after 1.5 s); Share by the clipboard and by hand (no secure context); More
async function columnCheck(p, name) {
  const cur = "document.querySelector('.sst-slide.sst-current')";
  const out = await p.evaluate(`(function () {
    var s = ${cur}, small = [];
    s.querySelectorAll('.sst-actions button, .sst-actions a, .sst-fav, .sst-subscribe, .sst-text, .sst-creator-name').forEach(function (b) {
      var r = b.getBoundingClientRect();
      if (!b.offsetParent) return; // hidden (the stars until the star button opens them)
      if (r.width < 44 || r.height < 44) small.push(b.className + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    });
    return { column: [...s.querySelectorAll('.sst-actions > .sst-action')].map(function (a) { var b = a.querySelector('button'); return b && b.className.replace('sst-btn ', ''); }),
      creator: !!s.querySelector('.sst-creator-row'), subscribe: s.querySelector('.sst-subscribe') && s.querySelector('.sst-subscribe').textContent,
      under44: small };
  })()`);
  // the caption: the post text hidden until a tap on the title unfolds it
  const textShown = () => p.evaluate(`(function () { var d = ${cur}.querySelector('.sst-details'); return d ? d.offsetHeight > 0 : null; })()`);
  out.unfold = { before: await textShown() };
  await p.evaluate(`${cur}.querySelector('.sst-text') && ${cur}.querySelector('.sst-text').click()`);
  out.unfold.afterTap = await textShown();
  await p.evaluate(`${cur}.querySelector('.sst-text') && ${cur}.querySelector('.sst-text').click()`);
  out.unfold.afterSecondTap = await textShown();
  // splash: three fast taps on the drop button give one splash; it is gone after 1.5 s. The orgasm it adds
  // is read back from GraphQL (once the request has come back) and taken back there.
  const oScene = await p.evaluate(`stashShorts.scenes[stashShorts.index].sceneId`);
  const oNow = async () => (await gql("query ($ids: [ID!]) { findScenes(ids: $ids) { scenes { o_counter } } }", { ids: [oScene] })).data.findScenes.scenes[0].o_counter;
  const o0 = await oNow();
  await p.evaluate(`(function () { var b = ${cur}.querySelector('.sst-o'); b.click(); b.click(); b.click(); })()`);
  await sleep(250);
  out.splash = await p.evaluate("({ nodes: document.querySelectorAll('.sst-splash').length, drops: document.querySelectorAll('.sst-splash svg').length })");
  await p.shot(`${name}${TAG}-8-splash`);
  await sleep(1500);
  out.splash.afterMs1750 = await p.evaluate("document.querySelectorAll('.sst-splash').length");
  await p.waitFor(`!${cur}.querySelector('.sst-o').disabled`, 5000);
  out.splash.oAdded = (await oNow()) - o0;
  for (let k = 0; k < out.splash.oAdded; k++) await gql("mutation ($id: ID!) { sceneDeleteO(id: $id) { count } }", { id: oScene });
  await p.evaluate("stashShorts.hideUndo && stashShorts.hideUndo()");
  out.oBack = (await oNow()) === o0;
  // Share (in More): the clipboard (secure context here) or the sheet by hand
  const share = `(function () { ${cur}.querySelector('.sst-more').click(); [...document.querySelectorAll('.sst-dialog .sst-item')].find((b) => b.textContent === 'Share').click(); })()`;
  out.shareInColumn = await p.evaluate(`!!${cur}.querySelector('.sst-actions .sst-share')`);
  await p.evaluate(share);
  await sleep(400);
  out.shareSecure = await p.evaluate("({ toast: document.querySelector('.sst-flash').textContent, sheet: !!document.querySelector('.sst-dialog input') })");
  if (out.shareSecure.sheet) await p.evaluate("stashShorts.dialog.close()");
  await p.evaluate("Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true }); window.__share = navigator.share; try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch (e) {} 0");
  await p.evaluate(share);
  await sleep(400);
  out.shareByHand = await p.evaluate("({ sheet: !!document.querySelector('.sst-dialog input'), value: document.querySelector('.sst-dialog input') && document.querySelector('.sst-dialog input').value, selected: document.activeElement && document.activeElement.selectionEnd > 0 })");
  await p.shot(`${name}${TAG}-9-share`);
  await p.evaluate("stashShorts.dialog && stashShorts.dialog.close(); Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true }); 0");
  // the profile button: the picture opens the profile, the browser's back closes it
  const pid = await p.evaluate(`(function () { var x = ${cur}.querySelector('.sst-profile-pic'); return x ? x.title : null; })()`);
  if (pid) {
    out.badge = await p.evaluate(`!!${cur}.querySelector('.sst-sub-badge')`); // gone (subscribing is the pill)
    await p.evaluate(`${cur}.querySelector('.sst-profile-pic').click()`);
    out.profileFromPic = !!(await p.waitFor("document.querySelector('.sst-profile') && location.search.indexOf('profile=') >= 0", 4000));
    await p.evaluate("history.back()");
    await p.waitFor("!document.querySelector('.sst-profile')", 4000);
    await sleep(400);
  }
  // More
  await p.evaluate(`${cur}.querySelector('.sst-more').click()`);
  await sleep(400);
  out.more = await p.evaluate("[...document.querySelectorAll('.sst-dialog .sst-item')].map(function (b) { return b.textContent; })");
  await p.shot(`${name}${TAG}-10-more`);
  await p.evaluate("stashShorts.dialog && stashShorts.dialog.close()");
  await sleep(300);
  return out;
}

// the sheet (here the filter dialog): it pauses the video, a drag down on its head (touch) or Esc (desktop)
// closes it, and the video plays on
async function sheetCheck(p, name, touch) {
  const playing = "!!(stashShorts.currentVideo() && !stashShorts.currentVideo().paused)";
  const before = await p.evaluate(playing);
  await p.evaluate("document.querySelector('.sst-filter').click()");
  await p.waitFor("document.querySelector('.sst-dialog .sst-check')", 5000);
  await sleep(600);
  const open = await p.evaluate(`({ open: !!document.querySelector('.sst-dialog'), paused: !${playing}, handle: getComputedStyle(document.querySelector('.sst-handle')).display !== 'none' })`);
  await p.shot(`${name}${TAG}-3-dialog`);
  if (touch) {
    const h = await p.evaluate("(function () { var r = document.querySelector('.sst-dialog-head h2').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()");
    for (let k = 0; k <= 8; k++) {
      await p.send("Input.dispatchTouchEvent", { type: k ? "touchMove" : "touchStart", touchPoints: [{ x: h.x, y: h.y + k * 20 }] });
      await sleep(30);
    }
    await p.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await p.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await p.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  }
  const closed = !!(await p.waitFor("!document.querySelector('.sst-dialog') && !stashShorts.dialog", 3000));
  const playsAgain = before ? !!(await p.waitFor(playing, 3000)) : null;
  return { ...open, closedBy: touch ? "drag down 160px" : "Escape", closed, playsAgain, stillOnPage: await p.evaluate("location.pathname.endsWith('/shorts')") };
}

// sideways: the performer channel and back (see the header)
async function contexts(p, width, height, touch, vstep) {
  const S = "stashShorts";
  const key = `(${S}.ctx.kind === 'performer' ? 'performer:' + ${S}.ctx.id : 'all')`;
  const state = () => p.evaluate(`({ key: ${key}, index: ${S}.index, scene: ${S}.scenes[${S}.index] && ${S}.scenes[${S}.index].id,
    loaded: ${S}.scenes.length, total: ${S}.total, label: document.querySelector('.sst-context').textContent.trim(),
    url: location.pathname + location.search, depth: ${S}.stack.depth(), videos: document.querySelectorAll('video').length,
    withSrc: [...document.querySelectorAll('video')].filter((v) => v.getAttribute('src')).length,
    playing: !!(${S}.currentVideo() && !${S}.currentVideo().paused) })`);
  const start = await p.evaluate("performance.now()");
  let maxVideos = 0;
  // time from the change of context until the current video's time moves on
  const watch = () => p.evaluate(`(function () {
    var k0 = ${key}, t0 = null, last = null; window.__ctxFrame = null;
    (function f() {
      var v = ${S}.currentVideo();
      if (${key} !== k0) {
        if (t0 == null) t0 = performance.now();
        if (v && !v.paused && last != null && v.currentTime > last) { window.__ctxFrame = Math.round(performance.now() - t0); return; }
        last = v ? v.currentTime : null;
      }
      requestAnimationFrame(f);
    })();
  })()`);
  // drags inside the portrait column (on wide screens it is narrower than the window)
  const sw = await p.evaluate("document.querySelector('.sst-stage').clientWidth");
  const swipe = async (dx, dy) => {
    const x0 = Math.round(width / 2 - dx / 2), y0 = Math.round(height * 0.55 - dy / 2);
    for (let k = 0; k <= 8; k++) {
      const x = Math.round(x0 + (dx * k) / 8), y = Math.round(y0 + (dy * k) / 8);
      if (touch) await p.send("Input.dispatchTouchEvent", { type: k ? "touchMove" : "touchStart", touchPoints: [{ x, y }] });
      else await p.send("Input.dispatchMouseEvent", { type: k ? "mouseMoved" : "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
      await sleep(16);
    }
    if (touch) await p.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    else await p.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(x0 + dx), y: Math.round(y0 + dy), button: "left", buttons: 0, clickCount: 1 });
  };
  const key2 = async (k) => {
    const code = k === "ArrowRight" ? 39 : 37;
    await p.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: code });
    await p.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: code });
  };
  // one change of context: the gesture, then the plugin's timing, the frame watcher and the state after it
  const change = async (name, act) => {
    const n = await p.evaluate(`${S}.timing.contexts.length`);
    await watch();
    await act();
    await p.waitFor(`${S}.timing.contexts.length > ${n}`, 4000);
    const frameMs = await p.waitFor("window.__ctxFrame", 4000);
    await p.waitFor(`${S}.loading == null`, 4000);
    await sleep(300);
    const st = await state();
    maxVideos = Math.max(maxVideos, st.videos);
    const timing = await p.evaluate(`${S}.timing.contexts.slice(${n})`);
    return { step: name, pluginMs: timing.map((x) => x.ms), keptVideo: timing.map((x) => x.kept), frameAdvanceMs: frameMs, ...st };
  };
  // the counter-check of a channel: every loaded scene has the performer, the count is right
  const channelCheck = async (pid) => {
    const ids = [...new Set(await p.evaluate(`${S}.scenes.map((s) => s.sceneId)`))];
    const got = (await gql("query ($ids: [ID!]) { findScenes(ids: $ids, filter: { per_page: -1 }) { scenes { id files { width height } performers { id } } } }", { ids })).data.findScenes.scenes;
    const all = (await gql("query ($s: SceneFilterType) { findScenes(scene_filter: $s, filter: { per_page: -1 }) { count } }", { s: { performers: { value: [pid], modifier: "INCLUDES" }, orientation: { value: ["PORTRAIT"] } } })).data.findScenes.count;
    return {
      performer: pid, loaded: ids.length, checked: got.length, portraitScenesOfPerformer: all,
      withoutPerformer: got.filter((s) => !s.performers.some((x) => x.id === pid)).map((s) => s.id),
      notPortrait: got.filter((s) => !s.files[0] || s.files[0].width >= s.files[0].height).map((s) => s.id),
    };
  };
  const out = { steps: [] };
  // start on a scene with a performer
  for (let i = 0; i < 10 && !(await p.evaluate(`${S}.scenes[${S}.index].performers.length`)); i++) { await vstep(1, 0); await sleep(400); }
  await sleep(400);

  // oblique: 30 degrees to the left and up, 60 % of the width
  const L = sw * 0.6, before0 = await state();
  await swipe(-L * Math.cos(Math.PI / 6), -L * Math.sin(Math.PI / 6));
  await sleep(600);
  const ob = await state();
  out.oblique30 = { before: before0.key, after: ob.key, contextChanged: ob.key !== before0.key, depth: ob.depth, sceneBefore: before0.scene, sceneAfter: ob.scene };
  for (let i = 0; i < 10 && !(await p.evaluate(`${S}.scenes[${S}.index].performers.length`)); i++) { await vstep(1, 0); await sleep(400); }
  await sleep(300);

  // left into the channel
  const before = await state();
  const cast = await p.evaluate(`${S}.scenes[${S}.index].performers.map((x) => ({ id: x.id, name: x.name, favorite: x.favorite }))`);
  const into = await change(touch ? "swipe left" : "mouse drag left", () => swipe(-sw * 0.5, 0));
  await p.shot(`${touch ? "phone" : "desktop"}${TAG}-6-channel`);
  out.steps.push(into);
  out.cast = cast;
  if (into.key.startsWith("performer:")) out.channel = await channelCheck(into.key.slice(10));
  out.channelStartsWithScene = into.scene === before.scene;
  // two steps down inside the channel (when there are more scenes)
  for (let i = 0; i < 2; i++) { await vstep(1, i); await sleep(500); }
  const deep = await state();
  out.inChannelAfterTwoSteps = { index: deep.index, scene: deep.scene, key: deep.key };
  maxVideos = Math.max(maxVideos, deep.videos);
  // back to the right
  const back = await change(touch ? "swipe right" : "ArrowLeft", () => (touch ? swipe(sw * 0.5, 0) : key2("ArrowLeft")));
  out.steps.push(back);
  out.backAtSamePlace = back.key === before.key && back.index === before.index && back.scene === before.scene && back.url === before.url;
  await p.shot(`${touch ? "phone" : "desktop"}${TAG}-7-back`);

  // avatar (touch) or ArrowRight (desktop) into the channel, the browser's back button out of it
  const before2 = await state();
  const into2 = await change(touch ? "swipe left" : "ArrowRight", () => (touch ? swipe(-sw * 0.5, 0) : key2("ArrowRight")));
  out.steps.push(into2);
  const back2 = await change("browser back", () => p.evaluate("history.back()"));
  out.steps.push(back2);
  out.browserBackAtSamePlace = back2.key === before2.key && back2.index === before2.index && back2.scene === before2.scene && back2.url === before2.url;

  const lt = await p.evaluate("window.__longTasks");
  const long = lt.filter((x) => x.start >= start).map((x) => Math.round(x.dur));
  out.maxVideoElements = maxVideos;
  out.longTasks = { count: long.length, maxMs: long.length ? Math.max(...long) : 0 };
  return out;
}

// channel links and several performers in one scene (see the header)
async function channelLinks() {
  const width = 390, height = 844, S = "stashShorts";
  const portrait = (await gql("query ($s: SceneFilterType) { findScenes(scene_filter: $s, filter: { per_page: -1 }) { scenes { id performers { id name favorite } } } }", { s: { orientation: { value: ["PORTRAIT"] } } })).data.findScenes.scenes;
  const count = {};
  portrait.forEach((sc) => sc.performers.forEach((x) => { count[x.id] = (count[x.id] || 0) + 1; }));
  const p = await page();
  await p.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
  await p.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const key = `(${S}.ctx.kind === 'performer' ? 'performer:' + ${S}.ctx.id : 'all')`;
  const state = () => p.evaluate(`({ key: ${key}, index: ${S}.index, scene: ${S}.scenes[${S}.index] && ${S}.scenes[${S}.index].id, loaded: ${S}.scenes.length,
    depth: ${S}.stack.depth(), label: document.querySelector('.sst-context').textContent.trim(), url: location.pathname + location.search,
    hint: document.querySelector('.sst-flash.sst-show') ? document.querySelector('.sst-flash').textContent : null })`);
  const swipe = async (dx) => {
    const x0 = Math.round(width / 2 - dx / 2), y = Math.round(height * 0.55);
    for (let k = 0; k <= 8; k++) {
      await p.send("Input.dispatchTouchEvent", { type: k ? "touchMove" : "touchStart", touchPoints: [{ x: Math.round(x0 + (dx * k) / 8), y }] });
      await sleep(16);
    }
    await p.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(500);
    await p.waitFor(`${S}.loading == null`, 4000);
    return state();
  };
  const open = async (id) => {
    await p.send("Page.navigate", { url: `${BASE}/shorts?performer=${id}` });
    await p.waitFor(`window.${S} && ${S}.timing.firstPlay != null && ${S}.ctx.name`, 15000);
    await sleep(300);
  };
  const out = {};
  // a performer with a single portrait scene: the hint, then back = all scenes
  const single = Object.keys(count).find((id) => count[id] === 1);
  if (single) {
    await open(single);
    const st = await state();
    await p.shot(`phone${TAG}-8-channel-only`);
    const back = await swipe(Math.round(width * 0.5));
    // all scenes start with that scene: a swipe to the left opens the channel again, with the hint
    const again = await swipe(-Math.round(width * 0.5));
    await p.shot(`phone${TAG}-9-channel-only-swiped`);
    out.singleScene = { performer: single, opened: st, backFromLink: { key: back.key, url: back.url, label: back.label, depth: back.depth, scene: back.scene },
      swipedIn: { key: again.key, loaded: again.loaded, depth: again.depth, hint: again.hint } };
  } else out.singleScene = "no performer with a single portrait scene";
  // several performers: from A's channel to the next one of the scene and the one after, then back twice
  const duo = portrait.find((sc) => sc.performers.length >= 2);
  if (duo) {
    await open(duo.performers[0].id);
    for (let i = 0; i < 20 && (await p.evaluate(`${S}.scenes[${S}.index].performers.length`)) < 2; i++) {
      await p.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
      await p.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
      await sleep(400);
    }
    const start = await state();
    const cast = await p.evaluate(`${S}.scenes[${S}.index].performers.map((x) => ({ id: x.id, favorite: x.favorite }))`);
    const first = await swipe(-Math.round(width * 0.5));
    const second = await swipe(-Math.round(width * 0.5));
    const back1 = await swipe(Math.round(width * 0.5));
    const back2 = await swipe(Math.round(width * 0.5));
    out.severalPerformers = {
      start: { key: start.key, scene: start.scene, index: start.index }, cast,
      firstLeft: { key: first.key, scene: first.scene, depth: first.depth }, secondLeft: { key: second.key, scene: second.scene, depth: second.depth },
      backOnce: { key: back1.key, scene: back1.scene }, backTwice: { key: back2.key, scene: back2.scene, index: back2.index, depth: back2.depth },
      backAtStart: back2.key === start.key && back2.scene === start.scene && back2.index === start.index,
    };
  }
  // a link to one scene (Share): the feed starts with it, also a scene outside the filter (landscape), the
  // address drops scene=, and an unknown id gives a hint and the feed as usual
  const link = async (id) => {
    await p.send("Page.navigate", { url: `${BASE}/shorts?scene=${id}` });
    await p.waitFor(`window.${S} && ${S}.scenes.length && document.querySelector('.sst-slide')`, 15000);
    await sleep(600);
    const st = await state();
    return { id: String(id), first: await p.evaluate(`${S}.scenes[0] && ${S}.scenes[0].sceneId`), index: st.index, url: st.url, loaded: st.loaded,
      toast: await p.evaluate("[...document.querySelectorAll('.sst-flash')].map((x) => x.textContent).join(' ')") };
  };
  const wide = (await gql("query ($s: SceneFilterType) { findScenes(scene_filter: $s, filter: { per_page: 1 }) { scenes { id } } }", { s: { orientation: { value: ["LANDSCAPE"] } } })).data.findScenes.scenes[0];
  const portraitLink = await link(portrait[portrait.length - 1].id);
  const wideLink = wide ? await link(wide.id) : null;
  const missing = await link(987654321);
  out.sceneLinks = {
    portrait: portraitLink, landscape: wideLink, missing,
    ok: portraitLink.first === portraitLink.id && !/scene=/.test(portraitLink.url) && (!wideLink || wideLink.first === wideLink.id) &&
      missing.first !== missing.id && missing.loaded > 0,
  };
  out.pageErrors = p.errors;
  p.ws.close();
  return out;
}

// The detail sheet (phone): opened from the marker count of a scene with markers (linked with scene=), the
// time to its rows, the rows against GraphQL; a marker row seeks the scene; in a marker clip a row of
// another marker turns the clip into its whole scene from that time; a tag filters the feed.
async function detailSheet() {
  const width = 390, height = 844, S = "stashShorts";
  const ms = (await gql("{ findSceneMarkers(filter: { per_page: -1 }) { scene_markers { id seconds scene { id files { width height } } } } }")).data.findSceneMarkers.scene_markers
    .filter((m) => m.scene.files[0] && m.scene.files[0].width < m.scene.files[0].height);
  const by = {};
  ms.forEach((m) => (by[m.scene.id] = by[m.scene.id] || []).push(m));
  const sceneId = Object.keys(by).sort((a, b) => by[b].length - by[a].length)[0];
  if (!sceneId) return { skipped: "no markers in portrait scenes" };
  const p = await page();
  await p.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
  await p.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await p.send("Page.navigate", { url: `${BASE}/shorts?scene=${sceneId}` });
  await p.waitFor(`window.${S} && ${S}.timing.firstPlay != null`, 15000);
  await sleep(500);
  const cur = "document.querySelector('.sst-slide.sst-current')";
  const out = { scene: sceneId, markersInGraphQL: by[sceneId].length, count: await p.evaluate(`${cur}.querySelector('.sst-markers + .sst-count').textContent`) };
  const t0 = await p.evaluate("performance.now()");
  await p.evaluate(`${cur}.querySelector('.sst-markers').click()`);
  await p.waitFor("document.querySelectorAll('.sst-dialog [data-marker]').length", 5000);
  out.openMs = Math.round((await p.evaluate("performance.now()")) - t0);
  out.rows = await p.evaluate("document.querySelectorAll('.sst-dialog [data-marker]').length");
  out.keepsPlaying = await p.evaluate(`!${S}.currentVideo().paused`);
  await p.shot(`phone${TAG}-11-details`);
  // a marker of the scene: the video seeks there
  const target = by[sceneId].slice().sort((a, b) => b.seconds - a.seconds)[0];
  await p.evaluate(`document.querySelector('.sst-dialog [data-marker="${target.id}"]').click()`);
  await sleep(700);
  out.seek = { marker: target.id, seconds: target.seconds, currentTime: await p.evaluate(`${S}.currentVideo().currentTime`), sheetClosed: await p.evaluate("!document.querySelector('.sst-dialog')") };
  out.seek.ok = out.seek.sheetClosed && Math.abs(out.seek.currentTime - target.seconds) < 1;
  // a marker clip of the scene, then another marker of it: the whole scene from there
  const clip = await p.evaluate(`${S}.scenes.findIndex((e) => e.marker && e.sceneId === ${JSON.stringify(sceneId)})`);
  if (clip >= 0 && by[sceneId].length > 1) {
    await p.evaluate(`${S}.go(${clip})`);
    await sleep(900);
    const here = await p.evaluate(`${S}.scenes[${S}.index].marker.id`);
    const other = by[sceneId].find((m) => String(m.id) !== String(here));
    const len = await p.evaluate(`${S}.scenes.length`);
    await p.evaluate(`${cur}.querySelector('.sst-markers').click()`);
    await p.waitFor("document.querySelectorAll('.sst-dialog [data-marker]').length", 5000);
    await p.evaluate(`document.querySelector('.sst-dialog [data-marker="${other.id}"]').click()`);
    await p.waitFor(`${S}.currentVideo() && !${S}.currentVideo().paused && ${S}.currentVideo().currentTime > 0`, 5000);
    await sleep(500);
    out.fromClip = {
      clip: here, picked: other.id, seconds: other.seconds, entry: await p.evaluate(`${S}.scenes[${S}.index].id`),
      currentTime: await p.evaluate(`${S}.currentVideo().currentTime`), sameLength: (await p.evaluate(`${S}.scenes.length`)) === len,
      videos: await p.evaluate("document.querySelectorAll('video').length"),
    };
    out.fromClip.ok = /^j/.test(out.fromClip.entry) && out.fromClip.sameLength && Math.abs(out.fromClip.currentTime - other.seconds) < 1.5 && out.fromClip.videos <= 3;
  }
  // a tag: the feed filtered by it
  await p.evaluate(`${cur}.querySelector('.sst-markers').click()`);
  await p.waitFor("document.querySelector('.sst-dialog [data-tab=tags]')", 5000);
  await p.evaluate("document.querySelector('.sst-dialog [data-tab=tags]').click()");
  await p.waitFor("document.querySelector('.sst-dialog .sst-tag-chip') || document.querySelector('.sst-dialog .sst-muted')", 5000);
  const tag = (await gql("query ($id: ID!) { findScene(id: $id) { tags { id } } }", { id: await p.evaluate(`${S}.scenes[${S}.index].sceneId`) })).data.findScene.tags[0];
  if (tag) {
    await p.evaluate("document.querySelector('.sst-dialog .sst-tag-chip').click()");
    await p.waitFor(`${S}.scenes.length && !${S}.loading`, 8000);
    await sleep(500);
    out.tag = { id: tag.id, filter: await p.evaluate(`${S}.filter.tags`), url: await p.evaluate("location.search") };
    out.tag.ok = out.tag.filter === String(tag.id);
  }
  out.pageErrors = p.errors;
  p.ws.close();
  return out;
}

// The creator profile (phone): opened by the name in the caption (time to the first post), the posts in
// date order and, scrolled to the end, as many as GraphQL has scenes in the format plus galleries; Media and
// Favorites; no video element in it; the browser's back closes it at the same scene; a post opens the
// channel at that scene, and back returns to all scenes.
async function profileCheck() {
  const width = 390, height = 844, S = "stashShorts";
  const p = await page();
  await p.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
  await p.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await p.send("Page.navigate", { url: `${BASE}/shorts` });
  await p.waitFor(`window.${S} && ${S}.timing.firstPlay != null`, 15000);
  for (let i = 0; i < 10 && !(await p.evaluate(`${S}.scenes[${S}.index].performers.length`)); i++) { await p.evaluate(`${S}.go(${S}.index + 1)`); await sleep(500); }
  await sleep(400);
  const cur = "document.querySelector('.sst-slide.sst-current')";
  const before = await p.evaluate(`({ scene: ${S}.scenes[${S}.index].id, url: location.search })`);
  const pid = await p.evaluate(`${S}.profileView ? null : (${S}.scenes[${S}.index].performers.find((x) => x.name === ${cur}.querySelector('.sst-creator-name').textContent) || {}).id`);
  const t0 = await p.evaluate("performance.now()");
  await p.evaluate(`${cur}.querySelector('.sst-creator-name').click()`);
  await p.waitFor("document.querySelector('.sst-profile .sst-post, .sst-profile .sst-empty')", 8000);
  const out = { performer: pid, firstPostMs: Math.round((await p.evaluate("performance.now()")) - t0), url: await p.evaluate("location.search") };
  // to the end of the posts
  for (let k = 0; k < 40; k++) {
    const n = await p.evaluate("document.querySelectorAll('.sst-profile .sst-post').length");
    await p.evaluate("(function (s) { s.scrollTop = s.scrollHeight; })(document.querySelector('.sst-profile-scroll'))");
    await sleep(350);
    if ((await p.evaluate("document.querySelectorAll('.sst-profile .sst-post').length")) === n) break;
  }
  const posts = await p.evaluate("[...document.querySelectorAll('.sst-profile .sst-post')].map((x) => x.getAttribute('data-post'))");
  const sceneIds = posts.filter((x) => !/^g/.test(x));
  const dates = (await gql("query ($ids: [ID!]) { findScenes(ids: $ids, filter: { per_page: -1 }) { scenes { id date } } }", { ids: sceneIds })).data.findScenes.scenes;
  const galleries = (await gql("query ($g: GalleryFilterType) { findGalleries(gallery_filter: $g, filter: { per_page: -1 }) { count galleries { id date } } }", { g: { performers: { value: [pid], modifier: "INCLUDES" } } })).data.findGalleries;
  const dateOf = {};
  dates.forEach((x) => (dateOf[x.id] = x.date || ""));
  galleries.galleries.forEach((x) => (dateOf["g" + x.id] = x.date || ""));
  const seq = posts.map((x) => dateOf[x] ?? "?");
  const scenesInFormat = (await gql("query ($s: SceneFilterType) { findScenes(scene_filter: $s, filter: { per_page: 1 }) { count } }", { s: { performers: { value: [pid], modifier: "INCLUDES" }, orientation: { value: ["PORTRAIT"] } } })).data.findScenes.count;
  out.posts = { shown: posts.length, expected: scenesInFormat + galleries.count, unique: new Set(posts).size === posts.length,
    dateOrder: seq.every((d, i) => i === 0 || d === "" || (seq[i - 1] !== "" && seq[i - 1] >= d)), firstDates: seq.slice(0, 6) };
  out.stats = await p.evaluate("[...document.querySelectorAll('.sst-profile .sst-stat strong')].map((x) => x.textContent)");
  out.posts.statMatches = out.stats[0] === String(out.posts.expected);
  out.videosInProfile = await p.evaluate("document.querySelectorAll('.sst-profile video').length");
  out.videosInPage = await p.evaluate("document.querySelectorAll('video').length");
  await p.evaluate("document.querySelector('.sst-profile-scroll').scrollTop = 0");
  await sleep(200);
  await p.shot(`phone${TAG}-12-profile`);
  for (const tab of ["media", "favorites"]) {
    await p.evaluate(`document.querySelector('.sst-profile [data-tab=${tab}]').click()`);
    await p.waitFor("document.querySelector('.sst-profile .sst-tile, .sst-profile .sst-empty')", 6000);
    out[tab] = await p.evaluate("document.querySelectorAll('.sst-profile .sst-tile').length");
  }
  await p.shot(`phone${TAG}-13-profile-media`);
  // the browser's back closes it, the feed is where it was
  await p.evaluate("history.back()");
  await p.waitFor("!document.querySelector('.sst-profile')", 4000);
  await sleep(300);
  const afterBack = await p.evaluate(`({ scene: ${S}.scenes[${S}.index].id, url: location.search, profile: !!${S}.profileView, gestures: !${S}.dialog })`);
  out.back = { ...afterBack, ok: afterBack.scene === before.scene && afterBack.url === before.url && !afterBack.profile && afterBack.gestures };
  // a post: the channel at that scene; back: all scenes
  await p.evaluate(`${cur}.querySelector('.sst-creator-name').click()`);
  await p.waitFor("document.querySelector('.sst-profile .sst-post')", 8000);
  const first = await p.evaluate("(function () { var x = [...document.querySelectorAll('.sst-profile .sst-post')].find((a) => !/^g/.test(a.getAttribute('data-post'))); x.querySelector('.sst-post-media').click(); return x.getAttribute('data-post'); })()");
  await p.waitFor(`${S}.ctx.kind === 'performer' && ${S}.currentVideo() && !${S}.currentVideo().paused`, 6000);
  await sleep(400);
  out.toChannel = await p.evaluate(`({ post: ${JSON.stringify(first)}, scene: ${S}.scenes[${S}.index].id, ctx: ${S}.ctx.kind + ':' + ${S}.ctx.id, url: location.search, profile: !!document.querySelector('.sst-profile') })`);
  out.toChannel.ok = out.toChannel.scene === first && out.toChannel.ctx === "performer:" + pid && !out.toChannel.profile;
  await p.evaluate("history.back()");
  await sleep(900);
  out.backFromChannel = await p.evaluate(`({ ctx: ${S}.ctx.kind, url: location.search, scene: ${S}.scenes[${S}.index].id })`);
  out.backFromChannel.ok = out.backFromChannel.ctx === "all" && out.backFromChannel.scene === before.scene;
  // the links of a performer who has some, as Stash's buttons: one per group, a menu that opens and closes
  const withUrls = (await gql("{ findPerformers(filter: { per_page: -1 }) { performers { id urls } } }")).data.findPerformers.performers.filter((x) => (x.urls || []).some((u) => /^https?:/.test(u)));
  if (withUrls.length) {
    const most = withUrls.sort((a, b) => b.urls.length - a.urls.length)[0];
    const groups = ["link", "twitter", "instagram"].filter((k) => most.urls.some((u) => (k === "twitter" ? /^https?:\/\/(www\.)?(twitter|x)\.com\//i : k === "instagram" ? /^https?:\/\/(www\.)?instagram\.com\//i : /^https?:/).test(u) &&
      (k !== "link" || !/^https?:\/\/(www\.)?((twitter|x)\.com|instagram\.com)\//i.test(u))));
    await p.send("Page.navigate", { url: `${BASE}/shorts?profile=${most.id}` });
    await p.waitFor("document.querySelector('.sst-profile .sst-profile-name')", 10000);
    await sleep(400);
    const buttons = await p.evaluate("document.querySelectorAll('.sst-profile .external-links-button').length");
    await p.evaluate("document.querySelector('.sst-profile .external-links-button button').click()");
    await sleep(200);
    const open = await p.evaluate("({ shown: !!document.querySelector('.sst-profile .dropdown-menu.show'), items: document.querySelectorAll('.sst-profile .dropdown-menu.show .dropdown-item').length, expanded: document.querySelector('.sst-profile .external-links-button button').getAttribute('aria-expanded') })");
    await p.shot(`phone${TAG}-19-profile-links`);
    await p.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 60, y: 600 }] });
    await p.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(200);
    const closed = await p.evaluate("!document.querySelector('.sst-profile .dropdown-menu.show')");
    out.links = { performer: most.id, urls: most.urls.length, groups: groups.length, buttons, open, closedByTapOutside: closed,
      ok: buttons === groups.length && open.shown && open.items > 0 && open.expanded === "true" && closed };
  }
  out.pageErrors = p.errors;
  p.ws.close();
  return out;
}

// Galleries in the feed (phone, galleries on): the galleries loaded against GraphQL (those with pictures in
// the format); in one, at most three pictures with a source and no video added; a swipe to the left flips
// to the next picture, to the right back, past the last one into the channel; an orgasm counts on the
// picture shown (read back, then taken back); the rating on the gallery (and back); a link with gallery=.
async function galleryCheck() {
  const width = 390, height = 844, S = "stashShorts";
  const want = (await gql("query ($g: GalleryFilterType) { findGalleries(gallery_filter: $g, filter: { per_page: -1 }) { count galleries { id date } } }",
    { g: { image_count: { value: 0, modifier: "GREATER_THAN" }, images_filter: { orientation: { value: LANDSCAPE ? ["PORTRAIT", "LANDSCAPE", "SQUARE"] : ["PORTRAIT"] } } } })).data.findGalleries;
  if (!want.count) return { skipped: "no galleries with pictures in the format" };
  const p = await page();
  await p.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
  await p.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await p.send("Page.navigate", { url: `${BASE}/shorts` });
  await p.waitFor(`window.${S} && ${S}.scenes.length && document.querySelector('.sst-slide')`, 15000);
  const loaded = await p.evaluate(`(async function () { while (${S}.scenes.length < ${S}.total) await ${S}.loadPage(); return ${S}.scenes.filter((e) => e.kind === 'gallery').map((e) => e.galleryId); })()`);
  const ids = want.galleries.map((g) => String(g.id));
  const out = { inGraphQL: ids.length, loaded: loaded.length, same: loaded.slice().sort().join() === ids.slice().sort().join(), unique: new Set(loaded).size === loaded.length };
  // the gallery with the most pictures, shown
  const at = await p.evaluate(`${S}.scenes.findIndex((e) => e.kind === 'gallery')`);
  await p.evaluate(`${S}.go(${at})`);
  await p.waitFor(`${S}.scenes[${S}.index].images && document.querySelector('.sst-slide.sst-current .sst-pic img')`, 6000);
  await sleep(500);
  const cur = "document.querySelector('.sst-slide.sst-current')";
  const pics = () => p.evaluate(`({ at: ${S}.scenes[${S}.index].at, count: ${S}.scenes[${S}.index].images.length, withSrc: ${cur}.querySelectorAll('.sst-pic img[src]').length,
    label: ${cur}.querySelector('.sst-pic-count').textContent, videos: document.querySelectorAll('video').length, ctx: ${S}.ctx.kind, gallery: ${S}.scenes[${S}.index].galleryId })`);
  out.shown = await pics();
  await p.shot(`phone${TAG}-14-gallery`);
  const swipe = async (dx) => {
    const x0 = Math.round(width / 2 - dx / 2), y = Math.round(height * 0.45);
    for (let k = 0; k <= 8; k++) {
      await p.send("Input.dispatchTouchEvent", { type: k ? "touchMove" : "touchStart", touchPoints: [{ x: Math.round(x0 + (dx * k) / 8), y }] });
      await sleep(16);
    }
    await p.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(450);
    return pics().catch(() => p.evaluate(`({ ctx: ${S}.ctx.kind, gallery: ${S}.scenes[${S}.index].galleryId || null })`));
  };
  const next = await swipe(-200), back = await swipe(200);
  out.flip = { next: next.at, back: back.at, ctxUnchanged: next.ctx === "all" && back.ctx === "all", withSrcMax: Math.max(out.shown.withSrc, next.withSrc, back.withSrc) };
  // an orgasm on the picture shown, read back, taken back
  const img = await p.evaluate(`${S}.scenes[${S}.index].images[${S}.scenes[${S}.index].at].id`);
  const oOf = async () => (await gql("query ($id: ID!) { findImage(id: $id) { o_counter } }", { id: img })).data.findImage.o_counter;
  const o0 = await oOf();
  await p.evaluate(`${cur}.querySelector('.sst-o').click()`);
  await sleep(500);
  const o1 = await oOf();
  await p.evaluate(`document.querySelector('.sst-undo .sst-pill') && document.querySelector('.sst-undo .sst-pill').click()`);
  await sleep(500);
  out.orgasm = { image: img, before: o0, after: o1, afterUndo: await oOf(), label: await p.evaluate(`${cur}.querySelector('.sst-o + .sst-count').textContent`) };
  out.orgasm.ok = o1 === o0 + 1 && out.orgasm.afterUndo === o0;
  // the rating on the gallery, and back
  const gid = out.shown.gallery;
  const rOf = async () => (await gql("query ($id: ID!) { findGallery(id: $id) { rating100 } }", { id: gid })).data.findGallery.rating100;
  const r0 = await rOf(), wantStars = r0 === 60 ? 4 : 3;
  await p.evaluate(`${cur}.querySelector('.sst-rate').click()`);
  await p.evaluate(`${cur}.querySelectorAll('.sst-star')[${wantStars - 1}].click()`);
  await sleep(500);
  const r1 = await rOf();
  await gql("mutation ($i: GalleryUpdateInput!) { galleryUpdate(input: $i) { id } }", { i: { id: gid, rating100: r0 } });
  out.rating = { before: r0, after: r1, ok: r1 === wantStars * 20, restored: (await rOf()) === r0 };
  // past the last picture: the channel (when the gallery has a performer)
  const hasPerformer = await p.evaluate(`${S}.scenes[${S}.index].performers.length > 0`);
  let last = await pics();
  for (let k = last.at; k < last.count - 1; k++) last = await swipe(-200);
  const beyond = await swipe(-200);
  out.pastLast = { lastAt: last.at, count: last.count, ctxAfter: beyond.ctx, expected: hasPerformer ? "performer" : "all" };
  out.pastLast.ok = last.at === last.count - 1 && beyond.ctx === out.pastLast.expected;
  out.maxVideos = await p.evaluate("document.querySelectorAll('video').length");
  // a link to the gallery
  await p.send("Page.navigate", { url: `${BASE}/shorts?gallery=${gid}` });
  await p.waitFor(`window.${S} && ${S}.scenes.length && document.querySelector('.sst-slide')`, 15000);
  await sleep(400);
  out.link = await p.evaluate(`({ first: ${S}.scenes[0].galleryId || null, url: location.search })`);
  out.link.ok = out.link.first === gid && !/gallery=/.test(out.link.url);
  // from a gallery post in a profile: the channel, starting with the gallery
  const owner = (await gql("query ($id: ID!) { findGallery(id: $id) { performers { id } } }", { id: gid })).data.findGallery.performers[0];
  if (owner) {
    await p.send("Page.navigate", { url: `${BASE}/shorts?profile=${owner.id}` });
    await p.waitFor(`document.querySelector('.sst-profile [data-post="g${gid}"]')`, 10000);
    await p.evaluate(`document.querySelector('.sst-profile [data-post="g${gid}"] .sst-post-media').click()`);
    await p.waitFor(`${S}.ctx.kind === 'performer' && !document.querySelector('.sst-profile')`, 6000);
    await sleep(500);
    out.fromProfile = await p.evaluate(`({ ctx: ${S}.ctx.kind + ':' + ${S}.ctx.id, first: ${S}.scenes[${S}.index].galleryId || null, pics: document.querySelectorAll('.sst-slide.sst-current .sst-pic img[src]').length })`);
    out.fromProfile.ok = out.fromProfile.ctx === "performer:" + owner.id && out.fromProfile.first === gid && out.fromProfile.pics > 0;
  }
  out.pageErrors = p.errors;
  p.ws.close();
  return out;
}

// The modes at the bottom (phone): For you is on by default; New shows only unwatched scenes, newest first by
// date; Subscribed with nobody subscribed says so, with one performer subscribed only their scenes (the
// subscription is taken back at the end); the bar keeps clear of caption and column.
async function modeCheck() {
  const width = 390, height = 844, S = "stashShorts";
  const p = await page();
  await p.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
  await p.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await p.send("Page.navigate", { url: `${BASE}/shorts` });
  await p.waitFor(`window.${S} && ${S}.timing.firstPlay != null`, 15000);
  await sleep(400);
  const active = () => p.evaluate("(document.querySelector('.sst-mode.sst-on') || {}).getAttribute ? document.querySelector('.sst-mode.sst-on').getAttribute('data-mode') : null");
  const out = { modes: await p.evaluate("[...document.querySelectorAll('.sst-mode')].map((b) => b.textContent)"), start: await active() };
  out.layout = await p.evaluate(`(function () {
    var bar = document.querySelector('.sst-modes').getBoundingClientRect(), s = document.querySelector('.sst-slide.sst-current');
    var info = s.querySelector('.sst-info').getBoundingClientRect(), col = s.querySelector('.sst-actions').getBoundingClientRect();
    return { barTop: Math.round(bar.top), infoBottom: Math.round(info.bottom), columnBottom: Math.round(col.bottom), clear: info.bottom <= bar.top + 1 && col.bottom <= bar.top + 1 };
  })()`);
  await p.shot(`phone${TAG}-15-modes`);
  const tap = async (m) => {
    await p.evaluate(`document.querySelector('.sst-mode[data-mode=${m}]').click()`);
    await p.waitFor(`${S}.loading == null && (${S}.scenes.length || document.querySelector('.sst-message').textContent)`, 8000);
    await sleep(500);
    return p.evaluate(`({ mode: (document.querySelector('.sst-mode.sst-on') || { getAttribute: () => null }).getAttribute('data-mode'), url: location.search,
      ids: ${S}.scenes.filter((e) => !e.marker && !e.kind).map((e) => e.sceneId), message: document.querySelector('.sst-message').textContent })`);
  };
  // New: unwatched, by date
  const nu = await tap("new");
  const got = nu.ids.length ? (await gql("query ($ids: [ID!]) { findScenes(ids: $ids, filter: { per_page: -1 }) { scenes { id date play_count } } }", { ids: nu.ids })).data.findScenes.scenes : [];
  const byId = {};
  got.forEach((x) => (byId[x.id] = x));
  const dates = nu.ids.map((id) => (byId[id] || {}).date || "");
  out.new = { mode: nu.mode, url: nu.url, loaded: nu.ids.length, watched: got.filter((x) => x.play_count > 0).map((x) => x.id),
    dateOrder: dates.every((d, i) => i === 0 || d === "" || (dates[i - 1] !== "" && dates[i - 1] >= d)) };
  // Subscribed: nobody, then one performer
  const subs = (await gql("query ($f: PerformerFilterType) { findPerformers(performer_filter: $f, filter: { per_page: -1 }) { count } }", { f: { custom_fields: [{ field: "shorts_subscribed", modifier: "NOT_NULL" }] } })).data.findPerformers.count;
  const none = await tap("subscribed");
  out.subscribedNone = { before: subs, loaded: none.ids.length, message: none.message };
  await tap("forYou");
  const pid = await p.evaluate(`${S}.scenes[${S}.index].performers[0] && ${S}.scenes[${S}.index].performers[0].id`);
  if (pid) {
    await p.evaluate(`${S}.toggleSubscribe(${S}.performers[${JSON.stringify(pid)}])`);
    const one = await tap("subscribed");
    const casts = one.ids.length ? (await gql("query ($ids: [ID!]) { findScenes(ids: $ids, filter: { per_page: -1 }) { scenes { id performers { id } } } }", { ids: one.ids })).data.findScenes.scenes : [];
    out.subscribedOne = { performer: pid, mode: one.mode, url: one.url, loaded: one.ids.length, without: casts.filter((x) => !x.performers.some((q) => q.id === pid)).map((x) => x.id) };
    await p.evaluate(`${S}.toggleSubscribe(${S}.performers[${JSON.stringify(pid)}])`);
  }
  const back = await tap("forYou");
  out.backToForYou = back.mode;
  out.ok = out.start === "forYou" && out.layout.clear && out.new.mode === "new" && !out.new.watched.length && out.new.dateOrder &&
    (subs > 0 || (out.subscribedNone.loaded === 0 && !!out.subscribedNone.message)) && (!out.subscribedOne || (out.subscribedOne.loaded > 0 && !out.subscribedOne.without.length)) && back.mode === "forYou";
  out.pageErrors = p.errors;
  p.ws.close();
  return out;
}

// Quick actions (phone, the settings quickActions and quickTags on for this run): the row above the caption,
// every target 44 px; a star there rates the scene and the column shows it; a quick tag toggles exactly that
// tag and keeps the others (read back from GraphQL), and back again; the values before come back.
async function quickCheck() {
  const width = 390, height = 844, S = "stashShorts";
  const p = await page();
  await p.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
  await p.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await p.send("Page.navigate", { url: `${BASE}/shorts` });
  await p.waitFor(`window.${S} && ${S}.timing.firstPlay != null && document.querySelector('.sst-slide.sst-current .sst-quick')`, 15000);
  await sleep(600);
  const cur = "document.querySelector('.sst-slide.sst-current')";
  const id = await p.evaluate(`${S}.scenes[${S}.index].sceneId`);
  const read = async () => (await gql("query ($id: ID!) { findScene(id: $id) { rating100 tags { id } } }", { id })).data.findScene;
  const before = await read();
  const out = { scene: id, row: await p.evaluate(`(function () { var r = ${cur}.querySelector('.sst-quick'); return { buttons: r.querySelectorAll('button').length,
    tags: [...r.querySelectorAll('.sst-quick-tag')].map((c) => c.textContent),
    under44: [...r.querySelectorAll('button')].filter((b) => { var x = b.getBoundingClientRect(); return x.width && (x.width < 40 || x.height < 44); }).length }; })()`) };
  await p.shot(`phone${TAG}-16-quick`);
  // a star (one that changes the rating)
  const want = before.rating100 === 60 ? 4 : 3;
  await p.evaluate(`${cur}.querySelectorAll('.sst-quick-stars button')[${want - 1}].click()`);
  await sleep(600);
  const rated = await read();
  out.rating = { before: before.rating100, after: rated.rating100, column: await p.evaluate(`${cur}.querySelector('.sst-actions .sst-rating .sst-count').textContent`) };
  out.rating.ok = rated.rating100 === want * 20 && out.rating.column === String(want);
  // the first quick tag, on and off again
  const tag = await p.evaluate(`${cur}.querySelector('.sst-quick-tag') && ${cur}.querySelector('.sst-quick-tag').getAttribute('data-tag')`);
  if (tag) {
    const had = before.tags.some((x) => x.id === tag);
    await p.evaluate(`${cur}.querySelector('.sst-quick-tag').click()`);
    await sleep(600);
    const once = await read();
    await p.evaluate(`${cur}.querySelector('.sst-quick-tag').click()`);
    await sleep(600);
    const twice = await read();
    const ids = (x) => x.tags.map((y) => y.id).sort().join();
    const others = (x) => x.tags.map((y) => y.id).filter((y) => y !== tag).sort().join();
    out.tag = { tag, had, afterFirst: ids(once), afterSecond: ids(twice), before: ids(before),
      ok: once.tags.some((x) => x.id === tag) === !had && others(once) === others(before) && ids(twice) === ids(before) };
  }
  // the rating as it was
  await gql("mutation ($i: SceneUpdateInput!) { sceneUpdate(input: $i) { id } }", { i: { id, rating100: before.rating100 } });
  out.restored = (await read()).rating100 === before.rating100;
  out.pageErrors = p.errors;
  p.ws.close();
  return out;
}

// Side previews (phone): at most three tiles above the column, none of the scene's performers, each one
// sharing a scene with the scene's performers or the studio (GraphQL); a tap opens that channel; no video
// added; on a 390x680 screen none are shown.
async function relatedCheck() {
  const S = "stashShorts";
  const p = await page();
  await p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await p.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await p.send("Page.navigate", { url: `${BASE}/shorts` });
  await p.waitFor(`window.${S} && ${S}.timing.firstPlay != null`, 15000);
  const cur = "document.querySelector('.sst-slide.sst-current')";
  for (let i = 0; i < 10 && !(await p.waitFor(`${cur}.querySelectorAll('.sst-rel').length`, 2500)); i++) { await p.evaluate(`${S}.go(${S}.index + 1)`); await sleep(500); }
  const sceneId = await p.evaluate(`${S}.scenes[${S}.index].sceneId`);
  const tiles = await p.evaluate(`[...${cur}.querySelectorAll('.sst-rel')].map((b) => b.getAttribute('data-performer'))`);
  const sc = (await gql("query ($id: ID!) { findScene(id: $id) { performers { id } studio { id } } }", { id: sceneId })).data.findScene;
  const cast = sc.performers.map((x) => x.id);
  const why = [];
  for (const id of tiles) {
    const theirs = (await gql("query ($s: SceneFilterType) { findScenes(scene_filter: $s, filter: { per_page: -1 }) { scenes { performers { id } studio { id } } } }", { s: { performers: { value: [id], modifier: "INCLUDES" } } })).data.findScenes.scenes;
    const together = theirs.some((x) => x.performers.some((q) => cast.includes(q.id)));
    const studio = sc.studio && theirs.some((x) => x.studio && x.studio.id === sc.studio.id);
    why.push({ id, together, studio });
  }
  const out = { scene: sceneId, cast, tiles: why, ok: tiles.length > 0 && tiles.length <= 3 && why.every((w) => !cast.includes(w.id) && (w.together || w.studio)) };
  await p.shot(`phone${TAG}-17-related`);
  if (tiles.length) {
    await p.evaluate(`${cur}.querySelector('.sst-rel').click()`);
    await p.waitFor(`${S}.ctx.kind === 'performer'`, 5000);
    await sleep(400);
    out.tap = { ctx: await p.evaluate(`${S}.ctx.kind + ':' + ${S}.ctx.id`), videos: await p.evaluate("document.querySelectorAll('video').length") };
    out.tap.playing = !!(await p.waitFor(`${S}.currentVideo() && !${S}.currentVideo().paused`, 5000));
    out.tap.ok = out.tap.ctx === "performer:" + tiles[0] && out.tap.videos <= 3 && out.tap.playing;
  }
  await p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 680, deviceScaleFactor: 1, mobile: true });
  await sleep(300);
  out.short = await p.evaluate(`[...document.querySelectorAll('.sst-slide.sst-current .sst-rel')].filter((b) => b.offsetParent).length`);
  out.pageErrors = p.errors;
  p.ws.close();
  return out;
}

// Session summary (phone): two entries watched for 3.5 s each, two orgasms and one taken back, one
// subscription; the back button shows the sheet with those numbers; Back to the feed stays, the next back
// shows it again and Leave leaves; the visit is in the history (localStorage). The orgasm and the
// subscription are taken back afterwards.
async function summaryCheck() {
  const S = "stashShorts";
  const p = await page();
  await p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await p.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await p.send("Page.navigate", { url: `${BASE}/shorts` });
  await p.waitFor(`window.${S} && ${S}.timing.firstPlay != null`, 15000);
  await p.evaluate("localStorage.removeItem('stash-shorts:sessions')");
  const cur = "document.querySelector('.sst-slide.sst-current')";
  await sleep(3500);
  await p.evaluate(`${S}.go(${S}.index + 1)`);
  await sleep(3500);
  const sceneId = await p.evaluate(`${S}.scenes[${S}.index].sceneId`);
  for (let k = 0; k < 2; k++) { await p.evaluate(`${cur}.querySelector('.sst-actions .sst-o').click()`); await sleep(700); }
  await p.evaluate("document.querySelector('.sst-undo .sst-pill') && document.querySelector('.sst-undo .sst-pill').click()");
  await sleep(700);
  const pid = await p.evaluate(`${S}.scenes[${S}.index].performers[0] && ${S}.scenes[${S}.index].performers[0].id`);
  const wasSub = pid ? await p.evaluate(`!!${S}.performers[${JSON.stringify(pid)}].subscribed`) : true;
  if (pid && !wasSub) await p.evaluate(`${S}.toggleSubscribe(${S}.performers[${JSON.stringify(pid)}])`);
  await p.waitFor("!document.querySelector('.sst-flash.sst-show, .sst-undo')", 4000); // no hint left in the picture
  await p.evaluate("document.querySelector('.sst-back').click()");
  await p.waitFor("document.querySelector('.sst-summary-sheet')", 3000);
  const rows = () => p.evaluate("[...document.querySelectorAll('.sst-summary-sheet .sst-summary dt')].map((d) => [d.textContent, d.nextElementSibling.textContent])");
  const out = { first: await rows() };
  await p.evaluate("document.querySelector('.sst-flash').classList.remove('sst-show')"); // a late hint, not part of the picture
  await sleep(250);
  await p.shot(`phone${TAG}-18-summary`);
  await p.evaluate("[...document.querySelectorAll('.sst-summary-sheet .sst-pill')].find((b) => !b.classList.contains('sst-primary')).click()");
  await sleep(400);
  out.stayed = await p.evaluate("!document.querySelector('.sst-summary-sheet') && location.pathname.endsWith('/shorts')");
  await p.evaluate("document.querySelector('.sst-back').click()");
  out.again = !!(await p.waitFor("document.querySelector('.sst-summary-sheet')", 3000));
  // take back what the run did, before leaving (on Stash the page is gone afterwards)
  await gql("mutation ($id: ID!) { sceneDeleteO(id: $id) { count } }", { id: sceneId });
  if (pid && !wasSub) await gql("mutation ($i: PerformerUpdateInput!) { performerUpdate(input: $i) { id } }", { i: { id: pid, custom_fields: { remove: ["shorts_subscribed"] } } });
  // (the demo's stand-in for Stash's router only logs a way out of the page: noted here)
  await p.evaluate(`(function (h) { var push = h.push, back = h.goBack; window.__left = [];
    h.push = function (to) { window.__left.push(to); return push.apply(h, arguments); };
    if (back) h.goBack = function () { window.__left.push("back"); return back.apply(h, arguments); }; })(${S}.history)`);
  try {
    await p.evaluate("document.querySelector('.sst-summary-sheet .sst-primary').click()");
  } catch (e) {
    /* the page navigated away during the click: that is leaving */
  }
  await sleep(1200);
  try {
    out.left = await p.evaluate("!document.querySelector('.sst-root') || (window.__left || []).some((x) => !/^\\/shorts/.test(x))");
    out.stored = await p.evaluate("JSON.parse(localStorage.getItem('stash-shorts:sessions') || '[]').length");
  } catch (e) {
    out.left = true; // Stash's router went to the page before (the inspected page navigated)
  }
  const get = (label) => (out.first.find((r) => r[0] === label) || [])[1];
  out.ok = Number(get("Clips watched")) >= 2 && get("Orgasms") === "1" && (wasSub || get("New subscriptions") === "1") && out.stayed && out.again && out.left &&
    (out.stored == null || out.stored === 1);
  out.pageErrors = p.errors;
  p.ws.close();
  return out;
}

// rating, orgasm count and play count on the current scene, read back from GraphQL
async function actions(p) {
  const read = async (id) => (await gql("query ($id: ID!) { findScene(id: $id) { id title rating100 o_counter play_count } }", { id })).data.findScene;
  await sleep(300);
  const id = await p.evaluate("stashShorts.scenes[stashShorts.index].sceneId"); // a marker entry counts for its scene
  const before = await read(id);
  const cur = "document.querySelector('.sst-slide.sst-current')";
  await p.waitFor("!document.querySelector('.sst-flash.sst-show, .sst-undo')", 4000); // no hint of an earlier test in the picture
  await p.evaluate(`${cur}.querySelector('.sst-rate').click()`);
  await sleep(200);
  await p.shot(`desktop${TAG}-4-rating`);
  const want = before.rating100 === 80 ? 3 : 4;
  await p.evaluate(`${cur}.querySelectorAll('.sst-star')[${want - 1}].click()`);
  await p.evaluate(`${cur}.querySelector('.sst-o').click()`);
  // favorite: on and off again, read back after each click
  const pid = await p.evaluate(`${cur}.querySelector('.sst-fav').getAttribute('data-performer')`);
  const fav = async () => (await gql("query ($id: ID!) { findPerformer(id: $id) { favorite } }", { id: pid })).data.findPerformer.favorite;
  const favBefore = await fav();
  await p.evaluate(`${cur}.querySelector('.sst-fav').click()`);
  await sleep(600);
  const favAfterClick = await fav();
  await p.evaluate(`${cur}.querySelector('.sst-fav').click()`);
  await sleep(600);
  const favorite = { performer: pid, before: favBefore, afterClick: favAfterClick, afterSecondClick: await fav() };
  // subscription (custom field, not the favorite): on and off again, favorite and other fields untouched
  const perf = async () => (await gql("query ($id: ID!) { findPerformer(id: $id) { favorite custom_fields } }", { id: pid })).data.findPerformer;
  const subBefore = await perf();
  const subOn = await p.evaluate(`stashShorts.toggleSubscribe(stashShorts.performers[${JSON.stringify(pid)}])`);
  const subAfterOn = await perf();
  const subOff = await p.evaluate(`stashShorts.toggleSubscribe(stashShorts.performers[${JSON.stringify(pid)}])`);
  const subAfterOff = await perf();
  const subscription = {
    performer: pid, returned: [subOn, subOff], fieldAfterOn: subAfterOn.custom_fields.shorts_subscribed || null,
    fieldAfterOff: subAfterOff.custom_fields.shorts_subscribed || null,
    favoriteUntouched: subBefore.favorite === subAfterOn.favorite && subBefore.favorite === subAfterOff.favorite,
    otherFieldsUntouched: JSON.stringify(subBefore.custom_fields) === JSON.stringify(subAfterOff.custom_fields),
  };
  const after0 = await p.waitFor(`stashShorts.counted[${JSON.stringify(id)}] && 1`, 12000); // play count after 5 s of playback
  await sleep(800);
  await p.shot(`desktop${TAG}-5-after-actions`);
  const after = await read(id);
  // the scene as it was: rating, and the orgasm taken back (the play count stays, it is what is measured)
  await gql("mutation ($i: SceneUpdateInput!) { sceneUpdate(input: $i) { id } }", { i: { id, rating100: before.rating100 } });
  for (let k = 0; k < after.o_counter - before.o_counter; k++) await gql("mutation ($id: ID!) { sceneDeleteO(id: $id) { count } }", { id });
  const restored = await read(id);
  return { scene: id, before, after, restored: restored.rating100 === before.rating100 && restored.o_counter === before.o_counter, favorite, subscription, expected: { rating100: want * 20, o_counter: before.o_counter + 1, play_count: before.play_count + 1 }, playReported: !!after0 };
}

// NAVBAR=1 (Stash only): screenshot of Stash's scene list with the navbar entry, then a click on it; from
// inside a channel the back button at the top left must return to the scene list
async function navbar() {
  const p = await page();
  await p.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await p.send("Page.navigate", { url: `${BASE}/scenes` });
  const entry = "[...document.querySelectorAll('.navbar a')].find((a) => /\\/shorts$/.test(a.getAttribute('href') || ''))";
  const found = await p.waitFor(`!!${entry}`, 20000);
  await sleep(1500);
  await p.shot("stash-navbar");
  // the UI is there at all (an error in a navbar patch leaves Stash black), and the hook of CURATOR=1
  const ui = await p.evaluate("({ navbar: !!document.querySelector('.navbar'), rootChildren: (document.getElementById('root') || { children: [] }).children.length, hook: window.__curatorHook || null })");
  if (!found) {
    const r = { navbarEntry: false, ui, pageErrors: p.errors };
    p.ws.close();
    return r;
  }
  await p.evaluate(`${entry}.click()`);
  const playing = await p.waitFor("window.stashShorts && window.stashShorts.timing.firstPlay");
  await sleep(500);
  await p.shot("stash-from-navbar");
  const path0 = await p.evaluate("location.pathname");
  // into a channel twice (right arrow), then the back button at the top left: back on the scene list
  for (let i = 0; i < 2; i++) {
    await p.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
    await p.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
    await sleep(600);
  }
  const inChannel = await p.evaluate("location.pathname + location.search");
  await p.evaluate("document.querySelector('.sst-back').click()");
  await sleep(500);
  // the session summary comes first (setting); Leave goes on
  await p.evaluate("(function () { var b = [...document.querySelectorAll('.sst-summary-sheet .sst-primary')][0]; if (b) b.click(); })()");
  await sleep(1500);
  const leave = { inChannel, after: await p.evaluate("location.pathname + location.search"), pageOpen: await p.evaluate("!!document.querySelector('.sst-root')") };
  const r = { navbarEntry: !!found, ui, playsAfterClick: !!playing, path: path0, leaveFromChannel: leave, pageErrors: p.errors };
  p.ws.close();
  return r;
}

// the setting for LANDSCAPE=1, through the same mutation the dialog uses; the stored map comes back after
const SETTINGS_Q = "query StashShortsSettings { configuration { plugins } }";
const SAVE_Q = "mutation StashShortsSaveSettings($i: Map!) { configurePlugin(plugin_id: \"stash-shorts\", input: $i) }";
// The video checks run without galleries in the feed (they measure steps from video to video); the gallery
// check turns them on for its run. The stored map comes back at the end.
const stored = (await gql(SETTINGS_Q)).data.configuration.plugins["stash-shorts"] || {};
const setSettings = (extra) => gql(SAVE_Q, { i: { ...stored, ...(LANDSCAPE ? { allowLandscape: true } : {}), ...extra } });
await setSettings({ disableGalleries: true });

const results = [];
try {
  if (process.env.NAVBAR) results.push(await navbar());
  if (process.env.NAVBAR !== "only") {
    results.push(await run("phone", 390, 844, true));
    results.push({ channelLinks: await channelLinks() });
    results.push({ detailSheet: await detailSheet() });
    results.push({ profile: await profileCheck() });
    results.push({ modes: await modeCheck() });
    results.push({ related: await relatedCheck() });
    results.push({ summary: await summaryCheck() });
    const tagIds = (await gql("{ findTags(filter: { per_page: 2, sort: \"name\" }) { tags { id } } }")).data.findTags.tags.map((x) => x.id).join(",");
    await setSettings({ disableGalleries: true, quickActions: true, quickTags: tagIds });
    results.push({ quick: await quickCheck() });
    await setSettings({ disableGalleries: true });
    await setSettings({ disableGalleries: false });
    results.push({ galleries: await galleryCheck() });
    await setSettings({ disableGalleries: true });
    results.push(await run("desktop", 1440, 900, false));
  }
} finally {
  await gql(SAVE_Q, { i: stored });
  await cleanup();
  // also what was measured before a failure
  console.log(JSON.stringify(results, null, 1));
}
