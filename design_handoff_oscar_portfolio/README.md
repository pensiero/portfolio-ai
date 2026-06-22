# Handoff: Oscar Fanelli AI Portfolio — Style Update

## Overview

Two visual style updates for Oscar Fanelli's AI-powered portfolio chatbot. The product is a single-page chat interface where visitors ask questions about Oscar's career, answered in real time by a Claude-backed AI. Two styles are being refined:

1. **Style 1 · The Guidebook** — Update the existing `public/options/option-49-brazilian-modernism-yellow.html`. Preserves its bold sans-serif editorial voice; fixes low-contrast kicker, animates the input, tightens the yellow offset block, and adds a full chat message treatment.
2. **Style 2 · The Manuscript** — Create a new layout file. Quiet, literary, all-serif. Reads like an interview transcript rather than a chat UI. No card borders, no bubbles — conversation renders as a typed document.

---

## About the Design Files

`style-1-guidebook-reference.html` and `style-2-manuscript-reference.html` are **high-fidelity HTML design references**. They show the intended look, animations, and behavior for all three UI states (empty, loading, answered). They are **not** production code to copy directly.

Your tasks:
- **Style 1**: Update `public/options/option-49-brazilian-modernism-yellow.html` to match `style-1-guidebook-reference.html`. Understand the existing option file's structure and class/variable system first; apply the design changes within it.
- **Style 2**: Create a new option file (suggested path: `public/options/option-XX-manuscript.html`, use the next available number) modeled on the structure of option-49 but implementing the Manuscript visual system from scratch per `style-2-manuscript-reference.html`.

---

## Fidelity

**High-fidelity.** Colors, typography, spacing, border weights, border radii, and animations should match the references exactly. All values are specified below; the reference files are the ground truth.

---

## Screens / Views

Both styles share the same three states:

| State | Description |
|-------|-------------|
| **Empty / Landing** | Page on first load — no conversation yet |
| **Loading** | User submitted a question; answer is streaming |
| **Answered / Chat** | Answer has arrived; conversation is visible |

---

## Style 1 · The Guidebook

### Design System

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-stage` | `#fbf4dc` | Outer cream stage background |
| `--bg-card` | `#fffdf6` | Inner card / page surface |
| `--bg-answer` | `#f3efe1` | Answer block tint |
| `--yellow` | `#f4c81d` | Offset accent block (behind card) |
| `--ink` | `#1a1916` | Primary text, borders, buttons |
| `--ink-body` | `#56524a` | Body / caption text |
| `--ink-muted` | `#9a958a` | Ghost text / placeholders |
| `--ink-label` | `#9c8f4a` | Mono kicker, source lines, "answers live" |

### Typography

| Role | Family | Weight | Size | Notes |
|------|--------|--------|------|-------|
| Headline | Bricolage Grotesque | 800 | 44px empty / 32px chat | `line-height: 0.98` empty, `letter-spacing: -0.025em` |
| Body / caption | Spline Sans | 400 | 15px | `line-height: 1.55; color: #56524a` |
| Input ghost | Spline Sans | 400 | 15.5px | `color: #9a958a` |
| Kicker / labels | IBM Plex Mono | 500 | 10.5–11.5px | `letter-spacing: 0.13em; text-transform: uppercase` |
| Button | Bricolage Grotesque | 700 | 14px | |
| Answer body | Spline Sans | 400 | 15.5px | `line-height: 1.55` |
| Chips | Spline Sans | 600 | 14px (popular) / 13px (follow-up) | |

Google Fonts import:
```
https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=IBM+Plex+Mono:wght@400;500&family=Spline+Sans:wght@400;500;600&display=swap
```

### Layout — Empty State

