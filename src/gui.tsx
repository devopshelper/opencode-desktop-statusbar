import { Plugin, Slot, Style, usePlugin } from "@opencode/plugin/gui"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { JSX } from "solid-js"
import type { ModelInfo, SessionInfo, VcsInfo, VcsFileStatus } from "@opencode/client/promise"

/* ---------- formatting ---------- */

const fmtTokens = (n: number | undefined): string => {
  if (!n || n <= 0) return "0"
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "b"
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "m"
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k"
  return String(Math.round(n))
}

const fmtCost = (n: number | undefined): string => {
  if (!n || n <= 0) return "$0.00"
  if (n < 0.01) return "$" + n.toPrecision(1)
  if (n < 100) return "$" + n.toFixed(2)
  return "$" + n.toFixed(0)
}

const fmtDuration = (ms: number): string => {
  if (!isFinite(ms) || ms <= 0) return "0s"
  const s = Math.round(ms / 1000)
  if (s < 60) return s + "s"
  const m = Math.floor(s / 60)
  if (m < 60) return m + "m"
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`
}

/** AMOLED palette: ≥80% electric green, ≥40% cyan, ≥15% amber, else hot red. */
const cacheColor = (pct: number): string => {
  if (pct >= 80) return "#00e676"
  if (pct >= 40) return "#00e5ff"
  if (pct >= 15) return "#ffc400"
  return "#ff1744"
}

const ctxColor = (pct: number): string | undefined => {
  if (pct >= 90) return "#ff1744"
  if (pct >= 75) return "#ffc400"
  return undefined
}

const modelName = (info: SessionInfo | undefined): string => {
  const model = info?.model
  if (!model) return "OpenCode"
  return `${model.providerID}/${model.id}${model.variant ? `#${model.variant}` : ""}`
}

const tokenTotal = (info: SessionInfo | undefined): number => {
  const t = info?.tokens
  return (t?.input ?? 0) + (t?.output ?? 0) + (t?.reasoning ?? 0) + (t?.cache?.read ?? 0) + (t?.cache?.write ?? 0)
}

/** Claude-style spinner glyphs, morphing while a turn runs. */
const GLYPHS = ["✻", "✽", "✶", "✳", "✢", "·"]

/** Rotating status words while the model works. */
const WORDS = [
  "thinking super hard",
  "Cogitating like crazy",
  "thinking even harder",
  "crunching popcorns",
  "thinking or not thinking",
  "to be or not to be",
  "reticulating splines",
  "herding semicolons",
  "untangling spaghetti",
  "consulting the rubber duck",
  "summoning the muses",
  "shaking the idea tree",
  "marinating in context",
  "shuffling tokens like tarot",
  "brewing something devious",
  "polishing the brain gears",
  "whispering to the GPU",
  "staring into the abyss",
  "assembling thought particles",
  "doing philosophy in the dark",
]

/** Rotating status words while the model rests. */
const IDLE_WORDS = [
  "waiting to cogitate",
  "bmboozled",
  "in the ether",
  "idling at 0.2 Hz",
  "resting the neurons",
  "pending inspiration",
  "off in a daydream",
  "charging psychic batteries",
  "dozing in latent space",
]

/* ---------- breathing rhythm ---------- */

/**
 * The bar breathes like a human, not like a lava lamp.
 * A real breath is asymmetric: inhale ~38% of the cycle, a short hold, then a
 * slower exhale that takes the rest. Resting adult = 12 breaths/min (5s),
 * alert/engaged = 16/min (3.75s). Everything glow-related shares the cycle.
 */
const BREATH_IDLE = 5
const BREATH_WORK = 3.75
const EASE_BREATH = "cubic-bezier(0.37, 0, 0.63, 1)"

// One thought per breath while working; idle thoughts linger for two.
const WORD_MS = BREATH_WORK * 1000
const IDLE_WORD_MS = BREATH_IDLE * 2000

/* ---------- model catalog (cached) ---------- */

type CostEntry = {
  tier?: { type: string; size: number }
  input: number
  output: number
  cache: { read: number; write: number }
}

const modelCache = new Map<string, ModelInfo>()

async function resolveModel(
  ctx: any,
  ref: SessionInfo["model"] | undefined,
  directory: string | undefined,
): Promise<ModelInfo | undefined> {
  if (!ref) return undefined
  const key = `${ref.providerID}/${ref.id}`
  const hit = modelCache.get(key)
  if (hit) return hit
  try {
    const res = await ctx.client.model.list(directory ? { location: { directory } } : undefined)
    for (const m of res?.data ?? []) {
      modelCache.set(`${m.providerID}/${m.id}`, m)
      if (m.modelID) modelCache.set(`${m.providerID}/${m.modelID}`, m)
    }
  } catch {
    /* keep whatever we have */
  }
  return modelCache.get(key)
}

/** Picks the price tier that applies to the given prompt size. */
function pickCost(costs: CostEntry[] | undefined, contextTokens: number): CostEntry | undefined {
  if (!costs || costs.length === 0) return undefined
  const base = costs.find((c) => !c.tier) ?? costs[0]
  const tiered = costs
    .filter((c) => c.tier?.type === "context")
    .sort((a, b) => (a.tier?.size ?? 0) - (b.tier?.size ?? 0))
  let picked = base
  for (const c of tiered) if (contextTokens >= (c.tier?.size ?? 0)) picked = c
  return picked
}

/* ---------- styles ---------- */

const shell: Record<string, string> = {
  display: "flex",
  "align-items": "center",
  "flex-wrap": "wrap",
  "column-gap": "18px",
  "row-gap": "3px",
  width: "100%",
  padding: "6px 16px",
  "font-size": "12px",
  background: "#000000",
  "border-top": "1px solid rgba(255, 255, 255, 0.06)",
  color: "#f2f7ff",
  "letter-spacing": "0.3px",
  position: "relative",
  "box-shadow": "inset 0 0 30px rgba(var(--sb-glow), 0.10)",
  "user-select": "none",
}

const group: Record<string, string> = {
  display: "flex",
  "align-items": "center",
  gap: "10px",
  "white-space": "nowrap",
}

/** A skin overrides personality, not just color: spinner glyphs, phrases, FX. */
type Skin = {
  glyphs?: string[]
  words?: string[]
  idleWords?: string[]
  scan?: boolean
  cursor?: boolean
}

/** Accent themes. `rgb` feeds every glow keyframe, `accent` the solid bits.
 *  `wash` is a FLAT solid tint (no gradient) used by the whale skin. */
type Theme = Skin & { id: string; name: string; accent: string; accent2: string; rgb: string; wash: string }

const THEMES: Theme[] = [
  { id: "cyan", name: "amoled cyan", accent: "#00e5ff", accent2: "#5ad8ff", rgb: "0,229,255", wash: "#04161b" },
  { id: "green", name: "matrix", accent: "#00e676", accent2: "#57e39a", rgb: "0,230,118", wash: "#04160c" },
  {
    id: "matrixgreen",
    name: "matrix · hacker",
    accent: "#00ff6a",
    accent2: "#0aff9d",
    rgb: "0,255,106",
    wash: "#02120a",
    scan: true,
    cursor: true,
    glyphs: ["ア", "イ", "ウ", "エ", "オ", "・"],
    words: [
      "decrypting the stream",
      "reading the source",
      "following the white rabbit",
      "compiling the truth",
      "tracing the packet",
    ],
    idleWords: ["green on black", "awaiting the signal", "jack out pending"],
  },
  { id: "magenta", name: "neon pink", accent: "#ff2d95", accent2: "#ff7ab8", rgb: "255,45,149", wash: "#170510" },
  { id: "violet", name: "ultraviolet", accent: "#b026ff", accent2: "#c777ff", rgb: "176,38,255", wash: "#100518" },
  { id: "amber", name: "solar", accent: "#ffb300", accent2: "#ffcf66", rgb: "255,179,0", wash: "#150f03" },
  { id: "ice", name: "ice", accent: "#8ad8ff", accent2: "#c7ecff", rgb: "138,216,255", wash: "#05111a" },
  { id: "blood", name: "blood", accent: "#ff1744", accent2: "#ff6b86", rgb: "255,23,68", wash: "#150306" },
  {
    id: "cyberpunk",
    name: "cyberpunk",
    accent: "#fcee0a",
    accent2: "#ff2d95",
    rgb: "252,238,10",
    wash: "#14120a",
    scan: true,
    cursor: true,
    glyphs: ["◈", "◇", "◆", "◉", "◊", "·"],
    words: [
      "jacking in",
      "breaching the ICE",
      "flatlining the net",
      "derezzing the mainframe",
      "ghosting through firewalls",
      "running the deck",
    ],
    idleWords: ["chrome cooling down", "idle in the sprawl", "waiting on the grid"],
  },
  {
    id: "cyberwar",
    name: "cyberwar",
    accent: "#ff2b2b",
    accent2: "#39ff14",
    rgb: "255,43,43",
    wash: "#140606",
    scan: true,
    cursor: true,
    glyphs: ["◤", "◥", "◣", "◢", "▮"],
    words: [
      "escalating",
      "deploying payload",
      "rooting the target",
      "exfiltrating",
      "burning the traces",
      "holding the line",
    ],
    idleWords: ["armed and waiting", "listening on the wire", "cold standby"],
  },
  { id: "superblack", name: "super black", accent: "#ffffff", accent2: "#9aa4b2", rgb: "255,255,255", wash: "#000000" },
  {
    // Palette lifted from deepseek.com's design tokens:
    // --ds-rgb-primary 77,107,254 (#4d6bfe), deepseek-400 #679efe, deepseek-900 #283142
    id: "deepseek",
    name: "deepseek",
    accent: "#4d6bfe",
    accent2: "#679efe",
    rgb: "77,107,254",
    wash: "#0b1226",
  },
]

const THEME_KEY = "desktop.statusbar.theme"
const LITE_KEY = "desktop.statusbar.lite"
const PAD_KEY = "desktop.statusbar.pad"

/** Bar height is vertical padding. Bounded so the layout can't be broken. */
const PAD_MIN = 2
const PAD_MAX = 18
const PAD_STEP = 2

const loadPad = (): number => {
  try {
    const n = Number(localStorage.getItem(PAD_KEY))
    if (Number.isFinite(n) && n >= PAD_MIN && n <= PAD_MAX) return n
  } catch {
    /* storage blocked */
  }
  return 6
}

/** Respect the OS setting by default; explicit choice always wins. */
const loadLite = (): boolean => {
  try {
    const saved = localStorage.getItem(LITE_KEY)
    if (saved === "1") return true
    if (saved === "0") return false
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch {
    return false
  }
}

const loadTheme = (): string => {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved && THEMES.some((t) => t.id === saved)) return saved
  } catch {
    /* storage blocked */
  }
  return THEMES[0].id
}

/** Which segment the pointer is sitting on — drives the hover card contents. */
type Seg = "default" | "model" | "cache" | "ctx" | "tok" | "cost" | "speed"

const fmtPrice = (n: number | undefined): string => (n === undefined ? "—" : "$" + n.toFixed(2) + "/M")

/** Deep-sea skin: used when the session is running on a deepseek model. */
const shellOcean: Record<string, string> = {
  ...shell,
  background: "var(--sb-wash)",
  "border-top": "1px solid var(--sb-accent)",
  "box-shadow": "inset 0 0 30px rgba(var(--sb-glow), 0.14)",
}

/* ---------- animation stylesheet (injected while the plugin is active) ---------- */

const css = `
@keyframes sb-bump { 0% { opacity:1; transform:translateY(0) } 60% { opacity:1; transform:translateY(-7px) } 100% { opacity:0; transform:translateY(-12px) } }
@keyframes sb-flash { 0% { filter:none } 25% { filter:brightness(1.9) drop-shadow(0 0 6px currentColor) } 100% { filter:none } }
@keyframes sb-loading { 0%,100% { opacity:.35 } 50% { opacity:.95 } }
@keyframes sb-spin { to { transform:rotate(360deg) } }
@keyframes sb-breathe { 0% { box-shadow:inset 0 0 26px rgba(var(--sb-glow),.30), 0 0 12px rgba(var(--sb-glow),.12) } 38% { box-shadow:inset 0 0 62px rgba(var(--sb-glow),.70), 0 0 26px rgba(var(--sb-glow),.35) } 46% { box-shadow:inset 0 0 56px rgba(var(--sb-glow),.62), 0 0 23px rgba(var(--sb-glow),.31) } 100% { box-shadow:inset 0 0 26px rgba(var(--sb-glow),.30), 0 0 12px rgba(var(--sb-glow),.12) } }
@keyframes sb-breathe-idle { 0% { box-shadow:inset 0 0 20px rgba(var(--sb-glow),.14), 0 0 8px rgba(var(--sb-glow),.05) } 38% { box-shadow:inset 0 0 46px rgba(var(--sb-glow),.38), 0 0 16px rgba(var(--sb-glow),.16) } 46% { box-shadow:inset 0 0 41px rgba(var(--sb-glow),.33), 0 0 14px rgba(var(--sb-glow),.13) } 100% { box-shadow:inset 0 0 20px rgba(var(--sb-glow),.14), 0 0 8px rgba(var(--sb-glow),.05) } }
@keyframes sb-glow { 0% { text-shadow:0 0 6px rgba(var(--sb-glow),.40) } 38% { text-shadow:0 0 14px rgba(var(--sb-glow),.95) } 46% { text-shadow:0 0 12px rgba(var(--sb-glow),.85) } 100% { text-shadow:0 0 6px rgba(var(--sb-glow),.40) } }
@keyframes sb-alert { 0%,100% { text-shadow:0 0 6px rgba(255,23,68,.35) } 50% { text-shadow:0 0 14px rgba(255,23,68,.95) } }
@keyframes sb-dotfade { 0%,100% { opacity:.2 } 50% { opacity:1 } }
@keyframes sb-glow-soft { 0% { text-shadow:0 0 4px rgba(var(--sb-glow),.45) } 38% { text-shadow:0 0 9px rgba(var(--sb-glow),.85) } 46% { text-shadow:0 0 8px rgba(var(--sb-glow),.75) } 100% { text-shadow:0 0 4px rgba(var(--sb-glow),.45) } }
@keyframes sb-zz { 0% { opacity:0; transform:translate(0,2px) scale(.7) } 28% { opacity:.9 } 100% { opacity:0; transform:translate(4px,-9px) scale(1.2) } }
@keyframes sb-flow { 0% { opacity:0; transform:translateX(0) } 12% { opacity:1 } 88% { opacity:1 } 100% { opacity:0; transform:translateX(128px) } }
@keyframes sb-wave { 0% { background-position:-160% 0 } 100% { background-position:160% 0 } }
@keyframes sb-ping { 0% { box-shadow:inset 0 0 0 rgba(var(--sb-glow),0); opacity:1 } 20% { box-shadow:inset 0 0 70px rgba(var(--sb-glow),.85) } 100% { box-shadow:inset 0 0 0 rgba(var(--sb-glow),0); opacity:0 } }

.sb-working { animation:sb-breathe ${BREATH_WORK}s ${EASE_BREATH} infinite }
.sb-idle { animation:sb-breathe-idle ${BREATH_IDLE}s ${EASE_BREATH} infinite }
.sb-glow { animation:sb-glow ${BREATH_WORK}s ${EASE_BREATH} infinite }
.sb-alert { animation:sb-alert 1.6s ease-in-out infinite }
.sb-dots i { display:inline-block; animation:sb-dotfade 1.2s ease-in-out infinite }
.sb-dots i:nth-child(2) { animation-delay:.18s }
.sb-dots i:nth-child(3) { animation-delay:.36s }

/* Terminal skin: a hard block cursor instead of Claude's soft ellipsis. */
.sb-cursor { display:inline-block; margin-left:2px; animation:sb-blink 1.05s steps(1) infinite }
@keyframes sb-blink { 0%,49% { opacity:1 } 50%,100% { opacity:0 } }

/* Scanline skin: faint CRT raster over the whole strip. */
.sb-scan::before { content:""; position:absolute; inset:0; z-index:1; pointer-events:none; opacity:.16; background:repeating-linear-gradient(180deg, rgba(255,255,255,.5) 0 1px, transparent 1px 3px) }

/* Sleeping Zzzz: one lazy puff per breath, drifting up and out. */
.sb-zzz { display:inline-block; margin-left:6px; font-style:normal; font-size:10px; font-weight:700; letter-spacing:.5px; color:var(--sb-accent); vertical-align:1px }
.sb-zzz i { display:inline-block; font-style:normal; animation:sb-zz ${BREATH_IDLE}s ease-out infinite }
.sb-zzz i:nth-child(2) { animation-delay:.55s }
.sb-zzz i:nth-child(3) { animation-delay:1.1s }
.sb-zzz i:nth-child(4) { animation-delay:1.65s }

/* Fixed-width status slot: phrases come and go, but the bar must not shuffle. */
.sb-status { display:inline-block; min-width:27ch; max-width:27ch; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:middle; font-size:12.5px }
/* Idle used to sit at .55 opacity, which read as disabled text. Keep the
   whisper-soft character but let it actually be readable. */
.sb-status.idle { opacity:.88; font-style:italic; font-weight:500; color:#eaf2fd; text-shadow:0 0 7px rgba(var(--sb-glow),.35) }

/* Queued / steering messages waiting behind the running turn. */
.sb-queue { margin-left:6px; color:#ffc400; text-shadow:none; font-size:11px; font-weight:700 }

/* Hover: the strip leans in and finally shows the numbers it truncates. */
.sb-hover { filter:brightness(1.08) }
.sb-card { position:absolute; left:12px; bottom:calc(100% + 8px); z-index:50; width:300px; max-width:calc(100vw - 28px); padding:8px 11px; border-radius:10px; pointer-events:auto; font-size:11px; line-height:1.6; background:#000000; border:1px solid rgba(var(--sb-glow),.22); box-shadow:0 14px 44px rgba(0,0,0,.95); animation:sb-card-in .16s ease-out 1 }
.sb-card::after { content:""; position:absolute; top:100%; left:50%; margin-left:-5px; border:5px solid transparent; border-top-color:rgba(var(--sb-glow),.22) }
.sb-spark { display:block; width:100%; height:26px; margin-top:5px }
.sb-spark polyline { fill:none; stroke:var(--sb-accent); stroke-width:1.5; stroke-linejoin:round; stroke-linecap:round; filter:drop-shadow(0 0 3px rgba(var(--sb-glow),.85)) }
.sb-spark-base { stroke:rgba(255,255,255,.10); stroke-width:1 }
.sb-row { display:flex; justify-content:space-between; gap:16px; white-space:nowrap }
.sb-k { color:rgba(150,170,190,.9) }
.sb-v { color:#ffffff; font-variant-numeric:tabular-nums }
.sb-card.pinned { border-color:rgba(var(--sb-glow),.45) }
.sb-palette { display:flex; align-items:center; gap:7px; margin-top:7px; padding-top:7px; border-top:1px solid rgba(255,255,255,.08); pointer-events:auto }
.sb-swatch { width:13px; height:13px; padding:0; border-radius:50%; border:1px solid rgba(255,255,255,.28); cursor:pointer; transition:transform .12s ease, border-color .15s ease }
.sb-swatch:hover { transform:scale(1.18) }
.sb-swatch.on { border:2px solid #ffffff }
.sb-fx { margin-left:auto; padding:2px 7px; border-radius:6px; border:1px solid rgba(255,255,255,.18); background:transparent; color:#cfd9e6; font:inherit; font-size:9.5px; letter-spacing:.5px; text-transform:uppercase; cursor:pointer }
.sb-fx:hover { border-color:rgba(var(--sb-glow),.65); color:#fff }
.sb-tools { display:flex; align-items:center; gap:5px; margin-top:7px; pointer-events:auto }
.sb-tool-k { font-size:9.5px; letter-spacing:.6px; text-transform:uppercase; color:rgba(150,170,190,.85) }
.sb-tool-v { min-width:26px; text-align:center; font-size:10px; color:#fff; font-variant-numeric:tabular-nums }
.sb-mini { width:16px; height:16px; padding:0; line-height:1; border-radius:4px; border:1px solid rgba(255,255,255,.18); background:transparent; color:#cfd9e6; font:inherit; font-size:11px; cursor:pointer }
.sb-mini:hover { border-color:rgba(var(--sb-glow),.65); color:#fff }
.sb-hint { margin-top:6px; font-size:10px; opacity:.4; letter-spacing:.2px }

/* Lite mode (Windows Server, RDP, no GPU): remove full-surface repaints only.
   Small per-element motion and once-a-second text updates stay — they're cheap. */
.sb-lite { box-shadow:none !important }
.sb-lite.sb-working, .sb-lite.sb-idle { animation:none !important }
.sb-lite.sb-hover { filter:none }
.sb-lite .sb-ping { display:none }
.sb-lite .sb-splash { display:none !important }
.sb-lite .sb-spark polyline { filter:none }
/* Lite still needs the phrase readable — freeze the breath but keep a static halo. */
.sb-lite .sb-glow { animation:none !important; text-shadow:0 0 8px rgba(var(--sb-glow),.6) }
.sb-lite .sb-card, .sb-lite .sb-swatch { transition:none }
@keyframes sb-card-in { from { opacity:0 } to { opacity:1 } }

/* Token pipeline: bits drifting left → right, speed driven by tok/s. */
.sb-flow { position:relative; display:inline-block; width:128px; height:17px; overflow:hidden; vertical-align:middle }
.sb-flow i { position:absolute; left:0; top:2px; width:6px; height:6px; border-radius:50%; background:#f8fafc; box-shadow:0 0 10px rgba(var(--sb-glow),1), 0 0 3px rgba(255,255,255,.95); animation:sb-flow var(--sb-flow,1.4s) linear infinite }
.sb-flow i:nth-child(2) { animation-delay:calc(var(--sb-flow,1.4s) * -0.125) }
.sb-flow i:nth-child(3) { animation-delay:calc(var(--sb-flow,1.4s) * -0.25) }
.sb-flow i:nth-child(4) { animation-delay:calc(var(--sb-flow,1.4s) * -0.375) }
.sb-flow i:nth-child(5) { animation-delay:calc(var(--sb-flow,1.4s) * -0.5) }
.sb-flow i:nth-child(6) { animation-delay:calc(var(--sb-flow,1.4s) * -0.625) }
.sb-flow i:nth-child(7) { animation-delay:calc(var(--sb-flow,1.4s) * -0.75) }
.sb-flow i:nth-child(8) { animation-delay:calc(var(--sb-flow,1.4s) * -0.875) }
.sb-flow i:nth-child(even) { top:10px; width:5px; height:5px; background:var(--sb-accent2); box-shadow:0 0 9px rgba(var(--sb-glow),.95) }
.sb-flow.idle i { background:#64748b; box-shadow:none }

/* Factory mode: while a tool call runs, bits get machined through the middle. */
@keyframes sb-flow-factory { 0% { opacity:0; transform:translateX(0) scale(.7) } 12% { opacity:1; transform:translateX(16px) scale(1) } 44% { opacity:.55; transform:translateX(55px) scale(.34) } 56% { opacity:.55; transform:translateX(73px) scale(.34) } 88% { opacity:1; transform:translateX(112px) scale(1) } 100% { opacity:0; transform:translateX(128px) scale(.7) } }
.sb-flow.tool i { background:#ffe066; box-shadow:0 0 10px rgba(255,196,0,.95); animation-name:sb-flow-factory }
.sb-flow.tool i:nth-child(even) { background:#ffc400; box-shadow:0 0 9px rgba(255,196,0,.9) }
.sb-flow-gear { position:absolute; left:50%; top:50%; z-index:2; width:12px; height:12px; margin:-6px 0 0 -6px; line-height:12px; text-align:center; font-size:11px; color:#ffc400; opacity:0; pointer-events:none; text-shadow:0 0 8px rgba(255,196,0,.9); transition:opacity .18s ease }
.sb-flow.tool .sb-flow-gear { opacity:1; animation:sb-spin 1.6s linear infinite }

/* Deep-sea mode: a whale is driving, so the whole bar floods. The palette comes
   from the active theme now, so the color picker works here too. */
.sb-ocean .sb-flow.idle i { background:#475569; box-shadow:none }

/* Moonlight glinting off the surface, sweeping left to right. */
.sb-ocean::after { content:""; position:absolute; left:0; right:0; top:0; height:2px; pointer-events:none; opacity:.75; background:linear-gradient(90deg, transparent 0%, rgba(var(--sb-glow),.75) 50%, transparent 100%); background-size:200% 100%; animation:sb-wave 7s linear infinite }

/* Claude-style glyph spinner: always glowing, morphs while working. Fixed box
   width because the glyph set has different advance widths — otherwise every
   morph frame shifts the entire bar. */
.sb-flower { display:inline-block; width:1.2em; text-align:center; font-size:12px; line-height:1; color:#00e676; animation:sb-glow ${BREATH_WORK}s ${EASE_BREATH} infinite }
.sb-flower.idle { animation:sb-glow-soft ${BREATH_IDLE}s ${EASE_BREATH} infinite }

/* Incoming-event flash: one-shot overlay, restarted on every key change. */
.sb-ping { position:absolute; inset:0; pointer-events:none; border-radius:inherit; animation:sb-ping .55s ease-out 1 }

/* Splash: two waves converge from the bar's ends, collide at the point you
   clicked, flash, then bounce back out. Geometry arrives as px custom props. */
.sb-splash { position:absolute; inset:0; pointer-events:none; overflow:hidden; display:none }
.sb-splash.go { display:block }
.sb-splash i { position:absolute; left:var(--sb-sx, 13%); top:50%; width:200px; height:200px; margin:-100px 0 0 -100px; border-radius:50%; opacity:0; background:radial-gradient(circle, rgba(var(--sb-glow),.6) 0%, rgba(var(--sb-glow),.18) 45%, transparent 72%) }
.sb-splash b, .sb-splash u { position:absolute; top:-40%; width:220px; height:180%; margin-left:-110px; border-radius:50%; opacity:0; background:radial-gradient(ellipse at center, rgba(var(--sb-glow),.50) 0%, rgba(var(--sb-glow),.16) 45%, transparent 72%) }
.sb-splash b { left:0 }
.sb-splash u { left:100% }
.sb-splash.go i { animation:sb-impact .55s ease-out .40s forwards }
.sb-splash.go b { animation:sb-wave-in-r 1.2s cubic-bezier(.3,.6,.35,1) forwards }
.sb-splash.go u { animation:sb-wave-in-l 1.2s cubic-bezier(.3,.6,.35,1) forwards }
@keyframes sb-impact { 0% { transform:scale(.2); opacity:0 } 30% { transform:scale(1.1); opacity:1 } 100% { transform:scale(2.6); opacity:0 } }
@keyframes sb-wave-in-r { 0% { transform:translateX(0) scaleX(.55); opacity:0 } 12% { opacity:.9 } 45% { transform:translateX(var(--sb-x)) scaleX(1.15); opacity:1 } 55% { transform:translateX(var(--sb-x)) scaleX(1.4); opacity:1 } 100% { transform:translateX(0) scaleX(.55); opacity:0 } }
@keyframes sb-wave-in-l { 0% { transform:translateX(0) scaleX(.55); opacity:0 } 12% { opacity:.9 } 45% { transform:translateX(calc(var(--sb-x) - var(--sb-w))) scaleX(1.15); opacity:1 } 55% { transform:translateX(calc(var(--sb-x) - var(--sb-w))) scaleX(1.4); opacity:1 } 100% { transform:translateX(0) scaleX(.55); opacity:0 } }

/* Cache meter as block glyphs: same idea as the README, zero subpixel blur. */
.sb-blocks { display:inline-block; font-size:11px; line-height:1; letter-spacing:1px; vertical-align:middle }
.sb-blocks .on { color:inherit; text-shadow:0 0 7px currentColor }
.sb-blocks .off { opacity:.25 }

.sb-flash { animation:sb-flash .9s ease-out 1 }
.sb-bump { position:absolute; left:100%; top:-3px; margin-left:5px; font-size:10px; font-weight:700; color:#00e676; pointer-events:none; white-space:nowrap; animation:sb-bump 1.2s ease-out forwards }
.sb-loading { animation:sb-loading 1.3s ease-in-out infinite }
.sb-spin { display:inline-block; animation:sb-spin 1.1s linear infinite }
`

function Group(props: { items: () => JSX.Element[]; end?: boolean }) {
  return (
    <div style={props.end ? { ...group, "margin-left": "auto" } : group}>
      <For each={props.items()}>
        {(item, i) => (
          <>
            <Show when={i() > 0}>
              <span style={{ opacity: "0.35" }}>·</span>
            </Show>
            {item}
          </>
        )}
      </For>
    </div>
  )
}

/* ---------- component ---------- */

function StatusBar() {
  const ctx = usePlugin()

  const [info, setInfo] = createSignal<SessionInfo | undefined>()
  const [model, setModel] = createSignal<ModelInfo | undefined>()
  const [ctxUsed, setCtxUsed] = createSignal<number | undefined>()
  const [git, setGit] = createSignal<{ branch: string; dirty: number } | undefined>()
  const [mounted, setMounted] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())
  const [busy, setBusy] = createSignal(false)
  const [flash, setFlash] = createSignal(false)
  const [delta, setDelta] = createSignal<string | undefined>()
  const [wordIdx, setWordIdx] = createSignal(0)
  const [idleIdx, setIdleIdx] = createSignal(0)
  const [glyphIdx, setGlyphIdx] = createSignal(0)
  const [ping, setPing] = createSignal(0)
  const [splashX, setSplashX] = createSignal(13)
  let splashRef: HTMLSpanElement | undefined

  /** One splash at a given horizontal position. Lives in the DOM permanently so
   *  restarting it is a class flip + reflow, never a remount race. */
  const splashNow = (pct: number) => {
    if (lite()) return // FX off = no waves at all
    const el = splashRef
    const bar = barRef
    if (!el || !bar) return
    // px geometry: the crests need to know the width and where to meet.
    const rect = bar.getBoundingClientRect()
    el.style.setProperty("--sb-x", `${(pct / 100) * rect.width}px`)
    el.style.setProperty("--sb-w", `${rect.width}px`)
    setSplashX(pct)
    el.classList.remove("go")
    void el.offsetWidth // flush, so the animation restarts from 0
    el.classList.add("go")
  }
  const [tps, setTps] = createSignal(0)
  const [queued, setQueued] = createSignal(0)
  const [hover, setHover] = createSignal(false)
  const [themeId, setThemeId] = createSignal(loadTheme())
  const [lite, setLite] = createSignal(loadLite())
  const [pad, setPad] = createSignal(loadPad())
  const stepPad = (dir: number) => {
    const next = Math.min(PAD_MAX, Math.max(PAD_MIN, pad() + dir * PAD_STEP))
    setPad(next)
    try {
      localStorage.setItem(PAD_KEY, String(next))
    } catch {
      /* storage blocked */
    }
  }
  const toggleLite = () => {
    const next = !lite()
    setLite(next)
    try {
      localStorage.setItem(LITE_KEY, next ? "1" : "0")
    } catch {
      /* storage blocked */
    }
    hit()
  }
  const theme = (): Theme => THEMES.find((t) => t.id === themeId()) ?? THEMES[0]
  // Skins override personality: glyph set and phrase pools fall back to defaults.
  const glyphs = () => theme().glyphs ?? GLYPHS
  const words = () => theme().words ?? WORDS
  const idleWords = () => theme().idleWords ?? IDLE_WORDS
  const pickTheme = (id: string) => {
    setThemeId(id)
    try {
      localStorage.setItem(THEME_KEY, id)
    } catch {
      /* storage blocked */
    }
    hit()
  }
  const [pinned, setPinned] = createSignal(false)
  const [opened, setOpened] = createSignal(false)
  const [hist, setHist] = createSignal<number[]>([])
  const [tool, setTool] = createSignal<string | undefined>()
  let barRef: HTMLDivElement | undefined
  let closeTimer: ReturnType<typeof setTimeout> | undefined

  // Tool calls in flight, keyed by call id so parallel calls don't stomp each other.
  const inFlight = new Map<string, string>()
  const markTool = (id: string | undefined, name?: string) => {
    if (!id) return
    const label = name ?? inFlight.get(id) ?? "tool"
    inFlight.set(id, label)
    setTool(label)
  }
  const clearTool = (id?: string) => {
    if (id) inFlight.delete(id)
    let last: string | undefined
    for (const v of inFlight.values()) last = v
    setTool(last)
  }
  const clearTools = () => {
    inFlight.clear()
    setTool(undefined)
  }

  // The card lives in the bottom-left corner and opens from the agent chip
  // (build / plan) only — it no longer chases the pointer around.
  const openCard = () => {
    if (closeTimer) clearTimeout(closeTimer)
    setOpened(true)
  }
  const closeCardSoon = () => {
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = setTimeout(() => setOpened(false), 140)
  }
  const showCard = () => (opened() || pinned()) && !!data()

  const hideCardNow = () => {
    if (closeTimer) clearTimeout(closeTimer)
    setOpened(false)
  }

  /** X position of a click, as a clamped percentage of the bar width. */
  const pctAt = (clientX: number): number => {
    const el = barRef
    if (!el) return 13
    const rect = el.getBoundingClientRect()
    if (!rect.width) return 13
    return Math.max(2, Math.min(98, ((clientX - rect.left) / rect.width) * 100))
  }

  // Authoritative run state, straight from the server. A turn can end while a
  // queued "steer" message immediately starts the next one, so execution events
  // alone go stale and the bar falls asleep mid-work. session.status is the truth.
  let statusSeen = false
  let serverStatus: "idle" | "busy" | "retry" = "idle"
  const syncBusy = () => setBusy(serverStatus !== "idle" || queued() > 0)

  // Rolling throughput from absolute token samples, so overlapping events
  // can't double-count the way summing deltas would. Window: last 6s.
  let samples: { t: number; v: number }[] = []
  let lastSampleAt = 0

  const noteThroughput = (total: number) => {
    const t = Date.now()
    let last = samples[samples.length - 1]
    // A drop means the accounting base changed (new session or model), not a refund.
    if (last && total < last.v) {
      samples = []
      last = undefined
    }
    if (!last || total !== last.v) {
      samples.push({ t, v: total })
      lastSampleAt = t
    }
    while (samples.length > 2 && t - samples[0]!.t > 6000) samples.shift()
    const first = samples[0]
    if (!first || samples.length < 2) return
    const dt = (t - first.t) / 1000
    if (dt < 0.4) return
    setTps(Math.max(0, (total - first.v) / dt))
  }

  // Morph the flower glyph while a turn runs; it rests on a static glowing star when idle.
  // Lite mode just slows it down — a text swap in a fixed box is cheap.
  createEffect(() => {
    const slow = lite()
    if (!busy()) {
      setGlyphIdx(0)
      return
    }
    const timer = setInterval(() => setGlyphIdx((i) => (i + 1) % glyphs().length), slow ? 300 : 130)
    onCleanup(() => clearInterval(timer))
  })

  // When the current turn started, so the timer can count it live.
  let turnStart = 0
  createEffect(() => {
    if (busy()) {
      if (!turnStart) turnStart = Date.now()
    } else turnStart = 0
  })

  // Splash on the thinking edge: one burst each time a turn starts.
  let wasBusy = false
  createEffect(() => {
    const running = busy()
    if (running && !wasBusy) splashNow(13)
    wasBusy = running
  })

  // Idle chatter: slower rotation while nothing is running.
  createEffect(() => {
    if (busy()) return
    setIdleIdx(Math.floor(Math.random() * idleWords().length))
    const timer = setInterval(() => setIdleIdx((i) => (i + 1) % idleWords().length), IDLE_WORD_MS)
    onCleanup(() => clearInterval(timer))
  })

  // Event-driven blink: every event that reaches the bar restarts the flash.
  let lastHit = 0
  const hit = () => {
    if (lite()) return
    const t = Date.now()
    if (t - lastHit < 120) return
    lastHit = t
    setPing((n) => n + 1)
  }

  // Cycle the status word while a turn runs; re-randomize at the start of each turn.
  createEffect(() => {
    if (!busy()) return
    setWordIdx(Math.floor(Math.random() * words().length))
    const timer = setInterval(() => setWordIdx((i) => (i + 1) % words().length), WORD_MS)
    onCleanup(() => clearInterval(timer))
  })

  // Floating "+1.2k" that drifts up and fades on token growth.
  let deltaSeq = 0
  const bump = (text: string) => {
    const id = ++deltaSeq
    setDelta(text)
    setTimeout(() => {
      if (id === deltaSeq) setDelta(undefined)
    }, 1200)
  }

  let flashTimer: ReturnType<typeof setTimeout> | undefined
  const flashCost = () => {
    setFlash(false)
    requestAnimationFrame(() => setFlash(true))
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => setFlash(false), 950)
  }

  const reset = () => {
    setMounted(false)
    setInfo(undefined)
    setModel(undefined)
    setCtxUsed(undefined)
    setGit(undefined)
    setBusy(false)
    setDelta(undefined)
    setTps(0)
    setQueued(0)
    clearTools()
    serverStatus = "idle"
    samples = []
    lastSampleAt = 0
  }

  const refresh = async () => {
    const session = ctx.sessions.current()
    if (!session) return reset()
    setMounted(true)
    try {
      const next = await ctx.client.session.get({ sessionID: session.id })
      const prev = info()
      const after = tokenTotal(next)
      if (prev) {
        const before = tokenTotal(prev)
        if (after > before) bump("+" + fmtTokens(after - before))
        if ((next.cost ?? 0) > (prev.cost ?? 0)) flashCost()
      }
      noteThroughput(after)
      setInfo(next)
      void resolveModel(ctx, next.model, session.directory).then((m) => m && setModel(m))
    } catch {
      /* server blip: keep the last known numbers */
    }
  }

  const refreshContext = async () => {
    const session = ctx.sessions.current()
    if (!session) return setCtxUsed(undefined)
    try {
      const messages: any[] = await ctx.client.session.context({ sessionID: session.id })
      let last: any
      for (const m of messages) if (m?.type === "assistant" && m.tokens) last = m
      if (last?.tokens) {
        const t = last.tokens
        setCtxUsed((t.input ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0))
      }
    } catch {
      /* ignore */
    }
  }

  const refreshGit = async () => {
    const session = ctx.sessions.current()
    if (!session) return setGit(undefined)
    const location = { location: { directory: session.directory } }
    try {
      const [vcs, status] = await Promise.all([
        ctx.client.vcs.get(location) as Promise<{ data?: VcsInfo }>,
        ctx.client.vcs.status(location) as Promise<{ data?: VcsFileStatus[] }>,
      ])
      const branch = vcs?.data?.branch?.current ?? vcs?.data?.branch?.default
      if (!branch) return setGit(undefined)
      // Keep the object referentially stable when nothing changed, so downstream
      // memos don't invalidate (and the bar doesn't reflow) on every refresh.
      const dirty = status?.data?.length ?? 0
      const prev = git()
      if (!prev || prev.branch !== branch || prev.dirty !== dirty) setGit({ branch, dirty })
    } catch {
      setGit(undefined)
    }
  }

  createEffect(() => {
    void ctx.sessions.current()?.id
    void refresh()
    void refreshContext()
    void refreshGit()
  })

  // Bursts of events collapse into a single fetch.
  let usageTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleUsage = () => {
    if (usageTimer) return
    usageTimer = setTimeout(() => {
      usageTimer = undefined
      void refresh()
      void refreshContext()
    }, 150)
  }

  let gitTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleGit = () => {
    if (gitTimer) return
    gitTimer = setTimeout(() => {
      gitTimer = undefined
      void refreshGit()
    }, 400)
  }

  onMount(() => {
    const controller = new AbortController()

    // Live data comes from the server's event stream: a step ends, a turn finishes, the tree changes.
    ;(async () => {
      try {
        const stream = ctx.client.event.subscribe({
          signal: controller.signal,
          types: [
            "session.usage.updated",
            "session.step.ended",
            "session.status",
            "session.inbox.enqueued",
            "session.inbox.delivered",
            "session.inbox.cancelled",
            "session.execution.started",
            "session.execution.succeeded",
            "session.execution.failed",
            "session.execution.interrupted",
            "session.idle",
            "session.tool.input.started",
            "session.tool.called",
            "session.tool.success",
            "session.tool.failed",
            "session.model.selected",
            "session.moved",
            "session.created",
            "filesystem.changed",
            "vcs.branch.updated",
          ],
        } as any)
        for await (const event of stream as AsyncIterable<{ type?: string; data?: any }>) {
          hit()
          const type = event?.type
          const data = event?.data

          // Authoritative: the server's own run state for this session.
          if (type === "session.status") {
            statusSeen = true
            const st = data?.status?.type
            serverStatus = st === "busy" || st === "retry" ? st : "idle"
            syncBusy()
            if (serverStatus === "idle") {
              setTps(0)
              clearTools()
            }
            scheduleUsage()
            continue
          }

          // Steering: a message was queued mid-turn. Work is coming — stay awake.
          if (type === "session.inbox.enqueued") {
            setQueued((n) => n + 1)
            syncBusy()
            scheduleUsage()
            continue
          }

          // ...and when the queue drains into the running turn.
          if (type === "session.inbox.delivered" || type === "session.inbox.cancelled") {
            setQueued((n) => Math.max(0, n - 1))
            // Delivery means the queued message just entered the turn.
            if (type === "session.inbox.delivered") setBusy(true)
            else syncBusy()
            scheduleUsage()
            continue
          }

          if (type === "session.idle") {
            // Only trust an idle that the server also agrees with; a mid-turn idle
            // during steering must not wipe a queue that is still pending.
            if (!statusSeen || serverStatus === "idle") setQueued(0)
            setTps(0)
            clearTools()
            if (!statusSeen) setBusy(false)
            else syncBusy()
            scheduleUsage()
            continue
          }

          if (type === "session.execution.started") {
            setBusy(true)
            scheduleUsage()
            continue
          }
          if (
            type === "session.execution.succeeded" ||
            type === "session.execution.failed" ||
            type === "session.execution.interrupted"
          ) {
            // Fallback only: once the status stream has spoken, it wins.
            if (!statusSeen) setBusy(false)
            scheduleUsage()
            continue
          }
          if (type === "session.usage.updated" || type === "session.step.ended") {
            // Live usage with a silent status stream means a turn is running —
            // the usual case when the plugin reloads mid-turn.
            if (!statusSeen) setBusy(true)
            scheduleUsage()
            continue
          }
          // Tool calls: the bits get machined while these run.
          if (type === "session.tool.input.started") {
            markTool(data?.id, data?.name)
            scheduleUsage()
            continue
          }
          if (type === "session.tool.called") {
            markTool(data?.id)
            scheduleUsage()
            continue
          }
          if (type === "session.tool.success" || type === "session.tool.failed") {
            clearTool(data?.id)
            scheduleUsage()
            continue
          }
          if (type === "filesystem.changed" || type === "vcs.branch.updated") {
            scheduleGit()
            continue
          }
          if (type === "session.model.selected" || type === "session.moved" || type === "session.created") {
            scheduleGit()
            scheduleUsage()
            continue
          }
          scheduleUsage()
        }
      } catch {
        /* stream ended or aborted */
      }
    })()

    // Local clock for the duration display; also decays stale throughput so a
    // silent stream reads as 0 tok/s instead of a frozen number.
    const ticker = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (lastSampleAt && t - lastSampleAt > 3500) setTps(0)
    }, 1000)

    // Safety net in case the stream silently drops.
    const poll = setInterval(() => void refresh(), 15000)

    onCleanup(() => {
      controller.abort()
      clearInterval(ticker)
      clearInterval(poll)
      if (usageTimer) clearTimeout(usageTimer)
      if (gitTimer) clearTimeout(gitTimer)
    })
  })

  /* ---------- derived ---------- */

  const data = () => (mounted() ? info() : undefined)

  // Whale mode: a deepseek model floods the bar with ocean.
  const whale = (): boolean => /deepseek/i.test(modelName(info()))

  const savings = (): number | undefined => {
    const s = info()
    const m = model()
    if (!s || !m) return undefined
    const read = s.tokens?.cache?.read ?? 0
    if (read <= 0) return undefined
    const entry = pickCost(m.cost as unknown as CostEntry[], ctxUsed() ?? 0)
    if (!entry) return undefined
    return (read / 1e6) * Math.max(0, entry.input - entry.cache.read)
  }

  const duration = (): { label: string; title: string } | undefined => {
    const s = info()
    if (!s) return undefined
    // Live turn timer, measured from the moment we saw this turn start.
    if (busy() && turnStart) return { label: fmtDuration(now() - turnStart), title: "current turn" }
    // SessionInfo.time.* is Unix SECONDS; the local clock is milliseconds.
    const created = s.time?.created ? s.time.created * 1000 : 0
    if (created && now() > created) return { label: fmtDuration(now() - created), title: "session age" }
    return undefined
  }

  // Particle speed tracks token throughput: a hyperbolic curve keeps low rates
  // readable and lets big bursts sprint. Idle trickle = two breaths per traverse.
  // Hovering opens the tap a little — the bar feels like it's leaning in.
  const flowDur = (): string => {
    if (!busy()) return `${BREATH_IDLE * 2}s`
    const dur = Math.max(0.5, Math.min(3.2, 3.2 / (1 + tps() / 55)))
    return (hover() ? Math.max(0.35, dur / 1.6) : dur).toFixed(2) + "s"
  }

  // The card always shows the full session panel now; the per-segment panels
  // remain in the switch below for whenever we want them back.
  const seg = () => "default" as Seg

  const cardRows = (): [string, string][] => {
    const s = info()
    if (!s) return []
    const t = s.tokens
    const total = tokenTotal(s)
    const read = t?.cache?.read ?? 0
    const write = t?.cache?.write ?? 0
    const denom = (t?.input ?? 0) + read + write
    const pct = denom > 0 ? (read / denom) * 100 : 0
    const used = ctxUsed() ?? 0
    const limit = model()?.limit?.context ?? 0
    const saved = savings()
    const price = pickCost(model()?.cost as unknown as CostEntry[], used)
    const full = price && read > 0 ? (read / 1e6) * price.input : undefined
    const where = [s.agent, git()?.branch, duration()?.label].filter(Boolean).join("  ·  ")

    switch (seg()) {
      case "model":
        return [
          ["model", modelName(s)],
          ["provider", s.model?.providerID ?? "—"],
          ["variant", s.model?.variant ?? "default"],
          ["context", limit ? fmtTokens(limit) + " tok" : "—"],
          ["price in/out", price ? `${fmtPrice(price.input)} ${fmtPrice(price.output)}` : "—"],
          ["cache r/w", price ? `${fmtPrice(price.cache.read)} ${fmtPrice(price.cache.write)}` : "—"],
          ["agent", s.agent ?? "—"],
        ]

      case "cache":
        return [
          ["hit rate", `${pct.toFixed(1)}%`],
          ["cache read", `${fmtTokens(read)} tok`],
          ["cache write", `${fmtTokens(write)} tok`],
          ["full price", full === undefined ? "—" : fmtCost(full)],
          ["saved", saved === undefined ? "—" : `−${fmtCost(saved)}`],
          ["meter", `${Math.round(pct)}% of prompt from cache`],
        ]

      case "ctx": {
        const room = limit > 0 ? Math.max(0, limit - used) : 0
        return [
          ["used", `${fmtTokens(used)} tok`],
          ["window", limit ? `${fmtTokens(limit)} tok` : "—"],
          ["fill", limit ? `${((used / limit) * 100).toFixed(1)}%` : "—"],
          ["free", limit ? `${fmtTokens(room)} tok` : "—"],
          ["compact at", "90%"],
          ["session", `${fmtTokens(total)} tok processed`],
        ]
      }

      case "tok":
        return [
          ["input", `↑ ${fmtTokens(t?.input)}`],
          ["output", `↓ ${fmtTokens(t?.output)}`],
          ["cache read", `⚡ ${fmtTokens(read)}`],
          ["cache write", `✍️ ${fmtTokens(write)}`],
          ["reasoning", `🧠 ${fmtTokens(t?.reasoning)}`],
          ["total", `${fmtTokens(total)} tok`],
          ["rate", `${tps().toFixed(0)} tok/s`],
        ]

      case "cost":
        return [
          ["session", fmtCost(s.cost)],
          ["saved", saved === undefined ? "—" : `−${fmtCost(saved)}`],
          ["per 1k tok", total > 0 ? "$" + (((s.cost ?? 0) / total) * 1000).toFixed(4) : "—"],
          ["cache rate", `${pct.toFixed(0)}%`],
          ["model", modelName(s)],
        ]

      case "speed":
        return [
          ["now", `${tps().toFixed(0)} tok/s`],
          ["peak 60s", `${peakTps().toFixed(0)} tok/s`],
          ["queued", String(queued())],
          ["flow", `${flowDur()} per traverse`],
          ["tool", tool() ? `⚙ ${tool()}` : "—"],
          ["state", queued() > 0 ? "steering" : busy() ? (serverStatus === "retry" ? "retrying" : "busy") : "idle"],
        ]

      default:
        return [
          ["in / out", `↑${fmtTokens(t?.input)}   ↓${fmtTokens(t?.output)}`],
          ["cache write", `✍️ ${fmtTokens(write)}`],
          ["reasoning", `🧠 ${fmtTokens(t?.reasoning)}`],
          ["cache hit", `${pct.toFixed(0)}%${saved ? `   −${fmtCost(saved)} saved` : ""}`],
          [
            "context",
            limit ? `${fmtTokens(used)} / ${fmtTokens(limit)}   ${((used / limit) * 100).toFixed(0)}%` : fmtTokens(used),
          ],
          ["throughput", `${tps().toFixed(0)} tok/s${queued() ? `   ⏳${queued()} queued` : ""}`],
          ...(tool() ? ([["tool", `⚙ ${tool()}`]] as [string, string][]) : []),
          ["total", `${fmtTokens(total)} tokens   ${fmtCost(s.cost)}`],
          ["session", where || "—"],
        ]
    }
  }

  const peakTps = (): number => {
    const h = hist()
    return h.length ? Math.max(...h) : 0
  }

  // Right-aligned sparkline across a fixed 60-slot window.
  const spark = (): string => {
    const h = hist()
    if (h.length < 2) return ""
    const max = Math.max(1, ...h)
    const step = 276 / 59
    return h
      .map((v, i) => {
        const x = 276 - (h.length - 1 - i) * step
        const y = 25 - (v / max) * 23
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(" ")
  }

  // Built exactly once: a new element per identity() evaluation would restart
  // the CSS animation mid-flight. Class/style/title still track reactively.
  const flow = createMemo(() => (
    <span
      class={busy() ? (tool() ? "sb-flow tool" : "sb-flow") : "sb-flow idle"}
      style={{ "--sb-flow": flowDur() } as JSX.CSSProperties}
      title={
        tool()
          ? `⚙ ${tool()} running — bits going through the factory`
          : tps() >= 1
            ? `${tps().toFixed(0)} tok/s flowing`
            : "no tokens flowing"
      }
    >
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
      <span class="sb-flow-gear" aria-hidden="true">
        ⚙
      </span>
    </span>
  ))

  // Stable elements: identity() re-runs on every glyph tick, and rebuilding these
  // nodes each time is what made the bar twitch. Created once, updated reactively.
  const modelEl = createMemo(() => (
    <span style={{ "font-weight": "600", opacity: "0.9" }} title={busy() ? "working" : "model"}>
      <span class={busy() ? "sb-flower" : "sb-flower idle"} style={{ "margin-right": "5px" }}>
        {glyphs()[glyphIdx() % glyphs().length]}
      </span>
      {whale() ? "🐋" : "🤖"} {modelName(info())}
    </span>
  ))

  const statusEl = createMemo(() => (
    <Show
      when={busy()}
      fallback={
        <span class="sb-status idle" title="idle — asleep in the ether">
          ◌ {idleWords()[idleIdx() % idleWords().length]}
          <span class="sb-zzz" aria-hidden="true">
            <i>Z</i>
            <i>z</i>
            <i>z</i>
            <i>z</i>
          </span>
        </span>
      }
    >
      <span
        class="sb-status sb-glow"
        style={{
          // Lift the accent toward white: pure accent is unreadable on dark
          // palettes (deepseek's #4d6bfe, cyberwar's reds). If a browser lacks
          // color-mix the declaration is dropped and it inherits the bar's
          // near-white, which is a fine fallback.
          color: `color-mix(in srgb, ${theme().accent} 42%, #ffffff)`,
          "font-weight": "600",
        }}
        title={queued() > 0 ? `working · ${queued()} queued` : "working"}
      >
        ✦ {words()[wordIdx() % words().length]}
        <Show
          when={theme().cursor}
          fallback={
            <span class="sb-dots">
              <i>.</i>
              <i>.</i>
              <i>.</i>
            </span>
          }
        >
          <span class="sb-cursor">▌</span>
        </Show>
        <Show when={queued() > 0}>
          <span class="sb-queue" title={`${queued()} message(s) queued — steering`}>
            ⏳{queued()}
          </span>
        </Show>
      </span>
    </Show>
  ))

  const branchEl = createMemo(() => {
    const g = git()
    if (!g) return undefined
    return (
      <span style={{ opacity: "0.75" }} title="working tree">
        ⎇ {g.branch}
        {g.dirty > 0 ? ` ●${g.dirty}` : ""}
      </span>
    )
  })

  const agentName = createMemo(() => info()?.agent)
  const agentEl = createMemo(() => {
    const a = agentName()
    return a ? (
      <span
        style={{ opacity: "0.75", cursor: "help" }}
        title={`agent: ${a} — hover for session details`}
        onMouseEnter={() => openCard()}
        onMouseLeave={() => closeCardSoon()}
      >
        ⚙️ {a}
      </span>
    ) : undefined
  })

  const durationEl = createMemo(() => (
    <Show when={duration()}>
      {(d) => (
        <span style={{ opacity: "0.7" }} title={d().title}>
          ⏱ {d().label}
        </span>
      )}
    </Show>
  ))

  const identity = (): JSX.Element[] => {
    const out: JSX.Element[] = []
    const b = branchEl()
    if (b) out.push(b)
    const a = agentEl()
    if (a) out.push(a)
    out.push(modelEl())
    out.push(statusEl())

    // Data bits streaming right, right after the status phrase.
    out.push(flow())

    return out
  }

  const usage = (): JSX.Element[] => {
    const s = info()
    if (!s) return []
    const t = s.tokens
    const total = (t?.input ?? 0) + (t?.output ?? 0) + (t?.reasoning ?? 0) + (t?.cache?.read ?? 0) + (t?.cache?.write ?? 0)
    if (total <= 0) return [<span style={{ opacity: "0.5" }}>no token data yet</span>]

    const out: JSX.Element[] = []
    const denom = (t?.input ?? 0) + (t?.cache?.read ?? 0) + (t?.cache?.write ?? 0)
    const pct = denom > 0 ? ((t?.cache?.read ?? 0) / denom) * 100 : 0

    const cells = 5
    const filled = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)))

    out.push(
      <span
        style={{ display: "flex", "align-items": "center", gap: "6px", color: cacheColor(pct), "font-weight": "600" }}
        title={`cache read share of prompt tokens — ${pct.toFixed(1)}%`}
      >
        ⚡ {pct.toFixed(0)}%
        <span class="sb-blocks">
          <span class="on">{"▰".repeat(filled)}</span>
          <span class="off">{"▱".repeat(cells - filled)}</span>
        </span>
      </span>,
    )

    const saved = savings()
    if (saved !== undefined && saved >= 0.0005) {
      out.push(
        <span style={{ opacity: "0.8" }} title="saved versus paying full input price">
          💚 −{fmtCost(saved)}
        </span>,
      )
    }

    const used = ctxUsed()
    const limit = model()?.limit?.context
    if (used && limit) {
      const cp = Math.min(100, (used / limit) * 100)
      out.push(
        <span
          class={cp >= 90 ? "sb-alert" : undefined}
          style={{ opacity: "0.85", color: ctxColor(cp) }}
          title={`${fmtTokens(used)} / ${fmtTokens(limit)} tokens in context`}
        >
          🪟 {cp.toFixed(0)}% ctx
        </span>,
      )
    }

    out.push(
      <span class={flash() ? "sb-flash" : undefined} style={{ opacity: "0.8" }} title="session cost">
        💰 {fmtCost(s.cost)}
      </span>,
    )

    out.push(
      <span style={{ position: "relative", opacity: "0.8" }} title="throughput tokens">
        📦 {fmtTokens(total)} tok
        <Show when={delta()}>{(d) => <span class="sb-bump">{d()}</span>}</Show>
      </span>,
    )

    const detail: string[] = [`↑${fmtTokens(t?.input)}`, `↓${fmtTokens(t?.output)}`]
    if ((t?.cache?.write ?? 0) > 0) detail.push(`✍️${fmtTokens(t?.cache?.write)}`)
    if ((t?.reasoning ?? 0) > 0) detail.push(`🧠${fmtTokens(t?.reasoning)}`)
    out.push(
      <span style={{ opacity: "0.65", "font-size": "11px" }} title="↑ input · ↓ output · ✍️ cache write · 🧠 reasoning">
        {detail.join(" ")}
      </span>,
    )

    out.push(durationEl())

    return out
  }

  return (
    <div
      ref={barRef}
      class={`${busy() ? "sb-working" : "sb-idle"}${whale() ? " sb-ocean" : ""}${hover() ? " sb-hover" : ""}${theme().scan ? " sb-scan" : ""}${lite() ? " sb-lite" : ""}`}
      style={{
        ...(whale() ? shellOcean : shell),
        padding: `${pad()}px 16px`,
        "--sb-glow": theme().rgb,
        "--sb-accent": theme().accent,
        "--sb-accent2": theme().accent2,
        "--sb-wash": theme().wash,
        "--sb-sx": `${splashX()}%`,
      } as JSX.CSSProperties}
      onMouseEnter={(e) => {
        setHover(true)
        hit() // hovering counts as an event: one flash across the strip
      }}
      onMouseLeave={() => {
        setHover(false)
        closeCardSoon()
      }}
      onClick={(e) => {
        // Click anywhere on the strip → waves, unless it landed on a card control.
        if ((e.target as HTMLElement | null)?.closest?.(".sb-card")) return
        splashNow(pctAt(e.clientX))
      }}
      onDblClick={() => {
        // Only pin a card that's already open — a stray double-click should never
        // summon one out of nowhere.
        if (!opened() && !pinned()) return
        setPinned(!pinned())
      }}
    >
      <Show when={ping()} keyed>
        {() => <span class="sb-ping" />}
      </Show>

      <span class="sb-splash" ref={splashRef} aria-hidden="true">
        <i />
        <b />
        <u />
      </span>

      <Show when={showCard()}>
        <div
          class={pinned() ? "sb-card pinned" : "sb-card"}
          onMouseEnter={() => openCard()}
          onMouseLeave={() => closeCardSoon()}
        >
          <div class="sb-card-h">
            <span>session</span>
            <span>{pinned() ? "📌 pinned" : ""}</span>
          </div>
          <For each={cardRows()}>
            {([k, v]) => (
              <div class="sb-row">
                <span class="sb-k">{k}</span>
                <span class="sb-v">{v}</span>
              </div>
            )}
          </For>
          <svg class="sb-spark" viewBox="0 0 276 26" preserveAspectRatio="none">
            <line class="sb-spark-base" x1="0" y1="25" x2="276" y2="25" />
            <polyline points={spark()} />
          </svg>
          <div class="sb-palette">
            <For each={THEMES}>
              {(t) => (
                <button
                  type="button"
                  class={t.id === themeId() ? "sb-swatch on" : "sb-swatch"}
                  style={{ background: t.accent, color: t.accent }}
                  title={t.name}
                  onClick={() => pickTheme(t.id)}
                />
              )}
            </For>
          </div>
          <div class="sb-tools">
            <span class="sb-tool-k">height</span>
            <button type="button" class="sb-mini" title="shorter bar" onClick={() => stepPad(-1)}>
              −
            </button>
            <span class="sb-tool-v">{pad()}px</span>
            <button type="button" class="sb-mini" title="taller bar" onClick={() => stepPad(1)}>
              +
            </button>
            <button
              type="button"
              class="sb-fx"
              title={lite() ? "Animations off — click for full FX" : "Animations on — click for a lighter bar (servers / RDP)"}
              onClick={toggleLite}
            >
              {lite() ? "fx off" : "fx on"}
            </button>
          </div>
        </div>
      </Show>
      <Show
        when={data()}
        fallback={
          <span class={mounted() ? "sb-loading" : undefined} style={{ opacity: "0.5", width: "100%", "text-align": "center" }}>
            {mounted() ? "loading usage…" : "no active session"}
          </span>
        }
      >
        <Group items={identity} />
        <Group items={usage} end />
      </Show>
    </div>
  )
}

export default Plugin.define({
  id: "desktop.statusbar",
  setup(ctx) {
    // Only the window context has `add`; the server context runs setup too.
    if (typeof (ctx as any).add !== "function") return

    ;(ctx as any).add(Style, css)

    ;(ctx as any).add(Slot, {
      at: "window.bottom",
      order: 1,
      render: () => <StatusBar />,
    })
  },
})
