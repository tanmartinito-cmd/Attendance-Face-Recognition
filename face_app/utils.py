"""
Face recognition utility functions.
Uses OpenCV LBPH face recognizer (opencv-contrib-python).
This approach requires NO dlib, NO CMake, and NO C++ compilation.
Falls back gracefully if opencv-contrib is not available.
"""
import os
import base64
import binascii
import logging
import threading
import numpy as np
from io import BytesIO
from django.conf import settings
from PIL import Image

logger = logging.getLogger(__name__)

# ── Library detection ─────────────────────────────────────────────────────────

try:
    import cv2
    OPENCV_AVAILABLE = True
except ImportError:
    cv2 = None
    OPENCV_AVAILABLE = False
    logger.warning("OpenCV not available.")

# Check for LBPH face recognizer (requires opencv-contrib-python)
try:
    import cv2
    _test = cv2.face.LBPHFaceRecognizer_create()
    LBPH_AVAILABLE = True
    logger.info("OpenCV LBPH face recognizer available.")
except (AttributeError, cv2.error if cv2 else Exception):
    LBPH_AVAILABLE = False
    logger.warning("LBPH not available. Install opencv-contrib-python.")

# Also check for the dlib-based face_recognition library (optional bonus)
try:
    import face_recognition as fr
    FACE_RECOGNITION_AVAILABLE = True
    logger.info("face_recognition (dlib) library loaded – using high accuracy mode.")
except ImportError:
    FACE_RECOGNITION_AVAILABLE = False
    fr = None

try:
    import dlib
    DLIB_AVAILABLE = True
except ImportError:
    dlib = None
    DLIB_AVAILABLE = False

# Determine overall capability
FR_AVAILABLE = FACE_RECOGNITION_AVAILABLE or LBPH_AVAILABLE

# ── Haar Cascade setup ────────────────────────────────────────────────────────

FACE_CASCADE = None
FACE_CASCADE_ALT = None
if OPENCV_AVAILABLE:
    _data_dir = os.path.join(os.path.dirname(__file__), 'data')
    _local_default = os.path.join(_data_dir, 'haarcascade_frontalface_default.xml')
    _local_alt = os.path.join(_data_dir, 'haarcascade_frontalface_alt2.xml')

    if os.path.exists(_local_default):
        FACE_CASCADE = cv2.CascadeClassifier(_local_default)
    if os.path.exists(_local_alt):
        FACE_CASCADE_ALT = cv2.CascadeClassifier(_local_alt)

    # OpenCV default fallback path
    if (FACE_CASCADE is None or FACE_CASCADE.empty()) and hasattr(cv2, 'data') and cv2.data:
        _cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        if os.path.exists(_cascade_path):
            FACE_CASCADE = cv2.CascadeClassifier(_cascade_path)


def _decode_image_to_rgb(data: bytes) -> np.ndarray:
    """Convert raw image bytes to an RGB numpy array."""
    img = Image.open(BytesIO(data)).convert('RGB')
    return np.array(img)


def _to_gray(rgb_np: np.ndarray) -> np.ndarray:
    """Convert RGB numpy array to grayscale."""
    return cv2.cvtColor(rgb_np, cv2.COLOR_RGB2GRAY)


def _detect_faces_cv(gray_np: np.ndarray):
    """Detect faces using Haar cascade with CLAHE/equalization. Returns list of (x, y, w, h)."""
    if not OPENCV_AVAILABLE:
        h, w = gray_np.shape[:2]
        return [(int(w * 0.1), int(h * 0.1), int(w * 0.8), int(h * 0.8))]

    gray_eq = cv2.equalizeHist(gray_np)
    faces = ()
    if FACE_CASCADE and not FACE_CASCADE.empty():
        faces = FACE_CASCADE.detectMultiScale(
            gray_eq,
            scaleFactor=1.1,
            minNeighbors=4,
            minSize=(50, 50),
        )
    if (len(faces) == 0) and FACE_CASCADE_ALT and not FACE_CASCADE_ALT.empty():
        faces = FACE_CASCADE_ALT.detectMultiScale(
            gray_eq,
            scaleFactor=1.1,
            minNeighbors=4,
            minSize=(50, 50),
        )

    return list(faces) if len(faces) > 0 else []


# ── Public API: Encoding ──────────────────────────────────────────────────────

def encode_face_from_image(image_data: bytes):
    """
    Encode a face from raw image bytes.
    Returns a list of floats (the face encoding) or None if no face found.

    Uses face_recognition (dlib) if available, else LBPH histogram encoding.
    """
    if FACE_RECOGNITION_AVAILABLE:
        try:
            img_np = _decode_image_to_rgb(image_data)
            encodings = fr.face_encodings(img_np)
            return encodings[0].tolist() if encodings else None
        except Exception as e:
            logger.error(f"face_recognition encode error: {e}")
            return None

    if LBPH_AVAILABLE:
        return _lbph_encode(image_data)

    logger.error("No face recognition library available.")
    return None


def encode_face_from_path(image_path: str):
    """Encode face from a file path."""
    try:
        with open(image_path, 'rb') as f:
            return encode_face_from_image(f.read())
    except Exception as e:
        logger.error(f"encode_face_from_path error: {e}")
        return None


