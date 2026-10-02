import { useCallback, useEffect } from 'react';

const COLORS = { scanning: '#ffffff', verifying: '#10b981', verified: '#10b981', error: '#ef4444' };

export default function useFaceOverlay({ videoRef, overlayCanvasRef, isCameraActive, detectLocalFace, faceBoxTargetRef, faceBoxSmoothRef, lastFaceSeenRef, overlayStateRef, overlayLabelRef, localFaceRef, isLocalDetectorReady, mirrorRef }) {
  const normalizeBox = useCallback((box) => {
    if (!box) return null;
    if (box.left !== undefined) return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    if (box.x !== undefined) return { left: box.x, top: box.y, right: box.x + box.w, bottom: box.y + box.h };
    return null;
  }, []);

  const mapBoxToDisplay = useCallback((box, videoWidth, videoHeight, canvasWidth, canvasHeight) => {
    const videoAspect = videoWidth / videoHeight;
    const canvasAspect = canvasWidth / canvasHeight;
    const scale = videoAspect > canvasAspect ? canvasHeight / videoHeight : canvasWidth / videoWidth;
    const offsetX = videoAspect > canvasAspect ? (canvasWidth - videoWidth * scale) / 2 : 0;
    const offsetY = videoAspect > canvasAspect ? 0 : (canvasHeight - videoHeight * scale) / 2;
    const left = box.left * scale + offsetX;
    const right = box.right * scale + offsetX;
    const mirrored = mirrorRef ? mirrorRef.current !== false : true; // front camera view is flipped
    return { left: mirrored ? canvasWidth - right : left, top: box.top * scale + offsetY, width: Math.max(30, right - left), height: Math.max(30, (box.bottom - box.top) * scale) };
  }, [mirrorRef]);

  const drawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !faceBoxSmoothRef.current) return;
    const context = canvas.getContext('2d');
    const videoWidth = video.videoWidth || 640;
    const videoHeight = video.videoHeight || 480;
    const canvasWidth = canvas.parentElement?.clientWidth || videoWidth;
    const canvasHeight = canvas.parentElement?.clientHeight || videoHeight;
    if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) { canvas.width = canvasWidth; canvas.height = canvasHeight; }
    context.clearRect(0, 0, canvasWidth, canvasHeight);
    const box = mapBoxToDisplay(faceBoxSmoothRef.current, videoWidth, videoHeight, canvasWidth, canvasHeight);
    const state = overlayStateRef.current;
    const color = state === 'verified' || state === 'verifying' ? COLORS.verified : state === 'error' ? COLORS.error : COLORS.scanning;
    context.save(); context.strokeStyle = color; context.lineWidth = 2.5; context.strokeRect(box.left, box.top, box.width, box.height); context.lineWidth = 3.5; context.lineCap = 'round';
    const length = Math.min(20, Math.min(box.width, box.height) / 4);
    [[box.left, box.top, length, 1], [box.left + box.width, box.top, length, -1], [box.left, box.top + box.height, length, 1], [box.left + box.width, box.top + box.height, length, -1]].forEach(([x, y, size, direction], index) => { context.beginPath(); context.moveTo(x, y + (index < 2 ? size : -size)); context.lineTo(x, y); context.lineTo(x + size * direction, y); context.stroke(); });
    context.restore();
    const label = overlayLabelRef.current;
    if (label && !label.toLowerCase().includes('scanning')) { context.font = '600 11px Inter, system-ui, sans-serif'; const width = context.measureText(label).width + 16; const x = Math.max(6, Math.min(box.left + (box.width - width) / 2, canvasWidth - width - 6)); const y = box.top > 30 ? box.top - 27 : box.top + box.height + 6; context.fillStyle = state === 'error' ? 'rgba(127,29,29,.94)' : state === 'verified' || state === 'verifying' ? 'rgba(6,78,59,.94)' : 'rgba(15,23,42,.88)'; context.fillRect(x, y, width, 21); context.fillStyle = '#fff'; context.textBaseline = 'middle'; context.fillText(label, x + 8, y + 10.5); }
  }, [mapBoxToDisplay, overlayCanvasRef, overlayLabelRef, overlayStateRef, faceBoxSmoothRef, videoRef]);

  useEffect(() => {
    let active = true;
    const renderLoop = async () => {
      if (!active) return;
      const video = videoRef.current;
      if (isCameraActive && video?.readyState >= 2) {
        const localBox = await detectLocalFace(video).catch(() => null);
        if (localFaceRef) localFaceRef.current = { box: localBox, at: Date.now(), width: video.videoWidth, height: video.videoHeight, ready: Boolean(isLocalDetectorReady?.()) };
        if (localBox && active) { faceBoxTargetRef.current = localBox; lastFaceSeenRef.current = Date.now(); }
        if (faceBoxTargetRef.current && faceBoxSmoothRef.current) { const target = faceBoxTargetRef.current; const current = faceBoxSmoothRef.current; faceBoxSmoothRef.current = { left: current.left + (target.left - current.left) * .45, top: current.top + (target.top - current.top) * .45, right: current.right + (target.right - current.right) * .45, bottom: current.bottom + (target.bottom - current.bottom) * .45 }; } else if (faceBoxTargetRef.current) faceBoxSmoothRef.current = { ...faceBoxTargetRef.current }; else if (Date.now() - lastFaceSeenRef.current > 1200) faceBoxSmoothRef.current = null;
        drawOverlay();
      }
      requestAnimationFrame(renderLoop);
    };
    if (isCameraActive) requestAnimationFrame(renderLoop);
    return () => { active = false; };
  }, [detectLocalFace, drawOverlay, faceBoxSmoothRef, faceBoxTargetRef, isCameraActive, isLocalDetectorReady, lastFaceSeenRef, localFaceRef, videoRef]);

  return { normalizeBox, mapBoxToDisplay, drawOverlay };
}
