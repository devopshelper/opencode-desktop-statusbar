# Style handoff — OpenCode desktop status bar

Everything you need to rebuild this thing's *look and feel* on another harness, without
reading the 1400-line Solid component. Values here are copied from `src/gui.tsx`; the
portable stylesheet is `docs/statusbar.css`, the machine-readable tokens are `docs/themes.json`.

---

## 1. The thesis

It is a **terminal strip that is alive**, not a dashboard.

Five rules everything else derives from:

1. **True black, flat color, zero gradients.** `#000000` background. Color arrives as *light*
   (glow, particles, one accent hue) — never as fill. The only gradient in the whole system is
   the radial falloff of the splash, because that's light, not paint.
2. **Motion is information, never decoration.** Breathing speed = busy or not. Particle speed =
   tok/s. Gear = a tool is running. Crest collision = a turn started, or you clicked. Nothing
   moves to look pretty; if you removed an animation you'd lose a fact.
3. **One accent at a time.** A theme sets one hue and the entire strip — glyph, particles,
   glow, ocean wash — follows. No two hues competing except one intentional second lane.
4. **Text is data.** Monospace-ish discipline: tabular numerals, fixed-width slots, everything
   aligned so the bar never reflows. Emoji are icons, not decoration.
5. **It breathes like a human.** 16 bpm working, 12 bpm idle, asymmetric inhale/hold/exhale.
   This is the single most important timing decision in the design.

---

## 2. What to copy

| File | Use it for |
|---|---|
| `docs/statusbar.css` | the whole visual system, framework-agnostic, attribute-driven |
| `docs/themes.json` | palettes, timings, semantic colors, and the derived formulas |
| `docs/demo.html` | live playground — theme switch, state toggles, FX off, click-to-splash |
| `src/gui.tsx` (lines 336–487) | if you want the source of truth for any value |

> Verify the port against `demo.html` before writing a single line of host code. It exercises
> every rule in this document with the *actual* stylesheet, so any drift shows up in seconds.

The portable CSS expects this markup shape:

```html
<div data-sb
     data-sb-theme="deepseek"
     data-sb-state="work"          <!-- idle | work -->
     data-sb-ocean                 <!-- whale model -->
     data-sb-scan                  <!-- CRT skin -->
     data-sb-hover                 <!-- pointer over the strip -->
     data-sb-lite>                 <!-- FX off -->

  <div class="sb-group">
    <span class="sb-sep">·</span>   ...
  </div>
  <div class="sb-group">...</div>
  <div class="sb-group end">...</div>

  <span class="sb-splash"><i></i><b></b><u></u></span>
</div>
```

Add `.go` to `.sb-splash` to fire a wave (see §7).

---

## 3. Tokens

Four chromatic variables carry **every** glow in the file:

| Var | Value | Used by |
|---|---|---|
| `--sb-glow` | **RGB triple**, `0,229,255` | all 14 keyframes via `rgba(var(--sb-glow), a)` |
| `--sb-accent` | solid hex | glyph, sparkline, cursor, Zzzz, cache "on" blocks |
| `--sb-accent2` | solid hex | second particle lane |
| `--sb-wash` | flat hex | ocean mode's full-bar tint |

> `--sb-glow` is a *triple without the `rgb()` wrapper*. That's the trick that makes a theme
> four lines instead of forty — you can't animate or alpha-vary a hex inside `rgba()`.

Rhythm:

| Var | Value | Why |
|---|---|---|
| `--sb-breath-work` | `3.75s` | 16 breaths/min — alert, engaged |
| `--sb-breath-idle` | `5s` | 12 breaths/min — resting adult |
| `--sb-ease-breath` | `cubic-bezier(.37,0,.63,1)` | smooth in and out, no bounce |

Keyframe stops are at **0% / 38% / 46% / 100%** — inhale for 38%, hold 8%, exhale the remaining
54%. That asymmetry is the whole "it's alive" illusion. Do not replace it with a symmetric sine.

---

## 4. Type & spacing

| Role | Size | Notes |
|---|---|---|
| base | `12px` | letter-spacing `0.3px` |
| status phrase | `12.5px` | the **only** text above base — it's the focal point |
| meta / blocks | `11px` | cache meter, branch, numbers |
| tips / bump | `10px` | transient deltas, Zzzz |
| family | `inherit` | never ship a font; inherit the host's UI face |

