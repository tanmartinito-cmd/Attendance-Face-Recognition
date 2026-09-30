"""
Django settings for attendance_fr project.
Configured via .env file using python-dotenv.
"""
import os
import sys
from pathlib import Path
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Load .env from project root
load_dotenv(BASE_DIR / '.env')

# ─── Security ─────────────────────────────────────────────────────────────────
DEBUG = os.getenv('DEBUG', 'False').lower() in ('true', '1', 'yes')
SECRET_KEY = os.getenv('SECRET_KEY', '').strip()
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = 'django-insecure-development-key-do-not-deploy'
    else:
        raise ImproperlyConfigured('SECRET_KEY must be set when DEBUG is disabled.')
ALLOWED_HOSTS = [h.strip() for h in os.getenv('ALLOWED_HOSTS', '127.0.0.1,localhost').split(',') if h.strip()]
RENDER_EXTERNAL_HOSTNAME = os.getenv('RENDER_EXTERNAL_HOSTNAME')
if RENDER_EXTERNAL_HOSTNAME and RENDER_EXTERNAL_HOSTNAME not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(RENDER_EXTERNAL_HOSTNAME)
if DEBUG and 'testserver' not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append('testserver')

# ─── Applications ─────────────────────────────────────────────────────────────
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    # staticfiles BEFORE cloudinary_storage: otherwise cloudinary_storage's collectstatic
    # replaces Django's and copies nothing (static files are served by WhiteNoise, not Cloudinary).
    # Media uploads still go to Cloudinary via STORAGES['default'].
    'django.contrib.staticfiles',
    'cloudinary_storage',
    'cloudinary',
    # Third-party
    'rest_framework',
    'corsheaders',
    'crispy_forms',
    'crispy_bootstrap5',
    # Local apps
    'accounts',
    'core',
    'face_app',
]

# Token blacklist storage uses Django UUID columns that older MariaDB releases do not support.
# Enable it only on a database where `manage.py migrate` applies token_blacklist successfully.
JWT_BLACKLIST_ENABLED = os.getenv('JWT_BLACKLIST_ENABLED', 'False').lower() in ('true', '1', 'yes')
if JWT_BLACKLIST_ENABLED:
    INSTALLED_APPS.append('rest_framework_simplejwt.token_blacklist')

# ─── Middleware ────────────────────────────────────────────────────────────────
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',  # CORS placed high before CommonMiddleware
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'attendance_fr.request_context.CurrentRequestMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'attendance_fr.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'attendance_fr.wsgi.application'

# ─── Database — MySQL (MariaDB 10.4 via XAMPP / phpMyAdmin) ───────────────────
DATABASES = {
    'default': {
        'ENGINE': os.getenv('DB_ENGINE', 'django.db.backends.mysql'),
        'NAME':     os.getenv('DB_NAME',     'attendance_db'),
        'USER':     os.getenv('DB_USER',     'root'),
        'PASSWORD': os.getenv('DB_PASSWORD', ''),
        'HOST':     os.getenv('DB_HOST',     '127.0.0.1'),
        'PORT':     os.getenv('DB_PORT',     '3306'),
        'OPTIONS': {
            'charset': 'utf8mb4',
            # Enforce strict SQL so Django constraints behave the same as in PostgreSQL
            'init_command': "SET sql_mode='STRICT_TRANS_TABLES'",
        },
    }
}

# TiDB Cloud SSL support
db_use_ssl = os.getenv('DB_USE_SSL', 'False').lower() in ('true', '1')
db_ssl_ca = os.getenv('DB_SSL_CA', '')

if db_use_ssl or db_ssl_ca:
    ssl_dict = {}
    ca_candidates = []
    if db_ssl_ca:
        ca_candidates.append(db_ssl_ca)
        ca_candidates.append(os.path.join(BASE_DIR, db_ssl_ca))
    ca_candidates.append(os.path.join(BASE_DIR, 'isrgrootx1.pem'))
    ca_candidates.append('isrgrootx1.pem')
    ca_candidates.append('/etc/ssl/certs/ca-certificates.crt')

    for candidate in ca_candidates:
        if candidate and os.path.exists(candidate):
            ssl_dict['ca'] = os.path.abspath(candidate)
            break

    if 'ca' not in ssl_dict:
        try:
            import certifi
            ssl_dict['ca'] = certifi.where()
        except ImportError:
            pass

    DATABASES['default']['OPTIONS']['ssl'] = ssl_dict