def detect_and_encode_all_faces(frame_bytes: bytes, downscale: float = 0.5, fast: bool = False, img_rgb=None,
                                primary_only: bool = False, stats: dict = None):
    """
    Lightning-fast multi-face detection and encoding.
    Downscales the frame for rapid face localization (omni-directional, catches off-center faces),
    then extracts 128-D encodings for ALL detected faces.
    When fast=True (live attendance), skips slow enhancement fallbacks for lower latency.
    img_rgb: the already-decoded frame (skips a second JPEG decode).
    primary_only (live attendance): keep ONLY the largest, most centred face and do NOT
    encode it ('encoding' is None); the caller runs the cheap quality gate first and encodes
    afterwards. People in the background are never encoded or matched.
    stats: optional dict that receives {'face_count': faces found before selection}.
    Returns list of dicts: [{'encoding': list_of_floats, 'box': {'top', 'right', 'bottom', 'left'}}, ...]
    """
    results = []
    try:
        img_np = img_rgb if img_rgb is not None else _decode_image_to_rgb(frame_bytes)
        h, w = img_np.shape[:2]

        if FACE_RECOGNITION_AVAILABLE:
            # Fast downscaled localization first (fast path)
            scale_factor = 1.0
            small_locations = []
            if downscale < 1.0 and (w > 320 or h > 240):
                small_w = max(1, int(w * downscale))
                small_h = max(1, int(h * downscale))
                small_img = cv2.resize(img_np, (small_w, small_h)) if OPENCV_AVAILABLE else img_np
                scale_factor = 1.0 / downscale if OPENCV_AVAILABLE else 1.0
                small_locations = fr.face_locations(small_img, model='hog')

            # Fallback 1: If downscaled detection found no faces, run on original full image
            if not small_locations:
                small_locations = fr.face_locations(img_np, number_of_times_to_upsample=0, model='hog')
                scale_factor = 1.0

            # Fallback 2: Upsample by 1 to detect smaller or distant faces
            if not small_locations and not fast:
                small_locations = fr.face_locations(img_np, number_of_times_to_upsample=1, model='hog')
                scale_factor = 1.0

            # Fallback 3: For backlit scenes (e.g. bright window behind student), enhance contrast using CLAHE
            enhanced_frame = None
            if not fast and not small_locations and OPENCV_AVAILABLE:
                try:
                    lab = cv2.cvtColor(img_np, cv2.COLOR_RGB2LAB)
                    l, a, b = cv2.split(lab)
                    clahe = cv2.createCLAHE(clipLimit=3.5, tileGridSize=(8, 8))
                    cl = clahe.apply(l)
                    enhanced_frame = cv2.cvtColor(cv2.merge((cl, a, b)), cv2.COLOR_LAB2RGB)
                    small_locations = fr.face_locations(enhanced_frame, number_of_times_to_upsample=0, model='hog')
                    if not small_locations:
                        small_locations = fr.face_locations(enhanced_frame, number_of_times_to_upsample=1, model='hog')
                    scale_factor = 1.0
                except Exception:
                    pass

            # Fallback 4: Gamma correction (brightens underexposed faces in backlit conditions)
            if not fast and not small_locations and OPENCV_AVAILABLE:
                try:
                    table = np.array([((i / 255.0) ** 0.55) * 255 for i in range(256)]).astype("uint8")
                    gamma_img = cv2.LUT(img_np, table)
                    small_locations = fr.face_locations(gamma_img, number_of_times_to_upsample=0, model='hog')
                    if not small_locations:
                        small_locations = fr.face_locations(gamma_img, number_of_times_to_upsample=1, model='hog')
                    scale_factor = 1.0
                except Exception:
                    pass

            # Fallback 5: dlib frontal face detector with lowered confidence threshold (-0.4)
            if not fast and not small_locations and DLIB_AVAILABLE and dlib is not None:
                try:
                    dlib_det = dlib.get_frontal_face_detector()
                    dets, _, _ = dlib_det.run(img_np, 1, -0.4)
                    if dets:
                        small_locations = [(d.top(), d.right(), d.bottom(), d.left()) for d in dets]
                        scale_factor = 1.0
                except Exception:
                    pass

            # Fallback 6: OpenCV Haar Cascade detector
            if not fast and not small_locations and OPENCV_AVAILABLE:
                try:
                    gray = _to_gray(img_np)
                    haar_faces = _detect_faces_cv(gray)
                    if len(haar_faces) > 0:
                        small_locations = [(y, x + fw, y + fh, x) for (x, y, fw, fh) in haar_faces]
                        scale_factor = 1.0
                except Exception:
                    pass

            # Upscale locations back to original resolution
            upscaled_locations = []
            for (t, r, b, l) in small_locations:
                upscaled_locations.append((
                    max(0, int(t * scale_factor)),
                    min(w, int(r * scale_factor)),
                    min(h, int(b * scale_factor)),
                    max(0, int(l * scale_factor))
                ))

            if stats is not None:
                stats['face_count'] = len(upscaled_locations)
            if primary_only:
                faces = [{'encoding': None, 'box': _box_dict(loc)} for loc in upscaled_locations]
                return pick_primary_face(faces, w, h)

            if upscaled_locations:
                try:
                    encodings = fr.face_encodings(img_np, upscaled_locations)
                except Exception:
                    encodings = []

                if (not encodings or len(encodings) < len(upscaled_locations)) and enhanced_frame is not None:
                    try:
                        enhanced_encodings = fr.face_encodings(enhanced_frame, upscaled_locations)
                        if enhanced_encodings:
                            encodings = enhanced_encodings
                    except Exception:
                        pass

                for enc, (top, right, bottom, left) in zip(encodings, upscaled_locations):
                    results.append({
                        'encoding': enc.tolist(),
                        'box': {'top': top, 'right': right, 'bottom': bottom, 'left': left}
                    })
            if results:
                return results

        if LBPH_AVAILABLE:
            gray = _to_gray(img_np)
            faces = _detect_faces_cv(gray)
            for (x, y, fw, fh) in faces:
                face_gray = gray[y:y+fh, x:x+fw]
                if face_gray.size > 0:
                    face_resized = cv2.resize(face_gray, (128, 128))
                    lbp_hist = _compute_lbp_histogram(face_resized)
                    results.append({
                        'encoding': lbp_hist.tolist(),
                        'box': {'top': y, 'right': x+fw, 'bottom': y+fh, 'left': x}
                    })
            return results

    except Exception as e:
        logger.error(f"detect_and_encode_all_faces error: {e}")

    return results


def encode_face_from_frame(frame_bytes: bytes):
    """
    Backward-compatible single/multi-face frame encoder.
    Returns (first_encoding_or_None, list_of_face_location_dicts)
    """
    all_faces = detect_and_encode_all_faces(frame_bytes)
    if not all_faces:
        return None, []
    primary_encoding = all_faces[0]['encoding']
    face_locs = [f['box'] for f in all_faces]
    return primary_encoding, face_locs


