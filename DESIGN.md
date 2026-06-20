# DESIGN.md — Project "Farm_Invite"

<task_instructions>
Design (no source code yet) a stateless, mobile-first 2D web mini-game used as a reusable SaaS template for kids' birthday invitations. A parent supplies 4 Yes/No questions about the birthday child; the game (a farm/barn scene) is played on a phone in Russian by default. The full configuration is compressed with `lz-string` into a single URL query parameter (`?d=`) — no database. This document maps: (1) the stateless URL architecture, (2) the frontend state machine, (3) the exact Higgsfield MCP asset-generation pipeline, and (4) an adversarial critique of URL payload size safety and sprite isolation.
</task_instructions>

---

## 1. Product Summary

| Attribute | Decision |
|---|---|
| Type | Single-page 2D web mini-game (vertical, 9:16) |
| Audience | Children, playing on a phone, shared by a parent |
| Business model | Reusable static template; one build serves every party |
| Hosting cost | $0 — fully static (HTML/CSS/JS + image assets on a static host/CDN) |
| State | Stateless. Zero backend persistence. All config lives in the URL |
| Default locale | `ru` (Russian). All demo content in Cyrillic |
| Font | Google Fonts **Noto Sans** (full Cyrillic coverage) |
| Tone | Gentle, zero-frustration, positive reinforcement, safe fail states |

The "Node.js backend" is intentionally minimal: it exists only as an optional **builder/encoder page** (a parent fills a form → gets a shareable link). The *played* game requires no server at runtime and can be served as flat files.

---

## 2. Stateless URL Architecture (lz-string)

### 2.1 Payload schema (pre-compression JSON)

Keys are deliberately short (single letters) to shrink the pre-compression source, which directly shrinks the compressed output.

```jsonc
{
  "v": 1,                       // schema version (forward-compat / migration guard)
  "n": "Маша",                  // child name
  "a": 7,                       // age (number)
  "q": [                        // exactly 4 questions; each a [text, correctAnswer] pair
    ["Маша любит рисовать?", 1],          // 1 = correct answer is "Да" (Yes)
    ["Маша боится собак?", 0],            // 0 = correct answer is "Нет" (No)
    ["У Маши есть кот?", 1],
    ["Маша умеет плавать?", 1]
  ],
  "i": {                        // invitation (final screen)
    "d": "12 июля",             // date
    "t": "15:00",               // time
    "p": "Кафе «Сказка», ул. Ленина 10",  // place
    "m": "Приходи на мой день рождения!"  // free message (optional)
  }
}
```

> **Answer semantics — critical, see critique §6.3:** `q[i][1]` is the *correct* answer, NOT a flag for "which choice advances". The engine compares the child's tap (Yes=1 / No=0) against this value. Phrasing a question whose true answer is "Нет" is legitimate and must still route to the success branch when the child answers correctly. The builder UI must let the parent pick the correct answer per question.

### 2.2 Encode/decode flow

```
Builder form  → JSON.stringify(minified)
              → LZString.compressToEncodedURIComponent(json)
              → https://host/play/?d=<compressed>
Player load   → read URLSearchParams.get('d')
              → LZString.decompressFromEncodedURIComponent(d)
              → JSON.parse  → validate against schema  → boot state machine
```

- Use **`compressToEncodedURIComponent`** (NOT `compressToBase64`). It emits only URL-safe characters (`A–Z a–z 0–9 + - $`) and needs **no** additional `encodeURIComponent`, avoiding the double-encoding bloat that 2-byte Cyrillic would otherwise cause (`%D0%9C` style).
- On decode failure / missing `d` → load a hard-coded **Russian demo payload** and continue (never show a broken screen to a child). Log the failure to console only.

### 2.3 Validation gate (defensive, runs before boot)

1. `d` present and non-empty.
2. Decompress returns a non-null string.
3. `JSON.parse` succeeds.
4. `v === 1`.
5. `q` is an array of **exactly 4** items; each item is `[string, 0|1]`.
6. Strings clamped to a max length (e.g. 140 chars) and rendered as **textContent only** (never `innerHTML`) → XSS-proof.
7. Any failure → fallback demo payload.