# Isolated SQLite database for automated test suite runs (fast, zero socket crash risk)
if 'test' in sys.argv or 'test_features' in sys.argv:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': ':memory:',
        }
    }

# ─── REST Framework & JWT ─────────────────────────────────────────────────────
from datetime import timedelta

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        # simplejwt + server-side revocation (logout, used refresh tokens)
        'attendance_fr.authentication.RevocationAwareJWTAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    # Rates for views that opt in via throttle_classes / throttle_scope.
    # Note: throttle counters live in CACHES; with LocMemCache each worker counts separately.
    'DEFAULT_THROTTLE_RATES': {
        'login': os.getenv('THROTTLE_LOGIN', '10/min'),                  # per IP
        'token_refresh': os.getenv('THROTTLE_TOKEN_REFRESH', '30/min'),  # per IP
        'face_recognize': os.getenv('THROTTLE_FACE_RECOGNIZE', '180/min'),  # per user (scanner sends ~120/min)
        'face_enroll': os.getenv('THROTTLE_FACE_ENROLL', '30/min'),      # per user
        'face_enroll_check': os.getenv('THROTTLE_FACE_ENROLL_CHECK', '240/min'),  # per user (live frame checks)
        'face_photo': os.getenv('THROTTLE_FACE_PHOTO', '600/min'),       # per IP (student tables)
        'sync_versions': os.getenv('THROTTLE_SYNC_VERSIONS', '120/min'),  # per user (live sync polls every 3 s per open tab)
    },
    # Number of trusted reverse proxies in front of Django (Render = 1). Used to read the real
    # client IP from X-Forwarded-For; 0 means use REMOTE_ADDR directly (local dev).
    'NUM_PROXIES': int(os.getenv('TRUSTED_PROXY_COUNT', '0')),
}

SIMPLE_JWT = {
    # Short-lived access token (common practice: 5-15 min); the frontend renews it silently.
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=int(os.getenv('JWT_ACCESS_MINUTES', '15'))),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=int(os.getenv('JWT_REFRESH_DAYS', '7'))),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': JWT_BLACKLIST_ENABLED,
    'AUTH_HEADER_TYPES': ('Bearer',),
}

# ─── CORS & CSRF ──────────────────────────────────────────────────────────────
# Allowed origins for Cloudflare Pages, Render, and local dev
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        'CORS_ALLOWED_ORIGINS',
        'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000'
    ).split(',')
    if origin.strip()
]
CORS_ALLOWED_ORIGIN_REGEXES = [
    expression.strip()
    for expression in os.getenv('CORS_ALLOWED_ORIGIN_REGEXES', '').split(',')
    if expression.strip()
]
CORS_ALLOW_CREDENTIALS = True

CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        'CSRF_TRUSTED_ORIGINS',
        # Exact origins only (no wildcards). The Render hostname is appended below automatically;
        # add the deployed frontend origin via the CSRF_TRUSTED_ORIGINS env var.
        'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000'
    ).split(',')
    if origin.strip()
]
if RENDER_EXTERNAL_HOSTNAME:
    render_origin = f'https://{RENDER_EXTERNAL_HOSTNAME}'
    if render_origin not in CSRF_TRUSTED_ORIGINS:
        CSRF_TRUSTED_ORIGINS.append(render_origin)
    if render_origin not in CORS_ALLOWED_ORIGINS:
        CORS_ALLOWED_ORIGINS.append(render_origin)

# ─── Browser login: refresh token in an httpOnly cookie via the Cloudflare proxy ──
# The browser calls /api/token/, /api/token/refresh/ and /api/auth/logout/ on the FRONTEND
# origin; a Cloudflare Pages Function forwards them here (frontend/functions/). All other
# API calls go straight to Render with the in-memory access token.
#
# AUTH_PROXY_SECRET: shared with the Pages Function (PROXY_SECRET there). Proves a request
#   came through our proxy, so its X-Client-IP (real user IP) can be trusted.
# AUTH_PROXY_REQUIRED: reject token-endpoint calls that did not come through the proxy.
#   Defaults to on whenever a secret is configured.
AUTH_PROXY_SECRET = os.getenv('AUTH_PROXY_SECRET', '').strip()
AUTH_PROXY_REQUIRED = os.getenv('AUTH_PROXY_REQUIRED', 'true' if AUTH_PROXY_SECRET else 'false').lower() in ('true', '1', 'yes')
REFRESH_COOKIE_NAME = os.getenv('REFRESH_COOKIE_NAME', 'attendfr_refresh')
REFRESH_COOKIE_PATH = '/api/'  # only proxied /api/* calls exist on the frontend origin
REFRESH_COOKIE_SECURE = os.getenv('REFRESH_COOKIE_SECURE', 'false' if DEBUG else 'true').lower() in ('true', '1', 'yes')
REFRESH_COOKIE_SAMESITE = 'Strict'  # proxied calls are same-origin, so Strict always works