```
[Stage: background #fbf4dc, padding 38px, position relative]
  [Yellow block: position absolute, left 54px, top 54px, right 22px, bottom 22px,
                 background #f4c81d, border-radius 2px, z-index 0]
  [Card: position relative, z-index 1, background #fffdf6,
         border 2px solid #1a1916, border-radius 2px, padding 30px 32px]
    [Header row: flex, space-between, margin-bottom 18px]
      [Left: presence dot (9px) + "OSCAR FANELLI" mono label]
      [Right: "answers live" mono label, color #9c8f4a]
    [h1: "Do not panic." — Bricolage 800, 44px]
    [p: caption — Spline Sans 400, 15px, max-width 400px]
    [Input row: border 2px solid #1a1916, border-radius 2px, height 56px]
      [Ghost text + blinking caret]
      [Ask → button: Bricolage 700, bg #1a1916, color #fffdf6, height 42px, border-radius 2px]
    [Divider: "Popular questions" mono label + 1px rule]
    [Chips: flex-wrap, gap 9px — border 1.5px solid #1a1916, radius 100px, padding 9px 15px]
    [Footer: border-top 1.5px, "Email · LinkedIn · GitHub" left, "What's behind this?" right]
```

### Layout — Chat State

Same card wrapper. Input shrinks to 52px height, placeholder becomes "Ask a follow-up…".

**You bubble:**
- `display: flex; flex-direction: column; align-items: flex-end`
- Label: IBM Plex Mono, 10.5px, color `#9c8f4a`. Copy: "You"
- Bubble: `background: #fff; border: 1.5px solid #1a1916; border-radius: 12px 12px 3px 12px; padding: 10px 15px; max-width: 78%`

**Oscar AI answer block:**
- `position: relative; padding: 18px 20px 18px 22px; background: #f3efe1`
- Left accent bar: `position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: #1a1916`
- Header: "Oscar AI" label + "latest" badge (`border: 1.5px solid #1a1916; border-radius: 2px; padding: 2px 7px`)
- Body: Spline Sans 400, 15.5px, `line-height: 1.55`
- Source line: IBM Plex Mono, 11px, `color: #9c8f4a`. Format: `SOURCE · {name}`
- Confidence + chips: separated by `border-top: 1.5px solid rgba(26,25,22,.16)`. Confidence: IBM Plex Mono 10.5px. Chips: same style as popular questions but 13px, append "↗"

### Layout — Loading State

Same as chat state. Oscar AI block shows:
- 3 animated dots (`dotwave` keyframe)
- Cycling status text (IBM Plex Mono, 12px): "Reading my bio…" → "Connecting the dots…" → "Composing an answer…" (every 1500ms)
- 3 skeleton lines (100% / 94% / 68% width), shimmer animation

---

## Style 2 · The Manuscript

### Design System

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-page` | `#faf9f4` | Full page background (no card) |
| `--ink` | `#21201c` | Primary text, thin rules |
| `--ink-sub` | `#6b685f` | Italic subhead, "confident" label |
| `--ink-muted` | `#a09c92` | Ghost text, "You asked", italic hints |
| `--ink-label` | `#8a8780` | Kicker label, footer, "Oscar" transcript label |

### Typography

| Role | Family | Weight | Size | Notes |
|------|--------|--------|------|-------|
| Headline | Source Serif 4 | 500 (not bold) | 46px empty / 34px chat | `line-height: 1.03; letter-spacing: -0.01em` |
| Subhead | Source Serif 4 | 400 italic | 18px | `color: #6b685f; max-width: 380px` |
| Input ghost | Source Serif 4 | 400 | 19px | `color: #a09c92` |
| Kicker | Source Serif 4 | 400 | 12.5px | `letter-spacing: 0.18em; text-transform: uppercase; color: #8a8780` |
| Answer body | Source Serif 4 | 400 | 18px | `line-height: 1.58` |
| Italic hints | Source Serif 4 | 400 italic | 12.5–13px | "You asked", "Or start here —", "Follow that thread —" |
| Starter / follow-up links | Source Serif 4 | 400 | 17px / 16px | `border-bottom: 1px solid rgba(33,32,28,.22)` |

Google Fonts import:
```
https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400..600;1,8..60,400..500&family=IBM+Plex+Mono:wght@400;500&display=swap
```

### Layout — Empty State

```
[Page: background #faf9f4, padding 52px 48px 44px — NO outer wrapper or card border]
  [Presence row: dot (8px) + "OSCAR FANELLI" serif label, margin-bottom 26px]
  [h1: "Curious about my work?" — Source Serif 500, 46px]
  [p: italic subhead]
  [Input: border-bottom ONLY (1.5px solid #21201c), no box border
    Ghost text (serif 19px) + blinking caret + "press ↵" italic hint]
  ["Or start here —" italic label + 3 serif underline links]
  [Footer: border-top 1px, serif 13.5px, color #8a8780]
```