---

## 3. Frontend State Machine

Single-page app. One persistent canvas/stage; "pages" are **states**, not separate documents. No reloads, no routing.

### 3.1 State model

```
GameState = {
  phase: enum,                       // see table below
  qIndex: 0..3,                      // which animal/question we are on
  collected: [bool,bool,bool,bool],  // inventory slots filled
  config: <decoded payload>
}
```

### 3.2 State table (maps the 13 specified pages)

| Phase | Page | Background | Key elements | Transitions |
|---|---|---|---|---|
| `START` | 1 | Farm exterior (day) | Title, child name, **Start** btn | → `ASK` (q0) |
| `ASK` | 2,6,8,10 | Barn interior (day) | 4 animals top, empty props bottom, question `n/4`, **Да/Нет** | correct → `REWARD`; wrong → `FAIL` |
| `FAIL` | 3 | Barn interior (night) | Sleeping animals, soft "Попробуй ещё раз", **Назад** btn | → `ASK` (same qIndex) |
| `REWARD` | 4,7,8,10 | Barn (day) | Prop fills (egg/milk/food/wool), **hand cursor** prompt | tap hand → `STORE` |
| `STORE` | 5,… | Barn (day) | Item animates to inventory slot; animal walks to its station; **Продолжить** | qIndex<3 → `ASK`(+1); qIndex==3 → `SUCCESS` |
| `SUCCESS` | 12 | Barn (day) | All 4 animals in 2×2 grid, celebratory | **Finish** → `INVITE` |
| `INVITE` | 13 | Farm exterior (day) or soft gradient | "Поздравляем!" + personalized invite text (name, date, time, place) | (end) |

The four question rounds (Chicken→Cow→Pig→Sheep) reuse the **same** `ASK/FAIL/REWARD/STORE` cycle parameterized by `qIndex`. Per-round reward differs only in which prop/animation plays:

| qIndex | Animal | Reward prop | Station |
|---|---|---|---|
| 0 | Chicken | Egg in nest | Nest |
| 1 | Cow | Milk in bucket | Bucket |
| 2 | Pig | Food in trough | Trough |
| 3 | Sheep | Wool (shorn) | Lower grid |

### 3.3 Zero-frustration guarantees

- **No dead ends:** `FAIL` always returns to the *same* question, never restarts the whole game.
- **No timers, no score, no losing.** A wrong answer = "the animals fell asleep, try again" — framed as play, not failure.
- **Big tap targets** (min 56×56 px) for small fingers.
- **Idempotent transitions:** double-taps are debounced; re-entering a phase re-renders deterministically from `GameState`.
- **Preload all assets** at `START` (show a Noto-Sans spinner) so no mid-game image pop-in.

---

## 4. Layout & Rendering Constraints

- **9:16 vertical**, mobile-first. Use a fixed virtual stage (e.g. 1080×1920) scaled with CSS `transform: scale()` + `100dvh`/`100dvw` letterboxing to fit any phone without layout reflow.
- Recommend **DOM/CSS layering** over Canvas for v1: simpler responsive scaling, accessible tap targets, trivial sprite isolation via transparent PNGs, and animations via CSS `transform`. Canvas reserved only if performance demands it.
- **Layer order (z):** background → animals → props/stations → inventory bar → hand cursor → UI buttons/text.
- **Animation = CSS transforms only:** head-bob (`@keyframes` rotate ±4°), idle bounce (`translateY`), reward item glide (`translate` + `ease-in-out`), hand cursor pulse (`scale`). No physics, no heavy JS RAF loops.
- **Noto Sans:** `<link>` preconnect + `font-display: swap`; preload the Cyrillic subset. Set on `:root` so all text inherits.

---

## 5. Higgsfield MCP Asset Pipeline

### 5.1 Style Seed Phrase (prepend to EVERY prompt)