Layout is `display:flex; flex-wrap:wrap; column-gap:18px; row-gap:3px; padding:6px 16px`.
Separators are a literal `·` at `opacity:.35`. Right-hand group gets `margin-left:auto`.

**Fixed-width slots** are a hard rule:

- status phrase: `min-width:27ch; max-width:27ch` + ellipsis → rotation never shuffles the bar
- glyph box: `width:1.2em` → the glyph set has different advance widths, and without a fixed
  box every morph frame shifts the entire strip
- numbers: `font-variant-numeric: tabular-nums`

Bar height is just vertical padding, user-adjustable **2–18px, step 2, default 6**.

---

## 5. Anatomy

```
⚙️ build · ⎇ main ●2 │ ✻ 🤖 provider/model │ ✦ Cogitating like crazy… │ ●••●••● │ ⚡86% ▰▰▰▰▱ │ 💚−$0.31 · 🪟42% ctx · 💰$0.04 · 📦42.1k tok · ↑3.1k ↓820 · ⏱4m
└──── group 1 ─────┘ └──── group 2 ────┘ └────── group 3 ─────┘ └ lane ┘ └──────────── group 4 (end) ─────────────┘
```

| Slot | Content | Behavior |
|---|---|---|
| agent chip | `⚙️ build` / `plan` | **the only thing that opens the card**, on hover; also the close trigger |
| branch | `⎇ main ●2` | `●N` only when dirty |
| glyph | `✻ → ✽ → ✶ → ✳ → ✢ → ·` | morphs every 130ms working / 300ms idle; always glowing |
| model | `🤖 provider/id` or `🐋 …` | whale icon + ocean mode for `deepseek` models |
| status | `✦ phrase…` or `◌ phrase Zzzz` | 27ch slot, rotates per breath / two breaths |
| flow | 8 beads, 2 lanes | speed = tok/s; factory pinch when a tool runs |
| cache | `⚡86% ▰▰▰▰▱` | 5 blocks, semantic color by hit rate |
| savings | `💚 −$0.31` | hidden under ~$0.0005 |
| context | `🪟42% ctx` | amber ≥75%, red ≥90% + `sb-alert` pulse |
| cost | `💰 $0.04` | one-shot `sb-flash` on change |
| tokens | `📦42.1k tok` | `sb-bump` floats the delta up on change |
| split | `↑3.1k ↓820 ✍️1.2k 🧠400` | secondary detail, `opacity:.65` |
| timer | `⏱ 4m` | session duration from `time.created` |

Emoji-as-icon is deliberate: it renders at font weight, inherits baseline, needs no assets, and
survives theme changes. Keep that choice or replace all eight at once.

---

## 6. States

Only two top-level states; everything else is a modifier.

| State | Set by | Visual |
|---|---|---|
| `idle` | `session.status === "idle"` **and** queue empty | `sb-breathe-idle` 5s `.14→.38` glow, glyph `.sb-flower.idle` soft at 5s, italic phrase at `.88`, Zzzz puffs, particles slate `#64748b` and slow (10s) |
| `work` | status ≠ idle or queued > 0 | `sb-breathe` 3.75s `.30→.70` glow, glyph fast, phrase 600 weight in accent→white mix, particles white/accent2 |

Modifiers: `sb-ocean` (whale), `sb-scan` (CRT), `sb-hover` (`brightness(1.08)`), `sb-lite` (FX off),
`sb-flow.tool` (factory), `sb-alert` (context ≥90%), `sb-flash` (cost change), `sb-ping` (any event).

Busy must be authoritative from the session status stream; execution events are fallback only.
If you drive busy from token activity alone, the bar flickers idle between tool calls.

---

## 7. Motion spec