# Session & Cookie Hardening
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'

# ─── Production HTTPS & Security ──────────────────────────────────────────────
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_BROWSER_XSS_FILTER = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = 'DENY'
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True

# ─── Authentication ────────────────────────────────────────────────────────────
AUTH_USER_MODEL = 'accounts.User'

# Sign in with username, Faculty ID, Student ID, or email (case-insensitive)
AUTHENTICATION_BACKENDS = ['accounts.backends.FlexibleLoginBackend']

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
        'OPTIONS': {'min_length': 8},
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
    {
        # Upper + lower + digit + special character
        'NAME': 'accounts.validators.ComplexPasswordValidator',
        'OPTIONS': {'min_length': 8},
    },
]

# ─── Login brute-force protection ─────────────────────────────────────────────
# After this many failed logins for the same username from the same IP, lock that pair out.
LOGIN_MAX_FAILED_ATTEMPTS = int(os.getenv('LOGIN_MAX_FAILED_ATTEMPTS', '5'))
LOGIN_LOCKOUT_MINUTES = int(os.getenv('LOGIN_LOCKOUT_MINUTES', '15'))
# Per-ACCOUNT cap across all IPs (NIST SP 800-63B: at most 100 consecutive failures).
# Stops slow guessing spread over many IPs. Reaching it locks the account for the window
# or until an admin runs: python manage.py unlock_login <username>
LOGIN_ACCOUNT_MAX_FAILURES = int(os.getenv('LOGIN_ACCOUNT_MAX_FAILURES', '100'))
LOGIN_ACCOUNT_WINDOW_HOURS = int(os.getenv('LOGIN_ACCOUNT_WINDOW_HOURS', '24'))

# ─── Upload limits ────────────────────────────────────────────────────────────
# Largest decoded camera frame accepted by the face endpoints, and its max width/height.
FACE_MAX_FRAME_BYTES = int(os.getenv('FACE_MAX_FRAME_BYTES', str(2 * 1024 * 1024)))
FACE_MAX_FRAME_DIMENSION = int(os.getenv('FACE_MAX_FRAME_DIMENSION', '4096'))
# Largest uploaded profile/face image file
MAX_IMAGE_UPLOAD_BYTES = int(os.getenv('MAX_IMAGE_UPLOAD_BYTES', str(2 * 1024 * 1024)))
# Request body cap: enrollment sends 3-5 JPEG photos (~0.2-0.5 MB each as base64)
DATA_UPLOAD_MAX_MEMORY_SIZE = int(os.getenv('DATA_UPLOAD_MAX_MEMORY_SIZE', str(6 * 1024 * 1024)))