def _lbph_encode(image_data: bytes):
    """
    Compute an LBPH-style face encoding (histogram over face ROI).
    Returns a flat float list or None.
    """
    try:
        img_np = _decode_image_to_rgb(image_data)
        gray = _to_gray(img_np)
        faces = _detect_faces_cv(gray)

        if len(faces) == 0:
            # Use entire frame center as fallback
            h, w = gray.shape
            face_gray = gray[int(h*0.1):int(h*0.9), int(w*0.1):int(w*0.9)]
        else:
            x, y, fw, fh = faces[0]
            face_gray = gray[y:y+fh, x:x+fw]

        # Resize to fixed size for consistent encoding
        face_resized = cv2.resize(face_gray, (128, 128))

        # Compute LBP histogram for a robust descriptor
        lbp_hist = _compute_lbp_histogram(face_resized)
        return lbp_hist.tolist()
    except Exception as e:
        logger.error(f"LBPH encode error: {e}")
        return None


def _compute_lbp_histogram(gray_face: np.ndarray, num_points: int = 8, radius: int = 1):
    """Compute Local Binary Pattern histogram over a face image."""
    h, w = gray_face.shape
    lbp = np.zeros((h, w), dtype=np.uint8)

    for i in range(num_points):
        angle = 2 * np.pi * i / num_points
        x_offset = int(round(radius * np.cos(angle)))
        y_offset = int(round(-radius * np.sin(angle)))

        shifted = np.roll(np.roll(gray_face, y_offset, axis=0), x_offset, axis=1)
        lbp += ((shifted >= gray_face).astype(np.uint8) << i)

    # Divide into a grid of cells and compute per-cell histograms
    grid = 8
    ch, cw = h // grid, w // grid
    histograms = []
    for row in range(grid):
        for col in range(grid):
            cell = lbp[row*ch:(row+1)*ch, col*cw:(col+1)*cw]
            hist, _ = np.histogram(cell, bins=256, range=(0, 256))
            hist = hist.astype(np.float32)
            norm = np.sum(hist)
            if norm > 0:
                hist /= norm
            histograms.append(hist)

    return np.concatenate(histograms)


def _detect_locations(frame_bytes: bytes):
    """Return face locations from a frame as list of dicts."""
    try:
        img_np = _decode_image_to_rgb(frame_bytes)
        gray = _to_gray(img_np)
        faces = _detect_faces_cv(gray)
        return [{'top': y, 'right': x+w, 'bottom': y+h, 'left': x}
                for (x, y, w, h) in faces]
    except Exception:
        return []


# ── Anti-Spoofing & Biometric Liveness Detection ──────────────────────────────

def check_face_liveness(img_rgb: np.ndarray, box: dict) -> tuple:
    """
    Evaluates whether a detected face ROI is a live human or a presentation attack
    (such as a printed paper photograph or smartphone LCD/OLED screen).

    Returns:
        (is_live: bool, confidence_score: float, details: str)
    """
    # Fail closed: if the check cannot run, the face is NOT accepted as live.
    if img_rgb is None or img_rgb.size == 0:
        return False, 0.0, "Liveness check failed: no image data"
    if not OPENCV_AVAILABLE:
        return False, 0.0, "Liveness check unavailable: OpenCV not installed"

    try:
        h, w = img_rgb.shape[:2]
        top = max(0, int(box.get('top', 0)))
        bottom = min(h, int(box.get('bottom', h)))
        left = max(0, int(box.get('left', 0)))
        right = min(w, int(box.get('right', w)))

        if (bottom - top) < 28 or (right - left) < 28:
            return False, 0.0, "Face region too small for reliable liveness check"

        face_roi = img_rgb[top:bottom, left:right]
        if face_roi.size == 0:
            return False, 0.0, "Invalid face region"

        # 1. Texture & Focus Analysis (Laplacian Variance)
        gray = cv2.cvtColor(face_roi, cv2.COLOR_RGB2GRAY)
        lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())

        # Printed paper photo or heavy out-of-focus blur typically has lap_var < 28
        if lap_var < 18.0:
            return False, round(lap_var, 2), "Flat or blurred image (possible printed paper photo)"

        # Extreme high-frequency screen pixel grid / moiré pattern
        if lap_var > 3500.0:
            return False, round(lap_var, 2), "Unnatural pixel raster texture (possible digital display)"

        # 2. Specular Screen Glare & Flash Reflection (HSV space)
        hsv = cv2.cvtColor(face_roi, cv2.COLOR_RGB2HSV)
        v_channel = hsv[:, :, 2]
        s_channel = hsv[:, :, 1]

        # Glass glare exhibits near-zero saturation and maximum brightness
        glare_mask = (v_channel > 248) & (s_channel < 25)
        glare_ratio = float(np.count_nonzero(glare_mask)) / float(face_roi.shape[0] * face_roi.shape[1])
        if glare_ratio > 0.18:
            return False, round(glare_ratio, 3), "Excessive specular glare (screen/glass reflection)"

        # 3. Chrominance Distribution (YCrCb space)
        # Real human skin exhibits natural dispersion in Cr/Cb channels
        ycrcb = cv2.cvtColor(face_roi, cv2.COLOR_RGB2YCrCb)
        cr_std = float(ycrcb[:, :, 1].std())
        cb_std = float(ycrcb[:, :, 2].std())

        if cr_std < 2.5 and cb_std < 2.5:
            return False, round(min(cr_std, cb_std), 2), "Uniform monochromatic surface (paper/monochrome spoof)"

        # 4. Passive deep-learning anti-spoofing (MiniFASNet): real skin vs print/screen texture.
        live_score = passive_liveness_score(img_rgb, box)
        if live_score is None:
            return False, 0.0, "Liveness model unavailable: please contact the administrator"
        threshold = getattr(settings, 'FACE_ANTISPOOF_THRESHOLD', 0.7)
        if live_score < threshold:
            return False, round(live_score, 3), "Photo or screen detected. Please use your real face"

        return True, round(live_score, 3), "Live human verified"
    except Exception as e:
        logger.warning(f"Liveness verification error (rejecting face): {e}")
        return False, 0.0, "Liveness check error: please try again"


