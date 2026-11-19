import React from 'react';

export interface TabItem<K extends string> {
  key: K;
  label: string;
  /** Metin sunumlu glif (emoji olarak çizilmesin diye). */
  icon: string;
  /** Sekmenin üstünde küçük yeşil nokta (ör. okuma çalışıyor). */
  badge?: boolean;
}

/** Pencerenin altındaki sekme çubuğu (mobildeki TabBar). */
export function TabBar<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: TabItem<K>[];
  active: K;
  onChange: (key: K) => void;
}) {
  return (
    <nav className="tabbar" role="tablist">
      {tabs.map(tab => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`tab ${selected ? 'active' : ''}`}
            onClick={() => onChange(tab.key)}
          >
            <span className="pill">
              {tab.icon}
              {tab.badge ? <span className="badge" /> : null}
            </span>
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
