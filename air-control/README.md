# Air Control

Control your Mac's mouse with hand gestures over the webcam. Built for *reliable* gesture recognition: One Euro Filter smoothing, hand-size-normalized pinch detection, debounced gesture state machine, click-vs-drag timing.

## Install

```bash
cd ~/ideas/air-control
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

If `pip install` 404s or stalls, your pip is pointed at a broken index. Use pypi directly:

```bash
pip install --index-url https://pypi.org/simple/ -r requirements.txt
```

## Run

```bash
source .venv/bin/activate
python main.py
```

- `q` — quit
- `r` — reset filters (if the cursor is stuck somewhere weird)

## macOS permissions (required)

Both prompts appear on first run; approve both.

1. **Camera** — the OS will ask.
2. **Accessibility** — *System Settings → Privacy & Security → Accessibility*. Add **Terminal** (or iTerm / VS Code — whatever runs `python`). Without this, `pyautogui` can't move the cursor and nothing will happen even though the preview works.

## Gestures

| Gesture | Action |
|---|---|
| 👆 Index only up | Move cursor |
| 🤏 Thumb + index pinch, quick release | Left click |
| 🤏 Thumb + index pinch, hold ≥0.35s | Start dragging — release pinch to drop |
| 🤏 Thumb + middle pinch | Right click |
| ✌️ Index + middle both up | Scroll (move hand up = scroll up) |
| ✊ Closed fist | Freeze cursor (idle / safety) |

### Why gestures feel good here

- **One Euro Filter** on cursor position — smooth when you're still, responsive when you move. No lag-vs-jitter tradeoff.
- **Normalized pinch**: the pinch threshold is a *ratio* of your hand size, so closer/farther from the camera doesn't change sensitivity.
- **State-machine debounce**: a gesture must persist for 2 frames before it fires, which kills false triggers from momentary mis-detections.
- **Click vs drag by timing**: short pinch = click, held pinch = drag. No separate "drag" gesture to memorize.
- **Hysteresis**: separate "pinch on" and "pinch off" thresholds prevent flicker at the boundary.
- **Fist = freeze**, not drag — gives you a safe idle pose where the cursor stops moving entirely.

## Tuning (top of `main.py`)

| Constant | Effect |
|---|---|
| `ACTIVE_X`, `ACTIVE_Y` | Fraction of the camera frame mapped to the screen. Larger = less hand travel for full-screen coverage. |
| `PINCH_ON` / `PINCH_OFF` | Pinch sensitivity (ratio of hand size). Lower `PINCH_ON` = must pinch tighter. |
| `GESTURE_STABLE_FRAMES` | Debounce. Raise if you get accidental triggers; lower for faster response. |
| `DRAG_HOLD_SECONDS` | How long to hold a pinch before it becomes a drag. |
| `ONE_EURO_MIN_CUTOFF` | Lower = smoother when still (but laggier). Try 0.8–1.5. |
| `ONE_EURO_BETA` | Higher = more responsive when moving fast. Try 0.005–0.03. |
| `SCROLL_GAIN` | Scroll speed. |

## Troubleshooting

- **Cursor doesn't move but preview shows your hand** — Accessibility permission not granted. See above.
- **Clicks fire by themselves** — raise `PINCH_ON` further below `PINCH_OFF`, or raise `GESTURE_STABLE_FRAMES` to 3.
- **Cursor is jittery** — lower `ONE_EURO_MIN_CUTOFF` to 0.8.
- **Cursor is laggy** — raise `ONE_EURO_BETA` to 0.03.
- **Need to reach a screen edge but can't** — raise `ACTIVE_X`/`ACTIVE_Y` to 0.8.