> **`2D flat vector illustration, pastel color palette, thick uniform black outlines, cute children's picture-book style, soft simple shading, clean shapes, friendly and warm`**

Generating all assets with one seed phrase + one model in one batch maximizes stylistic consistency.

### 5.2 Pipeline steps

1. **Model selection:** **LOCKED → `recraft-v4-1` (Recraft 4.1)** via `models_explore(recommend)` (score 380, top match). Use `model_type: "vector"` (SVG-like flat illustration — matches thick-outline pastel style) for all assets. Backgrounds at `resolution: "2k"`. The `background_color` param sets the matting background per-asset (`#FFFFFF` default; `#D0E8FF` for white subjects).
2. **Backgrounds:** `generate_image`, `aspect_ratio: "9:16"`.
3. **Sprites/props:** `generate_image` prompted on a **solid pure-white** background (most reliable for clean matting), then pipe each through **`remove_background`** (`media_type:'image'`) to produce transparent PNGs. Do **not** rely on the model alone for true alpha — see critique §6.1.
4. **Consistency:** reuse a saved Element / reference where supported so the 4 animals share proportions and palette across generations.
5. **Output naming:** `bg_farm_day`, `bg_barn_day`, `bg_barn_night`, `spr_chicken`, `spr_cow`, `spr_pig`, `spr_sheep`, `spr_sheep_shorn`, `prop_nest`, `prop_egg`, `prop_bucket_empty`, `prop_bucket_milk`, `prop_trough_empty`, `prop_trough_food`, `prop_wool`, `ui_hand`.

### 5.3 Exact prompts

**Backgrounds (9:16):**

- `bg_farm_day` — *[STYLE SEED] + ` a cheerful farm exterior on a sunny day, red barn in the distance, green rolling hills, blue sky with a few round clouds, wooden fence, vertical composition with empty space in the lower third for a button, no characters, no text`*
- `bg_barn_day` — *[STYLE SEED] + ` interior of a cozy farm barn, daytime, warm wooden walls and beams, hay bales, soft daylight from a window, clear empty area across the top for animals and an empty area across the bottom for a 2x2 grid of slots, no animals, no props, no text, vertical composition`*
- `bg_barn_night` — *[STYLE SEED] + ` interior of the same cozy farm barn at night, dim warm lantern light, deep blue shadows, a few stars through the window, calm and sleepy mood, empty barn, no animals, no text, vertical composition`*

**Animals (solid white background, then `remove_background`):**

- `spr_chicken` — *[STYLE SEED] + ` a single cute plump chicken standing, facing forward-right, full body, friendly smile, isolated and centered on a solid pure white background, no shadow, no ground, no scenery, no text`*
- `spr_cow` — *[STYLE SEED] + ` a single cute spotted cow standing, full body, gentle happy expression, isolated and centered on a solid pure white background, no shadow, no ground, no scenery, no text`*
- `spr_pig` — *[STYLE SEED] + ` a single cute pink pig standing, full body, cheerful expression, isolated and centered on a solid pure white background, no shadow, no ground, no scenery, no text`*
- `spr_sheep` — *[STYLE SEED] + ` a single cute fluffy white sheep with thick wool, standing, full body, happy expression, isolated and centered on a solid pale blue background (#D0E8FF) to protect white edges during matting, no shadow, no ground, no scenery, no text`*  **(white-subject → pale-blue bg, see §6.1)**
- `spr_sheep_shorn` — *[STYLE SEED] + ` the same cute sheep but freshly shorn with thin short fur, slightly smaller fluff, still happy, isolated and centered on a solid pure white background, no shadow, no scenery, no text`*

**Props (solid white background, then `remove_background`):**

