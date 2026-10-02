import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { searchItems } from '../../utils/fuzzySearch';

const titleCase = (text) => text.replace(/\b\w/g, (letter) => letter.toUpperCase());

/**
 * Type-to-search picker with suggestions (replaces long dropdowns).
 * - "kris"    -> every name starting with Kris
 * - "krisyan" -> 'Did you mean "Kristan"?' plus the Kristan results
 * Keyboard: ↑/↓ to move, Enter to pick, Esc to close. Works with screen readers (combobox).
 *
 * items: [{ id, label, sublabel?, terms?: string[], disabled?: boolean, note?: string }]
 */
export default function SearchSuggest({
  label,
  items = [],
  value = '',
  onChange,
  placeholder = 'Type to search…',
  required = false,
  emptyText = 'No match found.',
  limit = 8,
}) {
  const inputId = useId();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  const panelRef = useRef(null);
  const [panelPos, setPanelPos] = useState(null);
  const selected = items.find((item) => String(item.id) === String(value)) || null;

  // A typed name is not a choice: the form only submits once an item is picked from the list.
  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.setCustomValidity(required && !selected && query.trim() ? 'Choose one from the suggestions.' : '');
  }, [required, selected, query]);

  useEffect(() => {
    const close = (event) => {
      if (wrapperRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const { matches, suggestion } = useMemo(() => searchItems(items, query, { limit }), [items, query, limit]);

  const pick = (item) => {
    if (!item || item.disabled) return;
    onChange?.(String(item.id));
    setQuery('');
    setOpen(false);
  };
  const clear = () => { onChange?.(''); setQuery(''); setOpen(true); };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, Math.max(matches.length - 1, 0))); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (event.key === 'Enter' && open && matches[active]) { event.preventDefault(); pick(matches[active]); }
    else if (event.key === 'Escape') { setOpen(false); }
  };

  const showList = open && query.trim().length > 0;
  const activeId = showList && matches[active] ? `${listId}-opt-${matches[active].id}` : undefined;

  // The list lives in a portal on <body> (fixed position under the input), so a modal's
  // scrolling body or a following panel can never clip or cover it.
  useLayoutEffect(() => {
    if (!showList || selected) { setPanelPos(null); return undefined; }
    const place = () => {
      const rect = boxRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom;
      const up = below < 220 && rect.top > below;
      setPanelPos({
        left: rect.left,
        width: Math.max(rect.width, 240),
        ...(up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [showList, selected]);

  return (
    <div className="search-suggest" ref={wrapperRef}>
      {label && <label className="form-label" htmlFor={inputId}>{label}</label>}
      {selected ? (
        <div className="search-suggest-selected">
          <div><strong>{selected.label}</strong>{selected.sublabel && <span className="text-muted"> · {selected.sublabel}</span>}</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={clear} aria-label={`Change ${label || 'selection'}`}><X size={14} /> Change</button>
        </div>
      ) : (
        <div className="search-suggest-box" ref={boxRef}>
          <Search size={14} className="search-suggest-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            id={inputId}
            className="form-control"
            type="text"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            autoComplete="off"
            placeholder={placeholder}
            value={query}
            required={required}
            onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
        </div>
      )}
      {showList && !selected && createPortal(
        <div className="search-suggest-panel" ref={panelRef} style={panelPos ? { position: 'fixed', right: 'auto', margin: 0, zIndex: 5000, ...panelPos } : { visibility: 'hidden' }}>
          {suggestion && (
            <div className="search-suggest-hint" role="status">
              Did you mean{' '}
              <button type="button" className="btn-link" onClick={() => { setQuery(titleCase(suggestion)); setActive(0); }}>
                “{titleCase(suggestion)}”
              </button>?
            </div>
          )}
          <ul id={listId} role="listbox" aria-label={label || 'Suggestions'}>
            {matches.length === 0 && <li className="search-suggest-empty" role="option" aria-disabled="true" aria-selected="false">{emptyText}</li>}
            {matches.map((item, index) => (
              <li
                key={item.id}
                id={`${listId}-opt-${item.id}`}
                role="option"
                aria-selected={index === active}
                aria-disabled={item.disabled || undefined}
                className={`search-suggest-option${index === active ? ' active' : ''}${item.disabled ? ' disabled' : ''}`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => { event.preventDefault(); pick(item); }}
              >
                <span>{item.label}</span>
                {(item.sublabel || item.note) && <span className="text-muted">{item.note || item.sublabel}</span>}
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}
