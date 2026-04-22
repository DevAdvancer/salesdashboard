'use client';

import { useEffect, useState } from 'react';
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
    tagBg: 'rgba(201,100,66,0.15)',
    tagColor: '#d97757',
    iconBg: 'rgba(201,100,66,0.12)',
    iconColor: '#d97757',
    title: 'Interview Support module',
    description:
      'A dedicated Interview Support tab lets you send structured interview emails with candidate details, technology, interview round, and job description — with duplicate subject prevention.',
  },
  {
    icon: <Zap size={14} />,
    tag: 'Feature',
    tagBg: 'rgba(201,100,66,0.15)',
    tagColor: '#d97757',
    iconBg: 'rgba(201,100,66,0.12)',
    iconColor: '#d97757',
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
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) setOpen(true);
  }, []);

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
          background: 'rgba(15,15,14,0.72)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
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
          /* card bg = --surface-1 #1c1b19 */
          background: '#1c1b19',
          border: '1px solid #30302e',
          borderRadius: '0.875rem',
          boxShadow: '0 24px 64px rgba(0,0,0,0.65), 0 2px 8px rgba(0,0,0,0.4)',
          animation: 'wnSlideUp 0.28s cubic-bezier(0.34,1.4,0.64,1)',
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          scrollbarWidth: 'thin',
          scrollbarColor: '#30302e transparent',
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            padding: '1.375rem 1.375rem 1rem',
            borderBottom: '1px solid #30302e',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.875rem',
            position: 'sticky',
            top: 0,
            background: '#1c1b19',
            borderRadius: '0.875rem 0.875rem 0 0',
            zIndex: 1,
          }}
        >
          {/* Terracotta icon */}
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: '0.625rem',
              background: 'rgba(201,100,66,0.16)',
              border: '1px solid rgba(201,100,66,0.28)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#d97757',
              flexShrink: 0,
            }}
          >
            <Sparkles size={18} />
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              {/* Playfair Display heading — matches dashboard h-tags */}
              <h2
                id="wn-title"
                style={{
                  margin: 0,
                  fontSize: '1.125rem',
                  fontWeight: 500,
                  color: '#faf9f5',
                  fontFamily: "'Playfair Display', Georgia, 'Times New Roman', serif",
                  letterSpacing: 'normal',
                  lineHeight: 1.2,
                }}
              >
                What's New
              </h2>
              {/* Version pill — matches badge-brand */}
              <span
                style={{
                  fontSize: '0.625rem',
                  fontWeight: 600,
                  color: '#d97757',
                  background: 'rgba(201,100,66,0.15)',
                  border: '1px solid rgba(201,100,66,0.30)',
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
                color: '#87867f',
                lineHeight: 1.5,
              }}
            >
              Here's what changed in this update
            </p>
          </div>

          {/* Close button */}
          <button
            onClick={dismiss}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: '1px solid #30302e',
              borderRadius: '0.5rem',
              color: '#87867f',
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
              btn.style.background = '#2e2d2b';
              btn.style.color = '#faf9f5';
              btn.style.borderColor = '#3d3d3a';
            }}
            onMouseLeave={(e) => {
              const btn = e.currentTarget;
              btn.style.background = 'transparent';
              btn.style.color = '#87867f';
              btn.style.borderColor = '#30302e';
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
                borderBottom: i < CHANGES.length - 1 ? '1px solid rgba(48,48,46,0.7)' : 'none',
                transition: 'background 0.12s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#252422'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              {/* Icon */}
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '0.5rem',
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
                      color: '#faf9f5',
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
                    color: '#87867f',
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
            borderTop: '1px solid #30302e',
          }}
        >
          <button
            onClick={dismiss}
            style={{
              background: '#c96442',
              border: 'none',
              borderRadius: '0.625rem',
              color: '#faf9f5',
              fontWeight: 500,
              fontSize: '0.875rem',
              padding: '0.5rem 1.375rem',
              cursor: 'pointer',
              fontFamily: 'Inter, system-ui, sans-serif',
              transition: 'background 0.15s, transform 0.15s',
              letterSpacing: '0.01em',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = '#d97757';
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = '#c96442';
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