# ── Passive anti-spoofing model (MiniFASNetV2, Apache-2.0, minivision-ai) ────
# Input: 80x80 BGR crop at 2.7x the face box, raw 0-255 floats (NOT /255).
# Output: 3 logits; class index 1 = live. Verified against the upstream real/fake samples.

_antispoof_net = None
_antispoof_failed = False
_antispoof_lock = threading.Lock()


def _get_antispoof_net():
    global _antispoof_net, _antispoof_failed
    if _antispoof_net is not None or _antispoof_failed or not OPENCV_AVAILABLE:
        return _antispoof_net
    with _antispoof_lock:
        if _antispoof_net is None and not _antispoof_failed:
            path = str(getattr(settings, 'FACE_ANTISPOOF_MODEL', ''))
            try:
                _antispoof_net = cv2.dnn.readNetFromONNX(path)
            except Exception as e:
                _antispoof_failed = True
                logger.error(f"Anti-spoof model could not be loaded from {path}: {e}")
    return _antispoof_net


def _antispoof_crop(img_bgr: np.ndarray, box: dict, scale: float = 2.7, size: int = 80):
    """Upstream crop: expand the face box by `scale` around its center, shift to stay in frame."""
    src_h, src_w = img_bgr.shape[:2]
    x, y = int(box['left']), int(box['top'])
    box_w, box_h = int(box['right']) - x, int(box['bottom']) - y
    if box_w <= 0 or box_h <= 0:
        return None
    scale = min((src_h - 1) / box_h, (src_w - 1) / box_w, scale)
    new_w, new_h = box_w * scale, box_h * scale
    cx, cy = x + box_w / 2, y + box_h / 2
    x1, y1, x2, y2 = cx - new_w / 2, cy - new_h / 2, cx + new_w / 2, cy + new_h / 2
    if x1 < 0:
        x2 -= x1; x1 = 0
    if y1 < 0:
        y2 -= y1; y1 = 0
    if x2 > src_w - 1:
        x1 -= x2 - src_w + 1; x2 = src_w - 1
    if y2 > src_h - 1:
        y1 -= y2 - src_h + 1; y2 = src_h - 1
    patch = img_bgr[int(y1):int(y2) + 1, int(x1):int(x2) + 1]
    if patch.size == 0:
        return None
    return cv2.resize(patch, (size, size))


def passive_liveness_score(img_rgb: np.ndarray, box: dict):
    """Probability (0-1) that the face is a live person, or None if the model cannot run."""
    net = _get_antispoof_net()
    if net is None or img_rgb is None:
        return None
    try:
        patch = _antispoof_crop(cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR), box)
        if patch is None:
            return None
        blob = patch.astype(np.float32).transpose(2, 0, 1)[None]
        with _antispoof_lock:  # cv2.dnn nets are not thread-safe
            net.setInput(blob)
            logits = net.forward()[0]
        probs = np.exp(logits - logits.max())
        probs /= probs.sum()
        return float(probs[1])
    except Exception as e:
        logger.warning(f"passive_liveness_score error: {e}")
        return None


# ── Head pose (landmarks) ─────────────────────────────────────────────────────

# Generic 3-D face model (mm-ish), camera convention: x right, y down, z away from camera.
# Order: nose tip (30), chin (8), image-left eye outer corner (36), image-right eye outer
# corner (45), image-left mouth corner (48), image-right mouth corner (54).
_POSE_MODEL_POINTS = np.array([
    (0.0, 0.0, 0.0),
    (0.0, 330.0, 65.0),
    (-225.0, -170.0, 135.0),
    (225.0, -170.0, 135.0),
    (-150.0, 150.0, 125.0),
    (150.0, 150.0, 125.0),
], dtype=np.float64)


def face_landmarks_68(img_rgb: np.ndarray, box: dict):
    """dlib 68-point landmarks for one face as face_recognition's named groups, or None."""
    if not FACE_RECOGNITION_AVAILABLE or img_rgb is None:
        return None
    try:
        location = (int(box['top']), int(box['right']), int(box['bottom']), int(box['left']))
        marks = fr.face_landmarks(img_rgb, face_locations=[location], model='large')
        return marks[0] if marks else None
    except Exception as e:
        logger.warning(f"face_landmarks_68 error: {e}")
        return None


def pose_image_points(marks: dict) -> np.ndarray:
    """The 6 landmarks used for head pose, in _POSE_MODEL_POINTS order."""
    return np.array([
        marks['nose_bridge'][3],   # 30 nose tip
        marks['chin'][8],          # 8  chin
        marks['left_eye'][0],      # 36
        marks['right_eye'][3],     # 45
        marks['top_lip'][0],       # 48
        marks['top_lip'][6],       # 54
    ], dtype=np.float64)


def _wrap_angle(deg: float) -> float:
    deg = (deg + 180.0) % 360.0 - 180.0
    if deg > 90.0:
        deg -= 180.0
    elif deg < -90.0:
        deg += 180.0
    return deg


def head_pose_degrees(marks: dict, frame_w: int, frame_h: int):
    """
    (yaw, pitch, roll) in degrees from the 6 key landmarks via cv2.solvePnP (Perspective-n-Point).
    0/0/0 = looking straight at the camera. Returns None if it cannot be solved.
    """
    if not OPENCV_AVAILABLE or not marks:
        return None
    try:
        image_points = pose_image_points(marks)
        focal = float(frame_w)
        camera = np.array([[focal, 0, frame_w / 2.0], [0, focal, frame_h / 2.0], [0, 0, 1]], dtype=np.float64)
        rvec = np.zeros((3, 1), dtype=np.float64)
        tvec = np.array([[0.0], [0.0], [1000.0]], dtype=np.float64)
        ok, rvec, tvec = cv2.solvePnP(
            _POSE_MODEL_POINTS, image_points, camera, np.zeros((4, 1)),
            rvec, tvec, useExtrinsicGuess=True, flags=cv2.SOLVEPNP_ITERATIVE,
        )
        if not ok:
            return None
        rotation, _ = cv2.Rodrigues(rvec)
        angles, *_ = cv2.RQDecomp3x3(rotation)
        pitch, yaw, roll = (_wrap_angle(float(a)) for a in angles)
        return round(yaw, 1), round(pitch, 1), round(roll, 1)
    except Exception as e:
        logger.warning(f"head_pose_degrees error: {e}")
        return None


