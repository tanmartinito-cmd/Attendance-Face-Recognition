/** Grab one JPEG frame from the video element (used by the hands-free face capture). */
let sharedCanvas = null; // reused so repeated grabs don't allocate a new canvas each time

export function grabFrame(video, canvas, quality = 0.85) {
  if (!canvas && !sharedCanvas) sharedCanvas = document.createElement('canvas');
  const target = canvas || sharedCanvas;
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  // Resizing a canvas clears and reallocates it; only do it when the size changes.
  if (target.width !== width) target.width = width;
  if (target.height !== height) target.height = height;
  target.getContext('2d').drawImage(video, 0, 0, width, height);
  return target.toDataURL('image/jpeg', quality);
}

/**
 * Open the front camera into a <video>. Only a failure to get the camera itself counts
 * as an error: video.play() is often "interrupted" (autoplay/re-render) even though the
 * stream is live, and that must not show "Could not access camera".
 * Returns the MediaStream; throws only when the camera cannot be opened.
 */
export async function openCameraInto(video, previousStream, constraints = { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }) {
  previousStream?.getTracks().forEach((track) => track.stop());
  const stream = await navigator.mediaDevices.getUserMedia({ video: constraints });
  if (video) {
    video.srcObject = stream;
    try { await video.play(); } catch { /* autoplay attribute keeps it playing */ }
  }
  return stream;
}

/** Friendly reason for a camera failure (permission vs. missing/busy camera). */
export function cameraErrorMessage(error) {
  const name = error?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission was blocked. Allow camera access in your browser and try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and try again.';
  return 'Could not start the camera. Please try again.';
}
