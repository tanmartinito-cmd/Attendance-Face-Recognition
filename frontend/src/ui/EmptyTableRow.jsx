import React, { useEffect, useState } from 'react';

/**
 * The one empty-state row every table uses.
 *
 * Rule for "Add" buttons (keep exactly one visible):
 *   - table has no records at all  -> the Add button sits here, centered, and NOT in the header
 *   - table has records            -> the Add button sits in the page header only
 *   - filters/search hide all rows -> "no matches" + Clear filters here, Add stays in the header
 */
export default function EmptyTableRow({ colSpan, icon: Icon, title, message, actionLabel, onAction, secondary }) {
  return (
    <tr className="table-empty-row">
      <td colSpan={colSpan} className="table-empty-cell">
        <div className="table-empty-state">
          {Icon && <span className="table-empty-icon" aria-hidden="true"><Icon size={28} /></span>}
          {title && <strong>{title}</strong>}
          {message && <p>{message}</p>}
          {(actionLabel || secondary) && (
            <div className="table-empty-actions">
              {actionLabel && onAction && (
                <button type="button" className="btn btn-primary" onClick={onAction}>{actionLabel}</button>
              )}
              {secondary}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * Whether the page's header should show its Add button.
 * Stays false during the first load (no flicker), then keeps its last value while the
 * table reloads (filter changes), so the button doesn't blink on and off.
 *
 * @param {boolean} loading
 * @param {boolean} hasRecords  true when there is anything to show OR filters are active
 */
export function useShowHeaderAdd(loading, hasRecords) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!loading) setShow(Boolean(hasRecords));
  }, [loading, hasRecords]);
  return show;
}
