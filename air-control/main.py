"""Hand-gesture mouse controller.

Gestures (hold stable ~3 frames to activate):
  - Index finger only up    -> move cursor
  - Thumb + index pinch     -> left click (tap) / drag (hold)
  - Thumb + middle pinch    -> right click
  - Index + middle both up  -> scroll (hand up = scroll up, down = scroll down)
  - Closed fist             -> freeze cursor (safe idle)

Press 'q' in the preview window to quit.
Press 'r' to re-center / reset filters.
"""

import math
import time
from dataclasses import dataclass, field
from typing import Optional

import cv2
import mediapipe as mp
import numpy as np
import pyautogui

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0

SCREEN_W, SCREEN_H = pyautogui.size()
CAM_W, CAM_H = 960, 540

# Fraction of the camera frame used as the active region (centered).
ACTIVE_X = 0.65
ACTIVE_Y = 0.60

# Pinch thresholds are expressed as a fraction of hand size (wrist->middle_mcp length).
PINCH_ON = 0.45
PINCH_OFF = 0.75

# Gesture must persist this many frames before it fires (debounce).
GESTURE_STABLE_FRAMES = 2

# Click-vs-drag: if pinch is released within this time, it's a click.
# If still pinched after this, we switch into drag mode.
DRAG_HOLD_SECONDS = 0.35
CLICK_COOLDOWN = 0.25

# Scroll
SCROLL_DEADZONE = 0.008          # normalized units
SCROLL_GAIN = 1200.0             # multiplier -> scroll "clicks"

# One Euro Filter params (good defaults for cursor control at ~30fps).
ONE_EURO_MIN_CUTOFF = 1.2
ONE_EURO_BETA = 0.015
ONE_EURO_D_CUTOFF = 1.0

mp_hands = mp.solutions.hands
mp_draw = mp.solutions.drawing_utils
mp_styles = mp.solutions.drawing_styles

TIP = {"thumb": 4, "index": 8, "middle": 12, "ring": 16, "pinky": 20}
PIP = {"thumb": 3, "index": 6, "middle": 10, "ring": 14, "pinky": 18}
MCP = {"thumb": 2, "index": 5, "middle": 9, "ring": 13, "pinky": 17}
WRIST = 0


# ---------- utilities ---------------------------------------------------------

def _dist(a, b) -> float:
    return float(math.hypot(a.x - b.x, a.y - b.y))


def hand_size(lm) -> float:
    """Reference length used to normalize pinch distances across hand sizes/depth."""
    return max(1e-6, _dist(lm[WRIST], lm[MCP["middle"]]))


def finger_extended(lm, finger: str) -> bool:
    """Angle-based extension check: tip is far from MCP relative to PIP->MCP."""
    mcp = lm[MCP[finger]]
    pip = lm[PIP[finger]]
    tip = lm[TIP[finger]]
    # Vectors
    v1 = (pip.x - mcp.x, pip.y - mcp.y)
    v2 = (tip.x - pip.x, tip.y - pip.y)
    # Dot product -> cos(angle). Extended when roughly straight (cos > 0).
    dot = v1[0] * v2[0] + v1[1] * v2[1]
    n1 = math.hypot(*v1) or 1e-6
    n2 = math.hypot(*v2) or 1e-6
    cos_a = dot / (n1 * n2)
    if finger == "thumb":
        # Thumb bends sideways; also check tip is left of IP joint relative to wrist.
        return cos_a > 0.2
    # For other fingers, also require the tip to be above (lower y than) the MCP.
    return cos_a > 0.5 and tip.y < mcp.y


# ---------- One Euro Filter ---------------------------------------------------

class _LowPass:
    def __init__(self):
        self.y = None
        self.a = 0.0

    def __call__(self, x: float, alpha: float) -> float:
        self.a = alpha
        self.y = x if self.y is None else alpha * x + (1 - alpha) * self.y
        return self.y


class OneEuroFilter:
    """Adaptive low-pass filter: more smoothing when still, more responsive when moving."""

    def __init__(self, min_cutoff=1.0, beta=0.0, d_cutoff=1.0):
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self.x_prev: Optional[float] = None
        self.t_prev: Optional[float] = None
        self.lp_x = _LowPass()
        self.lp_dx = _LowPass()

    @staticmethod
    def _alpha(cutoff: float, dt: float) -> float:
        tau = 1.0 / (2 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / dt)

    def reset(self):
        self.x_prev = None
        self.t_prev = None
        self.lp_x = _LowPass()
        self.lp_dx = _LowPass()

    def __call__(self, x: float, t: float) -> float:
        if self.t_prev is None:
            self.t_prev = t
            self.x_prev = x
            return self.lp_x(x, 1.0)
        dt = max(1e-6, t - self.t_prev)
        dx = (x - self.x_prev) / dt
        edx = self.lp_dx(dx, self._alpha(self.d_cutoff, dt))
        cutoff = self.min_cutoff + self.beta * abs(edx)
        y = self.lp_x(x, self._alpha(cutoff, dt))
        self.x_prev = x
        self.t_prev = t
        return y