- `prop_nest` — *[STYLE SEED] + ` an empty straw bird nest, top-down friendly view, isolated on solid pure white background, no shadow, no text`*
- `prop_egg` — *[STYLE SEED] + ` a single smooth white egg, isolated on solid pale blue background (#D0E8FF) to protect white edges during matting, no shadow, no text`*  **(white-subject → pale-blue bg)**
- `prop_bucket_empty` — *[STYLE SEED] + ` an empty metal milking bucket, isolated on solid pure white background, no shadow, no text`*
- `prop_bucket_milk` — *[STYLE SEED] + ` a metal bucket full of white milk, isolated on solid pale blue background (#D0E8FF) to protect white edges during matting, no shadow, no text`*  **(white-subject → pale-blue bg)**
- `prop_trough_empty` — *[STYLE SEED] + ` an empty wooden feeding trough, isolated on solid pure white background, no shadow, no text`*
- `prop_trough_food` — *[STYLE SEED] + ` a wooden feeding trough full of grain and vegetables, isolated on solid pure white background, no shadow, no text`*
- `prop_wool` — *[STYLE SEED] + ` a soft fluffy bundle of white sheep wool, isolated on solid pure white background, no shadow, no text`*
- `ui_hand` — *[STYLE SEED] + ` a cute cartoon pointing hand cursor icon, index finger pointing, isolated on solid pure white background, no shadow, no text`*

### 5.4 Per-asset post-processing

| Asset class | After generation |
|---|---|
| Backgrounds | Keep as-is (9:16). Optionally `upscale_image` to stay crisp on large phones |
| All sprites/props | `remove_background` → export PNG with alpha; trim transparent margins; keep a consistent on-stage scale |

---

## 6. Adversarial Critique

*(External skeptical auditor stance — required focus: lz-string URL payload size safety margins, and sprite isolation technique.)*

### 6.1 Sprite isolation — failure modes

- **Models do not produce reliable alpha.** Prompting "transparent background" to a diffusion/flat-vector model frequently yields a *checkerboard pattern baked as opaque pixels* or an off-white background, not real transparency. **Mitigation (adopted):** always generate on solid pure-white, then run `remove_background`. Do not trust the model's alpha claim. **[Confidence: High]**
- **White-on-white erosion.** The sheep and egg are white objects on a white background. Background removal can eat the object's own white edges or interior, producing holes/jagged silhouettes. **Mitigation:** for white subjects, prefer generating on a **pale-grey or pale-blue** background instead of pure white, *then* matte; the style seed's "thick black outline" already helps the matcher find the boundary. Manual QA required on `spr_sheep`, `prop_egg`, `prop_bucket_milk`. **[Confidence: Medium]** — *Uncertainty: actual matting behavior on low-contrast white edges is unverified. Verify by generating sheep+egg both ways and inspecting alpha edges at 200% zoom.*
- **Semi-transparent halo / fringing.** Anti-aliased outline pixels become semi-opaque grey after matting and show as a halo over dark/night backgrounds. **Mitigation:** defringe / matte against target, or composite sprites only over the light day barn; verify each sprite over `bg_barn_night`. **[Confidence: Medium]**
- **Inconsistent scale & proportion** across separately generated animals breaks the 2×2 grid harmony. **Mitigation:** use reference Element/Soul consistency; normalize on-stage via fixed CSS box heights, not native px. **[Confidence: High]**
- **Baked shadows/ground** despite "no shadow, no ground" — common model disobedience. **Mitigation:** explicit negative phrasing (done) + manual reject-and-regenerate loop. **[Confidence: Medium]**

### 6.2 URL payload size & integrity — the central risk

**Raw size estimate (Russian, realistic worst case):**
- 4 questions × ~50 Cyrillic chars ≈ ~200 chars
- name + age + invite (date/time/place/message ~120 chars) + JSON syntax/keys ≈ +150 chars
- **Pre-compression JSON ≈ 350–450 characters** of mostly Cyrillic.

**Compression reality check — DO NOT assume Cyrillic "compresses well":**
- `lz-string` is LZ-based (dictionary on repeated substrings) operating on UTF-16 code units. Short, low-repetition natural-language Russian text has **little internal redundancy**, so the ratio on ~400 chars is modest — realistically the encoded output lands in the **~300–550 character** range, *not* a dramatic shrink. The win over `encodeURIComponent` is real (raw percent-encoded Cyrillic would be ~3× larger), but it is **not** a magic size guarantee. **[Confidence: Medium]** — *Uncertainty: exact ratio depends on the actual text. Verify empirically (below).*