# ─── Face quality gates (68-point landmarks; angles in degrees) ──────────────
# Enrollment = the one stored selfie (strict). Scan = live attendance frames (a bit looser).
# Frames that fail are skipped, never matched. Tune on your real camera if needed.
FACE_ENROLL_MIN_SAMPLES = int(os.getenv('FACE_ENROLL_MIN_SAMPLES', '3'))   # countdown frames
FACE_ENROLL_MAX_SAMPLES = int(os.getenv('FACE_ENROLL_MAX_SAMPLES', '5'))
# Only the face inside the on-screen oval is enrolled; background people are ignored.
FACE_ENROLL_OVAL_ZONE = float(os.getenv('FACE_ENROLL_OVAL_ZONE', '0.25'))            # centre offset / width
FACE_ENROLL_SECOND_FACE_RATIO = float(os.getenv('FACE_ENROLL_SECOND_FACE_RATIO', '0.6'))  # reject similar-size 2nd face in oval
# Captured frames that must pass the quality gate; a blinked/blurred frame is dropped.
FACE_ENROLL_MIN_GOOD_SAMPLES = int(os.getenv('FACE_ENROLL_MIN_GOOD_SAMPLES', '2'))
FACE_ENROLL_JITTERS = int(os.getenv('FACE_ENROLL_JITTERS', '4'))           # re-reads per frame, averaged
FACE_ENROLL_CONSISTENCY_TOLERANCE = float(os.getenv('FACE_ENROLL_CONSISTENCY_TOLERANCE', '0.5'))
FACE_ENROLL_MAX_YAW = float(os.getenv('FACE_ENROLL_MAX_YAW', '15'))        # left/right turn (still frontal)
FACE_ENROLL_MAX_PITCH = float(os.getenv('FACE_ENROLL_MAX_PITCH', '20'))    # up/down tilt
FACE_ENROLL_MAX_ROLL = float(os.getenv('FACE_ENROLL_MAX_ROLL', '10'))      # sideways lean
FACE_ENROLL_MIN_EAR = float(os.getenv('FACE_ENROLL_MIN_EAR', '0.2'))       # eye aspect ratio (eyes open)
FACE_ENROLL_MIN_EYE_DISTANCE = float(os.getenv('FACE_ENROLL_MIN_EYE_DISTANCE', '45'))  # px between eyes
FACE_ENROLL_MIN_BRIGHTNESS = float(os.getenv('FACE_ENROLL_MIN_BRIGHTNESS', '50'))
FACE_ENROLL_MAX_BRIGHTNESS = float(os.getenv('FACE_ENROLL_MAX_BRIGHTNESS', '215'))
FACE_ENROLL_MIN_SHARPNESS = float(os.getenv('FACE_ENROLL_MIN_SHARPNESS', '40'))     # Laplacian variance

FACE_SCAN_MAX_YAW = float(os.getenv('FACE_SCAN_MAX_YAW', '20'))
FACE_SCAN_MAX_PITCH = float(os.getenv('FACE_SCAN_MAX_PITCH', '25'))
FACE_SCAN_MAX_ROLL = float(os.getenv('FACE_SCAN_MAX_ROLL', '15'))
FACE_SCAN_MIN_EAR = float(os.getenv('FACE_SCAN_MIN_EAR', '0.17'))
FACE_SCAN_MIN_EYE_DISTANCE = float(os.getenv('FACE_SCAN_MIN_EYE_DISTANCE', '28'))  # scan frames are 480px wide
FACE_SCAN_MIN_BRIGHTNESS = float(os.getenv('FACE_SCAN_MIN_BRIGHTNESS', '40'))
FACE_SCAN_MAX_BRIGHTNESS = float(os.getenv('FACE_SCAN_MAX_BRIGHTNESS', '230'))
FACE_SCAN_MIN_SHARPNESS = float(os.getenv('FACE_SCAN_MIN_SHARPNESS', '25'))

LOGIN_URL = '/admin/login/'
LOGIN_REDIRECT_URL = '/admin/'
LOGOUT_REDIRECT_URL = '/admin/login/'

# ─── Internationalisation ──────────────────────────────────────────────────────
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Manila'
USE_I18N = True
USE_TZ = True

# ─── Static & Media files ─────────────────────────────────────────────────────
STATIC_URL = '/static/'
STATICFILES_DIRS = [BASE_DIR / 'static'] if (BASE_DIR / 'static').exists() else []
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_STORAGE = 'django.contrib.staticfiles.storage.StaticFilesStorage'

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'
# Local (non-Cloudinary) home for biometric face photos. Outside MEDIA_ROOT: never served.
PRIVATE_MEDIA_ROOT = BASE_DIR / 'private_media'
# Lifetime of the signed links the API hands out for face photos
FACE_PHOTO_LINK_SECONDS = int(os.getenv('FACE_PHOTO_LINK_SECONDS', '300'))

CLOUDINARY_CLOUD_NAME = os.getenv('CLOUDINARY_CLOUD_NAME', '').strip()
CLOUDINARY_API_KEY = os.getenv('CLOUDINARY_API_KEY', '').strip()
CLOUDINARY_API_SECRET = os.getenv('CLOUDINARY_API_SECRET', '').strip()

# The test suite must never upload to (or delete from) the real Cloudinary account.
import sys as _sys
if len(_sys.argv) > 1 and _sys.argv[1] == 'test':
    CLOUDINARY_CLOUD_NAME = CLOUDINARY_API_KEY = CLOUDINARY_API_SECRET = ''