| Signal | Animation | Timing |
|---|---|---|
| whole strip, working | `sb-breathe` — inset+outer `box-shadow` | 3.75s infinite, `cubic-bezier(.37,0,.63,1)` |
| whole strip, idle | `sb-breathe-idle` | 5s |
| status phrase, working | `sb-glow` — `text-shadow` 6→14px | 3.75s, same stops |
| status phrase, idle | static halo `0 0 7px rgba(glow,.35)` | — |
| glyph | `sb-glow` / `sb-glow-soft` | 3.75s / 5s |
| ellipsis | `sb-dotfade` | 1.2s, staggered `.18s` |
| block cursor | `sb-blink` | steps(1) 1.05s |
| Zzzz ×4 | `sb-zz` (fade, rise 9px, scale .7→1.2) | 5s, staggered `.55s` |
| beads | `sb-flow` (translateX 0→128px) | **computed**, see below |
| beads, tool | `sb-flow-factory` (pinch to `.34` mid-lane) | same duration |
| gear | `sb-spin` | 1.6s linear |
| every event | `sb-ping` — inset glow 0→70px→0 | .55s ease-out, one-shot |
| cost change | `sb-flash` — brightness 1.9 + 6px drop-shadow | .9s one-shot |
| token delta | `sb-bump` — rise 7px, fade at −12px | 1.2s forwards |
| card open | `sb-card-in` — opacity only | .16s |

### Particle duration (load-bearing)

```js
dur = clamp(3.2 / (1 + tps / 55), 0.5, 3.2)   // seconds
if (hover) dur = max(0.35, dur / 1.6)          // "leaning in" = faster read
if (idle)  dur = 10                             // barely drifting
```

So 55 tok/s halves the loop, 165 tok/s thirds it, and the floor at 0.5s stops it becoming a blur.
Per-bead stagger is `-dur * n/8` so the lane looks continuous at any speed.

`tps` itself: sample token totals once a second, `(total - prev) / dt`, and **decay to 0 after
3.5s of no change** — otherwise the lane keeps sprinting after the model has stopped.

### Splash geometry

Two elliptical crests start at the bar's edges and converge on the click point:

```js
--sb-x = clamp(pct, 2, 98) / 100 * barWidth   // meeting point, px
--sb-w = barWidth                             // px
```

- `<b>` is anchored `left:0`, travels `translateX(--sb-x)`
- `<u>` is anchored `left:100%`, travels `translateX(calc(--sb-x - --sb-w))`
- both `margin-left:-110px` so their **centres** land on the coordinate
- both `180%` tall, `top:-40%` so the crest keeps vertical falloff inside the clipped strip

Timeline: `0s` fade in and move → `45%` meet, `scaleX(1.15)` → `55%` swell to `1.4` (the collision
hold) → `100%` back home, faded. Impact burst is `sb-impact`, delayed `.4s` so it lands on contact.

Total `1.2s`, `cubic-bezier(.3,.6,.35,1)`. All three layers are `transform` + `opacity` only.

**Restarting it:** keep the element mounted, toggle `.go` off, force a reflow (`void el.offsetWidth`),
toggle `.go` on. Do not remount the node and do not key it — remounts silently fail to restart
animations and you'll chase a ghost.

---

## 8. Card

Anchored, not cursor-following. `left:12px; bottom:calc(100% + 8px); width:300px`,
black background, `1px` border in `rgba(glow,.22)`, radius 10, `0 14px 44px rgba(0,0,0,.95)`,
tiny 5px triangle pointing down at the bar.

Interaction contract:

| Action | Result |
|---|---|
| hover the agent chip | open |
| leave the chip | close after **140ms** (enough to cross the gap, fast enough to feel gone) |
| enter the card | cancel the close |
| double-click | pin/unpin — **only** if a card is already open |
| click inside the card | never fires the splash |

Rows are `flex; justify-content: space-between` with dim keys `rgba(150,170,190,.9)` and white
tabular values. Sparkline is a 26px-high inline SVG polyline with a `drop-shadow` glow.

---

## 9. Lite mode (FX off)

A **rendering budget**, not a different UI. Same information, zero full-surface repaints.

| Removed | Kept |
|---|---|
| bar breathing (`box-shadow` across 100% width, 60fps) | particles at normal speed |
| event ping | phrase rotation |
| splash waves | Zzzz, dots, gear |
| hover `brightness` filter | token bump, cost flash |
| sparkline `drop-shadow` | timer, percentages, blocks |
| ambient glow | **static** halo on the phrase (`0 0 8px rgba(glow,.6)`) |

Gate it in **two** places — a guard in the trigger (`if (lite) return`, before any measuring or
reflow) *and* a CSS backstop (`.sb-splash { display:none !important }`). One without the other
leaves a hole when something calls the trigger from a new path.

Default to on when `prefers-reduced-motion: reduce`; an explicit user choice always wins.

---

## 10. Themes

Twelve palettes; three are full **skins** that also swap glyphs, phrase pools, scanlines and cursor.

