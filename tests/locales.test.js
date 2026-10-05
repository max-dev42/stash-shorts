"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(__dirname, "..", "plugin", "locales");
const index = JSON.parse(fs.readFileSync(path.join(DIR, "index.json"), "utf8"));
const en = JSON.parse(fs.readFileSync(path.join(DIR, "en.json"), "utf8"));
const base = (k) => k.replace(/_(zero|one|two|few|many|other)$/, "");

test("index.json lists exactly the locale files", () => {
  const files = fs.readdirSync(DIR).filter((f) => f !== "index.json" && f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
  assert.deepEqual(index.slice().sort(), files);
  assert.ok(index.includes("en"));
});

// Plural keys ("<key>_one", "_other", ...) must have exactly the categories Intl.PluralRules knows for
// the language (fr/es/it also "many", e.g. for 1,000,000); all other keys are the same as in en.json.
const PLURAL = /_(zero|one|two|few|many|other)$/;
const pluralBases = new Set(Object.keys(en).filter((k) => PLURAL.test(k)).map(base));
function expectedKeys(code) {
  const cats = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
  const keys = Object.keys(en).filter((k) => !PLURAL.test(k));
  for (const b of pluralBases) for (const c of cats) keys.push(b + "_" + c);
  return keys.sort();
}

test("every translation has the keys of en.json, the plural forms of its language and the same placeholders", () => {
  const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort();
  for (const code of index) {
    const m = JSON.parse(fs.readFileSync(path.join(DIR, code + ".json"), "utf8"));
    assert.deepEqual(Object.keys(m).sort(), expectedKeys(code), code);
    for (const k of Object.keys(m)) {
      const ref = Object.prototype.hasOwnProperty.call(en, k) ? en[k] : en[base(k) + "_other"];
      assert.deepEqual(ph(m[k]), ph(ref), code + ": " + k);
      assert.ok(String(m[k]).trim(), code + ": " + k + " is empty");
    }
  }
});

test("plural forms: each language picks its own form through I18n", () => {
  const C = require("../plugin/stash-shorts-core.js");
  const load = (code) => JSON.parse(fs.readFileSync(path.join(DIR, code + ".json"), "utf8"));
  const de = new C.I18n("de", load("de"), en);
  assert.equal(de.t("stars", { count: 1 }), "1 Stern");
  assert.equal(de.t("stars", { count: 3 }), "3 Sterne");
  const fr = new C.I18n("fr", load("fr"), en);
  assert.equal(fr.t("stars", { count: 0 }), "0 étoile"); // French: 0 and 1 are singular
  assert.equal(fr.t("stars", { count: 2 }), "2 étoiles");
  const it = new C.I18n("it", load("it"), en);
  assert.equal(it.t("stars", { count: 1 }), "1 stella");
  assert.equal(new C.I18n("en", {}, en).t("missingKey"), "missingKey");
});

test("every text key used in the plugin exists in en.json, and every key in en.json is used", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "plugin", "stash-shorts.js"), "utf8");
  const core = fs.readFileSync(path.join(__dirname, "..", "plugin", "stash-shorts-core.js"), "utf8");
  const keys = new Set(Object.keys(en).map(base));
  const used = new Set([...js.matchAll(/\bt\("([A-Za-z]\w*)"/g)].map((m) => m[1]));
  for (const m of core.matchAll(/(?:label|help): "(\w+)"/g)) used.add(m[1]);
  Object.values(require("../plugin/stash-shorts-core.js").ORDERS).forEach((k) => used.add(k));
  // keys chosen with a condition: t(on ? "a" : "b")
  for (const m of js.matchAll(/\? "(\w+)" : "(\w+)"/g)) if (keys.has(m[1]) && keys.has(m[2])) [m[1], m[2]].forEach((k) => used.add(k));
  assert.deepEqual([...used].filter((k) => !keys.has(k)), []);
  assert.deepEqual([...keys].filter((k) => !used.has(k)), []);
});

test("no emoji in texts, plugin code or CSS (icons are inline SVG; gender signs are allowed)", () => {
  const allowed = new Set([0x2640, 0x2642, 0x26a7, 0x26a5, 0x26b2]);
  const emoji = (cp) => cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf && !allowed.has(cp));
  // besides the character itself (e.g. U+2665), escaped code points count too: "\u{1F4A6}" (JS), "\2665" (CSS)
  const decode = (s) => s.replace(/\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})|\\([0-9a-f]{4,6})(?![0-9a-f])/gi, (m, a, b, c) => String.fromCharCode(...(() => {
    const cp = parseInt(a || b || c, 16);
    return cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp];
  })()));
  const PLUGIN = path.join(__dirname, "..", "plugin");
  const files = fs.readdirSync(PLUGIN).filter((f) => /\.(js|css|yml)$/.test(f)).map((f) => path.join(PLUGIN, f))
    .concat(index.map((c) => path.join(DIR, c + ".json")));
  for (const file of files) {
    const found = [...decode(fs.readFileSync(file, "utf8"))].filter((ch) => emoji(ch.codePointAt(0)));
    assert.deepEqual(found, [], path.basename(file));
  }
});

