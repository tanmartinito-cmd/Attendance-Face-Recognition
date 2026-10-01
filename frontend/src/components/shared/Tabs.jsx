import React, { useRef } from 'react';

/**
 * Accessible tab bar (WAI-ARIA tabs pattern): arrow keys / Home / End move between tabs.
 * Pair it with <TabPanel> using the same idPrefix.
 *
 *   <Tabs idPrefix="profile" tabs={[{ id: 'personal', label: 'Personal', icon: User }]} active={tab} onChange={setTab} />
 *   <TabPanel idPrefix="profile" id="personal" active={tab}>...</TabPanel>
 */
export default function Tabs({ tabs, active, onChange, idPrefix = 'tabs', label = 'Sections' }) {
  const refs = useRef({});

  const focusTab = (index) => {
    const tab = tabs[(index + tabs.length) % tabs.length];
    onChange(tab.id);
    refs.current[tab.id]?.focus();
  };

  const onKeyDown = (event, index) => {
    const keys = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
    if (event.key in keys) {
      event.preventDefault();
      focusTab(keys[event.key]);
    }
  };

  return (
    <div className="tab-bar" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const selected = tab.id === active;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            ref={(el) => { refs.current[tab.id] = el; }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            className={`tab-bar-item ${selected ? 'active' : ''}`}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {Icon && <Icon size={15} aria-hidden="true" />}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idPrefix = 'tabs', id, active, children, className = '' }) {
  if (id !== active) return null;
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${id}`}
      aria-labelledby={`${idPrefix}-tab-${id}`}
      tabIndex={0}
      className={`tab-panel ${className}`.trim()}
    >
      {children}
    </div>
  );
}
