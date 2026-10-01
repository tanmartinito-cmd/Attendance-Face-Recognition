import { useCallback, useRef } from 'react';

const DETECT_CANVAS_W = 256;
// Self-hosted (frontend/public/vendor/face-api/<version>/, MIT): no third-party script origin is
// needed, so the Content-Security-Policy only allows our own scripts. Loaded on demand.
const FACE_API_BASE = '/vendor/face-api/1.7.14/';
const FACE_API_SCRIPT = `${FACE_API_BASE}face-api.js`;
const FACE_MODEL_URI = `${FACE_API_BASE}model/`;

export default function useFaceDetection() {
  const nativeDetectorRef = useRef(null);
  const faceApiReadyRef = useRef(false);
  const loadingRef = useRef(false);
  const detectCanvasRef = useRef(null);
  const detectContextRef = useRef(null);

  const loadScript = useCallback((src) => new Promise((resolve) => {
    if (window.faceapi || document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = resolve;
    document.head.appendChild(script);
  }), []);

  const initLocalFaceDetector = useCallback(async () => {
    if (nativeDetectorRef.current || faceApiReadyRef.current) return true;
    if (loadingRef.current) return false;
    loadingRef.current = true;
    if ('FaceDetector' in window) {
      try {
        nativeDetectorRef.current = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 5 });
        loadingRef.current = false;
        return true;
      } catch (error) { console.debug('Native FaceDetector init error:', error); }
    }
    try {
      await loadScript(FACE_API_SCRIPT);
      if (window.faceapi && !faceApiReadyRef.current) {
        await window.faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URI);
        faceApiReadyRef.current = true;
      }
    } catch (error) { console.debug('face-api init error:', error); }
    loadingRef.current = false;
    return Boolean(nativeDetectorRef.current || faceApiReadyRef.current);
  }, [loadScript]);

  const detectLocalFace = useCallback(async (video) => {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;
    if (nativeDetectorRef.current) {
      try {
        const faces = await nativeDetectorRef.current.detect(video);
        if (faces?.length) { const box = faces[0].boundingBox; return { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height }; }
      } catch { /* face-api fallback */ }
    }
    if (faceApiReadyRef.current && window.faceapi) {
      try {
        if (!detectCanvasRef.current) { detectCanvasRef.current = document.createElement('canvas'); detectContextRef.current = detectCanvasRef.current.getContext('2d', { willReadFrequently: true }); }
        const detectHeight = Math.round((DETECT_CANVAS_W * height) / width);
        detectCanvasRef.current.width = DETECT_CANVAS_W;
        detectCanvasRef.current.height = detectHeight;
        detectContextRef.current.drawImage(video, 0, 0, DETECT_CANVAS_W, detectHeight);
        const detection = await window.faceapi.detectSingleFace(detectCanvasRef.current, new window.faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.28 }));
        if (detection) { const scaleX = width / DETECT_CANVAS_W; const scaleY = height / detectHeight; const box = detection.box; return { left: box.x * scaleX, top: box.y * scaleY, right: (box.x + box.width) * scaleX, bottom: (box.y + box.height) * scaleY }; }
      } catch { /* no local face */ }
    }
    return null;
  }, []);

  /** Every face in view as boxes in video pixels (used by enrollment to find the one in the oval). */
  const detectLocalFaces = useCallback(async (video) => {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return [];
    if (nativeDetectorRef.current) {
      try {
        const faces = await nativeDetectorRef.current.detect(video);
        return (faces || []).map(({ boundingBox: b }) => ({ left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height }));
      } catch { /* face-api fallback */ }
    }
    if (faceApiReadyRef.current && window.faceapi) {
      try {
        if (!detectCanvasRef.current) { detectCanvasRef.current = document.createElement('canvas'); detectContextRef.current = detectCanvasRef.current.getContext('2d', { willReadFrequently: true }); }
        const detectHeight = Math.round((DETECT_CANVAS_W * height) / width);
        detectCanvasRef.current.width = DETECT_CANVAS_W;
        detectCanvasRef.current.height = detectHeight;
        detectContextRef.current.drawImage(video, 0, 0, DETECT_CANVAS_W, detectHeight);
        const detections = await window.faceapi.detectAllFaces(detectCanvasRef.current, new window.faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 }));
        const scaleX = width / DETECT_CANVAS_W; const scaleY = height / detectHeight;
        return (detections || []).map(({ box }) => ({ left: box.x * scaleX, top: box.y * scaleY, right: (box.x + box.width) * scaleX, bottom: (box.y + box.height) * scaleY }));
      } catch { /* no local face */ }
    }
    return [];
  }, []);

  return { initLocalFaceDetector, detectLocalFace, detectLocalFaces };
}
