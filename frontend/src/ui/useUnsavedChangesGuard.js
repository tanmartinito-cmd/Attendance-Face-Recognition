import { useCallback, useEffect, useRef } from 'react';
import { confirmAction } from './ConfirmDialog';

/**
 * Protects a modal (or any container) from losing edits when it is closed.
 *
 * It watches the form controls inside `containerRef` and, when the user has
 * actually changed something that is still unsaved, asks "Discard unsaved
 * changes?" before running `onClose`. No per-form state wiring is needed.
 *
 *   const { containerRef, requestClose } = useUnsavedChangesGuard(onClose);
 *
 * Only fields the USER typed/picked in are tracked, each against the value it
 * had right before the user touched it. Values the app sets by itself (a
 * filter pre-selecting a scope, a picker reset after "Enroll" succeeds) are
 * never mistaken for edits.
 *
 * Controls inside `data-guard-ignore` are skipped. Use it for search boxes and
 * for "action" forms whose submit applies immediately (e.g. Enroll student),
 * where there is nothing left to save afterwards.
 */

const FIELD_SELECTOR = 'input, select, textarea';
const SKIPPED_TYPES = new Set(['button', 'submit', 'reset', 'hidden']);

function isTrackable(target) {
  if (!target?.matches?.(FIELD_SELECTOR)) return false;
  if (target.closest('[data-guard-ignore]')) return false;
  return !SKIPPED_TYPES.has((target.type || '').toLowerCase());
}

function fieldValue(field) {
  const type = (field.type || '').toLowerCase();
  if (type === 'checkbox' || type === 'radio') return field.checked ? '1' : '0';
  if (field.multiple && field.options) return Array.from(field.selectedOptions).map((o) => o.value).join(',');
  return field.value ?? '';
}

export const DISCARD_CHANGES_PROMPT = {
  title: 'Discard unsaved changes?',
  message: 'You have edits that have not been saved. If you close now, they will be lost.',
  confirmLabel: 'Discard changes',
  cancelLabel: 'Keep editing',
  tone: 'danger',
};

export default function useUnsavedChangesGuard(onClose, { disabled = false, busy = false } = {}) {
  const containerRef = useRef(null);
  const originalsRef = useRef(new Map()); // field -> value before the user touched it
  const editedRef = useRef(new Set()); // fields the user changed
  const pendingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return undefined;
    // Remember a field's value right before the user interacts with it.
    const rememberOriginal = (event) => {
      const field = event.target;
      if (isTrackable(field) && !originalsRef.current.has(field)) {
        originalsRef.current.set(field, fieldValue(field));
      }
    };
    // input/change events only fire for user edits, never for React state updates.
    const markEdited = (event) => {
      if (isTrackable(event.target)) editedRef.current.add(event.target);
    };
    const captureEvents = ['focus', 'focusin', 'pointerdown', 'mousedown', 'keydown'];
    captureEvents.forEach((name) => root.addEventListener(name, rememberOriginal, true));
    root.addEventListener('input', markEdited, true);
    root.addEventListener('change', markEdited, true);
    return () => {
      captureEvents.forEach((name) => root.removeEventListener(name, rememberOriginal, true));
      root.removeEventListener('input', markEdited, true);
      root.removeEventListener('change', markEdited, true);
    };
  }, []);

  const isDirty = useCallback(() => {
    if (disabled) return false;
    for (const field of editedRef.current) {
      if (!field.isConnected) continue; // field no longer shown -> nothing to lose
      if (!originalsRef.current.has(field)) return true; // unknown start value: be safe
      if (fieldValue(field) !== originalsRef.current.get(field)) return true;
    }
    return false;
  }, [disabled]);

  const requestClose = useCallback(async () => {
    if (busy || pendingRef.current) return false;
    if (isDirty()) {
      pendingRef.current = true;
      const discard = await confirmAction(DISCARD_CHANGES_PROMPT);
      pendingRef.current = false;
      if (!discard) return false;
    }
    originalsRef.current = new Map();
    editedRef.current = new Set();
    onCloseRef.current?.();
    return true;
  }, [busy, isDirty]);

  return { containerRef, requestClose, isDirty, isPrompting: () => pendingRef.current };
}