if CLOUDINARY_CLOUD_NAME and CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET:
    CLOUDINARY_STORAGE = {
        'CLOUD_NAME': CLOUDINARY_CLOUD_NAME,
        'API_KEY': CLOUDINARY_API_KEY,
        'API_SECRET': CLOUDINARY_API_SECRET,
        'SECURE': True,
    }
    DEFAULT_FILE_STORAGE = 'cloudinary_storage.storage.MediaCloudinaryStorage'
    STORAGES = {
        'default': {
            'BACKEND': 'cloudinary_storage.storage.MediaCloudinaryStorage',
        },
        'staticfiles': {
            'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage',
        },
    }
else:
    STORAGES = {
        'default': {
            'BACKEND': 'django.core.files.storage.FileSystemStorage',
        },
        'staticfiles': {
            'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage',
        },
    }

# CORS is intentionally allow-list only. Configure production origins in CORS_ALLOWED_ORIGINS.
# Optional regular-expression origins belong in CORS_ALLOWED_ORIGIN_REGEXES.
CORS_ALLOW_CREDENTIALS = True

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ─── Crispy Forms ─────────────────────────────────────────────────────────────
CRISPY_ALLOWED_TEMPLATE_PACKS = 'bootstrap5'
CRISPY_TEMPLATE_PACK = 'bootstrap5'

# ─── Caching ─────────────────────────────────────────────────────────────────
# default:  fast per-process memory (face vectors, API responses).
# security: login lockout counters, stored in the database so EVERY gunicorn worker sees
#           the same counts (no Redis needed). Table is created by `createcachetable`
#           (build.sh); tiny and low-traffic (written only on failed logins).
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'attendfr-cache',
    },
    'security': {
        'BACKEND': 'django.core.cache.backends.db.DatabaseCache',
        'LOCATION': 'attendfr_security_cache',
        'OPTIONS': {'MAX_ENTRIES': 20000},
    },
}

# Face-vector cache lifetime. Targeted invalidation bypasses stale entries immediately.
FACE_CACHE_TIMEOUT = int(os.getenv('FACE_CACHE_TIMEOUT', '60'))
# Euclidean threshold for dlib 128-D embeddings (lower = stricter; 0.38 rejects look-alikes)
FACE_RECOGNITION_TOLERANCE = float(os.getenv('FACE_RECOGNITION_TOLERANCE', '0.38'))
# Minimum confidence (0–1) required before marking attendance (1 - tolerance ≈ 0.62)
MIN_FACE_CONFIDENCE = float(os.getenv('MIN_FACE_CONFIDENCE', '0.62'))
# Best match must beat second-best by at least this distance to avoid ambiguous matches
FACE_MATCH_MARGIN = float(os.getenv('FACE_MATCH_MARGIN', '0.08'))
# Consecutive matching frames (same student) required before attendance is marked
FACE_CONSENSUS_FRAMES = max(1, int(os.getenv('FACE_CONSENSUS_FRAMES', '3')))
# Frames whose face vector differs from the previous one by less than this are treated as a
# replayed/duplicated image and do not count toward consensus (real camera frames always vary)
FACE_REPLAY_EPSILON = float(os.getenv('FACE_REPLAY_EPSILON', '0.002'))
# Enrollment: a new face within this distance of another student's face is rejected as a duplicate,
# and a re-enrollment farther than this from the student's current face needs explicit replace
FACE_DUPLICATE_TOLERANCE = float(os.getenv('FACE_DUPLICATE_TOLERANCE', '0.5'))
# Minutes after class starts before a student is considered "late"
LATE_THRESHOLD_MINUTES = int(os.getenv('LATE_THRESHOLD_MINUTES', '15'))
# Chi-squared threshold for LBPH fallback encoder
LBPH_THRESHOLD = 40.0
# Directory reserved for future binary embedding files
FACE_ENCODINGS_DIR = BASE_DIR / 'media' / 'face_encodings'
# Passive anti-spoofing (MiniFASNetV2, Apache-2.0). Live probability required per frame.
FACE_ANTISPOOF_MODEL = BASE_DIR / 'face_app' / 'models' / 'minifasnet_v2.onnx'
FACE_ANTISPOOF_THRESHOLD = float(os.getenv('FACE_ANTISPOOF_THRESHOLD', '0.7'))

# ─── Logging ──────────────────────────────────────────────────────────────────
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'simple': {
            'format': '[{levelname}] {name}: {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'simple',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
    'loggers': {
        'face_app': {'handlers': ['console'], 'level': 'DEBUG', 'propagate': False},
        'core':     {'handlers': ['console'], 'level': 'DEBUG', 'propagate': False},
        'accounts': {'handlers': ['console'], 'level': 'DEBUG', 'propagate': False},
    },
}

