import React, { useEffect, useState } from 'react';

/** "Maria Santos" -> "MS", "admin" -> "A". */
export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const letters = parts.length === 1 ? parts[0][0] : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

/**
 * Photo if there is one, otherwise the person's initials, drawn locally.
 * Also falls back to initials when the photo fails to load (expired signed link, deleted file).
 * No third-party avatar service: names never leave the app.
 */
export default function Avatar({ src, name, size = 36, ring = false, alt = '', className = '', style = {} }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]); // a new photo URL gets a fresh try

  const box = { width: size, height: size, borderRadius: '50%', flexShrink: 0, ...style };
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={alt}
        onError={() => setFailed(true)}
        className={className}
        style={{ ...box, objectFit: 'cover', border: ring ? `${size >= 60 ? 3 : 2}px solid var(--success)` : undefined }}
      />
    );
  }
  return (
    <span
      className={`avatar-initials ${className}`.trim()}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : 'true'}
      style={{ ...box, fontSize: Math.round(size * 0.38) }}
    >
      {initialsOf(name)}
    </span>
  );
}