def eye_aspect_ratio(eye) -> float:
    """EAR = (|p2-p6| + |p3-p5|) / (2|p1-p4|). ~0.25-0.35 open, <0.15 closed."""
    p = np.asarray(eye, dtype=np.float64)
    horizontal = np.linalg.norm(p[0] - p[3])
    if horizontal < 1e-6:
        return 0.0
    return float((np.linalg.norm(p[1] - p[5]) + np.linalg.norm(p[2] - p[4])) / (2.0 * horizontal))


def analyze_face(img_rgb: np.ndarray, box: dict) -> dict:
    """All geometry + image-quality measurements for one face (keys may be None)."""
    h, w = img_rgb.shape[:2]
    top, bottom = max(0, int(box['top'])), min(h, int(box['bottom']))
    left, right = max(0, int(box['left'])), min(w, int(box['right']))
    roi = img_rgb[top:bottom, left:right]
    result = {'landmarks': False, 'yaw': None, 'pitch': None, 'roll': None,
              'ear': None, 'eye_distance': None, 'brightness': None, 'sharpness': None}
    if roi.size:
        gray = np.dot(roi[..., :3], [0.299, 0.587, 0.114]).astype(np.float32)
        result['brightness'] = round(float(gray.mean()), 1)
        if OPENCV_AVAILABLE:
            result['sharpness'] = round(float(cv2.Laplacian(gray.astype(np.uint8), cv2.CV_64F).var()), 1)

    marks = face_landmarks_68(img_rgb, box)
    if not marks or not marks.get('left_eye') or not marks.get('right_eye'):
        return result
    result['landmarks'] = True
    left_c = np.mean(np.asarray(marks['left_eye'], dtype=np.float64), axis=0)
    right_c = np.mean(np.asarray(marks['right_eye'], dtype=np.float64), axis=0)
    result['eye_distance'] = round(float(np.linalg.norm(left_c - right_c)), 1)
    result['ear'] = round(min(eye_aspect_ratio(marks['left_eye']), eye_aspect_ratio(marks['right_eye'])), 3)
    pose = head_pose_degrees(marks, w, h)
    if pose:
        result['yaw'], result['pitch'], result['roll'] = pose
    return result


def check_face_quality(metrics: dict, profile: str = 'scan'):
    """
    (ok, reason) for measured face metrics. profile 'scan' (live attendance) or 'enroll'
    (stricter, the stored selfie). Thresholds: FACE_<PROFILE>_* settings.
    """
    p = 'FACE_ENROLL_' if profile == 'enroll' else 'FACE_SCAN_'
    enroll = profile == 'enroll'
    s = lambda name, default: getattr(settings, p + name, default)

    if not metrics.get('landmarks'):
        return False, 'Face the camera directly so your eyes and nose are visible.'
    eye_distance = metrics.get('eye_distance') or 0
    if eye_distance < s('MIN_EYE_DISTANCE', 45 if enroll else 28):
        return False, 'Move closer to the camera.'
    brightness = metrics.get('brightness')
    if brightness is not None and brightness < s('MIN_BRIGHTNESS', 50 if enroll else 40):
        return False, 'Too dark. Add light in front of the face.'
    if brightness is not None and brightness > s('MAX_BRIGHTNESS', 215 if enroll else 230):
        return False, 'Too bright. Avoid strong light on the face.'
    sharpness = metrics.get('sharpness')
    if sharpness is not None and sharpness < s('MIN_SHARPNESS', 40 if enroll else 25):
        return False, 'Face is blurry. Hold still.'
    if metrics.get('yaw') is None:
        return False, 'Look straight at the camera.'
    if abs(metrics['yaw']) > s('MAX_YAW', 12 if enroll else 20):
        return False, 'Look straight at the camera (face is turned sideways).'
    if abs(metrics.get('pitch') or 0) > s('MAX_PITCH', 20 if enroll else 25):
        return False, 'Look straight at the camera (head tilted up or down).'
    if abs(metrics.get('roll') or 0) > s('MAX_ROLL', 10 if enroll else 15):
        return False, 'Keep your head level.'
    if (metrics.get('ear') or 0) < s('MIN_EAR', 0.2 if enroll else 0.17):
        return False, 'Keep your eyes open.'
    return True, 'ok'


def assess_scan_quality(img_rgb: np.ndarray, box: dict):
    """Attendance frame gate: (ok, reason, metrics). Fails closed when the frame is missing."""
    if img_rgb is None:
        return False, 'Frame could not be read.', {}
    metrics = analyze_face(img_rgb, box)
    ok, reason = check_face_quality(metrics, 'scan')
    return ok, reason, metrics


# ── Enrollment: strict detection + quality gate ───────────────────────────────

class EnrollmentQualityError(ValueError):
    """An enrollment photo was rejected (no/multiple faces, blurry, dark, tiny, turned)."""


def _box_dict(location) -> dict:
    t, r, b, l = location
    return {'top': t, 'right': r, 'bottom': b, 'left': l}


def encode_enrollment_face(img_rgb: np.ndarray, box: dict) -> list:
    """
    128-D code of ONE face for enrollment.
    Jitter: dlib re-reads the face several times with tiny shifts/zooms and averages the
    code, so the stored identity is steadier against blur and light (enrollment only).
    This is the expensive step (~0.5 s per jitter on a small CPU), so it runs only for
    the chosen face and only after every cheap gate has passed.
    """
    jitters = max(1, int(getattr(settings, 'FACE_ENROLL_JITTERS', 4)))
    location = (int(box['top']), int(box['right']), int(box['bottom']), int(box['left']))
    encodings = fr.face_encodings(img_rgb, [location], num_jitters=jitters)
    if not len(encodings):
        raise EnrollmentQualityError('Face is not clear. Hold still and face the light.')
    return encodings[0].tolist()