**Hard limits that actually bite:**
1. **Messaging-app link preview / truncation, not the browser.** Modern browsers handle 10k+ char URLs fine. The real threat is **WhatsApp/Telegram/iMessage** link rendering, in-app browsers, and especially **QR codes** if a parent generates one — QR capacity drops sharply past ~300 alphanumeric chars at decent error correction. **[Confidence: Medium]**
2. **Copy/paste & manual retype** of a 500-char link is hostile UX. **[Confidence: High]**
3. **No integrity check:** a single dropped/altered character (chat clients sometimes mangle trailing punctuation or wrap URLs) silently corrupts the payload → `JSON.parse` throws. Without a fallback the child sees a blank/broken screen — a direct violation of the zero-frustration rule. **[Confidence: High]**

**Mitigations (adopted):**
- Enforce a **builder-side length budget**: cap each question at ~80 chars and the message at ~120; show a live "link length" meter and warn above a soft threshold (e.g. >800 encoded chars). **[Confidence: High]**
- Always ship a **fallback demo payload** so a corrupted/missing `d` degrades to a playable game, never a crash (§2.2/§2.3). **[Confidence: High]**
- **Schema version `v`** lets future builds reject/upgrade old links instead of misparsing. **[Confidence: High]**
- Consider an optional **short-link service** for parents who hit QR/length pain — but that reintroduces a backend/cost and breaks the $0 stateless promise, so keep it out of v1 and document the limit instead. **[Confidence: High]**
- **Verification step for operator:** encode the longest plausible Russian payload, paste the resulting link into WhatsApp, Telegram, and iMessage on iOS+Android, confirm it remains a single tappable link and round-trips to identical JSON. Generate a QR from it and scan it. Record the encoded length. **[Confidence: Low until executed]** — *this empirical test is required before declaring the URL strategy safe.*

### 6.3 Other audited risks

- **XSS via question text** rendered into the DOM. **Mitigation:** `textContent` only, length clamp, schema validation (§2.3). **[Confidence: High]**
- **Answer-semantics confusion** (§2.1) — if "correct answer" is conflated with "Yes advances", any question whose true answer is "No" breaks. Explicitly modeled as `[text, correctAnswer]`. Builder UI must let the parent pick the correct answer per question. **[Confidence: High]**
- **Font FOIT / broken Cyrillic boxes** before Noto Sans loads. **Mitigation:** `font-display: swap`, preconnect, preload Cyrillic subset; system-font fallback that still renders Cyrillic. **[Confidence: High]**
- **Asset weight on mobile data.** 3 full 9:16 backgrounds + ~16 sprites could be multi-MB. **Mitigation:** export compressed WebP/PNG, preload at START with a spinner; budget total < ~2.5 MB. **[Confidence: Medium]**
- **iOS Safari `100vh` jump** with the address bar. **Mitigation:** use `100dvh` + scale-to-fit stage. **[Confidence: High]**

---

## 7. Decisions (LOCKED — 2026-06-20)

1. **Render layer:** **DOM/CSS layering** (Canvas rejected as overkill). Standard HTML elements scaled via CSS `transform: scale()` for responsive scaling, native tap targets, and cheap CSS animations.
2. **Builder page:** **IN SCOPE for v1** as a purely static `builder.html` — the parent fills a form, client-side JS generates the compressed `lz-string` link. No server → $0 hosting preserved.
3. **URL length policy:** **Strict client-side budget**. `builder.html` shows a live character counter that warns when the encoded link exceeds **800 characters**. No short-link backend in v1.
4. **Higgsfield model:** Run `models_explore(action:'recommend')`; lock the suggested model for flat children's vectors (e.g. `nano_banana_pro` or Recraft 4.1).
5. **White-subject matting:** **Approved.** `spr_sheep`, `prop_egg`, `prop_bucket_milk` are generated on a solid **pale-blue `#D0E8FF`** background to stop `remove_background` eroding white edges (§5.3, §6.1). All other sprites/props remain on pure white.

