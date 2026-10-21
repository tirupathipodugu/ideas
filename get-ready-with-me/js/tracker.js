// Tracking: MediaPipe Tasks Vision, loaded from vendor/ (wasm and models ship with the page, no CDN).
// The face landmarker anchors glasses, caps, hats and earrings; the hand landmarker anchors watches and bracelets.
// Each is created on first need, on the GPU when the browser allows it, else on the CPU.

const BASE = new URL('../vendor/mediapipe/', import.meta.url).href;
const FILESET = {
  wasmLoaderPath: BASE + 'wasm/vision_wasm_internal.js',
  wasmBinaryPath: BASE + 'wasm/vision_wasm_internal.wasm',
};

let vision = null;
const tasks = {};

async function create(name) {
  vision ??= await import('../vendor/mediapipe/vision_bundle.js');
  const make = (delegate) => name === 'face'
    ? vision.FaceLandmarker.createFromOptions(FILESET, {
      baseOptions: { modelAssetPath: BASE + 'face_landmarker.task', delegate },
      runningMode: 'VIDEO', numFaces: 1,
      minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    })
    : name === 'pose'
    ? vision.PoseLandmarker.createFromOptions(FILESET, {   // forearm (elbow->wrist) for watches
      baseOptions: { modelAssetPath: BASE + 'pose_landmarker.task', delegate },
      runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    })
    : vision.HandLandmarker.createFromOptions(FILESET, {
      baseOptions: { modelAssetPath: BASE + 'hand_landmarker.task', delegate },
      runningMode: 'VIDEO', numHands: 1,
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
  try {
    return await make('GPU');
  } catch {
    return make('CPU');
  }
}

/** Get (and lazily create) the 'face' or 'hand' tracker. */
export function tracker(name) {
  tasks[name] ??= create(name);
  return tasks[name];
}

let lastTs = 0;
/** Landmarks for one frame: array of {x, y, z} normalised to the source, or null. */
export function detect(task, name, source) {
  const ts = Math.max(performance.now(), lastTs + 1);   // VIDEO mode needs strictly increasing timestamps
  lastTs = ts;
  const result = task.detectForVideo(source, ts);
  if (name === 'face') return result.faceLandmarks?.[0] || null;
  return result.landmarks?.[0] || null;
}