def detect_and_encode_strict(frame_bytes: bytes, encode: bool = True):
    """
    Enrollment-grade detection: dlib HOG on the original image only (upsample 0, then 1).
    No contrast/gamma enhancement, no lowered-threshold dlib, no Haar cascade, no LBPH,
    so a poor or wrong crop is never stored. Returns (img_rgb, [{'encoding', 'box'}]).
    encode=False returns boxes only ('encoding' is None): used by the live check.
    """
    if not FACE_RECOGNITION_AVAILABLE:
        raise EnrollmentQualityError('Face engine (dlib) is not available on the server.')
    img = _decode_image_to_rgb(frame_bytes)
    locations = fr.face_locations(img, number_of_times_to_upsample=0, model='hog')
    if not locations:
        locations = fr.face_locations(img, number_of_times_to_upsample=1, model='hog')
    if not locations:
        return img, []
    if not encode:
        return img, [{'encoding': None, 'box': _box_dict(loc)} for loc in locations]
    jitters = max(1, int(getattr(settings, 'FACE_ENROLL_JITTERS', 4)))
    encodings = fr.face_encodings(img, locations, num_jitters=jitters)
    faces = [
        {'encoding': enc.tolist(), 'box': _box_dict(loc)}
        for enc, loc in zip(encodings, locations)
    ]
    return img, faces


def _box_center_width(box: dict):
    width = box['right'] - box['left']
    return (box['left'] + box['right']) / 2.0, (box['top'] + box['bottom']) / 2.0, width


def pick_enrollment_face(faces: list, img_w: int, img_h: int) -> dict:
    """
    The student is the face inside the on-screen oval (centre of the frame).
    People elsewhere in the picture (background, passing by) are ignored.
    Only a second face that is ALSO inside the oval zone and of similar size
    (someone right next to the student) rejects the frame.
    """
    zone = float(getattr(settings, 'FACE_ENROLL_OVAL_ZONE', 0.25))  # max centre offset, fraction of width
    similar = float(getattr(settings, 'FACE_ENROLL_SECOND_FACE_RATIO', 0.6))  # width ratio

    def in_oval(face):
        cx, cy, _w = _box_center_width(face['box'])
        return abs(cx - img_w / 2.0) <= zone * img_w and abs(cy - img_h / 2.0) <= 0.35 * img_h

    candidates = [f for f in faces if in_oval(f)]
    if not candidates:
        raise EnrollmentQualityError('Please center your face in the oval.')
    candidates.sort(key=lambda f: _box_center_width(f['box'])[2], reverse=True)
    main = candidates[0]
    main_width = _box_center_width(main['box'])[2]
    for other in candidates[1:]:
        if _box_center_width(other['box'])[2] >= similar * main_width:
            raise EnrollmentQualityError('Only the student should be inside the oval.')
    return main


def assess_face_quality(img_rgb: np.ndarray, box: dict):
    """Enrollment selfie gate (stricter than scanning): (ok, reason, metrics)."""
    metrics = analyze_face(img_rgb, box)
    ok, reason = check_face_quality(metrics, 'enroll')
    return ok, reason, metrics


def extract_enrollment_sample(frame_bytes: bytes, encode: bool = True) -> dict:
    """
    One enrollment photo -> {'encoding', 'box', 'yaw', 'metrics'}.
    Raises EnrollmentQualityError with a user-facing reason.
    Order: detect -> oval -> quality -> liveness (all cheap) -> encode (expensive, last).
    encode=False runs every gate but skips the 128-D code ('encoding' is None); the live
    "Hold still" check uses this because it only needs a yes/no.
    """
    img, faces = detect_and_encode_strict(frame_bytes, encode=False)
    if not faces:
        raise EnrollmentQualityError('No face detected. Center the face and make sure it is well lit.')
    face = pick_enrollment_face(faces, img.shape[1], img.shape[0])
    ok, reason, metrics = assess_face_quality(img, face['box'])
    if not ok:
        raise EnrollmentQualityError(reason)
    # Same single-frame anti-spoof heuristic as attendance scanning (fails closed).
    is_live, _score, live_reason = check_face_liveness(img, face['box'])
    if not is_live:
        # Students see this live on the camera, so speak about the FACE, not the image.
        if 'blur' in live_reason.lower() or 'small' in live_reason.lower():
            raise EnrollmentQualityError('Face is not clear. Hold still and face the light.')
        raise EnrollmentQualityError('Use your real face, not a photo or screen.')
    encoding = face.get('encoding')
    if encode and encoding is None:
        encoding = encode_enrollment_face(img, face['box'])
    return {'encoding': encoding, 'box': face['box'], 'yaw': metrics.get('yaw'), 'metrics': metrics}


# ── Public API: Comparison ────────────────────────────────────────────────────


def compare_faces(known_encoding: list, unknown_encoding: list, tolerance: float = None):
    """
    Compare two face encodings.
    Returns (is_match: bool, confidence: float)
    confidence is between 0.0 and 1.0, higher = better match.
    """
    if tolerance is None:
        tolerance = getattr(settings, 'FACE_RECOGNITION_TOLERANCE', 0.5)

    if known_encoding is None or unknown_encoding is None:
        return False, 0.0

    known_np = np.array(known_encoding, dtype=np.float32)
    unknown_np = np.array(unknown_encoding, dtype=np.float32)

    if FACE_RECOGNITION_AVAILABLE and len(known_np) == 128:
        # dlib encoding: use Euclidean distance
        distance = float(np.linalg.norm(known_np - unknown_np))
        is_match = distance <= tolerance
        confidence = max(0.0, 1.0 - distance)
        return is_match, round(confidence, 3)

    # LBPH encoding: use Chi-squared distance on histograms
    chi_sq = _chi_squared_distance(known_np, unknown_np)
    # Chi-sq ranges from 0 (identical) upward; threshold empirically ~20–80
    lbph_threshold = getattr(settings, 'LBPH_THRESHOLD', 40.0)
    is_match = chi_sq <= lbph_threshold
    confidence = max(0.0, 1.0 - chi_sq / lbph_threshold)
    return is_match, round(confidence, 3)


