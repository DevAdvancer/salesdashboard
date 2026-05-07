'use client';

import { useState } from 'react';
import { X, Sparkles, Bug, Zap, Shield } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// BUMP THIS KEY every time you ship new changes.
// Users who dismissed this version won't see the popup again
// until you change the version string.
// ─────────────────────────────────────────────────────────────────────────────
const WHATS_NEW_VERSION = 'v1.4.0';
const STORAGE_KEY = `whats_new_seen_${WHATS_NEW_VERSION}`;

interface ChangeItem {
  icon: React.ReactNode;
  tag: string;
  tagBg: string;
  tagColor: string;
  iconBg: string;
  iconColor: string;
  title: string;
  description: string;
}

const CHANGES: ChangeItem[] = [
  {
    icon: <Bug size={14} />,
    tag: 'Fix',
    tagBg: 'rgba(192,57,43,0.15)',
    tagColor: '#e57368',
    iconBg: 'rgba(192,57,43,0.12)',
    iconColor: '#e57368',
    title: 'Cross-user Mock / Assessment / Interview badges',
    description:
      'The "Mock Created" and "X Sent" badges now correctly show for all users who can see a client — even if a different team member created the entry.',
  },
  {
    icon: <Zap size={14} />,
    tag: 'Feature',
    tagBg: '#f5f5f5',
    tagColor: '#111111',
    iconBg: '#f5f5f5',
    iconColor: '#111111',
    title: 'Interview Support module',
    description:
      'A dedicated Interview Support tab lets you send structured interview emails with candidate details, technology, interview round, and job description — with duplicate subject prevention.',
  },
  {
    icon: <Zap size={14} />,
    tag: 'Feature',
    tagBg: '#f5f5f5',
    tagColor: '#111111',
    iconBg: '#f5f5f5',
    iconColor: '#111111',
    title: 'Sales Assessment Support module',
    description:
      'Send assessment support emails directly from the CRM with resume & file attachments, job descriptions, and full audit logging.',
  },
  {
    icon: <Shield size={14} />,
    tag: 'Improvement',
    tagBg: 'rgba(136,115,79,0.18)',
    tagColor: '#c9a86c',
    iconBg: 'rgba(136,115,79,0.12)',
    iconColor: '#c9a86c',
    title: 'Audit logs for Mock, Assessment & Interview',
    description:
      'Every Mock, Assessment, and Interview Support email is now recorded in the Audit Log with full metadata and actor tracking.',
  },
  {
    icon: <Sparkles size={14} />,
    tag: 'Design',
    tagBg: 'rgba(94,93,89,0.28)',
    tagColor: '#b0aea5',
    iconBg: 'rgba(94,93,89,0.18)',
    iconColor: '#b0aea5',
    title: 'Dark theme polish & branding update',
    description:
      'Refined dark mode with soft-rounded inputs, updated Silverspace / Vizva logos in email signatures, and consistent styling across all modules.',
  },
];