# ---------- gesture state machine --------------------------------------------

@dataclass
class GestureState:
    name: str = "idle"
    stable_count: int = 0
    pinch_index_down: bool = False
    pinch_index_t0: float = 0.0
    is_dragging: bool = False
    last_click_t: float = 0.0
    scroll_anchor_y: Optional[float] = None
    history: list = field(default_factory=list)

    def observe(self, candidate: str) -> str:
        """Return the gesture name only when it has been stable for N frames."""
        if candidate == self.name:
            self.stable_count = min(self.stable_count + 1, 10)
        else:
            self.stable_count = 1
            self.name = candidate
        return self.name if self.stable_count >= GESTURE_STABLE_FRAMES else "transition"


# ---------- main loop ---------------------------------------------------------

def map_to_screen(nx: float, ny: float) -> tuple[float, float]:
    """Map normalized hand coord (0..1) through active region to screen pixels."""
    cx = (1.0 - ACTIVE_X) / 2
    cy = (1.0 - ACTIVE_Y) / 2
    x = (nx - cx) / ACTIVE_X
    y = (ny - cy) / ACTIVE_Y
    x = min(1.0, max(0.0, x))
    y = min(1.0, max(0.0, y))
    return x * SCREEN_W, y * SCREEN_H


def draw_ui(frame, status, info_lines, pinch_ratio=None, confidence=0):
    h, w = frame.shape[:2]
    # Active region box
    x0 = int(w * (1 - ACTIVE_X) / 2)
    y0 = int(h * (1 - ACTIVE_Y) / 2)
    x1 = w - x0
    y1 = h - y0
    cv2.rectangle(frame, (x0, y0), (x1, y1), (90, 200, 255), 1)

    # Status pill
    cv2.rectangle(frame, (0, 0), (w, 44), (20, 20, 20), -1)
    cv2.putText(frame, status, (12, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 120), 2)

    # Pinch strength bar
    if pinch_ratio is not None:
        bar_x, bar_y, bar_w, bar_h = w - 160, 12, 140, 20
        cv2.rectangle(frame, (bar_x, bar_y), (bar_x + bar_w, bar_y + bar_h), (80, 80, 80), 1)
        fill = int(bar_w * min(1.0, max(0.0, 1 - pinch_ratio / 1.2)))
        color = (0, 255, 0) if pinch_ratio < PINCH_ON else (0, 180, 255)
        cv2.rectangle(frame, (bar_x, bar_y), (bar_x + fill, bar_y + bar_h), color, -1)
        cv2.putText(frame, "pinch", (bar_x - 50, bar_y + 15),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

    # Info text
    for i, line in enumerate(info_lines):
        cv2.putText(frame, line, (12, 64 + i * 18),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)


def main():
    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAM_W)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAM_H)
    cap.set(cv2.CAP_PROP_FPS, 60)

    if not cap.isOpened():
        raise RuntimeError("Could not open webcam. Grant camera permission to your terminal.")

    hands = mp_hands.Hands(
        model_complexity=1,
        max_num_hands=1,
        min_detection_confidence=0.7,
        min_tracking_confidence=0.6,
    )

    fx = OneEuroFilter(ONE_EURO_MIN_CUTOFF, ONE_EURO_BETA, ONE_EURO_D_CUTOFF)
    fy = OneEuroFilter(ONE_EURO_MIN_CUTOFF, ONE_EURO_BETA, ONE_EURO_D_CUTOFF)
    gs = GestureState()

    print(f"Screen: {SCREEN_W}x{SCREEN_H}  |  Camera: {CAM_W}x{CAM_H}")
    print("Keys: q=quit  r=reset filters")

    last_t = time.time()
    fps_ema = 0.0

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                continue
            frame = cv2.flip(frame, 1)
            h, w = frame.shape[:2]
            now = time.time()
            dt = now - last_t
            last_t = now
            if dt > 0:
                fps_ema = 0.9 * fps_ema + 0.1 * (1.0 / dt) if fps_ema else (1.0 / dt)

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            rgb.flags.writeable = False
            result = hands.process(rgb)

            status = "NO HAND"
            info = []
            pinch_ratio = None

            if result.multi_hand_landmarks:
                hand = result.multi_hand_landmarks[0]
                lm = hand.landmark

                mp_draw.draw_landmarks(
                    frame, hand, mp_hands.HAND_CONNECTIONS,
                    mp_styles.get_default_hand_landmarks_style(),
                    mp_styles.get_default_hand_connections_style(),
                )

                hs = hand_size(lm)
                ext = {f: finger_extended(lm, f) for f in TIP}
                pinch_ratio = _dist(lm[TIP["thumb"]], lm[TIP["index"]]) / hs
                pinch_mid_ratio = _dist(lm[TIP["thumb"]], lm[TIP["middle"]]) / hs

                index_only = ext["index"] and not ext["middle"] and not ext["ring"] and not ext["pinky"]
                two_up = ext["index"] and ext["middle"] and not ext["ring"] and not ext["pinky"]
                fist = not any(ext[f] for f in ("index", "middle", "ring", "pinky"))

                # Decide a candidate gesture.
                candidate = "idle"
                if fist:
                    candidate = "freeze"
                elif two_up:
                    candidate = "scroll"
                elif pinch_mid_ratio < PINCH_ON and ext["middle"]:
                    candidate = "right_click"
                elif pinch_ratio < PINCH_ON:
                    candidate = "pinch"
                elif index_only:
                    candidate = "move"

                gesture = gs.observe(candidate)

                # Always drive the cursor from the index tip when hand is visible,
                # but freeze/clear filters for stable states.
                idx = lm[TIP["index"]]
                tx, ty = map_to_screen(idx.x, idx.y)
                sx = fx(tx, now)
                sy = fy(ty, now)

                if gesture == "freeze":
                    status = "FREEZE (fist)"
                    if gs.is_dragging:
                        pyautogui.mouseUp(button="left")
                        gs.is_dragging = False
                    gs.scroll_anchor_y = None
                    gs.pinch_index_down = False

                elif gesture == "scroll":
                    status = "SCROLL"
                    cur_y = idx.y
                    if gs.scroll_anchor_y is None:
                        gs.scroll_anchor_y = cur_y
                    else:
                        dy = gs.scroll_anchor_y - cur_y
                        if abs(dy) > SCROLL_DEADZONE:
                            pyautogui.scroll(int(dy * SCROLL_GAIN))
                            gs.scroll_anchor_y = cur_y

                elif gesture == "right_click":
                    status = "RIGHT CLICK"
                    if now - gs.last_click_t > CLICK_COOLDOWN:
                        pyautogui.click(button="right")
                        gs.last_click_t = now

                elif gesture == "pinch":
                    # Start pinch: record time. Hold -> drag. Release quick -> click.
                    if not gs.pinch_index_down:
                        gs.pinch_index_down = True
                        gs.pinch_index_t0 = now
                        status = "PINCH"
                    else:
                        held = now - gs.pinch_index_t0
                        if held >= DRAG_HOLD_SECONDS and not gs.is_dragging:
                            pyautogui.mouseDown(button="left")
                            gs.is_dragging = True
                        status = "DRAG" if gs.is_dragging else f"PINCH ({held*1000:.0f}ms)"
                    # cursor keeps moving even while pinched (so you can drag)
                    pyautogui.moveTo(sx, sy)
                    gs.scroll_anchor_y = None

                else:
                    # Not pinching this frame — if we were pinched, decide click vs drag end.
                    if gs.pinch_index_down and pinch_ratio > PINCH_OFF:
                        held = now - gs.pinch_index_t0
                        if gs.is_dragging:
                            pyautogui.mouseUp(button="left")
                            gs.is_dragging = False
                        elif held < DRAG_HOLD_SECONDS and now - gs.last_click_t > CLICK_COOLDOWN:
                            pyautogui.click(button="left")
                            gs.last_click_t = now
                        gs.pinch_index_down = False

                    if gesture == "move":
                        status = "MOVE"
                        pyautogui.moveTo(sx, sy)
                        gs.scroll_anchor_y = None
                    else:
                        status = f"idle ({candidate})"
                        gs.scroll_anchor_y = None

                info.append(
                    f"fingers: " + "".join(
                        f.upper()[0] if ext[f] else f.lower()[0]
                        for f in ("thumb", "index", "middle", "ring", "pinky")
                    )
                )
                info.append(f"pinch(i)={pinch_ratio:.2f}  pinch(m)={pinch_mid_ratio:.2f}  hand={hs:.2f}")
            else:
                # No hand: reset dragging and filters so we don't carry stale state.
                if gs.is_dragging:
                    pyautogui.mouseUp(button="left")
                    gs.is_dragging = False
                gs.pinch_index_down = False
                gs.scroll_anchor_y = None
                fx.reset()
                fy.reset()

            info.append(f"fps: {fps_ema:4.1f}")
            draw_ui(frame, status, info, pinch_ratio=pinch_ratio)

            cv2.imshow("Gesture Mouse  (q=quit, r=reset)", frame)
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == ord("r"):
                fx.reset()
                fy.reset()
                gs = GestureState()

    finally:
        if gs.is_dragging:
            pyautogui.mouseUp(button="left")
        cap.release()
        cv2.destroyAllWindows()
        hands.close()


if __name__ == "__main__":
    main()