### Layout — Chat State

**You:**
- `text-align: right` — no bubble box whatsoever
- "You asked" italic label (Source Serif italic, 12.5px, `color: #a09c92`)
- Question text: Source Serif 400, 18px

**Oscar AI — transcript:**
- `position: relative; padding-left: 20px`
- Left rule only: `position: absolute; left: 0; top: 3px; bottom: 3px; width: 1.5px; background: #21201c`
- "Oscar" label: `font-size: 12.5px; letter-spacing: 0.16em; text-transform: uppercase; color: #8a8780`
- Body: Source Serif 400, 18px, `line-height: 1.58`. Key phrases in `<em>`.
- Source + confidence: single italic line. Format: `Source — {name} · confident`
- "Follow that thread —" italic intro + same underline link style as starters

### Layout — Loading State

Same as chat. Oscar block shows:
- "Oscar" label + inline italic cycling status (e.g. "— checking if this is relevant. It probably is…")
- 3 skeleton lines (muted: `rgba(33,32,28,.05)` → `.11`), `border-radius: 2px`

---

## Animations (shared)

```css
@keyframes caretBlink {
  0%, 45% { opacity: 1; }
  55%, 100% { opacity: 0; }
}
/* caret: 1.05s step-end infinite */

@keyframes breathe {
  0%, 100% { transform: scale(1); opacity: 0.55; }
  50%       { transform: scale(1.3); opacity: 1; }
}
/* dot fill: 3.2s ease-in-out infinite */

@keyframes ring {
  0%   { transform: scale(0.6); opacity: 0.5; }
  100% { transform: scale(2.3); opacity: 0; }
}
/* dot ring: 3.2s ease-out infinite */

@keyframes dotwave {
  0%, 100% { opacity: 0.25; transform: translateY(0); }
  50%       { opacity: 1;    transform: translateY(-3px); }
}
/* 3 dots, staggered 0 / 0.18s / 0.36s; duration 1.1s ease-in-out infinite */

@keyframes skeleton {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
/* Style 1: 1.4s linear; Style 2: 1.6s linear */

@keyframes ansIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: none; }
}
/* You bubble: 0.4s ease; Oscar block: 0.4s ease 0.1s */
```

---

## Interactions & Behavior

### Ghost question rotation
Questions cycle every **2600ms** via `setInterval`.

**Style 1 questions:**
- "What does Oscar look for in a team?"
- "Why did he co-found a quantum startup?"
- "What's the hardest call he's made?"
- "Is he open to new roles?"

**Style 2 questions:**
- "What is he doing at InPost?"
- "How does he think about design?"
- "What's he proudest of building?"
- "Where did he learn to lead?"

### Submit flow
1. Input clears; user's question appears as a right-aligned **You** entry (with `ansIn` animation)
2. Oscar AI block appears with loading state (dots + skeleton)
3. When streaming completes: skeleton is replaced by answer text; "latest" badge appears; follow-up prompts appear
4. Multiple exchanges: previous turns stay visible above; newest is always "latest"

### "Clear conversation"
Wipes all messages and returns to empty/landing state.

---

## State Management

| Variable | Type | Description |
|----------|------|-------------|
| `ghostIndex` | `number` | Increments every 2600ms to cycle ghost questions |
| `messages` | `Array<{role, content, source?, confidence?, followUps?}>` | Full conversation history |
| `isLoading` | `boolean` | True while streaming |
| `loadingStatus` | `string` | Cycles through status phrases during loading (every 1500ms) |

---

## Files in This Package

```
design_handoff_oscar_portfolio/
├── README.md                             ← This file
├── style-1-guidebook-reference.html     ← Style 1: empty + chat + loading states
└── style-2-manuscript-reference.html    ← Style 2: empty + chat + loading states
```

**Target files in codebase:**
- `public/options/option-49-brazilian-modernism-yellow.html` — update for Style 1
- `public/options/option-XX-manuscript.html` (next available number) — create for Style 2
