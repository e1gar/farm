/* ===========================================================================
 * Farm_Invite — stateless game engine
 * Reads config from ?d= (lz-string), validates, runs a DOM/CSS state machine.
 * No backend, no persistence. See DESIGN.md §2, §3.
 * ========================================================================= */
(function () {
  "use strict";

  /* ---- Asset map (local /assets, see DESIGN §9) ------------------------- */
  var A = {
    bg_farm_day: "assets/bg_farm_day.svg",
    bg_barn_day: "assets/bg_barn_day.svg",
    bg_barn_night: "assets/bg_barn_night.svg",
    spr_chicken: "assets/spr_chicken.png",
    spr_cow: "assets/spr_cow.png",
    spr_pig: "assets/spr_pig.png",
    spr_sheep: "assets/spr_sheep.png",
    spr_sheep_shorn: "assets/spr_sheep_shorn.png",
    prop_nest: "assets/prop_nest.png",
    prop_egg: "assets/prop_egg.png",
    prop_bucket_empty: "assets/prop_bucket_empty.png",
    prop_bucket_milk: "assets/prop_bucket_milk.png",
    prop_trough_empty: "assets/prop_trough_empty.png",
    prop_trough_food: "assets/prop_trough_food.png",
    prop_wool: "assets/prop_wool.png",
    ui_hand: "assets/ui_hand.png"
  };

  /* Per-round parameterization (DESIGN §3.2) */
  var ROUNDS = [
    { animal: "spr_chicken", reward: "prop_egg" },
    { animal: "spr_cow", reward: "prop_bucket_milk" },
    { animal: "spr_pig", reward: "prop_trough_food" },
    { animal: "spr_sheep", reward: "prop_wool" }
  ];

  /* ---- Fallback demo payload (DESIGN §2.2) — never show a broken screen -- */
  var DEMO = {
    v: 1,
    n: "Маша",
    a: 7,
    q: [
      ["Маша любит рисовать?", 1],
      ["Маша боится собак?", 0],
      ["У Маши есть кот?", 1],
      ["Маша умеет плавать?", 1]
    ],
    i: {
      d: "12 июля",
      t: "15:00",
      p: "Кафе «Сказка», ул. Ленина 10",
      m: "Приходи на мой день рождения!"
    }
  };

  var MAX_STR = 140; // hard clamp per DESIGN §2.3

  /* ---- Decode + validate gate (DESIGN §2.3) ----------------------------- */
  function clampStr(x) {
    return typeof x === "string" ? x.slice(0, MAX_STR) : "";
  }

  function isQuestion(item) {
    return (
      Array.isArray(item) &&
      item.length === 2 &&
      typeof item[0] === "string" &&
      (item[1] === 0 || item[1] === 1)
    );
  }

  function sanitize(cfg) {
    // Coerce into a known-good shape. Strings clamped; rendered via textContent only.
    var inv = cfg.i || {};
    return {
      v: 1,
      n: clampStr(cfg.n) || "Друг",
      a: typeof cfg.a === "number" && cfg.a > 0 && cfg.a < 100 ? cfg.a : null,
      q: cfg.q.map(function (item) {
        return [clampStr(item[0]), item[1]];
      }),
      i: {
        d: clampStr(inv.d),
        t: clampStr(inv.t),
        p: clampStr(inv.p),
        m: clampStr(inv.m)
      }
    };
  }

  function loadConfig() {
    try {
      var d = new URLSearchParams(window.location.search).get("d");
      if (!d) throw new Error("no d param");

      var json = LZString.decompressFromEncodedURIComponent(d);
      if (!json) throw new Error("decompress returned null");

      var cfg = JSON.parse(json);
      if (cfg.v !== 1) throw new Error("unsupported schema version");
      if (!Array.isArray(cfg.q) || cfg.q.length !== 4) throw new Error("q must be 4 items");
      if (!cfg.q.every(isQuestion)) throw new Error("malformed question");

      return sanitize(cfg);
    } catch (err) {
      console.warn("[farm] config decode failed, using demo payload:", err.message);
      return sanitize(DEMO);
    }
  }

  /* ---- Stage scaling (fixed 1080x1920 → fit any phone) ------------------- */
  var STAGE_W = 1080, STAGE_H = 1920;
  function fitStage() {
    var stage = document.getElementById("stage");
    var scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    var w = STAGE_W * scale, h = STAGE_H * scale;
    stage.style.transform =
      "translate(" + (window.innerWidth - w) / 2 + "px," +
      (window.innerHeight - h) / 2 + "px) scale(" + scale + ")";
  }

  /* ---- Asset preload (DESIGN §3.3) -------------------------------------- */
  function preload(done) {
    var urls = Object.keys(A).map(function (k) { return A[k]; });
    var left = urls.length;
    if (!left) return done();
    var finish = function () { if (--left <= 0) done(); };
    urls.forEach(function (u) {
      var img = new Image();
      img.onload = finish;
      img.onerror = finish; // never block boot on a single failed asset
      img.src = u;
    });
  }

  /* ---- DOM helpers ------------------------------------------------------ */
  function el(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }
  function img(src, cls, parent) {
    var n = el("img", cls, parent);
    n.src = src;
    n.alt = "";
    return n;
  }
  function bg(scene, key) {
    var n = img(A[key], "bg", scene);
    return n;
  }

  /* ===========================================================================
   * Game — the state machine. Everything renders deterministically from `s`.
   * ========================================================================= */
  function Game(cfg) {
    this.cfg = cfg;
    this.scene = document.getElementById("scene");
    this.s = { phase: "START", qIndex: 0, collected: [false, false, false, false] };
    this.locked = false; // debounce double-taps (DESIGN §3.3)
  }

  Game.prototype.go = function (phase) {
    this.s.phase = phase;
    this.locked = false;
    this.render();
  };

  // Debounced action wrapper so double-taps fire once.
  Game.prototype.once = function (fn) {
    var self = this;
    return function (e) {
      if (e) e.preventDefault();
      if (self.locked) return;
      self.locked = true;
      fn.call(self);
    };
  };

  Game.prototype.tap = function (node, fn) {
    var h = this.once(fn);
    node.addEventListener("click", h);
    return node;
  };

  Game.prototype.clear = function () {
    this.scene.textContent = "";
  };

  /* Animals row, with optional active/dim state by current qIndex. */
  Game.prototype.renderAnimals = function (mode) {
    var layer = el("div", "animals", this.scene);
    for (var i = 0; i < 4; i++) {
      var a = img(A[ROUNDS[i].animal], "animal", layer);
      a.dataset.i = i;
      if (mode === "focus") {
        if (i === this.s.qIndex) a.classList.add("active");
        else a.classList.add("dim");
      }
    }
    return layer;
  };

  /* Inventory grid reflecting collected[] (rewards already stored). */
  Game.prototype.renderInventory = function () {
    var layer = el("div", "inv", this.scene);
    var grid = el("div", "inv-grid", layer);
    for (var i = 0; i < 4; i++) {
      var slot = el("div", "slot", grid);
      if (this.s.collected[i]) {
        slot.classList.add("filled");
        img(A[ROUNDS[i].reward], null, slot);
      }
    }
    return layer;
  };

  /* ---------- Phase renderers ------------------------------------------- */
  Game.prototype.render = function () {
    this.clear();
    switch (this.s.phase) {
      case "START":   return this.rStart();
      case "ASK":     return this.rAsk();
      case "FAIL":    return this.rFail();
      case "REWARD":  return this.rReward();
      case "STORE":   return this.rStore();
      case "SUCCESS": return this.rSuccess();
      case "INVITE":  return this.rInvite();
    }
  };

  Game.prototype.rStart = function () {
    bg(this.scene, "bg_farm_day");
    var t = el("div", "title", this.scene);
    t.textContent = "С Днём Рождения,";
    var sub = el("div", "subtitle", this.scene);
    sub.textContent = this.cfg.n + (this.cfg.a ? ", " + this.cfg.a + "!" : "!");
    var btn = el("button", "btn btn-primary", this.scene);
    btn.textContent = "Начать";
    this.tap(btn, function () {
      this.s.qIndex = 0;
      this.s.collected = [false, false, false, false];
      this.go("ASK");
    });
  };

  Game.prototype.rAsk = function () {
    bg(this.scene, "bg_barn_day");
    this.renderAnimals("focus");
    this.renderInventory();

    var prog = el("div", "progress", this.scene);
    prog.textContent = "Вопрос " + (this.s.qIndex + 1) + " из 4";

    var q = el("div", "question", this.scene);
    q.textContent = this.cfg.q[this.s.qIndex][0];

    var ans = el("div", "answers", this.scene);
    var yes = el("button", "btn btn-answer btn-yes", ans);
    yes.textContent = "Да";
    var no = el("button", "btn btn-answer btn-no", ans);
    no.textContent = "Нет";

    var self = this;
    this.tap(yes, function () { self.answer(1); });
    this.tap(no, function () { self.answer(0); });
  };

  Game.prototype.answer = function (choice) {
    var correct = this.cfg.q[this.s.qIndex][1]; // compare against CORRECT answer (§2.1/§6.3)
    this.go(choice === correct ? "REWARD" : "FAIL");
  };

  Game.prototype.rFail = function () {
    bg(this.scene, "bg_barn_night");
    this.renderAnimals(); // all sleeping (no focus)
    var msg = el("div", "msg", this.scene);
    msg.textContent = "Животные уснули… Попробуй ещё раз!";
    var btn = el("button", "btn btn-primary", this.scene);
    btn.textContent = "Назад";
    this.tap(btn, function () { this.go("ASK"); }); // same qIndex — no dead end
  };

  Game.prototype.rReward = function () {
    bg(this.scene, "bg_barn_day");
    this.renderAnimals("focus");
    this.renderInventory();

    var prop = img(A[ROUNDS[this.s.qIndex].reward], "reward-prop props", this.scene);
    // trigger pop on next frame
    requestAnimationFrame(function () { prop.classList.add("show"); });

    var hand = img(A.ui_hand, "ui-hand hand", this.scene);

    // Whole stage is tappable here so small fingers can't miss.
    var hit = el("div", "ui", this.scene);
    hit.style.position = "absolute";
    hit.style.inset = "0";
    hit.style.cursor = "pointer";
    this.tap(hit, function () {
      hand.style.display = "none";
      prop.classList.remove("show");
      prop.classList.add("fly");
      this.go("STORE");
    });
  };

  Game.prototype.rStore = function () {
    bg(this.scene, "bg_barn_day");
    this.s.collected[this.s.qIndex] = true; // commit reward to inventory
    this.renderAnimals("focus");
    this.renderInventory();

    var btn = el("button", "btn btn-primary", this.scene);
    btn.textContent = "Продолжить";
    this.tap(btn, function () {
      if (this.s.qIndex < 3) {
        this.s.qIndex += 1;
        this.go("ASK");
      } else {
        this.go("SUCCESS");
      }
    });
  };

  Game.prototype.rSuccess = function () {
    bg(this.scene, "bg_barn_day");
    this.renderAnimals();   // all four, happy
    this.renderInventory(); // full grid
    var msg = el("div", "msg", this.scene);
    msg.textContent = "Ура! Все друзья в сборе!";
    var btn = el("button", "btn btn-primary", this.scene);
    btn.textContent = "Дальше";
    this.tap(btn, function () { this.go("INVITE"); });
  };

  Game.prototype.rInvite = function () {
    bg(this.scene, "bg_farm_day");
    var card = el("div", "invite-card", this.scene);
    var h = el("h1", null, card);
    h.textContent = "Поздравляем!";
    var who = el("div", "who", card);
    who.textContent = this.cfg.n + (this.cfg.a ? " — " + this.cfg.a + " лет!" : "!");

    var inv = this.cfg.i;
    var rows = [
      inv.d ? ["Дата", inv.d] : null,
      inv.t ? ["Время", inv.t] : null,
      inv.p ? ["Место", inv.p] : null
    ];
    rows.forEach(function (r) {
      if (!r) return;
      var row = el("div", "invite-row", card);
      var label = el("span", null, row);
      label.textContent = r[0] + ": ";
      row.appendChild(document.createTextNode(r[1]));
    });

    if (inv.m) {
      var m = el("div", "invite-msg", card);
      m.textContent = inv.m;
    }
  };

  /* ---- Boot ------------------------------------------------------------- */
  function boot() {
    fitStage();
    window.addEventListener("resize", fitStage);
    window.addEventListener("orientationchange", fitStage);

    var cfg = loadConfig();
    preload(function () {
      var loader = document.getElementById("loader");
      if (loader) loader.classList.add("hidden");
      new Game(cfg).go("START");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
