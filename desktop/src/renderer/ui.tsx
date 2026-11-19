import React from 'react';

/** Mobildeki src/components/ui.tsx yapı taşlarının web karşılığı. */

export function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      {title ? <div className="card-title">{title}</div> : null}
      {children}
    </section>
  );
}

export function Button({
  label,
  onPress,
  disabled,
  loading,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'danger' | 'ghost';
}) {
  return (
    <button
      type="button"
      className={`btn ${variant === 'primary' ? '' : variant}`}
      onClick={onPress}
      disabled={disabled || loading}
    >
      {loading ? <span className="spinner" aria-label="Bekleniyor" /> : label}
    </button>
  );
}

export function Field(
  props: React.InputHTMLAttributes<HTMLInputElement> & { onChangeText?: (v: string) => void },
) {
  const { onChangeText, className, ...rest } = props;
  return (
    <input
      autoComplete="off"
      spellCheck={false}
      {...rest}
      className={`field ${className ?? ''}`}
      onChange={e => onChangeText?.(e.target.value)}
    />
  );
}

export function Para({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'text' | 'ok' | 'warn' | 'error';
}) {
  return <p className={`para tone-${tone}`}>{children}</p>;
}

export function Row({ children }: { children: React.ReactNode }) {
  return <div className="row">{children}</div>;
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header>
      <h1 className="page-title">{title}</h1>
      {subtitle ? <div className="page-subtitle">{subtitle}</div> : null}
    </header>
  );
}

export function Page({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="page">
      <PageHeader title={title} subtitle={subtitle} />
      {children}
    </div>
  );
}

export function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <div>
        <div className="tone-text">{label}</div>
        {hint ? <div className="tone-muted" style={{ fontSize: 12, marginTop: 2 }}>{hint}</div> : null}
      </div>
      <span className="switch">
        <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
        <span />
      </span>
    </label>
  );
}

export function Spinner() {
  return <span className="spinner big" aria-label="Yükleniyor" />;
}
