// Camera: opens the front or back camera into a hidden <video> and reports each new frame.
// The stream stays inside this page; nothing is sent anywhere.

/** Friendly words for each way opening the camera can fail. Keys are returned by cameraProblem(). */
export const PROBLEMS = {
  blocked: "Camera is blocked. Allow it in your browser's address bar, then try again.",
  missing: 'No camera found. Connect one and try again, or continue without one.',
  busy: 'Your camera is busy in another app. Close it there, then try again.',
  insecure: 'The camera only works on a secure (https) page. Open the https link and try again.',
  webgl: "This browser can't run WebGL2, which the bubbles need. Try a recent Chrome, Safari or Firefox.",
};

/** Map a getUserMedia failure to one of the PROBLEMS keys. */
export function cameraProblem(error) {
  switch (error && error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'blocked';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'missing';
    case 'NotReadableError':
    case 'AbortError':
      return 'busy';
    case 'InsecureContext':
      return 'insecure';
    default:
      return 'missing';
  }
}

/**
 * Start the camera. Resolves to a frame source: { element, width, height, takeFrame(), stop() }.
 * takeFrame() is true once per new video frame, so the caller uploads each frame exactly once.
 */
export async function openCamera(video, facing = 'user') {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('Camera needs https'), { name: 'InsecureContext' });
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  let fresh = true;
  let stopped = false;
  const watch = () => {
    if (stopped) return;
    fresh = true;
    video.requestVideoFrameCallback(watch);
  };
  const hasFrameCallback = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  if (hasFrameCallback) video.requestVideoFrameCallback(watch);

  return {
    element: video,
    get width() { return video.videoWidth; },
    get height() { return video.videoHeight; },
    takeFrame() {
      if (!hasFrameCallback) return video.readyState >= 2;
      const was = fresh;
      fresh = false;
      return was;
    },
    stop() {
      stopped = true;
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    },
  };
}