| Theme | accent | accent2 | wash |
|---|---|---|---|
| amoled cyan (default) | `#00e5ff` | `#5ad8ff` | `#04161b` |
| matrix | `#00e676` | `#57e39a` | `#04160c` |
| matrix · hacker | `#00ff6a` | `#0aff9d` | `#02120a` |
| neon pink | `#ff2d95` | `#ff7ab8` | `#170510` |
| ultraviolet | `#b026ff` | `#c777ff` | `#100518` |
| solar | `#ffb300` | `#ffcf66` | `#150f03` |
| ice | `#8ad8ff` | `#c7ecff` | `#05111a` |
| blood | `#ff1744` | `#ff6b86` | `#150306` |
| cyberpunk | `#fcee0a` | `#ff2d95` | `#14120a` |
| cyberwar | `#ff2b2b` | `#39ff14` | `#140606` |
| super black | `#ffffff` | `#9aa4b2` | `#000000` |
| deepseek | `#4d6bfe` | `#679efe` | `#0b1226` |

**Functional colors never theme.** Cache 80%+ green, 40%+ cyan, 15%+ amber, else red; context
amber ≥75%, red ≥90%; queue amber; factory bits amber. A warning that recolors itself to match
your mood lighting stops being a warning.

Persist the choice (`localStorage["desktop.statusbar.theme"]`) and validate on read — a stale id
from an older version must fall back to the default instead of crashing the bar.

---

## 11. Porting checklist

1. Paste `docs/statusbar.css`, or lift the keyframes and rebuild the shell yourself. Either way
   keep the four chromatic vars — that's what makes theming cheap.
2. Set `--sb-glow` as a **bare RGB triple** and use `rgba(var(--sb-glow), a)` everywhere.
3. Port in this order: shell → groups/separators → status slot (27ch) → glyph box (1.2em) →
   flow lane → meters → splash → card → lite.
4. Wire state to two booleans (busy, tool) plus two numbers (tps, queue). Everything else is
   derived. Do not add per-segment state machines.
5. Compute spline/duration values with the formulas in §7 and `themes.json.derived`.
6. Test these five cases before shipping: **idle**, **working**, **tool running**, **queued
   message**, and **FX off on a 30fps Remote Desktop session**.
7. Check contrast on your darkest theme. `#4d6bfe` text on `#000` measures ~4.1:1 — the phrase
   must be mixed toward white (see §12, trap 3), and idle text must not drop below `~.8` opacity.

If your harness is a **terminal/TUI** instead of the DOM: drop `box-shadow` breathing (no sub-cell
glow), keep the glyph morph, phrase rotation, Zzzz, block meter and the state table. Use the bar's
background color as a slow-shifting wash for the breath, and keep 16 bpm. Everything in §6–§8
survives the port; only §7's shadows don't.

---

## 12. Traps we already paid for

1. **Never rebuild animated nodes.** In Solid (and React, and Vue) re-creating an element on
   every tick restarts its CSS animation, so the bar twitches. Create the element once, let
   class/style/attributes update reactively.
2. **Restart animations with a class flip + reflow**, never with a keyed remount (§7).
3. **A raw accent is not a text color.** `#4d6bfe`, `#ff2b2b` on black are unreadable. Use
   `color-mix(in srgb, accent 42%, #ffffff)` with a plain near-white declared first as fallback.
4. **Idle text at low opacity reads as disabled UI, not as calm.** `.88` minimum, plus a faint
   halo. Calm comes from *italic + slow breathing*, not from being dim.
5. **Any slot that changes content needs a fixed width**, or the whole strip reflows once a
   breath. 27ch phrase, 1.2em glyph, tabular numbers.
6. **Timestamps are the enemy of the timer.** `session.time.created` is in Unix **seconds**;
   a local clock is milliseconds. Mixing them yields a 55-year session.
7. **Never ship a `<div>`-wide `mousemove` handler for a tooltip** — anchoring the card to the
   agent chip removed 100% of the pointer tracking and made it feel *faster*, not slower.
8. **Don't hot-path poll.** Events drive state; keep one 1s ticker for the clock/timer and one
   15s safety poll for a silently dropped stream. That's it.

---

*Companion files: [`statusbar.css`](statusbar.css) · [`themes.json`](themes.json) ·
[`demo.html`](demo.html) · [`preview.svg`](preview.svg) · [`themes.svg`](themes.svg) ·
[`panels.svg`](panels.svg)*