---

## 8. Next Steps (post-approval)

1. Run `models_explore(action:'recommend')`; lock the image model.
2. Generate the 3 backgrounds (9:16) + all sprites on solid background; run `remove_background`; QA alpha edges (esp. white subjects).
3. Empirically measure the worst-case encoded URL length and run the messaging/QR round-trip test (§6.2).
4. Only then scaffold the stateless frontend + optional Node builder/encoder.

---

## 9. Asset Manifest (generated 2026-06-20, Recraft 4.1 / vector)

**Backgrounds** — 9:16, 2k, native **SVG** (infinite-scale, tiny payload):

| Asset | URL (SVG) |
|---|---|
| `bg_farm_day` | `…/hf_20260620_021444_95878cb8-add4-4b24-bd9f-dbfa541ff701.svg` |
| `bg_barn_day` | `…/hf_20260620_021446_32eecdcb-2f02-4a89-829a-d4fb96042062.svg` |
| `bg_barn_night` | `…/hf_20260620_021449_748739be-ac78-4560-b8d1-e55f599410de.svg` |

**Sprites / props** — transparent PNG (post `remove_background`). Gen bg: W=`#FFFFFF`, B=`#D0E8FF`.

| Asset | Gen bg | Transparent PNG URL |
|---|---|---|
| `spr_chicken` | W | `…/hf_20260620_022533_05bc4955-1ea5-491b-b16a-86b3263a7415.png` |
| `spr_cow` | W | `…/hf_20260620_022536_203a9852-5449-4afe-9a03-2e52f1c57f26.png` |
| `spr_pig` | W | `…/hf_20260620_022540_963275ec-3937-4164-83cd-c0971810ae6e.png` |
| `spr_sheep` | B | `…/hf_20260620_022600_b9c9aa79-2b5e-49e1-96e1-7ff215bb0bdd.png` |
| `spr_sheep_shorn` | W | `…/hf_20260620_022542_32ea56b0-abd4-4e7c-8009-43fbd098d0ba.png` |
| `prop_nest` | W | `…/hf_20260620_022544_0f1a07ac-aae5-4a41-a66d-c86768f081ab.png` |
| `prop_egg` | B | `…/hf_20260620_022603_345000ea-af88-4b87-8e1f-c9fef62d1640.png` |
| `prop_bucket_empty` | W | `…/hf_20260620_022548_0c2ead86-605b-45c4-bdb6-fe7dfc01da2c.png` |
| `prop_bucket_milk` | B | `…/hf_20260620_022605_cdbcc244-8c71-4008-976d-8f1685eb5521.png` |
| `prop_trough_empty` | W | `…/hf_20260620_022553_89400f58-ca67-4a17-a0c8-3978adcf3532.png` |
| `prop_trough_food` | W | `…/hf_20260620_022555_bbabf75b-8287-4d4e-b7e1-b8abca258363.png` |
| `prop_wool` | B | `…/hf_20260620_022608_3b25a4eb-cdda-40a6-ace1-c65fbac7f302.png` |
| `ui_hand` | W | `…/hf_20260620_022558_a67ea69b-e81e-4a13-8479-2bfa0ba60c97.png` |

> Host prefix for all URLs: `https://d8j0ntlcm91z4.cloudfront.net/user_3FMZmOivFfX7FbACvB3cBnmT7li/`
> **Pre-build QA required (§6.1):** inspect alpha edges on `spr_sheep`, `prop_egg`, `prop_bucket_milk`, `prop_wool` (white subjects, `#D0E8FF` matting) at 200%; verify all sprites over `bg_barn_night` for halo/fringing. Download assets to a local `/assets` dir before frontend scaffolding (CloudFront URLs are not a permanent CDN guarantee).
