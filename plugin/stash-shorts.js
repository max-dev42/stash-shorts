/*
 * stash-shorts -- Stash UI plugin: a full-screen portrait feed of scenes to swipe through.
 *
 * Adds a page (ROUTE in the core file) and a navbar entry. One scene per screen; swipe, mouse wheel or
 * arrow keys move to the next or previous one. Sideways changes the context: to the left into the channel
 * of a performer of the current scene (only their scenes), to the right back to where one came from.
 * Scenes come from Stash's GraphQL API, page by page; videos play from Stash's own stream endpoint. Only
 * the previous, current and next scene have a video element with a source (at most three elements, see
 * Core.assignSlots); slides further away are not in the DOM.
 * UI texts: locales/<code>.json, loaded at runtime from the asset path (see docs/translating.md).
 */
(function () {
  "use strict";

  var Core = window.StashShortsCore; // stash-shorts-core.js, loaded first
  var PluginApi = window.PluginApi;
  if (!PluginApi || !Core) return;
  // Loaded twice (plugin installed in two folders, or the script included again): the second copy would
  // register the route and the navbar entry once more.
  if (window.StashShortsLoaded) return;
  window.StashShortsLoaded = true;

  // ------------------------------------------------------------------ identifiers (keep in one place)
  var PLUGIN_ID = Core.PLUGIN_ID;
  var ROUTE = Core.ROUTE;
  var CSS = "sst"; // CSS class prefix
  var SOUND_KEY = PLUGIN_ID + ":sound"; // sessionStorage: "on" once the viewer turned the sound on
  var DEBUG_HANDLE = "stashShorts"; // window.stashShorts for testing in the console
  var FALLBACK_LOCALE = "en";
  var PER_PAGE = 20;
  var HOLD_MS = 350; // pressing this long pauses the video until released
  var SNAP_MS = 220;
  var UNDO_MS = 4000; // how long "Undo" is offered after an orgasm
  var REMOVE_O_HOLD_MS = 600; // holding the orgasm button this long takes one back

  var ICONS = Core.ICONS, ICON_BOX = Core.ICON_BOX, I18n = Core.I18n;
  var React = PluginApi.React;
  var h = React.createElement;
  var RRD = PluginApi.libraries.ReactRouterDOM;
  var Bootstrap = PluginApi.libraries.Bootstrap;
  var ReactIntl = PluginApi.libraries.Intl;

  var ASSET_BASE = new URL("plugin/" + PLUGIN_ID + "/assets/", document.baseURI).href;
  var GRAPHQL = new URL("graphql", document.baseURI).href;

  // ------------------------------------------------------------------ i18n
  // Language = Stash's interface language (the locale Stash's react-intl provider uses), else
  // navigator.language, else English. locales/index.json lists the available codes.
  var localeCache = {};
  function fetchLocale(code) {
    if (!localeCache[code])
      localeCache[code] = fetch(ASSET_BASE + "locales/" + code + ".json", { credentials: "same-origin" })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .catch(function () {
          return null;
        });
    return localeCache[code];
  }

  var i18nCache = {};
  function loadI18n(locale) {
    locale = locale || navigator.language || FALLBACK_LOCALE;
    if (i18nCache[locale]) return i18nCache[locale];
    var candidates = [locale, locale.split(/[-_]/)[0]].filter(function (c, i, a) {
      return c && a.indexOf(c) === i;
    });
    var available = fetchLocale("index").then(function (list) {
      return Array.isArray(list) ? list : [FALLBACK_LOCALE];
    });
    i18nCache[locale] = Promise.all([available, fetchLocale(FALLBACK_LOCALE)]).then(function (res) {
      var list = res[0], fallback = res[1] || {};
      var code = candidates.filter(function (c) {
        return list.indexOf(c) >= 0;
      })[0];
      var messages = !code || code === FALLBACK_LOCALE ? Promise.resolve(fallback) : fetchLocale(code);
      return messages.then(function (m) {
        var i18n = new I18n(locale, m || fallback, fallback);
        i18n.code = code || FALLBACK_LOCALE; // the language file used (also picks the app manifest)
        return i18n;
      });
    });
    return i18nCache[locale];
  }

  function useStashLocale() {
    try {
      var intl = ReactIntl && ReactIntl.useIntl ? ReactIntl.useIntl() : null;
      if (intl && intl.locale) return intl.locale;
    } catch (e) {
      /* outside an IntlProvider */
    }
    return navigator.language || FALLBACK_LOCALE;
  }

  function useI18n() {
    var locale = useStashLocale();
    var state = React.useState(null);
    React.useEffect(
      function () {
        var alive = true;
        loadI18n(locale).then(function (i) {
          if (alive) state[1](i);
        });
        return function () {
          alive = false;
        };
      },
      [locale]
    );
    return state[0] && state[0].locale === locale ? state[0] : null;
  }

  // ------------------------------------------------------------------ GraphQL

  function gql(query, variables) {
    return fetch(GRAPHQL, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, variables: variables || {} }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (j.errors && j.errors.length) throw new Error(j.errors[0].message);
        return j.data;
      });
  }

  function loadSettings() {
    return gql("query StashShortsSettings { configuration { plugins } }").then(function (d) {
      var all = (d.configuration && d.configuration.plugins) || {};
      return all[PLUGIN_ID] || {};
    });
  }

  // configurePlugin replaces the whole map, so the full set is always sent; defaults are not stored
  function saveSettings(values) {
    return gql("mutation StashShortsSaveSettings($i: Map!) { configurePlugin(plugin_id: \"" + PLUGIN_ID + "\", input: $i) }", {
      i: Core.settingsInput(values),
    }).then(function (d) {
      return d.configurePlugin;
    });
  }

  // ------------------------------------------------------------------ DOM helpers

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "text") e.textContent = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    (children || []).forEach(function (c) {
      if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return e;
  }

  var SVG_NS = "http://www.w3.org/2000/svg";
  function icon(name, cls) {
    var s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("viewBox", "0 0 " + ICON_BOX + " " + ICON_BOX);
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("class", CSS + "-icon" + (cls ? " " + cls : ""));
    var p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", ICONS[name]);
    p.setAttribute("fill", "currentColor");
    p.setAttribute("fill-rule", "evenodd");
    s.appendChild(p);
    return s;
  }

  function button(cls, label, iconName, onclick, extra) {
    var b = el("button", Object.assign({ type: "button", class: CSS + "-btn " + cls, "aria-label": label, title: label, onclick: onclick }, extra || {}));
    if (iconName) b.appendChild(icon(iconName));
    return b;
  }

  function readSound() {
    try {
      return sessionStorage.getItem(SOUND_KEY) === "on";
    } catch (e) {
      return false;
    }
  }
  function writeSound(on) {
    try {
      if (on) sessionStorage.setItem(SOUND_KEY, "on");
      else sessionStorage.removeItem(SOUND_KEY);
    } catch (e) {
      /* private mode */
    }
  }

  function now() {
    return performance.now();
  }

  // ------------------------------------------------------------------ the feed

  function ShortsView(root, history, i18n) {
    this.root = root;
    this.history = history;
    this.i18n = i18n;
    this.t = i18n.t.bind(i18n);
    this.scenes = [];
    this.total = 0;
    this.page = 0;
    this.index = 0;
    this.slides = {}; // scene index -> slide element (only the window around the current scene)
    this.videos = [];
    this.slots = [];
    this.trackers = {};
    this.counted = {};
    this.performers = {}; // id -> shared performer object (favorite and subscription state)
    this.subscribed = null; // id -> true, the performers subscribed to (custom field), once loaded
    this.sceneCache = {}; // id -> scene object, shared by all contexts (rating, counts stay in step)
    this.ctx = Core.ALL; // the context shown (see Core.contextFromQuery)
    this.stack = new Core.ContextStack(); // the contexts left behind
    this.gen = 0; // counts context changes; pages that arrive for an earlier context are dropped
    this.entries = 0; // history entries of channels on top of the one the page was opened with
    this.baseLength = window.history.length; // 1: nothing before the Shorts page (opened as an app)
    this.guarded = false; // a history entry that catches "back" in the home screen app, see bindBackGuard
    this.wakeLog = []; // screen wake lock requests and releases, for testing (window.stashShorts)
    this.sound = readSound();
    this.taps = new Core.DoubleTap();
    this.storiesGen = 0;
    this.seed = Math.floor(Math.random() * 1e9);
    this.timing = { start: now(), firstPlay: null, switches: [], contexts: [] };
    this.cleanup = [];
    this.session = Core.newSession(Date.now()); // what this visit did, for the summary when leaving
  }

  ShortsView.prototype.on = function (target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.cleanup.push(function () {
      target.removeEventListener(type, fn, opts);
    });
  };

  ShortsView.prototype.start = function () {
    var self = this, t = this.t;
    this.build();
    loadSettings()
      .catch(function () {
        return {};
      })
      .then(function (stored) {
        if (self.destroyed) return;
        self.settings = Core.readSettings(stored);
        var q = new URLSearchParams(location.search);
        self.baseFilter = Core.filtersFrom(self.settings, q);
        self.ctx = Core.contextFromQuery(q);
        self.linkScene = Core.sceneFromQuery(q);
        self.linkGallery = Core.galleryFromQuery(q);
        self.filter = self.filterFor(self.ctx);
        if (self.ctx.kind === "performer") self.nameContext(self.ctx);
        self.loadSubscriptions();
        var prof = Core.profileFromQuery(q);
        return self.reload(true).then(function () {
          if (prof && !self.destroyed) self.openProfile({ id: prof }, true, true);
        });
      })
      .catch(function (e) {
        self.showMessage(t("error", { message: e.message }));
      });
  };

  ShortsView.prototype.build = function () {
    var self = this, t = this.t;
    this.root.classList.add(CSS + "-root");
    this.stage = el("div", { class: CSS + "-stage" });
    this.track = el("div", { class: CSS + "-track" });
    this.stage.appendChild(this.track);
    this.message = el("div", { class: CSS + "-message", role: "status" });
    this.flash = el("div", { class: CSS + "-flash", "aria-hidden": "true" });
    this.stage.appendChild(this.flash);

    this.soundBtn = button(CSS + "-sound", "", null, function () {
      self.setSound(!self.sound);
    });
    var top = el("div", { class: CSS + "-top" }, [
      button(CSS + "-back", t("back"), "back", function () {
        self.leave();
      }),
      (this.storiesBtn = button(CSS + "-stories-btn", t("stories"), "people", function () {
        self.toggleStories();
      }, { "aria-expanded": "false", "aria-controls": CSS + "-stories" })),
      el("span", { class: CSS + "-spacer" }),
      (this.ctxBox = el("div", { class: CSS + "-context", "aria-live": "polite" })),
      this.soundBtn,
      (this.filterBtn = button(CSS + "-filter", t("filters"), "sliders", function () {
        self.openDialog();
      })),
    ]);
    this.stories = el("nav", { class: CSS + "-stories", id: CSS + "-stories", "aria-label": t("stories"), hidden: true });
    // the modes at the bottom (Core.MODES): a tap shows all scenes in that mode
    this.modeBar = el("nav", { class: CSS + "-modes", "aria-label": t("modes") });
    var modeLabels = { forYou: t("modeForYou"), subscribed: t("modeSubscribed"), new: t("modeNew") };
    Core.MODES.forEach(function (m) {
      self.modeBar.appendChild(el("button", { type: "button", class: CSS + "-mode", "data-mode": m, onclick: function () {
        self.showMode(m);
      } }, [modeLabels[m]]));
    });
    this.root.appendChild(this.stage);
    this.root.appendChild(top);
    this.root.appendChild(this.stories);
    this.root.appendChild(this.modeBar);
    this.root.appendChild(this.message);
    this.updateSoundButton();

    for (var i = 0; i < Core.POOL_SIZE; i++) {
      var v = el("video", { class: CSS + "-video", playsinline: true, "webkit-playsinline": true, loop: true, preload: "auto", disablepictureinpicture: true });
      v.muted = true;
      this.bindVideo(v);
      this.videos.push(v);
      this.slots.push(null);
    }

    this.rotateBtn = el("button", { type: "button", class: CSS + "-rotate", onclick: function () {
      self.rotate();
    } }, [icon("rotate"), el("span", { text: t("rotate") })]);
    this.root.appendChild(this.rotateBtn);
    this.watchOrientation();
    this.standalone = isStandalone();
    this.root.classList.toggle(CSS + "-standalone", this.standalone);
    this.appHead();
    this.bindGestures();
    this.bindBackGuard();
    this.bindMediaSession();
    this.on(document, "visibilitychange", function () {
      // the browser drops the wake lock when the page is hidden; back in view it is asked for again
      var v = self.currentVideo();
      if (!document.hidden && v && !v.paused) self.keepAwake(true);
    });
    // the browser's back and forward buttons move through the contexts as the sideways swipes do
    this.on(window, "popstate", function () {
      self.onPop();
    });
    // the page covers Stash's navbar and must not scroll underneath
    document.body.classList.add(CSS + "-open");
    this.cleanup.push(function () {
      document.body.classList.remove(CSS + "-open");
    });
  };

  ShortsView.prototype.destroy = function () {
    this.storeSummary(); // left another way (a link in Stash, closing): no sheet, but in the history
    this.destroyed = true;
    if (this.dialog) this.dialog.close();
    cancelAnimationFrame(this.raf);
    clearTimeout(this.holdTimer);
    clearTimeout(this.flashTimer);
    clearTimeout(this.tapTimer);
    clearTimeout(this.idleTimer);
    clearTimeout(this.picTimer);
    clearTimeout(this.seenTimer);
    clearTimeout(this.resumeTimer);
    clearTimeout(this.undoTimer);
    if (this.rotLocked) this.unlockRotation();
    this.keepAwake(false);
    this.videos.forEach(function (v) {
      v.pause();
      v.removeAttribute("src");
      v.load();
    });
    this.cleanup.forEach(function (fn) {
      fn();
    });
    if (window[DEBUG_HANDLE] === this) delete window[DEBUG_HANDLE];
  };

  // back to the page before the Shorts page, past the channels' history entries (and the back guard);
  // opened as an app there is no page before it: then Stash's start page
  // the back button and Esc: first the summary of the visit (setting), then leaving
  ShortsView.prototype.leave = function () {
    if (this.showSummary(false)) return;
    this.leaveNow();
  };

  ShortsView.prototype.leaveNow = function () {
    this.storeSummary();
    var own = this.entries + (this.guarded ? 1 : 0);
    if (this.baseLength <= 1 && this.standalone) this.history.push("/");
    else if (own && this.history.go) this.history.go(-(own + 1));
    else if (this.history.length > 1 && this.history.goBack) this.history.goBack();
    else this.history.push("/");
  };

  // -- session summary (Core.sessionSummary), kept in localStorage (the last Core.SUMMARY_MAX)

  function readSummaries() {
    try {
      var list = JSON.parse(localStorage.getItem(Core.SUMMARY_STORE) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }
  function writeSummaries(list) {
    try {
      localStorage.setItem(Core.SUMMARY_STORE, JSON.stringify(list));
    } catch (e) {
      /* private mode or full: no history */
    }
  }

  ShortsView.prototype.storeSummary = function () {
    if (this.summaryStored) return;
    var sum = Core.sessionSummary(this.session, Date.now());
    if (!Core.summaryWorth(sum)) return;
    this.summaryStored = true;
    writeSummaries(Core.addSummary(readSummaries(), sum));
  };

  // the rows of a summary
  ShortsView.prototype.summaryRows = function (sum) {
    var t = this.t, n = this.i18n.n.bind(this.i18n);
    var rows = [[t("sumTime"), Core.duration(sum.seconds)], [t("sumClips"), n(sum.clips)]];
    if (sum.galleries) rows.push([t("sumGalleries"), n(sum.galleries)]);
    rows.push([t("sumOrgasms"), n(sum.o)]);
    if (sum.subscribed) rows.push([t("sumSubscribed"), n(sum.subscribed)]);
    return el("dl", { class: CSS + "-summary" }, rows.reduce(function (out, r) {
      return out.concat([el("dt", { text: r[0] }), el("dd", { text: r[1] })]);
    }, []));
  };

  // The sheet "Session ended" when the page is left by its back button (fromGuard: the back gesture of the
  // home screen app, which has already gone back one entry). Returns false when it is not shown (setting,
  // nothing watched yet), so the caller leaves (or hints) as before.
  ShortsView.prototype.showSummary = function (fromGuard) {
    var self = this, t = this.t;
    if (!this.settings || this.settings.disableSummary || this.summaryShown) return false;
    var sum = Core.sessionSummary(this.session, Date.now());
    if (!Core.summaryWorth(sum)) return false;
    this.summaryShown = true; // once: the next back leaves at once
    var leave = el("button", { type: "button", class: CSS + "-pill " + CSS + "-primary", text: t("leave"), onclick: function () {
      s.wasPlaying = false;
      s.close();
      if (fromGuard && self.history.goBack) {
        self.storeSummary();
        self.history.goBack(); // the app closes (no entry before it)
      } else self.leaveNow();
    } });
    var stay = el("button", { type: "button", class: CSS + "-pill", text: t("backToFeed"), onclick: function () {
      s.close();
    } });
    var s = this.sheet(t("sessionEnded"), { foot: [stay, leave], cls: CSS + "-summary-sheet", onClose: function () {
      self.summaryShown = false; // back in the feed: the next leave shows it again, up to date
    } });
    s.body.appendChild(this.summaryRows(sum));
    leave.focus();
    return true;
  };

  // the last sessions (from More)
  ShortsView.prototype.openSessions = function () {
    var self = this, t = this.t, s = this.sheet(t("recentSessions"));
    readSummaries().forEach(function (sum) {
      var when = new Date(sum.at);
      s.body.appendChild(el("h3", { text: when.toLocaleString(self.i18n.locale, { dateStyle: "medium", timeStyle: "short" }) }));
      s.body.appendChild(self.summaryRows(sum));
    });
  };

  ShortsView.prototype.showMessage = function (text, action) {
    this.message.innerHTML = "";
    this.message.hidden = !text;
    if (!text) return;
    this.message.appendChild(el("p", { text: text }));
    if (action) this.message.appendChild(action);
  };

  // -- data

  // resume: start with the scene last shown in this context (opening the page), see Core.resumeAt
  ShortsView.prototype.reload = function (resume) {
    var self = this;
    this.gen++;
    this.loading = null;
    this.scenes = [];
    this.total = 0;
    this.page = 0;
    this.index = 0;
    this.plan = null;
    this.counted = {};
    this.lastCurrent = null;
    this.paused = false;
    Object.keys(this.slides).forEach(function (k) {
      self.dropSlide(Number(k));
    });
    this.slots = this.slots.map(function () {
      return null;
    });
    this.videos.forEach(function (v) {
      self.freeVideo(v);
    });
    this.track.style.transition = "none";
    this.track.style.transform = "translate3d(0,0,0)";
    this.filterBtn.classList.toggle(CSS + "-active", Core.hasExtraFilters(this.baseFilter));
    this.drawContext(0);
    this.showMessage(this.t("loading"));
    this.hideResume();
    var gen = this.gen, resumed = null, link = resume ? this.linkScene || this.linkGallery : null;
    var byLink = link && (this.linkScene ? this.sceneById(link) : this.galleryById(link));
    this.linkScene = this.linkGallery = null; // a link opens its entry once; Start over and the next reload do not
    return (byLink || (resume ? this.resumeScene() : Promise.resolve(null)))
      .then(function (sc) {
        if (link) {
          // the address keeps the context, not the scene, so a reload does not jump back to it
          self.history.replace(self.contextUrl(self.ctx));
          if (!sc) self.toast(self.t("sceneMissing"));
        }
        if (sc && gen === self.gen && !self.scenes.length) {
          self.scenes.push(sc);
          if (!link) resumed = sc;
        }
        return self.loadPage();
      })
      .then(function () {
        if (self.destroyed) return;
        if (!self.scenes.length) {
          var why = self.filter.subscribedOnly
            ? self.t("emptySubscribed")
            : self.t(Core.hasExtraFilters(self.filter) ? "emptyFiltered" : self.settings.allowLandscape ? "emptyLibrary" : "emptyPortrait");
          return self.showMessage(why, el("button", { type: "button", class: CSS + "-pill", text: self.t("filters"), onclick: function () {
            self.openDialog();
          } }));
        }
        self.showMessage(null);
        self.update();
        if (self.ctx.kind === "performer" && self.total <= 1) self.toast(self.t("channelOnly", { name: self.ctx.name || "" }));
        if (resumed && gen === self.gen) self.showResume();
      });
  };

  // -- continue where one was (Core.rememberAt / resumeAt, in localStorage; without it nothing is kept)

  function readResume() {
    try {
      return JSON.parse(localStorage.getItem(Core.RESUME_STORE) || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  function writeResume(map) {
    try {
      localStorage.setItem(Core.RESUME_STORE, JSON.stringify(map));
    } catch (e) {
      /* private mode or full: the feed works without */
    }
  }

  ShortsView.prototype.remember = function (sc) {
    writeResume(Core.rememberAt(readResume(), Core.resumeKey(this.ctx, this.filter), sc.id, Date.now()));
  };

  // the remembered scene of this context, if it still fits its filter (one query with Stash's id criterion)
  ShortsView.prototype.resumeScene = function () {
    var self = this, id = Core.resumeAt(readResume(), Core.resumeKey(this.ctx, this.filter), Date.now());
    if (!id || !/^\d/.test(id)) return Promise.resolve(null); // a marker or jump entry: from the start of the feed
    var s = Object.assign(Core.sceneFilter(this.filter, this.settings.allowLandscape), { id: { value: Number(id), modifier: "EQUALS" } });
    return gql(Core.RESUME_QUERY, { s: s })
      .then(function (d) {
        var raw = d.findScenes.scenes[0];
        return raw ? self.adopt(raw) : null;
      })
      .catch(function () {
        return null;
      });
  };

  // one scene by id, without the filter (a link opens it whatever the feed shows)
  ShortsView.prototype.sceneById = function (id) {
    var self = this;
    return gql(Core.BY_IDS_QUERY, { ids: [id] })
      .then(function (d) {
        var raw = d.findScenes.scenes[0];
        return raw ? self.adopt(raw) : null;
      })
      .catch(function () {
        return null;
      });
  };

  // "Continuing where you were" with "Start over", for a few seconds or until the next step
  ShortsView.prototype.showResume = function () {
    var self = this, t = this.t;
    this.hideResume();
    this.resumeBox = el("div", { class: CSS + "-resume", role: "status" }, [
      el("span", { text: t("resumed") }),
      el("button", { type: "button", class: CSS + "-pill", text: t("restart"), onclick: function () {
        var map = readResume();
        delete map[Core.resumeKey(self.ctx, self.filter)];
        writeResume(map);
        self.reload(false);
      } }),
    ]);
    this.root.appendChild(this.resumeBox);
    this.resumeTimer = setTimeout(function () {
      self.hideResume();
    }, 6000);
  };

  ShortsView.prototype.hideResume = function () {
    clearTimeout(this.resumeTimer);
    if (this.resumeBox) this.resumeBox.remove();
    this.resumeBox = null;
  };

  ShortsView.prototype.loadPage = function () {
    var self = this;
    if (this.loading) return this.loading;
    var page = this.page + 1, gen = this.gen;
    var found = Core.plannedOrder(this.filter, !this.settings.disableMarkers, this.galleriesOn())
      ? this.plannedPage(page)
      : gql(Core.SCENES_QUERY, { f: Core.findFilter(this.filter, page, PER_PAGE, this.seed), s: Core.sceneFilter(this.filter, this.settings.allowLandscape) }).then(function (d) {
          return d.findScenes;
        });
    var loading = found
      .then(function (res) {
        var d = { findScenes: res };
        if (self.destroyed || gen !== self.gen) return; // the context changed meanwhile
        self.loading = null;
        self.page = page;
        self.total = d.findScenes.count;
        var seen = {};
        self.scenes.forEach(function (sc) {
          seen[sc.id] = true; // a marker entry has its own id ("m..")
        });
        d.findScenes.scenes.forEach(function (raw) {
          if (seen[String(raw.id)]) return;
          self.scenes.push(self.adopt(raw));
        });
        // a short page means the end, also if the count was off
        if (d.findScenes.scenes.length < PER_PAGE) self.total = self.scenes.length;
      })
      .catch(function (e) {
        if (gen === self.gen) self.loading = null;
        throw e;
      });
    this.loading = loading;
    return loading;
  };

  // a scene from GraphQL as the feed keeps it: one object per scene and per performer for all contexts
  ShortsView.prototype.adopt = function (raw) {
    var self = this, sc = this.sceneCache[String(raw.id)];
    if (raw._gallery) {
      if (!sc) {
        sc = this.sceneCache[String(raw.id)] = Core.normalizeGallery(raw._gallery);
        sc.at = 0; // the picture shown
        sc.performers = sc.performers.map(function (p) {
          return self.sharedPerformer({ id: p.id, name: p.name, favorite: p.favorite, image_path: p.image });
        });
      }
      return sc;
    }
    if (raw._marker) return sc || (this.sceneCache[String(raw.id)] = Core.markerItem(this.adopt(raw._scene), raw._marker));
    if (!sc) {
      sc = this.sceneCache[String(raw.id)] = Core.normalizeScene(raw);
      sc.performers = sc.performers.map(function (p) {
        var shared = self.performers[p.id];
        if (shared) shared.favorite = p.favorite;
        else shared = self.performers[p.id] = p;
        if (self.subscribed) shared.subscribed = !!self.subscribed[p.id];
        return shared;
      });
    }
    return sc;
  };

  // "For you" and "unseen only" (Core.plannedOrder): the order of all ids is fetched or computed once per
  // context (Core.forYouOrder, or Stash's order; kept in the frame as this.plan), the pages are then
  // loaded by id in that order
  ShortsView.prototype.plannedPage = function (page) {
    var self = this;
    if (!this.plan) {
      var s = Core.sceneFilter(this.filter, this.settings.allowLandscape), f = this.filter, seed = this.seed;
      // the markers of the scenes in the filter (setting), as entries { id: "m..", sceneId, marker }
      var markers = this.settings.disableMarkers
        ? Promise.resolve([])
        : gql(Core.MARKERS_QUERY, { s: s }).then(function (d) {
            return d.findSceneMarkers.scene_markers.map(function (m) {
              return { id: "m" + m.id, sceneId: String(m.scene.id), marker: m };
            });
          });
      // the galleries in the filter (setting), as entries { id: "g..", galleryId }, spread over the feed
      var gf = this.galleriesOn() ? Core.galleryFilter(f, this.settings.allowLandscape) : null;
      var galleries = !gf
        ? Promise.resolve([])
        : gql(Core.GALLERY_IDS_QUERY, { f: { per_page: -1, sort: f.order === "newest" ? "created_at" : f.order === "date" ? "date" : "rating", direction: "DESC" }, g: gf })
            .then(function (d) {
              return d.findGalleries.galleries.map(function (g) {
                return { id: "g" + g.id, galleryId: String(g.id), rating100: g.rating100 };
              });
            })
            .catch(function () {
              return []; // the feed goes on without galleries
            });
      var plan = (this.plan = Promise.all([markers, galleries]).then(function (both) {
        var ms = both[0], gs = both[1];
        var byId = {};
        ms.forEach(function (m) {
          byId[m.id] = m;
        });
        var withMarker = function (e) {
          return byId[e.id] ? byId[e.id] : e;
        };
        return (f.order === "forYou"
          ? Promise.all([gql(Core.POOL_QUERY, { s: s }), self.loadTaste()]).then(function (r) {
              return Core.forYouOrder(r[0].findScenes.scenes, r[1], seed, ms).map(withMarker);
            })
          : gql(Core.IDS_QUERY, { f: Core.findFilter(f, 1, -1, seed), s: s }).then(function (d) {
              var ids = d.findScenes.scenes.map(function (sc) {
                return { id: String(sc.id) };
              });
              return Core.mixMarkers(ids, ms, f.order, seed).map(withMarker);
            })
        ).then(function (order) {
          return Core.mixGalleries(order, gs, f.order, seed);
        });
      }));
      plan.catch(function () {
        if (self.plan === plan) self.plan = null; // tried again with the next page
      });
    }
    return this.plan.then(function (order) {
      var entries = order.slice((page - 1) * PER_PAGE, page * PER_PAGE), ids = [], gids = [];
      entries.forEach(function (e) {
        if (e.galleryId) return gids.push(e.galleryId);
        var id = e.sceneId || e.id;
        if (ids.indexOf(id) < 0) ids.push(id);
      });
      if (!ids.length && !gids.length) return { count: order.length, scenes: [] };
      return Promise.all([
        ids.length ? gql(Core.BY_IDS_QUERY, { ids: ids }) : { findScenes: { scenes: [] } },
        gids.length ? gql(Core.GALLERIES_BY_IDS_QUERY, { ids: gids }) : { findGalleries: { galleries: [] } },
      ]).then(function (r) {
        var byId = {}, byGallery = {};
        r[0].findScenes.scenes.forEach(function (sc) {
          byId[String(sc.id)] = sc;
        });
        r[1].findGalleries.galleries.forEach(function (g) {
          byGallery[String(g.id)] = g;
        });
        // a marker goes to adopt() as { id: "m..", _marker, _scene }, a gallery as { id: "g..", _gallery }
        return { count: order.length, scenes: entries.map(function (e) {
          if (e.galleryId) return byGallery[e.galleryId] ? { id: e.id, _gallery: byGallery[e.galleryId] } : null;
          var raw = byId[e.sceneId || e.id];
          return raw && e.marker ? { id: e.id, _marker: e.marker, _scene: raw } : raw;
        }).filter(Boolean) };
      });
    });
  };

  // the taste for "For you" from the whole library, once per visit of the page
  // the whole library, light (TASTE_QUERY), once per visit: for "For you" and the side previews
  ShortsView.prototype.loadLibrary = function () {
    var self = this;
    if (!this.libraryLoad)
      this.libraryLoad = gql(Core.TASTE_QUERY)
        .then(function (d) {
          return d.findScenes.scenes;
        })
        .catch(function (e) {
          self.libraryLoad = null;
          throw e;
        });
    return this.libraryLoad;
  };

  ShortsView.prototype.loadTaste = function () {
    var self = this;
    if (!this.tasteLoad)
      this.tasteLoad = this.loadLibrary()
        .then(function (scenes) {
          return Core.taste(scenes);
        })
        .catch(function (e) {
          self.tasteLoad = null;
          throw e;
        });
    return this.tasteLoad;
  };

  // -- contexts: all scenes, or the channel of one performer (sideways swipe, avatar, URL)

  ShortsView.prototype.filterFor = function (ctx) {
    return ctx.kind === "performer" ? Core.channelFilter(this.baseFilter, ctx.id) : this.baseFilter;
  };

  ShortsView.prototype.contextUrl = function (ctx) {
    if (ctx.kind === "performer") return ROUTE + "?performer=" + encodeURIComponent(ctx.id);
    var q = Core.filterParams(this.baseFilter, this.settings);
    return ROUTE + (q ? "?" + q : "");
  };

  // everything needed to come back to the same place
  ShortsView.prototype.frame = function () {
    return { ctx: this.ctx, filter: this.filter, scenes: this.scenes, total: this.total, page: this.page, index: this.index, seed: this.seed, plan: this.plan };
  };

  // a channel opened from a URL: the name comes from the scenes, or is asked for
  ShortsView.prototype.nameContext = function (ctx) {
    var self = this;
    gql("query StashShortsPerformer($id: ID!) { findPerformer(id: $id) { id name } }", { id: ctx.id })
      .then(function (d) {
        if (ctx.name || !d.findPerformer) return;
        ctx.name = d.findPerformer.name;
        if (self.ctx === ctx) self.drawContext(0);
      })
      .catch(function () {
        /* the label stays without a name */
      });
  };

  // Shows a frame. The video of the current scene keeps playing when the frame starts with that scene (a
  // channel opened from it, or the way back to it); every other video loses its source. dir: +1 the new
  // context comes in from the right, -1 from the left.
  ShortsView.prototype.installFrame = function (frame, dir) {
    var self = this, t0 = now();
    var keep = this.currentVideo();
    var target = frame.scenes[frame.index];
    if (!(keep && keep._scene && target && keep._scene.id === target.id)) keep = null;
    if (keep && keep.parentNode) keep.parentNode.removeChild(keep); // put back in the same task: keeps playing
    Object.keys(this.slides).forEach(function (k) {
      self.dropSlide(Number(k));
    });
    this.videos.forEach(function (v) {
      if (v !== keep) self.freeVideo(v);
    });
    this.gen++;
    this.loading = null;
    this.switchFrom = null;
    this.closeStories();
    this.ctx = frame.ctx;
    this.filter = frame.filter;
    this.scenes = frame.scenes;
    this.total = frame.total;
    this.page = frame.page;
    this.index = frame.index;
    this.seed = frame.seed;
    this.plan = frame.plan;
    this.slots = this.videos.map(function (v) {
      return v === keep ? frame.index : null;
    });
    if (keep) keep._scene = target;
    else this.lastCurrent = null;
    this.paused = false;
    this.closeStars();
    this.showMessage(null);
    this.track.style.transition = "none";
    this.track.style.transform = "translate3d(" + dir * 100 + "%," + -this.index * 100 + "%,0)";
    this.update();
    void this.track.offsetWidth; // start the slide-in from the side
    this.snap();
    this.drawContext(dir);
    var v = this.currentVideo(), entry = { to: Core.contextKey(this.ctx), kept: !!keep };
    if (v && !v.paused && v.readyState >= 3) {
      entry.ms = Math.round(now() - t0);
      this.timing.contexts.push(entry);
    } else this.contextSwitch = { entry: entry, t: t0 };
    if (!this.page || Core.needMore(this.index, this.scenes.length, this.total)) this.more(frame);
  };

  // loads the next page of the context shown; a first page that brings nothing else says so
  ShortsView.prototype.more = function (frame) {
    var self = this, first = !this.page;
    this.loadPage()
      .then(function () {
        if (self.destroyed || self.scenes !== frame.scenes) return;
        if (!self.scenes.length) return self.showMessage(self.t("emptyFiltered"));
        self.update();
        if (first && self.ctx.kind === "performer" && self.total <= 1) self.toast(self.t("channelOnly", { name: self.ctx.name || "" }));
      })
      .catch(function (e) {
        if (!self.destroyed && self.scenes === frame.scenes) self.toast(self.t("error", { message: e.message }));
      });
  };

  // A new frame for a context, starting with the current scene when it belongs there.
  ShortsView.prototype.newFrame = function (ctx, start) {
    var cur = start || this.scenes[this.index], filter = this.filterFor(ctx);
    var fits = cur && (ctx.kind === "performer" ? cur.performers.some(function (p) {
      return p.id === ctx.id;
    }) : !Core.hasExtraFilters(filter));
    return { ctx: ctx, filter: filter, scenes: fits ? [cur] : [], total: fits ? 1 : 0, page: 0, index: 0, seed: Math.floor(Math.random() * 1e9), plan: null };
  };

  // into the channel of performer p (from the swipe, the avatar or the browser's forward button)
  // start: the scene to begin with (a tile in the profile), else the current one when it belongs there
  ShortsView.prototype.openChannel = function (p, fromHistory, start) {
    if (this.dialog || !this.settings) return;
    var ctx = { kind: "performer", id: String(p.id), name: p.name || null };
    if (!ctx.name) this.nameContext(ctx);
    if (this.ctx.kind === "performer" && this.ctx.id === ctx.id) {
      // already in that channel (from its profile): begin there again, without a second history entry
      this.installFrame(this.newFrame(ctx, start), 1);
      if (!fromHistory) this.history.replace(this.contextUrl(ctx));
      return;
    }
    this.stack.push(this.frame());
    this.installFrame(this.newFrame(ctx, start), 1);
    if (!fromHistory) this.history.push(this.contextUrl(ctx));
    this.entries++;
  };

  // the sideways swipe or arrow key: +1 into the channel of a performer of the current scene, -1 back
  ShortsView.prototype.sideways = function (dir) {
    if (this.dialog || !this.settings) return this.snap();
    if (dir < 0) return this.back();
    var sc = this.scenes[this.index];
    var p = sc && Core.nextPerformer(sc.performers, this.ctx.kind === "performer" ? this.ctx.id : null);
    if (!p) {
      this.snap();
      return this.toast(this.t(sc && sc.performers.length ? "noOtherPerformer" : "noPerformer"));
    }
    this.openChannel(p);
  };

  ShortsView.prototype.back = function () {
    if (this.stack.depth()) {
      this.installFrame(this.stack.pop(), -1);
      // the history entry of the channel goes too; its popstate then finds the context already shown
      if (this.history.goBack) {
        this.history.goBack();
        this.entries = Math.max(0, this.entries - 1);
      } else this.history.replace(this.contextUrl(this.ctx));
    } else if (this.ctx.kind === "performer") {
      // a channel opened from a link has nothing behind it: back means all scenes
      this.installFrame(this.newFrame(Core.ALL), -1);
      this.history.replace(this.contextUrl(this.ctx));
    } else this.snap();
  };

  // the browser's back or forward button: show the context of the URL
  ShortsView.prototype.onPop = function () {
    if (this.destroyed || !this.settings || location.pathname.slice(-ROUTE.length) !== ROUTE) return;
    if (this.guarded && !this.entries && !isGuard(window.history.state)) {
      // "back" took the guard entry: once the summary (or a hint), the next "back" leaves (closes the app)
      this.guarded = false;
      if (!this.showSummary(true)) this.toast(this.t("backAgain"));
      return;
    }
    var query = new URLSearchParams(location.search), prof = Core.profileFromQuery(query);
    // the profile is a history entry of its own on top of the context (back closes it, forward opens it)
    if (this.profileView && this.profileView.id !== prof) this.closeProfile(true);
    if (prof && !this.profileView) return this.openProfile({ id: prof }, true);
    var want = Core.contextFromQuery(query), key = Core.contextKey(want);
    if (key === Core.contextKey(this.ctx)) return;
    if (this.dialog) this.dialog.close();
    var d = this.stack.distance(key), frame = this.stack.popTo(key);
    if (frame) {
      this.entries = Math.max(0, this.entries - d - 1);
      return this.installFrame(frame, -1);
    }
    if (want.kind === "performer") {
      var sc = this.scenes[this.index];
      var known = sc && sc.performers.filter(function (p) {
        return p.id === want.id;
      })[0];
      return this.openChannel(known || want, true);
    }
    this.stack.clear();
    this.entries = 0;
    this.installFrame(this.newFrame(Core.ALL), -1);
  };

  // the label at the top: "All" or the performer's name (a link to their page), sliding in from dir
  ShortsView.prototype.drawContext = function (dir) {
    var t = this.t, ctx = this.ctx, box = this.ctxBox, label;
    if (ctx.kind === "performer") {
      // the channel's performer: a tap opens their profile (the link stays their page in Stash, for a new tab)
      var name = ctx.name || "#" + ctx.id, self = this;
      label = this.link(CSS + "-context-label", "performers/" + ctx.id, [el("span", { text: name }), icon("people")], t("profileOf", { name: name }), null, function () {
        self.openProfile(self.performers[ctx.id] || { id: ctx.id, name: ctx.name });
        return true;
      });
    } else label = el("span", { class: CSS + "-context-label", text: t(Core.hasExtraFilters(this.baseFilter) ? "contextFiltered" : "contextAll") });
    if (dir) label.classList.add(CSS + (dir > 0 ? "-from-right" : "-from-left"));
    box.innerHTML = "";
    box.appendChild(label);
    this.drawModes();
  };

  // -- navigation

  ShortsView.prototype.go = function (target) {
    var self = this;
    if (this.dialog || !this.scenes.length) return this.snap();
    target = Core.clamp(target, 0, this.scenes.length - 1);
    if (target === this.index) return this.snap();
    this.switchFrom = { from: this.index, to: target, t: now() };
    this.timing.lastGo = this.switchFrom.t;
    this.closeStories();
    this.hideResume();
    this.index = target;
    this.snap();
    this.update();
    if (Core.needMore(this.index, this.scenes.length, this.total))
      this.loadPage()
        .then(function () {
          if (!self.destroyed) self.update();
        })
        .catch(function () {
          /* the next attempt follows with the next step */
        });
  };

  ShortsView.prototype.snap = function () {
    this.track.style.transition = "transform " + SNAP_MS + "ms cubic-bezier(.2,.7,.3,1)";
    this.track.style.transform = "translate3d(0," + -this.index * 100 + "%,0)";
  };

  // Brings DOM and videos in line with the current index: slides for index-1..index+1, sources for the
  // wanted scenes, the current one playing and all others paused.
  ShortsView.prototype.update = function () {
    var self = this, i = this.index, n = this.scenes.length;
    for (var k = i - 1; k <= i + 1; k++) if (k >= 0 && k < n && !this.slides[k]) this.renderSlide(k);
    Object.keys(this.slides).forEach(function (k) {
      k = Number(k);
      if (k < i - 1 || k > i + 1) self.dropSlide(k);
    });

    // a gallery entry has pictures, no video element
    var wanted = Core.wantedScenes(i, n).filter(function (k) {
      return self.scenes[k].kind !== "gallery";
    });
    var next = Core.assignSlots(this.slots, wanted);
    next.forEach(function (sceneIndex, s) {
      var v = self.videos[s];
      if (self.slots[s] !== sceneIndex) {
        if (sceneIndex == null) self.freeVideo(v);
        else self.attachVideo(v, sceneIndex);
      }
    });
    this.slots = next;
    this.slots.forEach(function (sceneIndex, s) {
      var v = self.videos[s];
      if (sceneIndex == null) return;
      // a video kept over a change of context comes into its new slide
      var media = self.slides[sceneIndex] && self.slides[sceneIndex].querySelector("." + CSS + "-media");
      if (media && v.parentNode !== media) {
        media.appendChild(v);
        self.fitVideo(v, self.slides[sceneIndex]);
      }
      if (sceneIndex === i) {
        if (self.lastCurrent !== v._scene) {
          // a scene starts from the beginning whenever it comes into view
          self.lastCurrent = v._scene;
          self.remember(v._scene);
          self.mediaMetadata(v._scene);
          self.trackers[v._scene.id] = new Core.PlayTracker(self.settings.playCountAfter);
          self.paused = false;
          // (a marker from its time; not for Stash's live transcode: seeking there restarts the transcoding)
          // (a jump entry from the time picked in the detail sheet)
          var from = v._scene.startAt != null ? v._scene.startAt : Core.clipRange(v._scene).start;
          if (Math.abs(v.currentTime - from) > 0.3 && !v._transcoded) v.currentTime = from;
        }
        self.playCurrent(v);
      } else if (!v.paused) v.pause();
    });
    var cur = this.scenes[i];
    // the summary counts an entry as watched once it was shown for Core.SEEN_MS
    if (cur && this.seenEntry !== cur) {
      this.seenEntry = cur;
      clearTimeout(this.seenTimer);
      this.seenTimer = setTimeout(function () {
        if (self.scenes[self.index] !== cur || self.destroyed) return;
        if (cur.kind === "gallery") self.session.galleries[cur.galleryId] = true;
        else self.session.seen[cur.id] = true;
      }, Core.SEEN_MS);
    }
    if (cur && cur.kind === "gallery" && this.lastCurrent !== cur) {
      this.lastCurrent = cur;
      this.remember(cur);
    }
    this.galleryTimer();
    this.drawOrientation();
    Object.keys(this.slides).forEach(function (k) {
      self.slides[k].classList.toggle(CSS + "-current", Number(k) === i);
    });
    this.startProgress();
  };

  ShortsView.prototype.currentVideo = function () {
    var s = this.slots.indexOf(this.index);
    return s >= 0 ? this.videos[s] : null;
  };

  ShortsView.prototype.attachVideo = function (v, sceneIndex) {
    var sc = this.scenes[sceneIndex], slide = this.slides[sceneIndex];
    v.pause();
    v._scene = sc;
    v._transcoded = false;
    v._playing = false;
    v.className = CSS + "-video";
    slide.querySelector("." + CSS + "-media").appendChild(v);
    this.fitVideo(v, slide);
    v.muted = !this.sound;
    v.src = sc.stream;
    v.load();
  };

  // the end of the current entry (the file, or a marker's end): the next one with "autoAdvance", else
  // the entry from its start
  ShortsView.prototype.clipEnded = function (v) {
    var what = Core.endAction(this.settings && this.settings.autoAdvance, this.index, this.scenes.length);
    if (what === "next") return this.go(this.index + 1);
    var tr = this.trackers[v._scene.id];
    if (tr) tr.pause(); // the jump back is not played time
    v.currentTime = Core.clipRange(v._scene).start;
    this.playCurrent(v);
  };

  ShortsView.prototype.freeVideo = function (v) {
    if (!v._scene && !v.getAttribute("src")) return;
    v.pause();
    v.removeAttribute("src");
    v.load(); // drops the buffered data and the connection
    v._scene = null;
    if (v.parentNode) v.parentNode.removeChild(v);
  };

  ShortsView.prototype.fitVideo = function (v, slide) {
    var sc = v._scene;
    if (!sc) return;
    var r = slide.getBoundingClientRect();
    var mode = Core.fitMode(v.videoWidth || sc.width, v.videoHeight || sc.height, r.width, r.height);
    slide.classList.toggle(CSS + "-fill", mode === "cover");
  };

  ShortsView.prototype.playCurrent = function (v) {
    var self = this;
    if (this.held || this.paused) return;
    v.muted = !this.sound;
    // else "ended" (or the end of a marker) decides, see Core.endAction
    v.loop = !(this.settings && this.settings.autoAdvance) && !(v._scene && v._scene.marker);
    var p = v.play();
    if (p && p.catch)
      p.catch(function (e) {
        // unmuted autoplay may be refused (no user gesture yet in this page): play muted instead
        // (the remembered choice stays: the next tap turns the sound on again)
        if (e && e.name === "NotAllowedError" && !v.muted) {
          self.sound = false;
          self.updateSoundButton();
          v.muted = true;
          v.play().catch(function () {});
        }
      });
  };

  ShortsView.prototype.bindVideo = function (v) {
    var self = this;
    v.addEventListener("playing", function () {
      if (v._scene !== self.scenes[self.index]) return;
      var tm = now();
      if (self.timing.firstPlay == null) {
        self.timing.firstPlay = Math.round(tm - self.timing.start); // since the page was mounted
        self.timing.firstPlayAt = Math.round(tm); // since the navigation started
      }
      if (self.contextSwitch) {
        self.contextSwitch.entry.ms = Math.round(tm - self.contextSwitch.t);
        self.timing.contexts.push(self.contextSwitch.entry);
        self.contextSwitch = null;
      }
      if (self.switchFrom && self.switchFrom.to === self.index) {
        self.timing.switches.push({ from: self.switchFrom.from, to: self.switchFrom.to, ms: Math.round(tm - self.switchFrom.t) });
        self.switchFrom = null;
      }
      var slide = self.slides[self.index];
      if (slide) slide.classList.add(CSS + "-started");
      self.keepAwake(true);
      self.mediaState("playing");
    });
    v.addEventListener("loadedmetadata", function () {
      var k = self.scenes.indexOf(v._scene);
      if (self.slides[k]) self.fitVideo(v, self.slides[k]);
    });
    v.addEventListener("timeupdate", function () {
      var sc = v._scene;
      if (!sc || sc !== self.scenes[self.index]) return;
      if (Core.clipOver(sc, v.currentTime)) return self.clipEnded(v);
      var tr = self.trackers[sc.id];
      if (tr && tr.update(v.currentTime)) self.countPlay(sc, tr);
    });
    v.addEventListener("pause", function () {
      var sc = v._scene, tr = sc && self.trackers[sc.id];
      if (tr) tr.pause();
      // (a video paused because another scene came into view is not the current one any more)
      if (sc && sc === self.scenes[self.index]) {
        self.keepAwake(false);
        self.mediaState("paused");
      }
    });
    // only without loop (setting "autoAdvance"): on to the next clip, or the last one from the start
    v.addEventListener("ended", function () {
      if (v._scene && v._scene === self.scenes[self.index]) self.clipEnded(v);
    });
    v.addEventListener("error", function () {
      var sc = v._scene;
      if (!sc || !v.getAttribute("src")) return;
      if (!v._transcoded) {
        v._transcoded = true;
        v.src = Core.transcodeUrl(sc);
        v.load();
        if (sc === self.scenes[self.index]) self.playCurrent(v);
        return;
      }
      var k = self.scenes.indexOf(sc);
      if (self.slides[k]) self.slides[k].classList.add(CSS + "-failed");
    });
  };

  // -- play count (sceneAddPlay once per scene and visit of the page, after playCountAfter seconds)

  ShortsView.prototype.countPlay = function (sc, tr) {
    var self = this;
    tr.markReported();
    // once per scene and visit, also when its markers are shown too
    if (this.settings.disablePlayCount || this.counted[sc.sceneId]) return;
    this.counted[sc.sceneId] = true;
    gql("mutation StashShortsPlay($id: ID!) { sceneAddPlay(id: $id) { count } }", { id: sc.sceneId })
      .then(function (d) {
        sc.play_count = d.sceneAddPlay.count;
        self.syncScene(sc, "play_count");
      })
      .catch(function (e) {
        self.counted[sc.sceneId] = false;
        console.warn(PLUGIN_ID + ": " + e.message);
      });
  };

  // -- slides

  ShortsView.prototype.renderSlide = function (k) {
    var self = this, t = this.t, sc = this.scenes[k];
    // landscape and square scenes (setting "allowLandscape"): the video across the full width, centred, and
    // the scene's screenshot blurred behind it; no second video element
    var gallery = sc.kind === "gallery";
    var wide = sc.width > 0 && sc.width >= sc.height;
    var slide = el("section", { class: CSS + "-slide" + (wide ? " " + CSS + "-wide" : "") + (gallery ? " " + CSS + "-gallery" : ""), "data-index": k,
      "data-scene": gallery ? null : sc.sceneId, "data-gallery": gallery ? sc.galleryId : null, style: "top:" + k * 100 + "%" });
    var media = el("div", { class: CSS + "-media" });
    // a gallery: its pictures in a row (drawPictures), the one shown and its neighbours with a source
    if (gallery) media.appendChild(el("div", { class: CSS + "-pics" }));
    else if (sc.screenshot) {
      media.appendChild(el("img", { class: CSS + "-poster", src: sc.screenshot, alt: "", decoding: "async" }));
    }
    slide.appendChild(media);
    slide.appendChild(el("div", { class: CSS + "-failed-note", text: t("cannotPlay") }));
    slide.appendChild(el("div", { class: CSS + "-shade" }));

    // bottom left: the main performer with avatar, favorite heart and Subscribe; the others after "with";
    // then the title (one line, a tap unfolds it with the post text) and studio and date. Each name once
    // (Core.sceneCaption, Core.captionPeople).
    var channelId = this.ctx.kind === "performer" ? this.ctx.id : null;
    var cap = Core.sceneCaption(sc, channelId);
    var people = Core.captionPeople(sc.performers, channelId);
    var info = el("div", { class: CSS + "-info" });
    if (this.settings.quickActions) info.appendChild(this.quickRow(sc, slide));
    if (people.main) info.appendChild(this.creatorRow(people.main));
    if (people.others.length) {
      var withLine = el("p", { class: CSS + "-with" }, [el("span", { text: t("with") + " " })]);
      people.others.forEach(function (p, n) {
        if (n) withLine.appendChild(el("span", { text: ", " }));
        withLine.appendChild(self.channelLink(CSS + "-with-name", p, [p.name]));
      });
      info.appendChild(withLine);
    }
    // a marker's primary tag as a chip (not when it already is the title)
    if (sc.marker && sc.marker.tag && sc.marker.tag !== cap.title) info.appendChild(el("span", { class: CSS + "-tag", text: sc.marker.tag }));
    var text = el("button", { type: "button", class: CSS + "-text", "aria-expanded": "false" });
    if (cap.title) text.appendChild(el("h2", { class: CSS + "-title", text: cap.title }));
    if (sc.details && !sc.marker) text.appendChild(el("p", { class: CSS + "-details", text: sc.details }));
    var line = [];
    if (cap.studio) line.push(this.link(CSS + "-studio", "studios/" + cap.studio.id, [cap.studio.text], sc.studio.name));
    if (cap.studio && sc.date) line.push(el("span", { class: CSS + "-sep", "aria-hidden": "true", text: " · " }));
    if (sc.date) line.push(el("span", { class: CSS + "-date", text: this.i18n.date(sc.date) }));
    if (text.childNodes.length) {
      text.setAttribute("aria-label", t("showMore"));
      text.addEventListener("click", function () {
        if (now() - (self.swipedAt || 0) < 400) return; // the end of a swipe that began on the text
        var open = !info.classList.contains(CSS + "-unfolded");
        info.classList.toggle(CSS + "-unfolded", open);
        text.setAttribute("aria-expanded", open ? "true" : "false");
      });
      info.appendChild(text);
    }
    if (line.length) info.appendChild(el("p", { class: CSS + "-names" }, line));
    // unfolded: the whole text and everything else in the detail sheet
    if (!gallery) info.appendChild(el("button", { type: "button", class: CSS + "-pill " + CSS + "-details-link", text: t("allDetails"), onclick: function () {
      self.openDetails(sc, "details");
    } }));
    slide.appendChild(info);

    // right: the side previews (related performers), the main performer, rating, orgasms, markers, More
    var actions = el("div", { class: CSS + "-actions" });
    if (!this.settings.disableRelated) {
      var rel = el("div", { class: CSS + "-related", "aria-label": t("related") });
      actions.appendChild(rel);
      this.drawRelated(sc, rel);
    }
    // the main performer: a tap on the picture opens the profile
    if (people.main) actions.appendChild(this.profileButton(people.main));
    actions.appendChild(this.ratingControl(sc));
    // (in a gallery the orgasms of the picture shown)
    var oCount = el("span", { class: CSS + "-count", text: this.i18n.n(gallery ? 0 : sc.o_counter) });
    actions.appendChild(
      el("div", { class: CSS + "-action" }, [
        (function () {
          var b = button(CSS + "-o", t("addO"), "drop", function () {
            if (b._held) return (b._held = false); // the click after holding the button
            self.addO(sc, oCount, b);
            self.splashFrom(b);
          });
          self.holdToRemoveO(b, sc, oCount);
          return b;
        })(),
        oCount,
      ])
    );
    if (!gallery)
      actions.appendChild(el("div", { class: CSS + "-action" }, [
        button(CSS + "-markers", t("markersOf", { count: sc.markerCount }), "markers", function () {
          self.openDetails(sc, "markers");
        }),
        el("span", { class: CSS + "-count", text: this.i18n.n(sc.markerCount) }),
      ]));
    actions.appendChild(el("div", { class: CSS + "-action" }, [
      button(CSS + "-more", t("more"), "more", function () {
        self.openMore(sc);
      }),
    ]));
    slide.appendChild(actions);

    if (gallery) {
      // at the top: which picture, "3 / 24"
      slide.appendChild(el("div", { class: CSS + "-pic-count", "aria-live": "polite" }));
      this.track.appendChild(slide);
      this.slides[k] = slide;
      this.drawPictures(slide, sc);
      this.loadPictures(sc);
      return slide;
    }

    // bottom: progress bar (tap to seek)
    var bar = el("div", { class: CSS + "-progress", role: "slider", "aria-label": t("progress"), tabindex: "-1" }, [el("div", { class: CSS + "-progress-fill" })]);
    bar.addEventListener("pointerdown", function (e) {
      e.stopPropagation();
      var v = self.currentVideo();
      if (!v || v._scene !== sc) return;
      var r = bar.getBoundingClientRect();
      v.currentTime = Core.clipSeek(sc, e.clientX - r.left, r.width, v.duration);
      var tr = self.trackers[sc.id];
      if (tr) tr.pause(); // a seek is not played time
      self.drawProgress();
    });
    slide.appendChild(bar);

    this.track.appendChild(slide);
    this.slides[k] = slide;
    return slide;
  };

  ShortsView.prototype.dropSlide = function (k) {
    var slide = this.slides[k];
    if (!slide) return;
    var self = this;
    this.videos.forEach(function (v) {
      if (v.parentNode && slide.contains(v)) {
        self.freeVideo(v);
        var s = self.videos.indexOf(v);
        self.slots[s] = null;
      }
    });
    slide.remove();
    delete this.slides[k];
  };

  // An <a> that Stash's router handles (in-app navigation), with a normal href for new tabs.
  // instead(): a plain click that it handles (returns true) does not navigate.
  ShortsView.prototype.link = function (cls, path, children, label, suffix, instead) {
    var self = this;
    var a = el("a", { class: cls, href: path, title: label, "aria-label": label }, children);
    a.addEventListener("click", function (e) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (instead && instead()) return;
      self.history.push("/" + path + (suffix ? suffix() : ""));
    });
    if (suffix)
      a.addEventListener("pointerenter", function () {
        a.setAttribute("href", path + suffix());
      });
    return a;
  };

  // A link that opens a performer's channel (their page: the name at the top there, or a second tap); the
  // href stays for a new tab and the browser's own menu on a long press.
  ShortsView.prototype.channelLink = function (cls, p, children) {
    var self = this;
    return this.link(cls, "performers/" + p.id, children, this.t("channel", { name: p.name }), null, function () {
      if (self.ctx.kind === "performer" && self.ctx.id === p.id) return false;
      self.openChannel(p);
      return true;
    });
  };

  // the main performer in the caption: avatar and name (their channel), the favorite heart, Subscribe
  // the main performer in the caption: the name opens their profile (their picture is the profile button
  // in the column); the heart (Stash's favorite) and Subscribe
  ShortsView.prototype.creatorRow = function (p) {
    var self = this, t = this.t;
    var name = el("button", { type: "button", class: CSS + "-creator-name", text: p.name, title: t("profileOf", { name: p.name }), onclick: function () {
      self.openProfile(p);
    } });
    return el("div", { class: CSS + "-creator-row" }, [name, this.favoriteButton(p), this.subscribeButton(p)]);
  };

  // The profile button at the top of the column: the main performer's picture opens their profile
  // (subscribing is the Subscribe in the caption and in the profile).
  ShortsView.prototype.profileButton = function (p) {
    var self = this, t = this.t;
    var img = p.image ? el("img", { src: p.image, alt: "", loading: "lazy", decoding: "async" }) : icon("person");
    var pic = el("button", { type: "button", class: CSS + "-profile-pic", "aria-label": t("profileOf", { name: p.name }), title: p.name, onclick: function () {
      self.openProfile(p);
    } }, [img]);
    return el("div", { class: CSS + "-action " + CSS + "-profile-action" }, [pic]);
  };

  ShortsView.prototype.favoriteButton = function (p) {
    var self = this;
    var fav = button(CSS + "-fav", "", null, function () {
      self.toggleFavorite(p);
    }, { "data-performer": p.id });
    this.drawFavorite(fav, p);
    return fav;
  };

  ShortsView.prototype.subscribeButton = function (p) {
    var self = this, t = this.t;
    var sub = el("button", { type: "button", class: CSS + "-subscribe", "data-subscribe": p.id, onclick: function () {
      self.toggleSubscribe(p).then(function (on) {
        if (on && self.settings.splashOnSubscribe) self.splashFrom(sub);
      });
    } });
    sub._draw = function (q) {
      var on = !!q.subscribed;
      sub.innerHTML = "";
      sub.appendChild(icon(on ? "subscribed" : "subscribe"));
      sub.appendChild(el("span", { text: t(on ? "subscribed" : "subscribe") }));
      sub.classList.toggle(CSS + "-on", on);
      sub.setAttribute("aria-pressed", on ? "true" : "false");
      sub.setAttribute("aria-label", t(on ? "unsubscribeFrom" : "subscribeTo", { name: q.name }));
    };
    sub._draw(p);
    return sub;
  };

  // Side previews: up to Core.RELATED_MAX tiles of related performers (Core.related) with their picture and
  // name; a tap opens their channel. Pictures only, so the limit of three videos stays. Filled once the
  // library and the performers' names are there (both loaded once per visit).
  ShortsView.prototype.drawRelated = function (sc, box) {
    var self = this, t = this.t;
    Promise.all([this.loadLibrary(), loadNames(), loadRefs(this.settings.allowLandscape)])
      .then(function (r) {
        if (!box.isConnected) return; // the slide went meanwhile
        var byId = {}, fav = {};
        r[1].findPerformers.performers.forEach(function (p) {
          byId[String(p.id)] = p;
          if (p.favorite) fav[String(p.id)] = true;
        });
        Object.keys(self.performers).forEach(function (id) {
          if (self.performers[id].favorite) fav[id] = true;
        });
        Core.related(sc, r[0], fav, Core.RELATED_MAX, r[2].performers).forEach(function (id) {
          var raw = byId[id];
          if (!raw) return;
          var p = self.sharedPerformer(raw);
          box.appendChild(el("button", { type: "button", class: CSS + "-rel", "data-performer": id, "aria-label": t("channel", { name: p.name }), title: p.name, onclick: function () {
            self.openChannel(p);
          } }, [p.image ? el("img", { src: p.image, alt: "", loading: "lazy", decoding: "async" }) : icon("person"), el("span", { text: p.name })]));
        });
      })
      .catch(function () {
        /* no previews */
      });
  };

  // Quick actions (setting "quickActions"): a row above the caption with the rating 1 to 5, an orgasm, and
  // the tags of the setting "quickTags" as toggles on the scene (not on a gallery). Scrolls sideways.
  ShortsView.prototype.quickRow = function (sc, slide) {
    var self = this, t = this.t, row = el("div", { class: CSS + "-quick", role: "toolbar", "aria-label": t("quickActions") });
    var stars = el("div", { class: CSS + "-quick-stars", "data-rate": sc.id });
    var starBtns = [1, 2, 3, 4, 5].map(function (n) {
      var b = el("button", { type: "button", class: CSS + "-quick-btn", "aria-label": t("stars", { count: n }), onclick: function () {
        self.rate(sc, Core.ratingAfterClick(sc.rating100, n));
      } }, [icon("star")]);
      stars.appendChild(b);
      return b;
    });
    stars._draw = function () {
      var n = Core.ratingStars(sc.rating100);
      starBtns.forEach(function (b, i) {
        b.classList.toggle(CSS + "-on", i < n);
        b.setAttribute("aria-pressed", i < n ? "true" : "false");
      });
    };
    stars._draw();
    row.appendChild(stars);
    // the orgasm: the column's drop button, so count, Undo and splash are the same
    row.appendChild(el("button", { type: "button", class: CSS + "-quick-btn " + CSS + "-quick-o", "aria-label": t("addO"), onclick: function () {
      var b = slide.querySelector("." + CSS + "-actions ." + CSS + "-o");
      if (b && !b.disabled) b.click();
    } }, [icon("drop")]));
    if (sc.kind !== "gallery")
      Core.quickTagIds(this.settings.quickTags).forEach(function (id) {
        var chip = el("button", { type: "button", class: CSS + "-quick-tag", "data-tag": id, onclick: function () {
          self.toggleTag(sc, id);
        } });
        chip._draw = function () {
          var on = sc.tags.some(function (x) {
            return x.id === id;
          });
          var name = (self.tagNames && self.tagNames[id]) || "#" + id;
          chip.textContent = name;
          chip.classList.toggle(CSS + "-on", on);
          chip.setAttribute("aria-pressed", on ? "true" : "false");
          chip.setAttribute("aria-label", t(on ? "removeTag" : "addTag", { name: name }));
        };
        chip._draw();
        row.appendChild(chip);
      });
    if (!this.tagNames && Core.quickTagIds(this.settings.quickTags).length)
      loadNames()
        .then(function (d) {
          var map = {};
          d.findTags.tags.forEach(function (x) {
            map[String(x.id)] = x.name;
          });
          self.tagNames = map;
          self.root.querySelectorAll("." + CSS + "-quick-tag").forEach(function (c) {
            c._draw();
          });
        })
        .catch(function () {
          /* the chips keep their ids */
        });
    return row;
  };

  // a quick tag on or off: the scene's whole tag list with it added or taken out (Core.toggledTags); shown at
  // once, taken back on failure
  ShortsView.prototype.toggleTag = function (sc, id) {
    var self = this, before = sc.tags;
    function draw() {
      self.root.querySelectorAll("." + CSS + "-slide[data-scene=\"" + sc.sceneId + "\"] ." + CSS + "-quick-tag[data-tag=\"" + id + "\"]").forEach(function (c) {
        c._draw();
      });
    }
    var want = Core.toggledTags(sc.tags, id);
    sc.tags = want.map(function (x) {
      return { id: x, name: (before.filter(function (y) {
        return y.id === x;
      })[0] || { name: (self.tagNames && self.tagNames[x]) || "" }).name };
    });
    draw();
    return gql(Core.TAGS_MUTATION, { i: { id: sc.sceneId, tag_ids: want } })
      .then(function (d) {
        sc.tags = d.sceneUpdate.tags.map(function (x) {
          return { id: String(x.id), name: x.name };
        });
        self.syncScene(sc, "tags");
        draw();
      })
      .catch(function (e) {
        sc.tags = before;
        draw();
        self.toast(self.t("error", { message: e.message }));
      });
  };

  // Share: the phone's share sheet where there is one, else the clipboard (only on HTTPS or localhost), else
  // a sheet with the link selected to copy by hand (Stash on plain HTTP in the home network)
  ShortsView.prototype.shareScene = function (sc) {
    var gallery = sc.kind === "gallery";
    var self = this, t = this.t, url = Core.shareUrl(location.href, gallery ? sc.galleryId : sc.sceneId, sc.kind);
    var title = sc.title || "";
    function byHand() {
      var input = el("input", { type: "text", class: CSS + "-input", readonly: true, value: url, "aria-label": t("copyLink") });
      var s = self.sheet(t("share"));
      s.body.appendChild(el("p", { class: CSS + "-muted", text: t("copyByHand") }));
      s.body.appendChild(input);
      input.focus();
      input.select();
    }
    function copy() {
      if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText)
        return navigator.clipboard.writeText(url).then(function () {
          self.toast(t("linkCopied"));
        }, byHand);
      byHand();
    }
    if (navigator.share && (!navigator.canShare || navigator.canShare({ url: url })))
      return navigator.share({ title: title, url: url }).catch(function (e) {
        if (!e || e.name !== "AbortError") copy(); // closing the share sheet is not a failure
      });
    copy();
  };

  // More: the scene and its performers in Stash, Share, the filters
  ShortsView.prototype.openMore = function (sc) {
    var self = this, t = this.t;
    var s = this.sheet(sc.title || t("more"), { cls: CSS + "-menu" });
    function item(iconName, label, act) {
      return el("button", { type: "button", class: CSS + "-item", onclick: act }, [icon(iconName), el("span", { text: label })]);
    }
    var v = this.currentVideo(), at = v && v._scene === sc && v.currentTime > 1 ? "?t=" + Math.floor(v.currentTime) : "";
    if (sc.kind === "gallery")
      s.body.appendChild(item("open", t("openGalleryInStash"), function () {
        s.close();
        self.history.push("/galleries/" + sc.galleryId);
      }));
    else {
      s.body.appendChild(item("markers", t("allDetails"), function () {
        self.openDetails(sc, "details");
      }));
      s.body.appendChild(item("open", t("openScene"), function () {
        s.wasPlaying = false;
        s.close();
        self.history.push("/scenes/" + sc.sceneId + at);
      }));
    }
    sc.performers.forEach(function (p) {
      s.body.appendChild(item("people", t("profileOf", { name: p.name }), function () {
        s.close();
        self.openProfile(p);
      }));
      s.body.appendChild(item("person", t("openPerformer", { name: p.name }), function () {
        s.wasPlaying = false;
        s.close();
        self.history.push("/performers/" + p.id);
      }));
    });
    s.body.appendChild(item("share", t("share"), function () {
      s.close();
      self.shareScene(sc);
    }));
    s.body.appendChild(item("sliders", t("filters"), function () {
      s.close();
      self.openDialog();
    }));
    if (readSummaries().length)
      s.body.appendChild(item("play", t("recentSessions"), function () {
        s.close();
        self.openSessions();
      }));
  };

  // -- creator profile (/shorts?profile=<id>): a full screen view over the feed, with its own history entry.
  // Head with banner, avatar, handle, Subscribe, bio and numbers; tabs Posts (scenes and galleries by date),
  // Media (videos and pictures) and Favorites, loaded page by page as they scroll into view.
  var PROFILE_PAGE = 20;
  ShortsView.prototype.openProfile = function (p, fromHistory, linked) {
    var self = this, t = this.t;
    if (!this.settings) return;
    if (this.profileView) this.closeProfile(true);
    if (this.dialog) this.dialog.close();
    var id = String(p.id), current = this.currentVideo();
    var view = (this.profileView = { id: id, gen: 0, linked: !!linked,
      wasPlaying: !!(current && !current.paused), video: current });
    if (view.wasPlaying) current.pause();
    // gestures, wheel and keys of the feed are off while it is open; Esc closes it
    this.dialog = { close: function () {
      self.closeProfile();
    }, profile: true };
    if (!fromHistory) {
      var url = this.contextUrl(this.ctx);
      this.history.push(url + (url.indexOf("?") >= 0 ? "&" : "?") + "profile=" + encodeURIComponent(id));
      this.entries++;
    }
    var scroll = el("div", { class: CSS + "-profile-scroll" });
    var root = (view.el = el("section", { class: CSS + "-profile", role: "dialog", "aria-modal": "true", "aria-label": p.name || t("profile") }, [
      el("div", { class: CSS + "-profile-top" }, [
        button(CSS + "-back", t("back"), "back", function () {
          self.closeProfile();
        }),
        (view.titleEl = el("span", { class: CSS + "-profile-title", text: p.name || "" })),
        (view.stashLink = this.link(CSS + "-btn " + CSS + "-open", "performers/" + id, [icon("open")], t("openPerformer", { name: p.name || "" }))),
      ]),
      scroll,
    ]));
    view.scroll = scroll;
    scroll.appendChild(el("p", { class: CSS + "-muted " + CSS + "-profile-loading", text: t("loadingDetails") }));
    this.root.appendChild(root);
    root.querySelector("." + CSS + "-back").focus();
    gql(Core.PROFILE_QUERY, { id: id })
      .then(function (d) {
        if (self.profileView !== view) return;
        if (!d.findPerformer) {
          scroll.innerHTML = "";
          return scroll.appendChild(el("p", { class: CSS + "-muted", text: t("noPerformerFound") }));
        }
        self.drawProfile(view, d.findPerformer);
      })
      .catch(function (e) {
        if (self.profileView === view) scroll.textContent = t("error", { message: e.message });
      });
  };

  ShortsView.prototype.closeProfile = function (fromHistory) {
    var view = this.profileView;
    if (!view) return;
    this.profileView = null;
    if (this.dialog && this.dialog.profile) this.dialog = null;
    if (view.observer) view.observer.disconnect();
    view.el.remove();
    if (fromHistory) this.entries = Math.max(0, this.entries - 1);
    else if (view.linked || !this.history.goBack) this.history.replace(this.contextUrl(this.ctx));
    else {
      this.history.goBack(); // its popstate finds the profile closed and the context as it is
      this.entries = Math.max(0, this.entries - 1);
    }
    var v = view.video;
    if (view.wasPlaying && v && v._scene === this.scenes[this.index] && !this.destroyed) this.playCurrent(v);
  };

  // the performer as the feed shares them (favorite and subscription stay in step everywhere)
  ShortsView.prototype.sharedPerformer = function (raw) {
    var id = String(raw.id), p = this.performers[id];
    if (!p) p = this.performers[id] = { id: id, name: raw.name, favorite: !!raw.favorite, image: Core.localUrl(raw.image_path) };
    p.name = raw.name || p.name;
    if (raw.favorite != null) p.favorite = !!raw.favorite;
    if (raw.image_path) p.image = Core.localUrl(raw.image_path);
    p.subscribed = this.subscribed ? !!this.subscribed[id] : Core.isSubscribed(raw.custom_fields);
    return p;
  };

  // A FontAwesome icon from Stash's plugin API (PluginApi.libraries), with Stash's classes; null outside
  // Stash (the demo), where the plugin's own icon stands in.
  function faIcon(library, name) {
    var lib = window.PluginApi && window.PluginApi.libraries && window.PluginApi.libraries[library];
    var def = lib && lib[name];
    if (!def || !def.icon) return null;
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + def.icon[0] + " " + def.icon[1]);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "svg-inline--fa fa-icon " + CSS + "-icon");
    [].concat(def.icon[4]).forEach(function (d) {
      var path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "currentColor");
      svg.appendChild(path);
    });
    return svg;
  }

  // One group of a performer's links (Core.linkGroups) as Stash's performer page shows it: a button with
  // the group's icon and a menu of the links, with Stash's own classes (external-links-button, minimal,
  // dropdown-menu, dropdown-item), so it looks like the rest of Stash. The menu opens below the button and
  // closes with a tap outside it, a link or Esc.
  ShortsView.prototype.linksButton = function (g) {
    var self = this, t = this.t;
    var toggle = el("button", { type: "button", class: "btn btn-primary minimal link " + (g.kind === "link" ? "" : g.kind + " ") + CSS + "-links-toggle",
      "aria-haspopup": "true", "aria-expanded": "false", "aria-label": t("links", { count: g.urls.length }), title: t("links", { count: g.urls.length }) },
      [faIcon(g.library, g.icon) || icon("open")]);
    var menu = el("div", { class: "dropdown-menu " + CSS + "-links-menu", role: "menu" }, g.urls.map(function (u) {
      return el("a", { class: "dropdown-item", role: "menuitem", href: u, title: u, target: "_blank", rel: "noopener noreferrer", text: u, onclick: function () {
        close();
      } });
    }));
    var box = el("div", { class: "dropdown external-links-button " + CSS + "-links" }, [toggle, menu]);
    function onDoc(e) {
      if (!box.contains(e.target)) close();
    }
    function onKey(e) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
      toggle.focus();
    }
    function close() {
      menu.classList.remove("show");
      box.classList.remove("show");
      toggle.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", onDoc, true);
      box.removeEventListener("keydown", onKey);
    }
    toggle.addEventListener("click", function () {
      if (menu.classList.contains("show")) return close();
      menu.classList.add("show");
      box.classList.add("show");
      // to the right of the button, or to its left where the screen ends
      menu.style.left = "0";
      menu.style.right = "auto";
      if (menu.getBoundingClientRect().right > window.innerWidth - 8) {
        menu.style.left = "auto";
        menu.style.right = "0";
      }
      toggle.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", onDoc, true);
      box.addEventListener("keydown", onKey);
      self.cleanup.push(close);
    });
    return box;
  };

  ShortsView.prototype.drawProfile = function (view, raw) {
    var self = this, t = this.t, n = this.i18n.n.bind(this.i18n), scroll = view.scroll;
    var p = this.sharedPerformer(raw);
    view.performer = p;
    view.titleEl.textContent = p.name;
    scroll.innerHTML = "";
    // banner: the screenshot of their best rated scene in the feed's format
    var banner = el("div", { class: CSS + "-banner" });
    scroll.appendChild(banner);
    // (the same query counts their scenes in the feed's format: Posts and Media count what the tabs show)
    var posts = el("span", { text: "" }), media = el("span", { text: "" });
    gql(Core.SCENES_QUERY, { f: Core.profilePage(1, 1, "rating"), s: Core.profileSceneFilter(p.id, this.settings.allowLandscape) })
      .then(function (d) {
        var sc = d.findScenes.scenes[0], src = sc && Core.localUrl(sc.paths && sc.paths.screenshot);
        if (src) banner.appendChild(el("img", { src: src, alt: "", decoding: "async" }));
        posts.textContent = n(d.findScenes.count + (raw.gallery_count || 0));
        media.textContent = n(d.findScenes.count + (raw.image_count || 0));
      })
      .catch(function () {
        /* the banner stays plain, the numbers empty */
      });
    var img = p.image ? el("img", { src: p.image, alt: "", decoding: "async" }) : icon("person");
    var bio = raw.details ? el("p", { class: CSS + "-bio", text: raw.details }) : null;
    if (bio)
      bio.addEventListener("click", function () {
        bio.classList.toggle(CSS + "-unfolded");
      });
    var links = Core.linkGroups(raw.urls).map(function (g) {
      return self.linksButton(g);
    });
    var stars = Core.ratingStars(raw.rating100);
    function stat(value, label, iconName) {
      var v = typeof value === "string" ? el("span", { text: value }) : value;
      return el("div", { class: CSS + "-stat" }, [el("strong", null, [v, iconName ? icon(iconName) : null]), el("span", { text: label })]);
    }
    scroll.appendChild(
      el("div", { class: CSS + "-profile-head" }, [
        el("span", { class: CSS + "-profile-avatar" }, [img]),
        el("div", { class: CSS + "-profile-actions" }, links.concat([this.favoriteButton(p), this.subscribeButton(p)])),
        el("h2", { class: CSS + "-profile-name", text: p.name }),
        el("p", { class: CSS + "-at", text: [Core.handleOf(p.name), raw.disambiguation].filter(Boolean).join(" · ") }),
        bio,
        el("div", { class: CSS + "-stats" }, [
          stat(posts, t("statPosts")),
          stat(media, t("statMedia")),
          stat(n(raw.o_counter || 0), t("statLikes")),
          stat(stars ? n(stars) : "-", t("statRating"), stars ? "star" : null),
        ]),
      ])
    );
    var tabs = el("div", { class: CSS + "-tabs " + CSS + "-profile-tabs", role: "tablist" });
    var panel = el("div", { class: CSS + "-profile-panel", role: "tabpanel" });
    var sentinel = el("div", { class: CSS + "-sentinel", "aria-hidden": "true" });
    scroll.appendChild(tabs);
    scroll.appendChild(panel);
    scroll.appendChild(sentinel);
    var labels = { posts: t("tab_posts"), media: t("tab_media"), favorites: t("tab_favorites") };
    ["posts", "media", "favorites"].forEach(function (name) {
      tabs.appendChild(el("button", { type: "button", role: "tab", class: CSS + "-tab", "data-tab": name, onclick: function () {
        self.profileTab(view, name, panel, tabs);
      } }, [labels[name]]));
    });
    view.observer = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) {
        return e.isIntersecting;
      }) && view.more) view.more();
    }, { root: scroll, rootMargin: "600px 0px" });
    view.observer.observe(sentinel);
    this.profileTab(view, "posts", panel, tabs);
  };

  // one tab of the profile: its list, loaded page by page (Core.takeByDate merges two sources by date)
  ShortsView.prototype.profileTab = function (view, name, panel, tabs) {
    var self = this, t = this.t, p = view.performer, wide = this.settings.allowLandscape;
    tabs.querySelectorAll("button").forEach(function (b) {
      var on = b.getAttribute("data-tab") === name;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.classList.toggle(CSS + "-on", on);
    });
    panel.innerHTML = "";
    panel.className = CSS + "-profile-panel " + CSS + (name === "posts" ? "-posts" : "-grid");
    var gen = ++view.gen;
    function source(fetch) {
      var src = { items: [], done: false, page: 0, busy: null };
      src.fill = function () {
        if (src.busy || src.done) return src.busy || Promise.resolve();
        return (src.busy = fetch(src.page + 1).then(function (r) {
          src.page++;
          src.items = src.items.concat(r.items);
          if (r.items.length < PROFILE_PAGE || src.page * PROFILE_PAGE >= r.count) src.done = true;
          src.busy = null;
        }, function (e) {
          src.busy = null;
          throw e;
        }));
      };
      return src;
    }
    var none = { items: [], done: true, fill: function () {
      return Promise.resolve();
    } };
    function scenes(filter, sort) {
      return source(function (page) {
        return gql(Core.SCENES_QUERY, { f: Core.profilePage(page, PROFILE_PAGE, sort), s: filter }).then(function (d) {
          return { count: d.findScenes.count, items: d.findScenes.scenes.map(function (raw) {
            return self.adopt(raw);
          }) };
        });
      });
    }
    var a, b;
    if (name === "favorites") {
      a = scenes(Core.profileFavoritesFilter(p.id, wide), "rating");
      b = none;
    } else {
      a = scenes(Core.profileSceneFilter(p.id, wide), "date");
      b = source(function (page) {
        return name === "posts"
          ? gql(Core.GALLERIES_QUERY, { f: Core.profilePage(page, PROFILE_PAGE), g: Core.profileGalleryFilter(p.id) }).then(function (d) {
              return { count: d.findGalleries.count, items: d.findGalleries.galleries.map(Core.normalizeGallery) };
            })
          : gql(Core.IMAGES_QUERY, { f: Core.profilePage(page, PROFILE_PAGE), i: Core.profileGalleryFilter(p.id) }).then(function (d) {
              return { count: d.findImages.count, items: d.findImages.images.map(function (im) {
                return { kind: "image", id: "i" + im.id, imageId: String(im.id), date: im.date || "", thumb: Core.localUrl(im.paths && im.paths.thumbnail),
                  galleryId: im.galleries && im.galleries[0] ? String(im.galleries[0].id) : null };
              }) };
            });
      });
    }
    var busy = false, shown = 0, finished = false;
    function stale() {
      return gen !== view.gen || self.profileView !== view;
    }
    // one page: take what is certain, load the source that is needed, until a page is full or all is shown
    function more() {
      if (busy || finished || stale()) return;
      busy = true;
      (function step(got) {
        var r = Core.takeByDate(a, b, PROFILE_PAGE - got);
        r.out.forEach(function (it) {
          panel.appendChild(name === "posts" ? self.postCard(view, it) : self.tile(view, it));
        });
        shown += r.out.length;
        got += r.out.length;
        if (got < PROFILE_PAGE && r.need)
          return (r.need === "a" ? a : b)
            .fill()
            .then(function () {
              if (!stale()) step(got);
            })
            .catch(function (e) {
              busy = false;
              if (!stale()) panel.appendChild(el("p", { class: CSS + "-muted", text: t("error", { message: e.message }) }));
            });
        busy = false;
        finished = !r.need && !a.items.length && !b.items.length;
        if (finished && !shown) panel.appendChild(el("p", { class: CSS + "-muted " + CSS + "-empty", text: t(name === "favorites" ? "noFavoritesYet" : "noPosts") }));
        // the end of the list may still be in view (a tall screen): the next page right away
        if (!finished)
          requestAnimationFrame(function () {
            var end = view.scroll.querySelector("." + CSS + "-sentinel");
            if (end && end.getBoundingClientRect().top < view.scroll.getBoundingClientRect().bottom + 600) more();
          });
      })(0);
    }
    view.more = more;
    more();
  };

  // a post in the profile: date and studio, the text, the picture (a tap opens the scene in their channel,
  // or the gallery), and its numbers
  ShortsView.prototype.postCard = function (view, it) {
    var self = this, t = this.t, gallery = it.kind === "gallery";
    var pic = gallery ? it.cover : it.screenshot;
    var media = el("button", { type: "button", class: CSS + "-post-media", "aria-label": gallery ? t("openGallery", { name: it.title || "" }) : t("playScene", { name: it.title || "" }), onclick: function () {
      self.openFromProfile(view, it);
    } });
    if (pic || it.preview) {
      var im = el("img", { src: !gallery && it.preview ? it.preview : pic, alt: "", loading: "lazy", decoding: "async" });
      // Stash gives the webp path also when no preview was generated
      im.addEventListener("error", function () {
        if (pic && im.getAttribute("src") !== pic) im.setAttribute("src", pic);
      });
      media.appendChild(im);
    }
    media.appendChild(el("span", { class: CSS + "-badge" }, gallery ? [icon("picture"), el("span", { text: this.i18n.n(it.imageCount) })] : [icon("play"), el("span", { text: Core.clock(it.duration) })]));
    var stars = Core.ratingStars(it.rating100);
    var foot = [];
    if (stars) foot.push(el("span", { class: CSS + "-post-num" }, [icon("star"), el("span", { text: this.i18n.n(stars) })]));
    if (!gallery) foot.push(el("span", { class: CSS + "-post-num" }, [icon("drop"), el("span", { text: this.i18n.n(it.o_counter) })]));
    if (!gallery && it.markerCount) foot.push(el("span", { class: CSS + "-post-num" }, [icon("markers"), el("span", { text: this.i18n.n(it.markerCount) })]));
    var text = it.details ? el("p", { class: CSS + "-post-text", text: it.details }) : null;
    if (text)
      text.addEventListener("click", function () {
        text.classList.toggle(CSS + "-unfolded");
      });
    return el("article", { class: CSS + "-post", "data-post": it.id }, [
      el("p", { class: CSS + "-post-meta" }, [
        el("span", { text: it.date ? this.i18n.date(it.date) : t("noDate") }),
        it.studio ? el("span", { text: " · " + it.studio.name }) : null,
      ]),
      it.title && it.titled !== false ? el("h3", { class: CSS + "-post-title", text: it.title }) : null,
      text,
      media,
      foot.length ? el("div", { class: CSS + "-post-foot" }, foot) : null,
    ]);
  };

  // a tile in the Media and Favorites grids
  ShortsView.prototype.tile = function (view, it) {
    var self = this, t = this.t, src = it.kind === "image" ? it.thumb : it.screenshot;
    var b = el("button", { type: "button", class: CSS + "-tile", "data-post": it.id, "aria-label": it.kind === "image" ? t("openPicture") : t("playScene", { name: it.title || "" }), onclick: function () {
      self.openFromProfile(view, it);
    } }, [src ? el("img", { src: src, alt: "", loading: "lazy", decoding: "async" }) : null]);
    b.appendChild(el("span", { class: CSS + "-badge" }, it.kind === "image" ? [icon("picture")] : [icon("play"), el("span", { text: Core.clock(it.duration) })]));
    return b;
  };

  // A tap on a post or tile: it plays in the performer's channel, starting with it (the profile's history
  // entry becomes the channel's); a picture opens its gallery there at that picture.
  ShortsView.prototype.openFromProfile = function (view, it) {
    var self = this, p = view.performer;
    // (a gallery of the profile list becomes the feed's entry first, which has its picture index "at")
    if ((it.kind === "gallery" && it.at == null) || it.kind === "image") {
      if (!it.galleryId) return;
      return this.galleryById(it.galleryId).then(function (g) {
        if (!g || self.profileView !== view) return;
        if (it.kind === "image") g.startImage = it.imageId;
        self.openFromProfile(view, g);
      });
    }
    view.wasPlaying = false; // the channel plays the scene, not the video behind the profile
    this.closeProfile(true);
    this.history.replace(this.contextUrl({ kind: "performer", id: p.id }));
    // in that channel already, openChannel adds no history entry: the replaced one still counts
    if (this.ctx.kind === "performer" && this.ctx.id === p.id) this.entries++;
    this.openChannel(p, true, it);
  };

  // -- galleries in the feed (setting "disableGalleries"): an entry shows one picture at a time; a sideways
  // swipe flips them, past the last one it opens the channel as on a video

  ShortsView.prototype.galleriesOn = function () {
    return !!(this.settings && !this.settings.disableGalleries);
  };

  // the pictures of a gallery entry, once (sc.images: [{ id, o_counter, thumb, image }])
  ShortsView.prototype.loadPictures = function (sc) {
    var self = this;
    if (sc.images || sc.imagesLoad) return sc.imagesLoad;
    sc.imagesLoad = gql(Core.GALLERY_IMAGES_QUERY, { i: { galleries: { value: [sc.galleryId], modifier: "INCLUDES" } } })
      .then(function (d) {
        sc.images = d.findImages.images.map(function (im) {
          return { id: String(im.id), o_counter: Number(im.o_counter) || 0, thumb: Core.localUrl(im.paths && im.paths.thumbnail), image: Core.localUrl(im.paths && im.paths.image) };
        });
        sc.at = Math.min(sc.at || 0, Math.max(0, sc.images.length - 1));
        // opened from a picture in the profile: at that picture
        if (sc.startImage) {
          sc.images.forEach(function (im, k) {
            if (im.id === sc.startImage) sc.at = k;
          });
          sc.startImage = null;
        }
        Object.keys(self.slides).forEach(function (k) {
          if (self.scenes[k] === sc) self.drawPictures(self.slides[k], sc);
        });
        if (self.scenes[self.index] === sc) self.galleryTimer();
      })
      .catch(function () {
        sc.imagesLoad = null; // tried again when the slide is drawn again
      });
    return sc.imagesLoad;
  };

  // the row of pictures: an element per picture, a source only for the one shown and its neighbours
  // (Core.galleryWindow); the count at the top and the orgasms of the picture shown
  ShortsView.prototype.drawPictures = function (slide, sc, dx) {
    var row = slide.querySelector("." + CSS + "-pics");
    if (!row) return;
    var list = sc.images || (sc.cover ? [{ id: null, image: sc.cover, thumb: sc.cover, o_counter: 0 }] : []);
    var at = Math.min(sc.at || 0, Math.max(0, list.length - 1)), keep = Core.galleryWindow(at, list.length);
    while (row.children.length < list.length) row.appendChild(el("div", { class: CSS + "-pic" }));
    while (row.children.length > list.length) row.lastChild.remove();
    [].forEach.call(row.children, function (cell, k) {
      cell.style.left = k * 100 + "%";
      var img = cell.firstChild, want = keep.indexOf(k) >= 0 ? list[k].image || list[k].thumb : null;
      if (want && !img) {
        img = el("img", { src: want, alt: "", decoding: "async", draggable: "false" });
        // close to the shape of the screen it fills it, as a video does (Core.fitMode)
        img.addEventListener("load", function () {
          var r = cell.getBoundingClientRect();
          cell.classList.toggle(CSS + "-fill", Core.fitMode(img.naturalWidth, img.naturalHeight, r.width, r.height) === "cover");
        });
        cell.appendChild(img);
      }
      else if (want && img.getAttribute("src") !== want) img.setAttribute("src", want);
      else if (!want && img) img.remove(); // further away: no source, so not more than three are loaded
    });
    row.style.transition = dx ? "none" : "";
    row.style.transform = "translate3d(calc(" + -at * 100 + "% + " + (dx || 0) + "px),0,0)";
    var count = slide.querySelector("." + CSS + "-pic-count");
    if (count) count.textContent = sc.images ? this.i18n.n(at + 1) + " / " + this.i18n.n(sc.images.length) : "";
    var o = slide.querySelector("." + CSS + "-o + ." + CSS + "-count");
    if (o) o.textContent = this.i18n.n(sc.images && sc.images[at] ? sc.images[at].o_counter : 0);
  };

  // dir +1 the next picture, -1 the one before; false when there is none (the swipe is the channel's then)
  ShortsView.prototype.canFlip = function (sc, dir) {
    if (!sc || sc.kind !== "gallery" || !sc.images) return false;
    var to = (sc.at || 0) + dir;
    return to >= 0 && to < sc.images.length;
  };
  ShortsView.prototype.flip = function (dir) {
    var sc = this.scenes[this.index], slide = this.slides[this.index];
    if (!this.canFlip(sc, dir)) return false;
    sc.at += dir;
    this.hideUndo(); // its Undo belongs to the picture before
    this.drawPictures(slide, sc);
    this.galleryTimer();
    return true;
  };

  // "Next clip at the end" on a gallery: each picture for galleryImageSeconds, after the last one the next
  // entry (the last entry starts over at its first picture)
  ShortsView.prototype.galleryTimer = function () {
    var self = this, sc = this.scenes[this.index];
    clearTimeout(this.picTimer);
    if (!sc || sc.kind !== "gallery" || !sc.images || !(this.settings && this.settings.autoAdvance)) return;
    this.picTimer = setTimeout(function () {
      if (self.destroyed || self.scenes[self.index] !== sc || self.dialog || self.held) return self.galleryTimer();
      if (self.flip(1)) return;
      var what = Core.endAction(true, self.index, self.scenes.length);
      if (what === "next") return self.go(self.index + 1);
      sc.at = 0;
      self.drawPictures(self.slides[self.index], sc);
      self.galleryTimer();
    }, (this.settings.galleryImageSeconds || 4) * 1000);
  };

  // one gallery by id, without the filter (a link opens it whatever the feed shows)
  ShortsView.prototype.galleryById = function (id) {
    var self = this;
    return gql(Core.GALLERIES_BY_IDS_QUERY, { ids: [id] })
      .then(function (d) {
        var g = d.findGalleries.galleries[0];
        return g ? self.adopt({ id: "g" + g.id, _gallery: g }) : null;
      })
      .catch(function () {
        return null;
      });
  };

  // -- detail sheet: markers (a tap jumps there), details, tags (a tap filters the feed), people. Loaded when
  // it opens (Core.DETAIL_QUERY), once per scene and visit; the video goes on behind it.
  ShortsView.prototype.loadDetails = function (sceneId) {
    var self = this;
    this.detailCache = this.detailCache || {};
    if (!this.detailCache[sceneId])
      this.detailCache[sceneId] = gql(Core.DETAIL_QUERY, { id: sceneId })
        .then(function (d) {
          return d.findScene;
        })
        .catch(function (e) {
          delete self.detailCache[sceneId];
          throw e;
        });
    return this.detailCache[sceneId];
  };

  var DETAIL_TABS = ["markers", "details", "tags", "people"];
  ShortsView.prototype.openDetails = function (sc, tab) {
    var self = this, t = this.t;
    var s = this.sheet(sc.title || t("allDetails"), { cls: CSS + "-details-sheet", keepPlaying: true });
    var tabs = el("div", { class: CSS + "-tabs", role: "tablist" });
    var panel = el("div", { class: CSS + "-tab-panel", role: "tabpanel" });
    s.dialog.insertBefore(tabs, s.body);
    s.body.appendChild(panel);
    var data = null, labels = { markers: t("tab_markers"), details: t("tab_details"), tags: t("tab_tags"), people: t("tab_people") };
    function show(name) {
      tab = name;
      tabs.querySelectorAll("button").forEach(function (b) {
        var on = b.getAttribute("data-tab") === name;
        b.setAttribute("aria-selected", on ? "true" : "false");
        b.classList.toggle(CSS + "-on", on);
      });
      panel.innerHTML = "";
      if (!data) return panel.appendChild(el("p", { class: CSS + "-muted", text: t("loadingDetails") }));
      self["details_" + name](sc, data, panel, s);
    }
    DETAIL_TABS.forEach(function (name) {
      tabs.appendChild(el("button", { type: "button", role: "tab", class: CSS + "-tab", "data-tab": name, onclick: function () {
        show(name);
      } }, [labels[name]]));
    });
    show(DETAIL_TABS.indexOf(tab) >= 0 ? tab : "details");
    this.loadDetails(sc.sceneId)
      .then(function (d) {
        if (s.closed) return;
        data = d || { scene_markers: [], tags: [], performers: [], urls: [] };
        show(tab);
      })
      .catch(function (e) {
        if (!s.closed) panel.textContent = t("error", { message: e.message });
      });
    return s;
  };

  ShortsView.prototype.details_markers = function (sc, d, panel, s) {
    var self = this, t = this.t;
    var list = (d.scene_markers || []).slice().sort(function (a, b) {
      return a.seconds - b.seconds;
    });
    if (!list.length) return panel.appendChild(el("p", { class: CSS + "-muted", text: t("noMarkers") }));
    list.forEach(function (m) {
      var tag = m.primary_tag ? m.primary_tag.name : "";
      var here = sc.marker && sc.marker.id === String(m.id);
      panel.appendChild(el("button", { type: "button", class: CSS + "-row" + (here ? " " + CSS + "-on" : ""), "data-marker": m.id, onclick: function () {
        s.close();
        self.jumpTo(sc, Number(m.seconds) || 0);
      } }, [
        el("span", { class: CSS + "-time", text: Core.clock(m.seconds) }),
        el("span", { class: CSS + "-row-main", text: m.title || tag }),
        m.title && tag ? el("span", { class: CSS + "-chip-small", text: tag }) : null,
      ]));
    });
  };

  ShortsView.prototype.details_details = function (sc, d, panel) {
    var t = this.t, rows = [];
    function row(label, value) {
      if (value) rows.push(el("div", { class: CSS + "-fact" }, [el("span", { class: CSS + "-label", text: label }), value]));
    }
    row(t("date"), d.date ? el("span", { text: this.i18n.date(d.date) }) : null);
    row(t("studio"), d.studio ? this.link(CSS + "-link", "studios/" + d.studio.id, [d.studio.name], d.studio.name) : null);
    row(t("code"), d.code ? el("span", { text: d.code }) : null);
    row(t("director"), d.director ? el("span", { text: d.director }) : null);
    rows.forEach(function (r) {
      panel.appendChild(r);
    });
    if (d.details) panel.appendChild(el("p", { class: CSS + "-fulltext", text: d.details }));
    (d.urls || []).forEach(function (u) {
      if (/^https?:\/\//i.test(u)) panel.appendChild(el("a", { class: CSS + "-link " + CSS + "-url", href: u, target: "_blank", rel: "noopener noreferrer", text: u }));
    });
    if (!panel.childNodes.length) panel.appendChild(el("p", { class: CSS + "-muted", text: t("noDetails") }));
  };

  ShortsView.prototype.details_tags = function (sc, d, panel, s) {
    var self = this, t = this.t;
    if (!(d.tags || []).length) return panel.appendChild(el("p", { class: CSS + "-muted", text: t("noTags") }));
    var box = el("div", { class: CSS + "-chips" });
    d.tags.forEach(function (tag) {
      box.appendChild(el("button", { type: "button", class: CSS + "-chip " + CSS + "-tag-chip", "aria-label": t("showTag", { name: tag.name }), onclick: function () {
        s.wasPlaying = false;
        s.close();
        // only this tag, the rest of the filter as stored
        self.showFilter(Object.assign(Core.filtersFrom(self.settings, null), { tags: String(tag.id) }));
      } }, [el("span", { text: tag.name })]));
    });
    panel.appendChild(box);
  };

  ShortsView.prototype.details_people = function (sc, d, panel, s) {
    var self = this, t = this.t;
    if (!sc.performers.length) return panel.appendChild(el("p", { class: CSS + "-muted", text: t("noPerformer") }));
    sc.performers.forEach(function (p) {
      // a tap on the name opens their profile (which closes the sheet)
      var row = self.creatorRow(p);
      row.classList.add(CSS + "-person");
      panel.appendChild(row);
    });
  };

  // A marker picked in the detail sheet: the playing scene seeks there; a marker clip becomes its whole
  // scene from that time (Core.jumpEntry), in its place in the feed.
  ShortsView.prototype.jumpTo = function (sc, seconds) {
    var v = this.currentVideo();
    if (!v || v._scene !== sc) return;
    var tr = this.trackers[sc.id];
    if (tr) tr.pause(); // a jump is not played time
    if (!sc.marker) {
      v.currentTime = seconds;
      this.paused = false;
      this.playCurrent(v);
      this.drawProgress();
      return;
    }
    var entry = Core.jumpEntry(this.sceneCache[sc.sceneId], seconds);
    if (!entry) return;
    this.scenes[this.index] = entry;
    this.dropSlide(this.index); // frees its video
    this.lastCurrent = null;
    this.paused = false;
    this.update();
  };

  // The splash: white drops rise from an element (the drop button, Subscribe) or a point and scatter over
  // the video, like hearts in a live app. One at a time per origin, so fast taps do not pile up nodes;
  // setting "disableSplash"; with reduced motion one drop fades (CSS).
  var SPLASH_DROPS = 8, SPLASH_MS = 1300;
  ShortsView.prototype.splashFrom = function (target) {
    var r = target.getBoundingClientRect();
    this.splash(r.left + r.width / 2, r.top + r.height / 2, target);
  };
  ShortsView.prototype.splash = function (x, y, owner) {
    if (!this.settings || this.settings.disableSplash) return;
    owner = owner || this.stage;
    if (owner._splash) return;
    var box = this.stage.getBoundingClientRect();
    // from the right edge (the drop button) the drops drift to the left, so they stay over the video
    var lean = x - box.left > box.width * 0.66 ? -1 : x - box.left < box.width * 0.33 ? 1 : 0;
    var wrap = el("div", { class: CSS + "-splash", "aria-hidden": "true" });
    wrap.style.left = Math.round(x - box.left) + "px";
    wrap.style.top = Math.round(y - box.top) + "px";
    for (var i = 0; i < SPLASH_DROPS; i++) {
      var svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", "0 0 16 16");
      var path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", ICONS.splash);
      svg.appendChild(path);
      // each drop its own way up: sideways drift, height, size, start
      var spread = 12 + ((i * 37) % 60), side = lean && i % 4 ? lean * spread : (i % 2 ? 1 : -1) * spread * (lean ? 0.3 : 1);
      svg.style.setProperty("--dx", side + "px");
      svg.style.setProperty("--dy", -(150 + ((i * 53) % 170)) + "px");
      svg.style.setProperty("--s", (0.7 + ((i * 29) % 7) / 10).toFixed(2));
      svg.style.animationDelay = i * 45 + "ms";
      wrap.appendChild(svg);
    }
    this.stage.appendChild(wrap);
    owner._splash = true;
    setTimeout(function () {
      wrap.remove();
      owner._splash = false;
    }, SPLASH_MS);
  };

  ShortsView.prototype.drawFavorite = function (b, p) {
    var label = this.t(p.favorite ? "unfavorite" : "favorite", { name: p.name });
    b.innerHTML = "";
    b.appendChild(icon(p.favorite ? "heart" : "heartOutline"));
    b.classList.toggle(CSS + "-on", p.favorite);
    b.setAttribute("aria-label", label);
    b.setAttribute("title", label);
    b.setAttribute("aria-pressed", p.favorite ? "true" : "false");
  };

  ShortsView.prototype.toggleFavorite = function (p) {
    var self = this, want = !p.favorite;
    gql("mutation StashShortsFavorite($i: PerformerUpdateInput!) { performerUpdate(input: $i) { id favorite } }", { i: { id: p.id, favorite: want } })
      .then(function (d) {
        p.favorite = !!d.performerUpdate.favorite;
        self.root.querySelectorAll("." + CSS + "-fav[data-performer=\"" + p.id + "\"]").forEach(function (b) {
          self.drawFavorite(b, p);
        });
      })
      .catch(function (e) {
        self.toast(self.t("error", { message: e.message }));
      });
  };

  // the ids of the performers subscribed to, once per visit; a failure leaves everyone unsubscribed
  ShortsView.prototype.loadSubscriptions = function () {
    var self = this;
    if (!this.subscriptionsLoad)
      this.subscriptionsLoad = gql(Core.SUBSCRIPTIONS_QUERY, { f: Core.SUBSCRIPTIONS_FILTER })
        .then(function (d) {
          var map = {};
          d.findPerformers.performers.forEach(function (p) {
            map[String(p.id)] = true;
          });
          self.subscribed = map;
          Object.keys(self.performers).forEach(function (id) {
            self.performers[id].subscribed = !!map[id];
          });
          self.drawSubscriptions();
          return map;
        })
        .catch(function () {
          self.subscriptionsLoad = null;
          return {};
        });
    return this.subscriptionsLoad;
  };

  // subscribe or unsubscribe (the custom field, Core.subscribeInput); shown at once, taken back on failure
  ShortsView.prototype.toggleSubscribe = function (p) {
    var self = this, want = !p.subscribed;
    p.subscribed = want;
    if (this.subscribed) this.subscribed[p.id] = want;
    this.drawSubscriptions(p);
    return gql(Core.SUBSCRIBE_MUTATION, { i: Core.subscribeInput(p.id, want) })
      .then(function (d) {
        p.subscribed = Core.isSubscribed(d.performerUpdate.custom_fields);
        if (self.subscribed) self.subscribed[p.id] = p.subscribed;
        self.session.subscribed[p.id] = p.subscribed;
        self.drawSubscriptions(p);
        return p.subscribed;
      })
      .catch(function (e) {
        p.subscribed = !want;
        if (self.subscribed) self.subscribed[p.id] = !want;
        self.drawSubscriptions(p);
        self.toast(self.t("error", { message: e.message }));
        return p.subscribed;
      });
  };

  // every subscribe button on the page (data-subscribe="<performer id>"), or those of one performer
  ShortsView.prototype.drawSubscriptions = function (p) {
    var self = this, sel = "[data-subscribe" + (p ? "=\"" + p.id + "\"" : "") + "]";
    this.root.querySelectorAll(sel).forEach(function (b) {
      var q = self.performers[b.getAttribute("data-subscribe")];
      if (q && b._draw) b._draw(q);
    });
  };

  ShortsView.prototype.ratingControl = function (sc) {
    var self = this, t = this.t;
    var count = el("span", { class: CSS + "-count" });
    var toggle = button(CSS + "-rate", t("rate"), "star", function () {
      var open = !wrap.classList.contains(CSS + "-stars-open");
      self.closeStars();
      wrap.classList.toggle(CSS + "-stars-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }, { "aria-expanded": "false" });
    var stars = el("div", { class: CSS + "-stars", role: "group", "aria-label": t("rate") });
    var starBtns = [1, 2, 3, 4, 5].map(function (n) {
      var b = button(CSS + "-star", t("stars", { count: n }), "star", function () {
        self.rate(sc, Core.ratingAfterClick(sc.rating100, n), draw);
      });
      stars.appendChild(b);
      return b;
    });
    var wrap = el("div", { class: CSS + "-action " + CSS + "-rating", "data-rate": sc.id }, [stars, toggle, count]);
    wrap._draw = draw;
    function draw() {
      var n = Core.ratingStars(sc.rating100);
      count.textContent = n ? self.i18n.n(n) : "";
      toggle.classList.toggle(CSS + "-on", n > 0);
      toggle.setAttribute("aria-label", n ? t("ratedStars", { count: n }) : t("rate"));
      starBtns.forEach(function (b, i) {
        b.classList.toggle(CSS + "-on", i < n);
        b.setAttribute("aria-pressed", i < n ? "true" : "false");
      });
    }
    draw();
    return wrap;
  };

  // -- stories bar: round avatars at the top, opened and closed with the button next to it; a tap opens
  // the performer's channel. Closed again by a step, a change of context, Esc or the button, so it never
  // stays over the video.
  ShortsView.prototype.toggleStories = function () {
    if (!this.stories.hidden) return this.closeStories();
    var self = this, t = this.t, gen = ++this.storiesGen;
    this.stories.hidden = false;
    this.storiesBtn.setAttribute("aria-expanded", "true");
    this.storiesBtn.classList.add(CSS + "-on");
    this.root.classList.add(CSS + "-stories-open");
    this.stories.innerHTML = "";
    this.stories.appendChild(el("p", { class: CSS + "-muted", text: t("loading") }));
    Promise.all([loadNames(), loadRefs(this.settings && this.settings.allowLandscape)])
      .then(function (r) {
        if (self.destroyed || gen !== self.storiesGen || self.stories.hidden) return;
        var list = Core.storyPerformers(
          r[0].findPerformers.performers.map(function (p) {
            var known = self.performers[String(p.id)]; // the favorite as the feed knows it now
            return known ? Object.assign({}, p, { favorite: known.favorite }) : p;
          }),
          r[1].performers
        );
        self.stories.innerHTML = "";
        if (!list.length) self.stories.appendChild(el("p", { class: CSS + "-muted", text: t("noPerformers") }));
        list.forEach(function (p) {
          self.stories.appendChild(self.storyLink(p));
        });
      })
      .catch(function (e) {
        if (gen !== self.storiesGen) return;
        self.stories.innerHTML = "";
        self.stories.appendChild(el("p", { class: CSS + "-muted", text: t("error", { message: e.message }) }));
      });
  };

  ShortsView.prototype.storyLink = function (p) {
    var self = this, src = Core.localUrl(p.image_path);
    var pic = el("span", { class: CSS + "-story-pic" + (p.favorite ? " " + CSS + "-fav-ring" : "") }, [
      src ? el("img", { src: src, alt: "", loading: "lazy", decoding: "async" }) : icon("person"),
    ]);
    return this.link(CSS + "-story", "performers/" + p.id, [pic, el("span", { class: CSS + "-story-name", text: p.name })], this.t("channel", { name: p.name }), null, function () {
      var here = self.ctx.kind === "performer" && self.ctx.id === String(p.id);
      self.closeStories();
      if (!here) self.openChannel({ id: String(p.id), name: p.name });
      return true;
    });
  };

  ShortsView.prototype.closeStories = function () {
    if (!this.stories || this.stories.hidden) return;
    this.storiesGen++;
    this.stories.hidden = true;
    this.storiesBtn.setAttribute("aria-expanded", "false");
    this.storiesBtn.classList.remove(CSS + "-on");
    this.root.classList.remove(CSS + "-stories-open");
  };

  ShortsView.prototype.closeStars = function () {
    this.root.querySelectorAll("." + CSS + "-stars-open").forEach(function (w) {
      w.classList.remove(CSS + "-stars-open");
    });
  };

  // a scene and its marker entries are separate objects: a changed number goes to all of them
  ShortsView.prototype.syncScene = function (sc, key) {
    var cache = this.sceneCache;
    Object.keys(cache).forEach(function (k) {
      if (cache[k] !== sc && cache[k].sceneId === sc.sceneId) cache[k][key] = sc[key];
    });
  };

  ShortsView.prototype.rate = function (sc, rating100, drawOne) {
    var self = this, before = sc.rating100;
    // every control of this entry (column and quick row), data-rate="<entry id>"
    function draw() {
      if (drawOne) drawOne();
      self.root.querySelectorAll("[data-rate=\"" + sc.id + "\"]").forEach(function (w) {
        if (w._draw && w._draw !== drawOne) w._draw();
      });
    }
    sc.rating100 = rating100;
    draw();
    var gallery = sc.kind === "gallery";
    (gallery
      ? gql(Core.RATE_GALLERY_MUTATION, { i: { id: sc.galleryId, rating100: rating100 } })
      : gql("mutation StashShortsRate($i: SceneUpdateInput!) { sceneUpdate(input: $i) { id rating100 } }", { i: { id: sc.sceneId, rating100: rating100 } }))
      .then(function (d) {
        sc.rating100 = (gallery ? d.galleryUpdate : d.sceneUpdate).rating100;
        self.syncScene(sc, "rating100");
        draw();
        setTimeout(function () {
          self.closeStars();
        }, 250);
      })
      .catch(function (e) {
        sc.rating100 = before;
        draw();
        self.toast(self.t("error", { message: e.message }));
      });
  };

  // What an orgasm counts on: the scene, or in a gallery the picture shown (its own counter in Stash).
  // holder: the object whose o_counter changes; null while a gallery's pictures are not loaded.
  ShortsView.prototype.oTarget = function (sc) {
    if (sc.kind === "gallery") {
      var im = sc.images && sc.images[sc.at || 0];
      return im ? { holder: im, id: im.id, add: Core.IMAGE_O_MUTATION, remove: Core.IMAGE_UNDO_O_MUTATION, read: function (d) {
        return Number(d.imageIncrementO != null ? d.imageIncrementO : d.imageDecrementO) || 0;
      } } : null;
    }
    return { holder: sc, id: sc.sceneId, scene: true,
      add: "mutation StashShortsO($id: ID!) { sceneAddO(id: $id) { count } }",
      remove: "mutation StashShortsUndoO($id: ID!) { sceneDeleteO(id: $id) { count } }",
      read: function (d) {
        return (d.sceneAddO || d.sceneDeleteO).count;
      } };
  };

  ShortsView.prototype.addO = function (sc, count, b) {
    var self = this, tgt = this.oTarget(sc);
    if (!tgt) return;
    b.disabled = true;
    gql(tgt.add, { id: tgt.id })
      .then(function (d) {
        tgt.holder.o_counter = tgt.read(d);
        self.session.o++;
        if (tgt.scene) self.syncScene(sc, "o_counter");
        count.textContent = self.i18n.n(tgt.holder.o_counter);
        b.classList.add(CSS + "-pop");
        setTimeout(function () {
          b.classList.remove(CSS + "-pop");
        }, 300);
        self.offerUndo(sc, count, b, tgt);
      })
      .catch(function (e) {
        self.toast(self.t("error", { message: e.message }));
      })
      .then(function () {
        b.disabled = false;
      });
  };

  // Takes back the scene's latest orgasm (Stash's sceneDeleteO without times removes the newest one).
  // (a picture: Stash's imageDecrementO; tgt: the target of the orgasm being taken back, else the current one)
  ShortsView.prototype.removeO = function (sc, count, b, tgt) {
    var self = this;
    tgt = tgt || this.oTarget(sc);
    if (!tgt || !(tgt.holder.o_counter > 0) || b.disabled) return;
    b.disabled = true;
    gql(tgt.remove, { id: tgt.id })
      .then(function (d) {
        tgt.holder.o_counter = tgt.read(d);
        self.session.o--;
        if (tgt.scene) self.syncScene(sc, "o_counter");
        // (in a gallery only while that picture is shown)
        if (tgt.scene || sc.images[sc.at] === tgt.holder) count.textContent = self.i18n.n(tgt.holder.o_counter);
        self.toast(self.t("oRemoved"));
      })
      .catch(function (e) {
        self.toast(self.t("error", { message: e.message }));
      })
      .then(function () {
        b.disabled = false;
      });
  };

  // after an orgasm (button or double tap): "Undo" for UNDO_MS, under the top bar
  ShortsView.prototype.offerUndo = function (sc, count, b, tgt) {
    var self = this;
    this.hideResume();
    this.hideUndo();
    var box = (this.undoBox = el("div", { class: CSS + "-undo", role: "status" }, [
      el("span", { text: this.t("oAdded") }),
      el("button", { type: "button", class: CSS + "-pill", text: this.t("undo"), onclick: function () {
        self.hideUndo();
        self.removeO(sc, count, b, tgt);
      } }),
    ]));
    this.root.appendChild(box);
    this.undoTimer = setTimeout(function () {
      if (self.undoBox === box) self.hideUndo();
    }, UNDO_MS);
  };

  ShortsView.prototype.hideUndo = function () {
    clearTimeout(this.undoTimer);
    if (this.undoBox) this.undoBox.remove();
    this.undoBox = null;
  };

  // holding the orgasm button takes one back (also after the undo hint is gone); the hold that pauses the
  // video belongs to the video, not to the buttons, so the two do not meet
  ShortsView.prototype.holdToRemoveO = function (b, sc, count) {
    var self = this, timer = null, start = null;
    function stop() {
      clearTimeout(timer);
      timer = null;
    }
    b.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      b._held = false;
      start = { x: e.clientX, y: e.clientY };
      stop();
      timer = setTimeout(function () {
        timer = null;
        b._held = true; // a long press never adds one
        var tgt = self.oTarget(sc);
        if (!tgt || !(tgt.holder.o_counter > 0)) return;
        self.hideUndo();
        self.removeO(sc, count, b);
      }, REMOVE_O_HOLD_MS);
    });
    // a swipe that starts on the button is a swipe
    b.addEventListener("pointermove", function (e) {
      if (timer && start && Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 10) stop();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (type) {
      b.addEventListener(type, stop);
    });
    // no browser menu on the long press
    b.addEventListener("contextmenu", function (e) {
      e.preventDefault();
    });
  };

  // A tap toggles the sound; with double tap on (the default) only once Core.DOUBLE_TAP_MS have passed
  // without a second tap, which adds an orgasm instead.
  ShortsView.prototype.tapped = function (x, y) {
    var self = this;
    if (this.root.classList.contains(CSS + "-idle")) return this.wake(); // the first tap shows the overlay
    if (this.settings && this.settings.disableDoubleTap) return this.setSound(!this.sound);
    clearTimeout(this.tapTimer);
    if (this.taps.tap(now(), x, y) === "double") return this.doubleTap(x, y);
    this.tapTimer = setTimeout(function () {
      if (!self.destroyed) self.setSound(!self.sound);
    }, Core.DOUBLE_TAP_MS);
  };

  ShortsView.prototype.doubleTap = function (x, y) {
    var slide = this.slides[this.index], sc = this.scenes[this.index];
    var b = slide && slide.querySelector("." + CSS + "-o");
    if (!sc || !b || b.disabled) return;
    this.burst(x, y);
    this.splash(x, y);
    this.addO(sc, b.parentNode.querySelector("." + CSS + "-count"), b);
  };

  // the drop with sparks where the double tap was (removed after its animation)
  ShortsView.prototype.burst = function (x, y) {
    var r = this.stage.getBoundingClientRect();
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "-32 -32 64 64");
    svg.setAttribute("class", CSS + "-burst");
    svg.setAttribute("aria-hidden", "true");
    svg.style.left = Math.round(x - r.left) + "px";
    svg.style.top = Math.round(y - r.top) + "px";
    var g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("transform", "translate(-12 -13) scale(1.5)");
    var drop = document.createElementNS(SVG_NS, "path");
    drop.setAttribute("d", ICONS.drop);
    drop.setAttribute("fill-rule", "evenodd");
    g.appendChild(drop);
    svg.appendChild(g);
    for (var i = 0; i < 8; i++) {
      var a = (i * Math.PI) / 4, line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", (Math.cos(a) * 18).toFixed(1));
      line.setAttribute("y1", (Math.sin(a) * 18).toFixed(1));
      line.setAttribute("x2", (Math.cos(a) * 28).toFixed(1));
      line.setAttribute("y2", (Math.sin(a) * 28).toFixed(1));
      svg.appendChild(line);
    }
    this.stage.appendChild(svg);
    setTimeout(function () {
      svg.remove();
    }, 800);
  };

  ShortsView.prototype.toast = function (text) {
    this.showFlash(null, text);
  };

  // short centred hint (sound on/off, pause, errors)
  ShortsView.prototype.showFlash = function (iconName, text) {
    var self = this;
    this.flash.innerHTML = "";
    if (iconName) this.flash.appendChild(icon(iconName));
    if (text) this.flash.appendChild(el("span", { text: text }));
    this.flash.classList.add(CSS + "-show");
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(function () {
      self.flash.classList.remove(CSS + "-show");
    }, text ? 2500 : 700);
  };

  // -- sound and pause

  ShortsView.prototype.setSound = function (on) {
    this.sound = on;
    writeSound(on);
    var v = this.currentVideo();
    if (v) v.muted = !on;
    this.videos.forEach(function (x) {
      if (x !== v) x.muted = !on;
    });
    this.updateSoundButton();
    this.showFlash(on ? "soundOn" : "soundOff");
  };

  ShortsView.prototype.updateSoundButton = function () {
    var label = this.t(this.sound ? "soundOff" : "soundOn");
    this.soundBtn.innerHTML = "";
    this.soundBtn.appendChild(icon(this.sound ? "soundOn" : "soundOff"));
    this.soundBtn.setAttribute("aria-label", label);
    this.soundBtn.setAttribute("title", label);
  };

  ShortsView.prototype.togglePause = function () {
    var v = this.currentVideo();
    if (!v) return;
    if (v.paused) {
      this.paused = false;
      this.playCurrent(v);
      this.showFlash("play");
    } else {
      this.paused = true;
      v.pause();
      this.showFlash("pause");
    }
  };

  // -- progress bar of the current slide (drawn per animation frame while the page is open)

  ShortsView.prototype.startProgress = function () {
    var self = this;
    cancelAnimationFrame(this.raf);
    function frame() {
      if (self.destroyed) return;
      self.drawProgress();
      self.raf = requestAnimationFrame(frame);
    }
    this.raf = requestAnimationFrame(frame);
  };

  ShortsView.prototype.drawProgress = function () {
    var v = this.currentVideo(), slide = this.slides[this.index];
    if (!v || !slide) return;
    var f = Core.clipProgress(v._scene, v.currentTime, v.duration);
    var fill = slide.querySelector("." + CSS + "-progress-fill");
    if (fill && fill._f !== f) {
      fill._f = f;
      fill.style.transform = "scaleX(" + f + ")";
    }
  };

  // -- gestures: touch/mouse drag, wheel, keys

  ShortsView.prototype.bindGestures = function () {
    var self = this, stage = this.stage, drag = null;
    var gate = new Core.WheelGate();

    function interactive(target) {
      return target.closest && target.closest("button, a, input, select, ." + CSS + "-progress, ." + CSS + "-stars");
    }

    this.on(stage, "pointerdown", function (e) {
      if (self.dialog || (e.pointerType === "mouse" && e.button !== 0)) return;
      if (!interactive(e.target)) self.closeStars();
      if (!self.root.classList.contains(CSS + "-idle")) self.wake();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now(), moved: false, ui: !!interactive(e.target) };
      if (!drag.ui)
        self.holdTimer = setTimeout(function () {
          var v = self.currentVideo();
          if (!drag || drag.moved || !v || v.paused) return;
          drag.held = true;
          self.held = true;
          v.pause();
          self.showFlash("pause");
        }, HOLD_MS);
    });
    this.on(stage, "pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved) {
        // the direction is decided once, after the first pixels (Core.dragAxis)
        drag.axis = Core.dragAxis(dx, dy);
        if (!drag.axis) return;
        drag.moved = true;
        clearTimeout(self.holdTimer);
        try {
          stage.setPointerCapture(e.pointerId);
        } catch (err) {
          /* pointer already gone */
        }
      }
      if (drag.axis === "x") {
        // a gallery: the pictures follow the finger while there is one to flip to
        var gsc = self.scenes[self.index];
        if (drag.flip == null) drag.flip = self.canFlip(gsc, dx < 0 ? 1 : -1);
        if (drag.flip) return self.drawPictures(self.slides[self.index], gsc, dx);
        // the scene follows the finger; resistance where there is nothing to go to
        var nothing = dx > 0 && !self.stack.depth() && self.ctx.kind !== "performer";
        self.track.style.transition = "none";
        self.track.style.transform = "translate3d(" + (nothing ? dx / 3 : dx) + "px," + -self.index * 100 + "%,0)";
        return;
      }
      // resistance at both ends of the feed
      var atEdge = (dy > 0 && self.index === 0) || (dy < 0 && self.index >= self.scenes.length - 1);
      var off = atEdge ? dy / 3 : dy;
      self.track.style.transition = "none";
      self.track.style.transform = "translate3d(0,calc(" + -self.index * 100 + "% + " + off + "px),0)";
    });
    function end(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var d = drag;
      drag = null;
      clearTimeout(self.holdTimer);
      if (d.held) {
        self.held = false;
        var v = self.currentVideo();
        if (v && !self.paused) self.playCurrent(v);
        return;
      }
      if (d.moved) self.swipedAt = now();
      if (d.moved && d.axis === "x" && d.flip) {
        var turn = e.type === "pointercancel" ? 0 : Core.sideStep(e.clientX - d.x, e.clientY - d.y, now() - d.t, stage.clientWidth);
        if (!turn || !self.flip(turn)) self.drawPictures(self.slides[self.index], self.scenes[self.index]);
        return;
      }
      if (d.moved && d.axis === "x") {
        var side = e.type === "pointercancel" ? 0 : Core.sideStep(e.clientX - d.x, e.clientY - d.y, now() - d.t, stage.clientWidth);
        if (side) self.sideways(side);
        else self.snap();
        return;
      }
      if (d.moved) {
        var step = e.type === "pointercancel" ? 0 : Core.swipeStep(e.clientY - d.y, now() - d.t, stage.clientHeight);
        self.go(self.index + step);
        return;
      }
      if (!d.ui && e.type === "pointerup") self.tapped(e.clientX, e.clientY);
    }
    this.on(stage, "pointerup", end);
    this.on(stage, "pointercancel", end);
    // a long press on the video pauses it (above), without the browser's menu for saving the video or image
    this.on(stage, "contextmenu", function (e) {
      if (!interactive(e.target)) e.preventDefault();
    });

    this.on(
      this.root,
      "wheel",
      function (e) {
        if (self.dialog || self.stories.contains(e.target)) return; // the bar scrolls sideways itself
        e.preventDefault();
        var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * stage.clientHeight : e.deltaY;
        var step = gate.push(dy, now());
        if (step) self.go(self.index + step);
      },
      { passive: false }
    );

    this.on(document, "keydown", function (e) {
      if (self.dialog) {
        if (e.key === "Escape") self.dialog.close(); // also when the focus is not inside the sheet
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (self.stories.contains(e.target) && /^Arrow(Left|Right)$/.test(e.key)) return; // scrolls the bar
      var step = Core.keyStep(e.key), side = Core.sideKey(e.key);
      if (step) {
        e.preventDefault();
        self.go(self.index + step);
      } else if (side) {
        e.preventDefault();
        if (!self.flip(side)) self.sideways(side); // in a gallery the arrow keys flip first
      } else if (e.key === " ") {
        if (e.target && e.target.tagName === "BUTTON") return;
        e.preventDefault();
        self.togglePause();
      } else if (e.key === "m") self.setSound(!self.sound);
      else if (e.key === "Escape") {
        if (self.root.querySelector("." + CSS + "-stars-open")) self.closeStars();
        else if (!self.stories.hidden) self.closeStories();
        else self.leave();
      }
    });

    this.on(window, "resize", function () {
      self.refit();
    });
  };

  // -- home screen app (docs/home-screen.md)

  // opened from the home screen: no browser bar, so the page itself keeps clear of notch and rounded corners
  function isStandalone() {
    try {
      if (window.navigator.standalone) return true; // iOS
      return !!(window.matchMedia && (matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches));
    } catch (e) {
      return false;
    }
  }

  // Sets an attribute of a tag in the document's head for as long as the page is open (the tag is made if
  // there is none) and puts back what was there when the page is left, so Stash itself stays as it is.
  ShortsView.prototype.headTag = function (tag, key, keyValue, attr, value) {
    var node = document.head.querySelector(tag + "[" + key + '="' + keyValue + '"]'), made = !node;
    if (made) {
      node = document.createElement(tag);
      node.setAttribute(key, keyValue);
      document.head.appendChild(node);
    }
    var old = node.getAttribute(attr);
    node.setAttribute(attr, value);
    this.cleanup.push(function () {
      if (made) node.remove();
      else if (old == null) node.removeAttribute(attr);
      else node.setAttribute(attr, old);
    });
  };

  // "Add to Home Screen" on this page should open /shorts: while the page is open, the manifest link points
  // to the plugin's own manifest (app/manifest.<language>.json: start_url /shorts, its own id, icons,
  // shortcuts, black), Safari gets its own tags for the same, and the page reaches under notch and status
  // bar (viewport-fit=cover; the CSS keeps the controls clear of them with env(safe-area-inset-*)).
  ShortsView.prototype.appHead = function () {
    var code = this.i18n.code && this.i18n.code !== FALLBACK_LOCALE ? "." + this.i18n.code : "";
    var viewport = document.head.querySelector('meta[name="viewport"]');
    var vp = (viewport && viewport.getAttribute("content")) || "width=device-width, initial-scale=1";
    if (!/viewport-fit/.test(vp)) vp += ", viewport-fit=cover";
    this.headTag("link", "rel", "manifest", "href", ASSET_BASE + "app/manifest" + code + ".json");
    this.headTag("meta", "name", "theme-color", "content", "#000000");
    this.headTag("meta", "name", "viewport", "content", vp);
    this.headTag("meta", "name", "apple-mobile-web-app-capable", "content", "yes");
    this.headTag("meta", "name", "mobile-web-app-capable", "content", "yes");
    this.headTag("meta", "name", "apple-mobile-web-app-status-bar-style", "content", "black-translucent");
    this.headTag("meta", "name", "apple-mobile-web-app-title", "content", this.t("title"));
    this.headTag("link", "rel", "apple-touch-icon", "href", ASSET_BASE + "app/apple-touch-icon.png");
    // no rubber band and no pull to refresh behind the feed
    document.documentElement.classList.add(CSS + "-open");
    this.cleanup.push(function () {
      document.documentElement.classList.remove(CSS + "-open");
    });
  };

  // -- "back" in the home screen app: from the bottom of the history it would close the app at once. After
  // the first touch (Chrome skips history entries made without one) a guard entry with the same URL goes
  // on top; "back" then lands on the page's own entry and shows a hint, the next "back" leaves. The guard
  // comes again with the next touch.
  function isGuard(state) {
    return !!(state && (state.sstGuard || (state.state && state.state.sstGuard)));
  }

  ShortsView.prototype.bindBackGuard = function () {
    var self = this;
    if (!this.standalone) return;
    function arm() {
      if (self.guarded || self.entries || self.stack.depth() || self.destroyed) return;
      if (location.pathname.slice(-ROUTE.length) !== ROUTE || isGuard(window.history.state)) return;
      self.guarded = true;
      self.history.push(ROUTE + location.search, { sstGuard: true });
    }
    this.on(this.root, "pointerdown", arm, true);
    this.on(document, "keydown", arm, true);
  };

  // -- keep the screen on while a video plays (Screen Wake Lock API, setting "disableWakeLock"). The lock
  // is released on pause and when the page is left; the browser drops it by itself when the page is hidden.
  ShortsView.prototype.wakeNote = function (what) {
    this.wakeLog.push({ t: Math.round(now()), what: what });
    if (this.wakeLog.length > 50) this.wakeLog.shift();
  };

  ShortsView.prototype.keepAwake = function (on) {
    var self = this;
    this.wantAwake = on = !!on && !this.destroyed && !!navigator.wakeLock && !(this.settings && this.settings.disableWakeLock);
    if (!on) {
      if (this.wakeLock) {
        var lock = this.wakeLock;
        this.wakeLock = null;
        lock.release().catch(function () {});
      }
      return;
    }
    if (this.wakeLock || this.wakeAsking || document.hidden) return;
    this.wakeAsking = true;
    navigator.wakeLock
      .request("screen")
      .then(function (lock) {
        self.wakeAsking = false;
        self.wakeNote("request");
        lock.addEventListener("release", function () {
          if (self.wakeLock === lock) self.wakeLock = null;
          self.wakeNote("release");
        });
        if (self.wantAwake) self.wakeLock = lock;
        else lock.release().catch(function () {});
      })
      .catch(function (e) {
        // refused (battery saver, not visible, no permission): the screen dims as usual
        self.wakeAsking = false;
        self.wakeNote("refused " + (e && e.name));
      });
  };

  // -- lock screen and notification controls (Media Session API): title, performers, screenshot; play and
  // pause, next and previous clip as the vertical swipe
  ShortsView.prototype.bindMediaSession = function () {
    var self = this, ms = navigator.mediaSession;
    if (!ms) return;
    this.mediaHandlers = {
      play: function () {
        var v = self.currentVideo();
        if (v && v.paused) self.togglePause();
      },
      pause: function () {
        var v = self.currentVideo();
        if (v && !v.paused) self.togglePause();
      },
      nexttrack: function () {
        self.go(self.index + 1);
      },
      previoustrack: function () {
        self.go(self.index - 1);
      },
    };
    Object.keys(this.mediaHandlers).forEach(function (action) {
      try {
        ms.setActionHandler(action, self.mediaHandlers[action]);
      } catch (e) {
        /* action not supported by this browser */
      }
    });
    this.cleanup.push(function () {
      Object.keys(self.mediaHandlers).forEach(function (action) {
        try {
          ms.setActionHandler(action, null);
        } catch (e) {
          /* not supported */
        }
      });
      ms.metadata = null;
      ms.playbackState = "none";
    });
  };

  ShortsView.prototype.mediaMetadata = function (sc) {
    var ms = navigator.mediaSession;
    if (!ms || typeof MediaMetadata === "undefined" || !sc) return;
    var cap = Core.sceneCaption(sc, this.ctx.kind === "performer" ? this.ctx.id : null);
    var names = sc.performers
      .map(function (p) {
        return p.name;
      })
      .join(", ");
    try {
      ms.metadata = new MediaMetadata({
        title: cap.title || names || this.t("title"),
        artist: cap.title ? names : "",
        album: sc.studio ? sc.studio.name : "",
        artwork: sc.screenshot ? [{ src: new URL(sc.screenshot, document.baseURI).href }] : [],
      });
    } catch (e) {
      /* an artwork URL the browser does not take */
    }
  };

  ShortsView.prototype.mediaState = function (state) {
    if (navigator.mediaSession) navigator.mediaSession.playbackState = state;
  };

  ShortsView.prototype.refit = function () {
    var self = this;
    this.videos.forEach(function (v) {
      var k = self.scenes.indexOf(v._scene);
      if (self.slides[k]) self.fitVideo(v, self.slides[k]);
    });
  };

  // -- turning the phone (Core.orientationMode): a landscape clip on a phone held sideways fills the
  // screen and the overlay hides after Core.IDLE_MS without a touch; held upright, a button offers to turn
  // it (full screen and orientation lock where the browser can, else a hint). The same video elements
  // stay, so the position and the sound are kept.
  ShortsView.prototype.watchOrientation = function () {
    var self = this;
    if (!window.matchMedia) return;
    this.mqSideways = window.matchMedia("(orientation: landscape)");
    this.mqTouch = window.matchMedia("(pointer: coarse)");
    [this.mqSideways, this.mqTouch].forEach(function (mq) {
      var fn = function () {
        self.drawOrientation();
      };
      if (mq.addEventListener) self.on(mq, "change", fn);
      else if (mq.addListener) {
        mq.addListener(fn);
        self.cleanup.push(function () {
          mq.removeListener(fn);
        });
      }
    });
    this.on(document, "fullscreenchange", function () {
      if (!document.fullscreenElement) self.rotLocked = false;
    });
  };

  ShortsView.prototype.drawOrientation = function () {
    var sc = this.scenes[this.index];
    var wide = !!(sc && this.settings && this.settings.allowLandscape && sc.width > 0 && sc.width >= sc.height);
    var m = Core.orientationMode(!!(this.mqTouch && this.mqTouch.matches), !!(this.mqSideways && this.mqSideways.matches), wide);
    var was = this.root.classList.contains(CSS + "-fill-screen");
    this.root.classList.toggle(CSS + "-fill-screen", m.fill);
    this.root.classList.toggle(CSS + "-can-rotate", m.rotate);
    if (m.fill !== was) this.refit(); // the stage changed its width
    if (m.fill) {
      if (!was) this.wake();
    } else {
      clearTimeout(this.idleTimer);
      this.root.classList.remove(CSS + "-idle");
    }
    if (!wide && this.rotLocked) this.unlockRotation();
  };

  // shows the overlay and hides it again after Core.IDLE_MS (only while a clip fills the screen)
  ShortsView.prototype.wake = function () {
    var self = this;
    clearTimeout(this.idleTimer);
    this.root.classList.remove(CSS + "-idle");
    if (!this.root.classList.contains(CSS + "-fill-screen")) return;
    this.idleTimer = setTimeout(function () {
      if (!self.destroyed && !self.dialog) self.root.classList.add(CSS + "-idle");
    }, Core.IDLE_MS);
  };

  ShortsView.prototype.rotate = function () {
    var self = this, doc = document.documentElement;
    function hint() {
      self.toast(self.t("rotateHint"));
    }
    try {
      // iOS Safari has neither: there the hint only
      if (!doc.requestFullscreen || !screen.orientation || !screen.orientation.lock) return hint();
      doc
        .requestFullscreen()
        .then(function () {
          return screen.orientation.lock("landscape");
        })
        .then(function () {
          self.rotLocked = true;
        })
        .catch(function () {
          self.unlockRotation();
          hint();
        });
    } catch (e) {
      hint();
    }
  };

  ShortsView.prototype.unlockRotation = function () {
    this.rotLocked = false;
    try {
      if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    } catch (e) {
      /* never in the way of playback */
    }
  };

  // ------------------------------------------------------------------ filter and settings dialog
  // "Apply" changes the feed of this view (and the URL parameters); "Save as default" stores everything
  // in Stash's plugin settings.

  var namesCache = null;
  function loadNames() {
    if (!namesCache)
      namesCache = gql(
        "query StashShortsNames { findTags(filter: {per_page: -1, sort: \"name\"}) { tags { id name } }" +
          " findStudios(filter: {per_page: -1, sort: \"name\"}) { studios { id name } }" +
          " findPerformers(filter: {per_page: -1, sort: \"name\"}) { performers { id name image_path favorite } } }"
      ).catch(function (e) {
        namesCache = null;
        throw e;
      });
    return namesCache;
  }

  // how many scenes in the format have each tag, studio and performer (Core.countRefs), once per format
  var refsCache = {};
  function loadRefs(allowLandscape) {
    var k = allowLandscape ? "all" : "portrait";
    if (!refsCache[k])
      refsCache[k] = gql(Core.REFS_QUERY, { s: Core.formatFilter(allowLandscape) })
        .then(function (d) {
          return Core.countRefs(d.findScenes.scenes);
        })
        .catch(function (e) {
          refsCache[k] = null;
          throw e;
        });
    return refsCache[k];
  }

  // -- sheets: a panel from the bottom on phones (centred on wide screens) with a title, a close button,
  // Esc, the focus kept inside it, and a drag down on its head to close. One at a time (this.dialog); while
  // it is open the gestures of the feed are off and the video is paused (and plays again on close, unless
  // s.wasPlaying was set to false). opts.foot: elements for a row at the bottom; opts.cls: a class;
  // opts.keepPlaying: the video goes on behind the sheet.
  var sheetCount = 0;
  var SHEET_CLOSE_PX = 80;
  ShortsView.prototype.sheet = function (title, opts) {
    var self = this, t = this.t;
    opts = opts || {};
    if (this.dialog) this.dialog.close();
    var uid = CSS + "-s" + ++sheetCount;
    var previous = document.activeElement;
    var current = this.currentVideo();
    var s = { id: uid, wasPlaying: !opts.keepPlaying && !!(current && !current.paused), closed: false };
    if (s.wasPlaying) current.pause();

    var head = el("div", { class: CSS + "-dialog-head" }, [
      el("span", { class: CSS + "-handle", "aria-hidden": "true" }),
      el("h2", { id: uid, text: title }),
      button(CSS + "-close", t("close"), "close", function () {
        s.close();
      }),
    ]);
    var body = el("div", { class: CSS + "-dialog-body" });
    var dialog = el("div", { class: CSS + "-dialog" + (opts.cls ? " " + opts.cls : ""), role: "dialog", "aria-modal": "true", "aria-labelledby": uid }, [head, body]);
    if (opts.foot) dialog.appendChild(el("div", { class: CSS + "-dialog-foot" }, opts.foot));
    // over a video that goes on, the backdrop only dims it a little
    var backdrop = el("div", { class: CSS + "-backdrop-dialog" + (opts.keepPlaying ? " " + CSS + "-backdrop-light" : "") }, [dialog]);
    backdrop.addEventListener("pointerdown", function (e) {
      if (e.target === backdrop) s.close();
    });
    backdrop.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        s.close();
      } else if (e.key === "Tab") {
        // keep the focus inside the sheet
        var f = [].filter.call(dialog.querySelectorAll("button, input, a[href], [tabindex]"), function (x) {
          return x.tabIndex >= 0 && !x.disabled && x.offsetParent !== null;
        });
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    // a drag down on the head moves the sheet with the finger; far enough (or fast) closes it
    var drag = null;
    head.addEventListener("pointerdown", function (e) {
      if (e.target.closest("button") || (e.pointerType === "mouse" && e.button !== 0)) return;
      drag = { id: e.pointerId, y: e.clientY, t: now() };
      try {
        head.setPointerCapture(e.pointerId);
      } catch (err) {
        /* pointer already gone */
      }
    });
    head.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dy = Math.max(0, e.clientY - drag.y);
      dialog.style.transition = "none";
      dialog.style.transform = dy ? "translateY(" + dy + "px)" : "";
    });
    function release(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dy = e.clientY - drag.y, fast = dy > 30 && dy / Math.max(1, now() - drag.t) > 0.6;
      drag = null;
      dialog.style.transition = "";
      if (e.type === "pointerup" && (dy > SHEET_CLOSE_PX || fast)) return s.close();
      dialog.style.transform = "";
    }
    head.addEventListener("pointerup", release);
    head.addEventListener("pointercancel", release);

    s.body = body;
    s.dialog = dialog;
    s.backdrop = backdrop;
    s.close = function () {
      if (s.closed) return;
      s.closed = true;
      backdrop.remove();
      if (self.dialog === s) self.dialog = null;
      if (opts.onClose) opts.onClose();
      if (previous && previous.focus && previous.isConnected) previous.focus();
      if (s.wasPlaying && current && current._scene === self.scenes[self.index] && !self.destroyed) self.playCurrent(current);
    };
    this.dialog = s;
    this.root.appendChild(backdrop);
    return s;
  };

  // A filter of all scenes (the dialog, a tag in the detail sheet): the view goes back to all scenes with
  // it and forgets the channels; noReload: the caller reloads.
  ShortsView.prototype.showFilter = function (f, noReload) {
    this.baseFilter = this.filter = f;
    this.ctx = Core.ALL;
    this.stack.clear();
    this.history.replace(this.contextUrl(Core.ALL));
    if (!noReload) this.reload();
  };

  // a mode of the bar: all scenes with its filter (also from inside a channel)
  ShortsView.prototype.showMode = function (mode) {
    if (!this.settings || (this.ctx.kind === "all" && Core.modeOf(this.baseFilter) === mode)) return;
    this.closeStories();
    this.showFilter(Core.modeFilter(mode, this.settings));
  };

  // the mode shown, underlined (none in a channel, or with a filter that is no mode)
  ShortsView.prototype.drawModes = function () {
    var on = this.ctx.kind === "all" ? Core.modeOf(this.baseFilter) : null;
    this.modeBar.querySelectorAll("button").forEach(function (b) {
      var is = b.getAttribute("data-mode") === on;
      b.classList.toggle(CSS + "-on", is);
      b.setAttribute("aria-current", is ? "true" : "false");
    });
  };

  ShortsView.prototype.openDialog = function () {
    var self = this, t = this.t;
    if (this.dialog || !this.settings) return;
    var draft = Object.assign({}, this.settings, this.baseFilter);

    function field(label, control, id) {
      return el("div", { class: CSS + "-field" }, [el("span", { class: CSS + "-label", id: id, text: label }), control]);
    }
    function check(key, label, help, invert) {
      var c = el("input", { type: "checkbox" });
      c.checked = invert ? !draft[key] : !!draft[key];
      c.addEventListener("change", function () {
        draft[key] = invert ? !c.checked : c.checked;
        if (key === "allowLandscape") drawPickers();
      });
      return el("div", null, [
        el("label", { class: CSS + "-check" }, [c, el("span", { text: label })]),
        help ? el("small", { class: CSS + "-help", text: help }) : null,
      ]);
    }
    // one of a few values as a row of buttons (radio group)
    function choices(key, label, options) {
      var id = uid + "-" + key, group = el("div", { class: CSS + "-choices", role: "radiogroup", "aria-labelledby": id });
      function draw() {
        group.querySelectorAll("button").forEach(function (b) {
          var on = String(draft[key]) === b.getAttribute("data-value");
          b.setAttribute("aria-checked", on ? "true" : "false");
          b.classList.toggle(CSS + "-on", on);
        });
      }
      options.forEach(function (o) {
        group.appendChild(
          el("button", { type: "button", class: CSS + "-choice", role: "radio", "data-value": String(o.value), "aria-label": o.aria, onclick: function () {
            draft[key] = o.value;
            draw();
          } }, o.content)
        );
      });
      draw();
      return field(label, group, id);
    }

    var pickers = el("div", { class: CSS + "-pickers" });
    var quickPicker = el("div", { class: CSS + "-pickers" });
    var pickerGen = 0;
    function drawPickers() {
      var gen = ++pickerGen;
      pickers.innerHTML = "";
      pickers.appendChild(el("p", { class: CSS + "-muted", text: t("loadingNames") }));
      Promise.all([loadNames(), loadRefs(draft.allowLandscape)])
        .then(function (r) {
          if (gen !== pickerGen || sheet.closed) return;
          var d = r[0], counts = r[1];
          pickers.innerHTML = "";
          pickers.appendChild(self.picker(uid + "-tags", t("setTags"), d.findTags.tags, counts.tags, draft, "tags"));
          pickers.appendChild(self.picker(uid + "-studios", t("setStudios"), d.findStudios.studios, counts.studios, draft, "studios"));
          pickers.appendChild(self.picker(uid + "-performers", t("setPerformers"), d.findPerformers.performers, counts.performers, draft, "performers", true));
          quickPicker.innerHTML = "";
          quickPicker.appendChild(self.picker(uid + "-quick", t("setQuickTags"), d.findTags.tags, counts.tags, draft, "quickTags"));
        })
        .catch(function (e) {
          if (gen !== pickerGen) return;
          pickers.innerHTML = "";
          pickers.appendChild(el("p", { class: CSS + "-muted", text: t("error", { message: e.message }) }));
        });
    }

    var apply = el("button", { type: "button", class: CSS + "-pill " + CSS + "-primary", text: t("apply") });
    var reset = el("button", { type: "button", class: CSS + "-pill", text: t("reset") });
    var sheet = this.sheet(t("filters"), { foot: [reset, apply] });
    var uid = sheet.id, body = sheet.body;
    var msg = el("p", { class: CSS + "-dialog-msg", role: "status" });
    sheet.dialog.insertBefore(msg, body.nextSibling);
    var save = el("button", { type: "button", class: CSS + "-pill " + CSS + "-wide", text: t("saveDefault") });
    // the controls show the draft; "Reset" changes the draft and draws them again
    function fill() {
      body.innerHTML = "";
      var seconds = el("input", { type: "number", class: CSS + "-input", inputmode: "numeric", min: 1, max: 60, step: 1, value: draft.playCountAfter, "aria-labelledby": uid + "-sec" });
      seconds.addEventListener("change", function () {
        draft.playCountAfter = Core.settingValue(Core.SETTING.playCountAfter, seconds.value);
        seconds.value = draft.playCountAfter;
      });
      var picSeconds = el("input", { type: "number", class: CSS + "-input", inputmode: "numeric", min: 2, max: 15, step: 1, value: draft.galleryImageSeconds, "aria-labelledby": uid + "-pic" });
      picSeconds.addEventListener("change", function () {
        draft.galleryImageSeconds = Core.settingValue(Core.SETTING.galleryImageSeconds, picSeconds.value);
        picSeconds.value = draft.galleryImageSeconds;
      });
      var stars = [{ value: 0, content: [t("anyRating")], aria: t("anyRating") }];
      for (var n = 1; n <= 5; n++) stars.push({ value: n, content: [String(n), icon("star")], aria: t("starsAtLeast", { count: n }) });
      [
        el("h3", { text: t("feed") }),
        choices("order", t("setOrder"), Object.keys(Core.ORDERS).map(function (k) {
          return { value: k, content: [t(Core.ORDERS[k])] };
        })),
        choices("minRating", t("setMinRating"), stars),
        check("favoritesOnly", t("setFavorites")),
        check("subscribedOnly", t("setSubscribed")),
        check("unseenOnly", t("setUnseen")),
        check("allowLandscape", t("setLandscape"), t("setLandscapeHelp")),
        pickers,
        el("h3", { text: t("playback") }),
        check("autoAdvance", t("setAutoAdvance"), t("setAutoAdvanceHelp")),
        check("disableMarkers", t("setMarkers"), t("setMarkersHelp"), true),
        check("disableGalleries", t("setGalleries"), t("setGalleriesHelp"), true),
        field(t("setGallerySeconds"), picSeconds, uid + "-pic"),
        check("disableDoubleTap", t("setDoubleTap"), t("setDoubleTapHelp"), true),
        check("disableWakeLock", t("setWakeLock"), t("setWakeLockHelp"), true),
        check("disableSplash", t("setSplash"), t("setSplashHelp"), true),
        check("splashOnSubscribe", t("setSplashSubscribe")),
        check("disableRelated", t("setRelated"), t("setRelatedHelp"), true),
        check("disableSummary", t("setSummary"), t("setSummaryHelp"), true),
        check("quickActions", t("setQuick"), t("setQuickHelp")),
        quickPicker,
        check("disablePlayCount", t("setPlayCount"), t("setPlayCountHelp"), true),
        field(t("setPlayCountAfter"), seconds, uid + "-sec"),
        save,
      ].forEach(function (c) {
        body.appendChild(c);
      });
      drawPickers();
    }

    function filterOf(values) {
      var f = {};
      Core.FILTER_KEYS.forEach(function (k) {
        f[k] = Core.settingValue(Core.SETTING[k], values[k]);
      });
      return f;
    }
    function applyFilter(f) {
      sheet.wasPlaying = false;
      sheet.close();
      self.showFilter(f, true);
    }
    apply.addEventListener("click", function () {
      // playback and format settings take effect for this view; filters too, without being stored
      self.settings.disablePlayCount = draft.disablePlayCount;
      self.settings.playCountAfter = draft.playCountAfter;
      self.settings.allowLandscape = draft.allowLandscape;
      self.settings.disableDoubleTap = draft.disableDoubleTap;
      self.settings.autoAdvance = draft.autoAdvance;
      self.settings.disableMarkers = draft.disableMarkers;
      self.settings.disableGalleries = draft.disableGalleries;
      self.settings.galleryImageSeconds = draft.galleryImageSeconds;
      self.settings.disableWakeLock = draft.disableWakeLock;
      self.settings.disableSplash = draft.disableSplash;
      self.settings.disableRelated = draft.disableRelated;
      self.settings.disableSummary = draft.disableSummary;
      self.settings.quickActions = draft.quickActions;
      self.settings.quickTags = draft.quickTags;
      self.settings.splashOnSubscribe = draft.splashOnSubscribe;
      applyFilter(filterOf(draft));
      self.reload();
    });
    reset.addEventListener("click", function () {
      // the filters only, not the playback settings
      Core.FILTER_KEYS.forEach(function (k) {
        draft[k] = Core.SETTING[k].def;
      });
      fill();
    });
    save.addEventListener("click", function () {
      msg.textContent = "";
      saveSettings(draft)
        .then(function (stored) {
          self.settings = Core.readSettings(stored);
          applyFilter(Core.filtersFrom(self.settings, null));
          self.reload();
        })
        .catch(function (e) {
          msg.textContent = t("saveFailed", { message: e.message });
        });
    });

    fill();
    var first = body.querySelector("[aria-checked=true]");
    if (first) first.focus();
  };

  // Chosen entries as chips, and a search field that offers the entries with scenes in the format
  // (Core.suggestions) as buttons below it, with the number of scenes; performers with a small picture.
  ShortsView.prototype.picker = function (id, label, items, counts, draft, key, pictures) {
    var self = this, t = this.t, byId = {};
    items.forEach(function (it) {
      byId[it.id] = it;
    });
    function picture(it) {
      var src = pictures && it && Core.localUrl(it.image_path);
      return src ? el("img", { class: CSS + "-mini", src: src, alt: "", loading: "lazy", decoding: "async" }) : null;
    }
    var chips = el("div", { class: CSS + "-chips" });
    var list = el("div", { class: CSS + "-suggest", id: id + "-list", hidden: true });
    var input = el("input", { type: "text", class: CSS + "-input", placeholder: t("addFilter"), autocomplete: "off", enterkeyhint: "done",
      "aria-label": label, "aria-controls": id + "-list", "aria-autocomplete": "list" });
    var box = el("div", { class: CSS + "-field" }, [el("span", { class: CSS + "-label", text: label }), chips, input, list]);
    function ids() {
      return Core.idList(draft[key]);
    }
    function drawChips() {
      chips.innerHTML = "";
      ids().forEach(function (x) {
        var it = byId[x], name = it ? it.name : "#" + x;
        chips.appendChild(
          el("span", { class: CSS + "-chip" }, [
            picture(it),
            el("span", { text: name }),
            button(CSS + "-chip-x", t("remove", { name: name }), "close", function () {
              draft[key] = ids()
                .filter(function (y) {
                  return y !== x;
                })
                .join(",");
              drawChips();
              suggest();
            }),
          ])
        );
      });
    }
    function add(x) {
      draft[key] = ids().concat([x]).join(",");
      input.value = "";
      drawChips();
      input.focus();
      suggest();
    }
    function options() {
      return list.querySelectorAll("button");
    }
    function suggest() {
      list.innerHTML = "";
      if (!box.contains(document.activeElement)) {
        list.hidden = true;
        return;
      }
      list.hidden = false;
      var found = Core.suggestions(items, counts, input.value, ids());
      if (!found.length) list.appendChild(el("p", { class: CSS + "-muted", text: t("noSuggestions") }));
      found.forEach(function (r) {
        var b = el("button", { type: "button", class: CSS + "-option", "data-id": r.item.id }, [
          picture(r.item),
          el("span", { class: CSS + "-option-name", text: r.item.name }),
          el("span", { class: CSS + "-option-n", text: "· " + self.i18n.n(r.count) }),
        ]);
        b.addEventListener("pointerdown", function (e) {
          e.preventDefault(); // keeps the focus (and the phone's keyboard) in the field
        });
        b.addEventListener("click", function () {
          add(String(r.item.id));
        });
        list.appendChild(b);
      });
    }
    input.addEventListener("input", suggest);
    box.addEventListener("focusin", function (e) {
      if (e.target === input) suggest();
    });
    box.addEventListener("focusout", function (e) {
      if (!box.contains(e.relatedTarget)) list.hidden = true;
    });
    box.addEventListener("keydown", function (e) {
      var all = [].slice.call(options()), at = all.indexOf(document.activeElement);
      if (e.key === "Enter" && e.target === input) {
        e.preventDefault();
        if (all[0]) add(all[0].getAttribute("data-id"));
      } else if (e.key === "ArrowDown" && all.length) {
        e.preventDefault();
        all[Math.min(at + 1, all.length - 1)].focus();
      } else if (e.key === "ArrowUp" && at >= 0) {
        e.preventDefault();
        (at ? all[at - 1] : input).focus();
      } else if (e.key === "Escape" && !list.hidden) {
        e.stopPropagation(); // closes the list, not the dialog
        list.hidden = true;
        input.focus();
      }
    });
    drawChips();
    return box;
  };

  // ------------------------------------------------------------------ React wrapper, route, navbar

  // A render error in our components must not reach Stash: its own error boundary sits outside the
  // IntlProvider and fails itself, which leaves the whole UI black. fallback(error) renders instead.
  // (Without React.Component, as in the demo's stand-in, components are used as they are.)
  function ErrorBoundary(props) {
    React.Component.call(this, props);
    this.state = { error: null };
  }
  if (React.Component) {
    ErrorBoundary.prototype = Object.create(React.Component.prototype);
    ErrorBoundary.prototype.constructor = ErrorBoundary;
    ErrorBoundary.getDerivedStateFromError = function (error) {
      return { error: error };
    };
    ErrorBoundary.prototype.componentDidCatch = function (error) {
      console.error(PLUGIN_ID + ":", error);
    };
    ErrorBoundary.prototype.render = function () {
      return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
    };
  }

  function guarded(Component, fallback) {
    if (!React.Component) return Component;
    function Guarded(props) {
      return h(ErrorBoundary, { fallback: fallback }, h(Component, props));
    }
    Guarded.displayName = "StashShorts" + (Component.name || "Component");
    return Guarded;
  }

  function errorMessage(e) {
    return (e && e.message) || String(e);
  }

  function PageError(props) {
    var i18n = useI18n();
    var message = errorMessage(props.error);
    return h(
      "div",
      { className: CSS + "-page" },
      h("div", { className: CSS + "-root" }, h("div", { className: CSS + "-message", role: "alert" }, i18n ? i18n.t("pageError", { message: message }) : "Stash Shorts: " + message))
    );
  }

  function ShortsPage() {
    var ref = React.useRef(null);
    var history = RRD.useHistory();
    var i18n = useI18n();
    var failed = React.useState(null);
    React.useEffect(
      function () {
        if (!i18n) return;
        var title = document.title;
        document.title = i18n.t("title") + " | Stash";
        var view;
        try {
          view = new ShortsView(ref.current, history, i18n);
          window[DEBUG_HANDLE] = view;
          view.start();
        } catch (e) {
          console.error(PLUGIN_ID + ":", e);
          failed[1](e);
        }
        return function () {
          try {
            if (view) view.destroy();
          } catch (e) {
            console.error(PLUGIN_ID + ":", e);
          }
          document.title = title;
          if (ref.current) ref.current.innerHTML = "";
        };
      },
      [i18n]
    );
    if (failed[0]) return h(PageError, { error: failed[0] });
    return h("div", { className: CSS + "-page", ref: ref });
  }

  PluginApi.register.route(
    ROUTE,
    guarded(ShortsPage, function (error) {
      return h(PageError, { error: error });
    })
  );

  // Entry point for use outside Stash's UI (demo/ and the screenshots); in Stash the route above mounts
  // the page. opts: {locale, history: {push, replace, goBack, length}}.
  window.StashShortsMount = function (root, opts) {
    opts = opts || {};
    return loadI18n(opts.locale).then(function (i18n) {
      var noop = function () {};
      var view = new ShortsView(root, opts.history || { push: noop, replace: noop, length: 1 }, i18n);
      window[DEBUG_HANDLE] = view;
      view.start();
      return view;
    });
  };

  // The navbar entry is optional: if a library it needs is missing, the page stays reachable at ROUTE.
  var Nav = Bootstrap && Bootstrap.Nav;
  var Button = Bootstrap && Bootstrap.Button;
  var FA = PluginApi.libraries.FontAwesomeSolid || {};
  // FontAwesomeIcon directly, not PluginApi.components.Icon: that one can be patched by other plugins, and
  // a patch that returns nothing for our icon would break the entry. Stash's Icon only adds "fa-icon".
  var FontAwesomeIcon = PluginApi.libraries.ReactFontAwesome && PluginApi.libraries.ReactFontAwesome.FontAwesomeIcon;
  var navIcon = FA.faMobileScreenButton || FA.faMobileAlt || FA.faFilm;

  // Same markup as Stash's own menu items (MainNavBar uses a LinkContainer around a Button, which ends
  // up as <a class="btn ...">); LinkContainer is not exposed to plugins, so Button renders as a Link.
  function NavItem() {
    var active = !!RRD.useRouteMatch({ path: ROUTE, exact: true });
    var i18n = useI18n();
    if (!i18n) return null;
    return h(
      Nav.Link,
      { eventKey: ROUTE, as: "div", className: "col-4 col-sm-3 col-md-2 col-lg-auto" },
      h(
        Button,
        {
          as: RRD.Link,
          to: ROUTE,
          className:
            "minimal p-4 p-xl-2 d-flex d-xl-inline-block flex-column justify-content-between align-items-center" +
            (active ? " active" : ""),
        },
        FontAwesomeIcon && navIcon ? h(FontAwesomeIcon, { icon: navIcon, className: "fa-icon nav-menu-icon d-block d-xl-inline mb-2 mb-xl-0" }) : null,
        h("span", null, i18n.t("nav"))
      )
    );
  }

  var SafeNavItem = guarded(NavItem, function () {
    return null;
  });

  if (Nav && Button && RRD && RRD.Link && RRD.useRouteMatch && PluginApi.patch && PluginApi.patch.before) {
    PluginApi.patch.before("MainNavBar.MenuItems", function () {
      return Core.withNavChild(arguments, h(SafeNavItem, { key: PLUGIN_ID }), React.Children.toArray);
    });
  } else {
    console.warn(PLUGIN_ID + ": navbar entry not added, a library is missing; the page is at " + ROUTE);
  }
})();