export function WhatsNewModal() {
  const [open, setOpen] = useState(() => (
    typeof window !== 'undefined' && !localStorage.getItem(STORAGE_KEY)
  ));

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setOpen(false);
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop — matches .dialog-overlay */}
      <div
        onClick={dismiss}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(17,17,17,0.42)',
          zIndex: 9998,
          animation: 'wnFadeIn 0.22s ease',
        }}
      />

      {/* Modal panel — surface-1 card with warm border */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wn-title"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 9999,
          width: 'min(520px, 94vw)',
          maxHeight: '88vh',
          overflowY: 'auto',
          background: '#ffffff',
          border: '1px solid #e5e5e5',
          borderRadius: 0,
          boxShadow: 'none',
          animation: 'wnSlideUp 0.28s cubic-bezier(0.34,1.4,0.64,1)',
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          scrollbarWidth: 'thin',
          scrollbarColor: '#cacacb transparent',
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            padding: '1.375rem 1.375rem 1rem',
            borderBottom: '1px solid #e5e5e5',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.875rem',
            position: 'sticky',
            top: 0,
            background: '#ffffff',
            borderRadius: 0,
            zIndex: 1,
          }}
        >
          {/* Terracotta icon */}
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: '9999px',
              background: '#111111',
              border: '1px solid #111111',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              flexShrink: 0,
            }}
          >
            <Sparkles size={18} />
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <h2
                id="wn-title"
                style={{
                  margin: 0,
                  fontSize: '1.125rem',
                  fontWeight: 500,
                  color: '#111111',
                  fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
                  letterSpacing: 'normal',
                  lineHeight: 1.2,
                }}
              >
                What&apos;s New
              </h2>
              {/* Version pill — matches badge-brand */}
              <span
                style={{
                  fontSize: '0.625rem',
                  fontWeight: 600,
                  color: '#111111',
                  background: '#f5f5f5',
                  border: '1px solid #cacacb',
                  padding: '0.1rem 0.45rem',
                  borderRadius: '999px',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase' as const,
                }}
              >
                {WHATS_NEW_VERSION}
              </span>
            </div>
            <p
              style={{
                margin: '0.2rem 0 0',
                fontSize: '0.8125rem',
                color: '#707072',
                lineHeight: 1.5,
              }}
            >
              Here&apos;s what changed in this update
            </p>
          </div>

          {/* Close button */}
          <button
            onClick={dismiss}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: '1px solid #e5e5e5',
              borderRadius: '9999px',
              color: '#707072',
              cursor: 'pointer',
              padding: '0.3rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.15s, color 0.15s, border-color 0.15s',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              const btn = e.currentTarget;
              btn.style.background = '#f5f5f5';
              btn.style.color = '#111111';
              btn.style.borderColor = '#cacacb';
            }}
            onMouseLeave={(e) => {
              const btn = e.currentTarget;
              btn.style.background = 'transparent';
              btn.style.color = '#707072';
              btn.style.borderColor = '#e5e5e5';
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* ── Change list ── */}
        <div style={{ padding: '0.5rem 0' }}>
          {CHANGES.map((item, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: '0.875rem',
                padding: '0.875rem 1.375rem',
                borderBottom: i < CHANGES.length - 1 ? '1px solid #e5e5e5' : 'none',
                transition: 'background 0.12s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#f5f5f5'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              {/* Icon */}
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '9999px',
                  background: item.iconBg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: item.iconColor,
                  flexShrink: 0,
                  marginTop: '0.1rem',
                }}
              >
                {item.icon}
              </div>

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    flexWrap: 'wrap' as const,
                    marginBottom: '0.2rem',
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.6rem',
                      fontWeight: 700,
                      color: item.tagColor,
                      background: item.tagBg,
                      padding: '0.05rem 0.4rem',
                      borderRadius: '999px',
                      textTransform: 'uppercase' as const,
                      letterSpacing: '0.07em',
                    }}
                  >
                    {item.tag}
                  </span>
                  <span
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      color: '#111111',
                      lineHeight: 1.3,
                    }}
                  >
                    {item.title}
                  </span>
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: '0.8rem',
                    color: '#707072',
                    lineHeight: 1.6,
                  }}
                >
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Footer ── */}
        <div
          style={{
            padding: '1rem 1.375rem 1.25rem',
            display: 'flex',
            justifyContent: 'flex-end',
            borderTop: '1px solid #e5e5e5',
          }}
        >
          <button
            onClick={dismiss}
            style={{
              background: '#111111',
              border: 'none',
              borderRadius: '9999px',
              color: '#ffffff',
              fontWeight: 500,
              fontSize: '0.875rem',
              padding: '0.5rem 1.375rem',
              cursor: 'pointer',
              fontFamily: 'Inter, system-ui, sans-serif',
              transition: 'background 0.15s, transform 0.15s',
              letterSpacing: '0.01em',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = '#111111';
              (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.98)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = '#111111';
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
            }}
          >
            Got it
          </button>
        </div>
      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes wnFadeIn  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes wnSlideUp {
          from { opacity: 0; transform: translate(-50%, -47%) scale(0.97); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>
    </>
  );
}