def batch_compare_faces(known_matrix: np.ndarray, unknown_encoding: list, tolerance: float = None,
                        min_margin: float = None):
    """
    Sub-millisecond vectorized comparison of an unknown face against a section's pre-indexed matrix.
    known_matrix shape: (N, 128)
    unknown_encoding length: 128
    Returns (is_match, best_index, min_distance, confidence, margin)
    margin = distance to second-best match minus best distance (higher = more confident)
    """
    if tolerance is None:
        tolerance = getattr(settings, 'FACE_RECOGNITION_TOLERANCE', 0.38)
    if min_margin is None:
        min_margin = getattr(settings, 'FACE_MATCH_MARGIN', 0.08)

    if known_matrix is None or len(known_matrix) == 0 or unknown_encoding is None:
        return False, None, 999.0, 0.0, 0.0

    try:
        unknown_np = np.array(unknown_encoding, dtype=np.float32)

        # High-accuracy 128-D Euclidean Vectorized Matching
        if known_matrix.ndim == 2 and known_matrix.shape[1] == len(unknown_np):
            if len(known_matrix) > 2000:
                # School-wide matrix: |a-b|^2 = |a|^2 + |b|^2 - 2ab avoids an (N, 128)
                # temporary (25 MB at 50,000 students) on every frame.
                sq = (np.einsum('ij,ij->i', known_matrix, known_matrix)
                      + float(unknown_np @ unknown_np) - 2.0 * (known_matrix @ unknown_np))
                distances = np.sqrt(np.maximum(sq, 0.0))
            else:
                distances = np.linalg.norm(known_matrix - unknown_np, axis=1)
            # Only the best two are needed (argpartition: O(N) instead of a full sort).
            if len(distances) > 2:
                top2 = np.argpartition(distances, 1)[:2]
                sorted_indices = top2[np.argsort(distances[top2])]
            else:
                sorted_indices = np.argsort(distances)
            best_idx = int(sorted_indices[0])
            min_dist = float(distances[best_idx])
            second_dist = float(distances[sorted_indices[1]]) if len(distances) > 1 else 999.0
            margin = second_dist - min_dist
            confidence = max(0.0, 1.0 - min_dist)

            is_match = min_dist <= tolerance and confidence >= getattr(settings, 'MIN_FACE_CONFIDENCE', 0.62)
            if is_match and len(distances) > 1 and margin < min_margin:
                is_match = False

            return is_match, best_idx, min_dist, round(confidence, 3), round(margin, 3)

        # Fallback for LBPH or differing dimensions
        best_idx = None
        best_confidence = 0.0
        best_match = False
        min_dist = 999.0
        for i, known_row in enumerate(known_matrix):
            matched, conf = compare_faces(known_row.tolist(), unknown_encoding, tolerance)
            if matched and conf > best_confidence:
                best_match = True
                best_idx = i
                best_confidence = conf
        return best_match, best_idx, min_dist, best_confidence, 0.0

    except Exception as e:
        logger.error(f"batch_compare_faces error: {e}")
        return False, None, 999.0, 0.0, 0.0


def pick_primary_face(detected_faces: list, frame_w: int = 640, frame_h: int = 480) -> list:
    """
    Select the single most prominent face (largest area + closest to center).
    Forces one-at-a-time scanning so the system focuses on one person per frame.
    """
    if not detected_faces:
        return []
    if len(detected_faces) == 1:
        return detected_faces

    center_x = frame_w / 2.0
    center_y = frame_h / 2.0

    def prominence_score(face):
        box = face.get('box', {})
        w = max(1, box.get('right', 0) - box.get('left', 0))
        h = max(1, box.get('bottom', 0) - box.get('top', 0))
        area = w * h
        cx = (box.get('left', 0) + box.get('right', 0)) / 2.0
        cy = (box.get('top', 0) + box.get('bottom', 0)) / 2.0
        dist_from_center = ((cx - center_x) ** 2 + (cy - center_y) ** 2) ** 0.5
        return area - dist_from_center * 2.0

    return [max(detected_faces, key=prominence_score)]


def scan_face_position(box: dict, frame_w: int, frame_h: int):
    """
    Live attendance only accepts a face that is close and centered: (ok, reason).
    Only the face needs to be positioned; the student does not need to stand anywhere
    specific, the frame is just cropped around wherever their face already is.
    FACE_SCAN_MIN_FACE_RATIO: face width / frame width (0.15 of a 480 px frame = 72 px).
    FACE_SCAN_CENTER_ZONE: max horizontal offset of the face centre, fraction of width.
    """
    width = max(0, int(box['right']) - int(box['left']))
    min_ratio = float(getattr(settings, 'FACE_SCAN_MIN_FACE_RATIO', 0.15))
    zone = float(getattr(settings, 'FACE_SCAN_CENTER_ZONE', 0.3))
    if width < min_ratio * frame_w:
        return False, 'Move closer to the camera.'
    center_x = (int(box['left']) + int(box['right'])) / 2.0
    if abs(center_x - frame_w / 2.0) > zone * frame_w:
        return False, 'Center your face in the camera.'
    return True, 'ok'


def encode_scan_face(img_rgb: np.ndarray, box: dict):
    """128-D code of ONE face for live attendance (1 jitter; the ~0.4 s step), or None."""
    if not FACE_RECOGNITION_AVAILABLE or img_rgb is None:
        return None
    location = (int(box['top']), int(box['right']), int(box['bottom']), int(box['left']))
    try:
        encodings = fr.face_encodings(img_rgb, [location])
    except Exception as e:
        logger.warning(f"encode_scan_face error: {e}")
        return None
    return encodings[0].tolist() if len(encodings) else None


