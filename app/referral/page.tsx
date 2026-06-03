'use client';

import { FormEvent, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, CheckCircle2, Link2, Moon, Send, Sun } from 'lucide-react';
import { createPublicLeadRequestAction } from '@/app/actions/lead-requests';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type FormState = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  linkedinProfileUrl: string;
  city: string;
  interestedService: string;
  referrerName: string;
  notes: string;
  referrerCompany: string;
  bonusAmount: string;
  paymentDate: string;
  paymentMode: string;
  salesPerson: string;
};

const initialState: FormState = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  linkedinProfileUrl: '',
  city: '',
  interestedService: '',
  referrerName: '',
  notes: '',
  referrerCompany: '',
  bonusAmount: '',
  paymentDate: '',
  paymentMode: '',
  salesPerson: '',
};

export default function ReferralPage() {
  const [form, setForm] = useState<FormState>(initialState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submittedRequestId, setSubmittedRequestId] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const savedTheme = localStorage.getItem('salesdashboard-theme') === 'dark' ? 'dark' : 'light';
    setTheme(savedTheme);
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('salesdashboard-theme', nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
    document.documentElement.style.colorScheme = nextTheme;
  };

  const updateField = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const result = await createPublicLeadRequestAction(form);
      setSubmittedRequestId(result.requestId);
      setForm(initialState);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit referral.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen bg-[var(--background)] px-4 py-8 text-[var(--foreground)] sm:px-6 lg:px-8">
      <div className="absolute top-4 right-4 sm:top-6 sm:right-8">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="h-10 w-10 rounded-full border-[var(--border)] bg-[var(--card)] hover:bg-[var(--accent)]"
        >
          {mounted && theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </Button>
      </div>
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-5xl content-center gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/silverspace.png" alt="Silverspace Inc." className="h-8 w-8 object-contain" />
            </span>
            <div>
              <p className="text-sm font-medium text-[var(--muted-foreground)]">Silverspace Inc.</p>
              <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">Refer a Lead</h1>
            </div>
          </div>

          <p className="max-w-lg text-base leading-7 text-[var(--muted-foreground)]">
            Share a standard lead referral with the sales team. The admin team reviews every request before it becomes an active CRM lead.
          </p>

          <div className="flex items-center gap-3 text-sm text-[var(--muted-foreground)]">
            <Link2 size={18} className="text-[var(--primary)]" />
            <span>LinkedIn, email, and phone are checked before assignment.</span>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm sm:p-6">
          {submittedRequestId ? (
            <div className="flex min-h-[26rem] flex-col items-start justify-center gap-4">
              <CheckCircle2 className="text-emerald-500" size={34} />
              <div>
                <h2 className="text-xl font-semibold">Referral submitted</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                  The admin team can now review this request and move it into Leads.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={() => setSubmittedRequestId('')}>
                Add another referral
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name" required>
                  <Input value={form.firstName} onChange={(event) => updateField('firstName', event.target.value)} required />
                </Field>
                <Field label="Last name" required>
                  <Input value={form.lastName} onChange={(event) => updateField('lastName', event.target.value)} required />
                </Field>
                <Field label="Phone" required>
                  <Input value={form.phone} onChange={(event) => updateField('phone', event.target.value)} placeholder="+1 555 000 0000" required />
                </Field>
                <Field label="Email" required>
                  <Input type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} placeholder="lead@example.com" required />
                </Field>
                <Field label="LinkedIn link" required>
                  <Input value={form.linkedinProfileUrl} onChange={(event) => updateField('linkedinProfileUrl', event.target.value)} placeholder="linkedin.com/in/profile" required />
                </Field>
                <Field label="City">
                  <Input value={form.city} onChange={(event) => updateField('city', event.target.value)} />
                </Field>
                <Field label="Interested service">
                  <Input value={form.interestedService} onChange={(event) => updateField('interestedService', event.target.value)} />
                </Field>
                <Field label="Referrer name">
                  <Input value={form.referrerName} onChange={(event) => updateField('referrerName', event.target.value)} />
                </Field>
                <Field label="Company (SST/VCS)">
                  <Input value={form.referrerCompany} onChange={(event) => updateField('referrerCompany', event.target.value)} placeholder="e.g. SST" />
                </Field>
                <Field label="Bonus Amount">
                  <Input value={form.bonusAmount} onChange={(event) => updateField('bonusAmount', event.target.value)} placeholder="e.g. $500" />
                </Field>
                <Field label="Date of Payment">
                  <Input value={form.paymentDate} onChange={(event) => updateField('paymentDate', event.target.value)} placeholder="e.g. NA" />
                </Field>
                <Field label="Payment Mode">
                  <Input value={form.paymentMode} onChange={(event) => updateField('paymentMode', event.target.value)} placeholder="e.g. Stripe" />
                </Field>
                <Field label="Sales Person">
                  <Input value={form.salesPerson} onChange={(event) => updateField('salesPerson', event.target.value)} placeholder="e.g. Dhananjay Patil" />
                </Field>
              </div>

              <Field label="Notes">
                <Textarea value={form.notes} onChange={(event) => updateField('notes', event.target.value)} rows={4} />
              </Field>

              {error ? (
                <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <Button type="submit" className="w-full sm:w-auto" disabled={isSubmitting}>
                <Send size={16} />
                {isSubmitting ? 'Submitting...' : 'Submit referral'}
                <ArrowRight size={16} />
              </Button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>
        {label}
        {required ? <span className="ml-1 text-red-500">*</span> : null}
      </Label>
      {children}
    </div>
  );
}