test("no dashes U+2012 to U+2015 in texts, code and docs (colon, comma, brackets or a full stop instead)", () => {
  const dash = (cp) => cp >= 0x2012 && cp <= 0x2015;
  // besides the character itself, escaped code points count too: "\u2013" (JS), "\2014" (CSS)
  const decode = (s) => s.replace(/\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})|\\([0-9a-f]{4,6})(?![0-9a-f])/gi, (m, a, b, c) => {
    const cp = parseInt(a || b || c, 16);
    return cp > 0xffff ? m : String.fromCharCode(cp);
  });
  const ROOT = path.join(__dirname, "..");
  const walk = (dir, re) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === "vendor" ? [] : walk(p, re); // bundled third-party code stays as published
    return re.test(d.name) ? [p] : [];
  });
  const files = walk(path.join(ROOT, "plugin"), /\.(js|css|yml|json)$/)
    .concat(walk(path.join(ROOT, "docs"), /\.md$/), walk(path.join(ROOT, "demo"), /\.(js|html|css)$/))
    .concat(["README.md", "CHANGELOG.md", "CONTRIBUTING.md"].map((f) => path.join(ROOT, f)));
  // tests and scripts: only the characters themselves (escapes there are examples, as in this test)
  const literal = walk(path.join(ROOT, "tests"), /\.js$/).concat(walk(path.join(ROOT, "scripts"), /\.(m?js|sh)$/));
  for (const file of files.concat(literal)) {
    const text = fs.readFileSync(file, "utf8");
    const lines = (literal.includes(file) ? text : decode(text)).split("\n");
    const found = lines.map((l, i) => ([...l].some((ch) => dash(ch.codePointAt(0))) ? path.relative(ROOT, file) + ":" + (i + 1) : null)).filter(Boolean);
    assert.deepEqual(found, []);
  }
});

test("app manifest for the home screen: starts at /shorts, its own id, served as a plugin asset", () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "plugin", "app", "manifest.json"), "utf8"));
  assert.equal(m.start_url, "/shorts");
  assert.equal(m.id, "/shorts");
  assert.equal(m.display, "standalone");
  assert.equal(m.orientation, "any");
  assert.equal(m.background_color, "#000000");
  const yml = fs.readFileSync(path.join(__dirname, "..", "plugin", "stash-shorts.yml"), "utf8");
  assert.match(yml, /^ {4}\/app: app$/m);
});

test("app manifest: one per language, the same apart from the texts, shortcuts that are feed filters", () => {
  const C = require("../plugin/stash-shorts-core.js");
  const APP = path.join(__dirname, "..", "plugin", "app");
  const file = (code) => path.join(APP, code === "en" ? "manifest.json" : "manifest." + code + ".json");
  const en = JSON.parse(fs.readFileSync(file("en"), "utf8"));
  const shape = (m) => JSON.stringify({ ...m, description: 0, lang: 0, shortcuts: m.shortcuts.map((s) => ({ ...s, name: 0 })) });
  for (const code of index) {
    const m = JSON.parse(fs.readFileSync(file(code), "utf8"));
    assert.equal(m.lang, code);
    assert.equal(shape(m), shape(en), code);
    assert.ok(m.shortcuts.every((s) => s.name && s.name.length <= 12), code);
  }
  assert.deepEqual(fs.readdirSync(APP).filter((f) => /^manifest\..+\.json$/.test(f)).sort(), index.filter((c) => c !== "en").map((c) => "manifest." + c + ".json").sort());
  const filters = en.shortcuts.map((s) => {
    const u = new URL(s.url, "http://x");
    assert.equal(u.pathname, "/shorts");
    const f = C.filtersFrom(C.readSettings({ order: "random" }), u.searchParams);
    return [f.order, f.unseenOnly, f.favoritesOnly];
  });
  assert.deepEqual(filters, [["forYou", false, false], ["date", true, false], ["random", false, true]]);
});

test("app icons: own PNGs in the sizes the manifest names, maskable ones among them", () => {
  const APP = path.join(__dirname, "..", "plugin", "app");
  const m = JSON.parse(fs.readFileSync(path.join(APP, "manifest.json"), "utf8"));
  const png = (f) => {
    const b = fs.readFileSync(path.join(APP, f));
    assert.equal(b.toString("ascii", 1, 4), "PNG", f);
    return b.readUInt32BE(16) + "x" + b.readUInt32BE(20);
  };
  for (const i of m.icons) {
    assert.ok(!i.src.startsWith("/"), "relative to the manifest: " + i.src);
    if (i.type === "image/png") assert.equal(png(i.src), i.sizes, i.src);
    else assert.ok(fs.existsSync(path.join(APP, i.src)), i.src);
  }
  for (const size of ["192x192", "512x512"]) {
    assert.ok(m.icons.some((i) => i.sizes === size && i.purpose === "any"), size + " any");
    assert.ok(m.icons.some((i) => i.sizes === size && i.purpose === "maskable"), size + " maskable");
  }
  assert.equal(png("apple-touch-icon.png"), "180x180");
});