def pick_face_for_next_attendance(
    detected_faces: list,
    section_matrix: np.ndarray,
    students: list,
    marked_student_ids: set,
    frame_w: int = 640,
    frame_h: int = 480,
    tolerance: float = None,
):
    """
    Prefer the face that matches an not-yet-marked enrolled student (queue scanning).
    Falls back to the largest / most centered face when no unmarked match is found.
    """
    if not detected_faces:
        return []
    if len(detected_faces) == 1:
        return detected_faces

    marked_student_ids = set(marked_student_ids or [])
    if section_matrix is None or len(section_matrix) == 0:
        return pick_primary_face(detected_faces, frame_w, frame_h)

    best_face = None
    best_confidence = -1.0

    for face in detected_faces:
        encoding = face.get('encoding')
        if not encoding:
            continue
        # Match against the full roster so a marked student's face is never
        # mistaken for an unmarked look-alike; then keep only unmarked owners.
        is_match, idx, _dist, confidence, _margin = batch_compare_faces(
            section_matrix, encoding, tolerance
        )
        if not is_match or idx is None or idx >= len(students):
            continue
        if students[idx].get('id') in marked_student_ids:
            continue
        if confidence > best_confidence:
            best_confidence = confidence
            best_face = face

    if best_face is not None:
        return [best_face]
    return pick_primary_face(detected_faces, frame_w, frame_h)


def _chi_squared_distance(h1: np.ndarray, h2: np.ndarray) -> float:
    """Chi-squared histogram distance. Lower = more similar."""
    if len(h1) != len(h2):
        return 9999.0
    eps = 1e-10
    return float(np.sum(((h1 - h2) ** 2) / (h1 + h2 + eps)))


# ── Public API: Detection ─────────────────────────────────────────────────────

def detect_faces_in_frame(frame_bytes: bytes):
    """
    Detect face locations in a frame.
    Returns list of dicts: {top, right, bottom, left}
    """
    if FACE_RECOGNITION_AVAILABLE:
        try:
            img_np = _decode_image_to_rgb(frame_bytes)
            locations = fr.face_locations(img_np, model='hog')
            return [{'top': t, 'right': r, 'bottom': b, 'left': l}
                    for (t, r, b, l) in locations]
        except Exception as e:
            logger.error(f"detect_faces dlib error: {e}")

    return _detect_locations(frame_bytes)


# ── Utility ───────────────────────────────────────────────────────────────────

class InvalidImageError(ValueError):
    """Uploaded frame is not an acceptable image (bad encoding, too big, wrong type)."""


ALLOWED_FRAME_FORMATS = ('JPEG', 'PNG', 'WEBP')


def base64_to_bytes(base64_str: str, max_bytes: int = None) -> bytes:
    """
    Convert a base64 data URL or plain base64 string to bytes.
    Strict: rejects non-base64 characters and payloads larger than max_bytes
    (defaults to settings.FACE_MAX_FRAME_BYTES) before decoding.
    """
    if not isinstance(base64_str, str) or not base64_str:
        raise InvalidImageError('Frame must be a base64-encoded image string.')
    if max_bytes is None:
        max_bytes = getattr(settings, 'FACE_MAX_FRAME_BYTES', 2 * 1024 * 1024)

    if ',' in base64_str:
        base64_str = base64_str.split(',', 1)[1]
    base64_str = ''.join(base64_str.split())  # drop any whitespace/newlines

    # Each 4 base64 chars decode to 3 bytes; reject oversize input without decoding it.
    if (len(base64_str) * 3) // 4 > max_bytes:
        raise InvalidImageError(f'Frame is too large (max {max_bytes // (1024 * 1024)} MB).')
    try:
        return base64.b64decode(base64_str, validate=True)
    except (binascii.Error, ValueError):
        raise InvalidImageError('Frame is not valid base64 data.')


def validate_image_bytes(data: bytes, max_dimension: int = None) -> None:
    """
    Ensure decoded bytes are a real JPEG/PNG/WEBP image within size limits.
    Reads only the header for format/dimensions, so oversized "image bombs" are rejected cheaply.
    """
    from PIL import UnidentifiedImageError

    if max_dimension is None:
        max_dimension = getattr(settings, 'FACE_MAX_FRAME_DIMENSION', 4096)
    if not data:
        raise InvalidImageError('Frame is empty.')
    try:
        with Image.open(BytesIO(data)) as img:
            img_format = img.format
            width, height = img.size
            img.verify()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise InvalidImageError('Frame is not a valid image.')

    if img_format not in ALLOWED_FRAME_FORMATS:
        raise InvalidImageError('Only JPEG, PNG, or WEBP frames are allowed.')
    if width < 1 or height < 1 or width > max_dimension or height > max_dimension:
        raise InvalidImageError(f'Frame dimensions must be at most {max_dimension}x{max_dimension} pixels.')


def decode_frame(base64_str: str) -> bytes:
    """base64 frame -> validated image bytes. Raises InvalidImageError."""
    data = base64_to_bytes(base64_str)
    validate_image_bytes(data)
    return data


def draw_face_boxes(frame_bytes: bytes, results: list) -> bytes:
    """
    Draw colored bounding boxes + name labels on faces.
    results: list of {top, right, bottom, left, name, status}
    Returns modified JPEG bytes.
    """
    if not OPENCV_AVAILABLE:
        return frame_bytes
    try:
        img_np = _decode_image_to_rgb(frame_bytes)
        for res in results:
            top, right, bottom, left = res['top'], res['right'], res['bottom'], res['left']
            name = res.get('name', 'Unknown')
            status = res.get('status', 'unknown')
            color = (0, 200, 0) if status == 'present' else (200, 0, 0)
            cv2.rectangle(img_np, (left, top), (right, bottom), color, 2)
            cv2.rectangle(img_np, (left, bottom - 28), (right, bottom), color, cv2.FILLED)
            cv2.putText(img_np, name, (left + 4, bottom - 8),
                        cv2.FONT_HERSHEY_DUPLEX, 0.5, (255, 255, 255), 1)
        output = BytesIO()
        Image.fromarray(img_np).save(output, format='JPEG', quality=85)
        return output.getvalue()
    except Exception as e:
        logger.error(f"draw_face_boxes error: {e}")
        return frame_bytes
