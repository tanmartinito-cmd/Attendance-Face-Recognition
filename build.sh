#!/usr/bin/env bash
# Render Build Script for AttendFR Django Backend
set -o errexit

echo "==> Upgrading pip..."
python -m pip install --upgrade pip

echo "==> Installing dependencies..."
pip install -r requirements.txt

# face_recognition depends on "dlib", which would compile from source; dlib-bin (in
# requirements.txt) already provides it, so install face_recognition without its deps.
echo "==> Installing face_recognition (using prebuilt dlib-bin)..."
pip install --no-deps face-recognition==1.3.0

echo "==> Collecting static files..."
python manage.py collectstatic --no-input --clear

# `migrate` also resets an old-schema database, creates the cache table, and seeds the
# admin account (see accounts/deploy.py). All of it is idempotent.
echo "==> Applying database migrations..."
python manage.py migrate --no-input

# Move any face photos still in public storage into private storage.
# Safe on every deploy: already-private photos are skipped, and by default the public copy is
# kept (reversible). Set FACE_PHOTOS_DELETE_PUBLIC=true in Render once you've confirmed photos
# load in the app; the next deploy then deletes the public copies (cannot be undone).
# A failure here only logs a warning: photos keep working through signed links either way.
echo "==> Securing face photos..."
if [ "${FACE_PHOTOS_DELETE_PUBLIC:-false}" = "true" ]; then
  python manage.py make_face_photos_private --apply \
    || echo "WARNING: face photo migration failed; will retry on next deploy"
else
  python manage.py make_face_photos_private --apply --keep-public \
    || echo "WARNING: face photo migration failed; will retry on next deploy"
fi

echo "==> Build complete!"
