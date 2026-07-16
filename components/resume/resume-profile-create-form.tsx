'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  UserPlus,
  PhoneCall,
  User as UserIcon,
  ShieldCheck,
  Briefcase,
  Clock,
  Save,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/contexts/auth-context';
import {
  RESUME_PROFILE_STAGES,
  type CallRequest,
  type ResumeProfileStage,
} from '@/lib/types';
import {
  createResumeProfileAction,
  getResumeProfileOptionsAction,
  type CreateResumeProfileInput,
} from '@/app/actions/resume-profiles';
import { EmployerExperienceFields } from '@/components/resume/employer-experience-fields';
import {
  type EmployerEntry,
  serializeExperience,
} from '@/lib/utils/resume-experience';

interface ResumeProfileCreateFormProps {
  initialCallRequests: (CallRequest & { $id: string })[];
  initialAssignableUsers: { $id: string; name: string; email: string }[];
}

const INPUT_CLASS =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';
const LABEL_CLASS = 'block text-xs font-medium text-muted-foreground mb-1';
const SECTION_HEADER_CLASS =
  'flex items-center gap-2 border-b pb-2 text-sm font-semibold text-foreground';

export function ResumeProfileCreateForm({
  initialCallRequests,
  initialAssignableUsers,
}: ResumeProfileCreateFormProps) {
  const router = useRouter();
  const { user, serverSessionReady } = useAuth();

  const [callRequests, setCallRequests] = useState(initialCallRequests);
  const [assignableUsers, setAssignableUsers] = useState(initialAssignableUsers);

  const [mode, setMode] = useState<'from_call' | 'manual'>('from_call');
  const [selectedCallId, setSelectedCallId] = useState('');
  const [candidateName, setCandidateName] = useState('');
  const [technology, setTechnology] = useState('');
  const [usaArrival, setUsaArrival] = useState('');
  const [bachelors, setBachelors] = useState('');
  const [masters, setMasters] = useState('');

  const [cpt, setCpt] = useState('NO');
  const [cptDetails, setCptDetails] = useState('');
  const [opt, setOpt] = useState('NO');
  const [optDetails, setOptDetails] = useState('');
  const [stemOpt, setStemOpt] = useState('NO');
  const [stemOptDetails, setStemOptDetails] = useState('');

  const [experience, setExperience] = useState<EmployerEntry[]>([]);
  const [missingDocs, setMissingDocs] = useState('');
  const [resumeTimeline, setResumeTimeline] = useState('');
  const [remarks, setRemarks] = useState('');
  const [stage, setStage] = useState<ResumeProfileStage>('1. Draft');
  const [assignedToId, setAssignedToId] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The page's server-side options fetch can come back empty if it runs before
  // the crm_appwrite_jwt cookie is written (right after login). Re-fetch once
  // the session is ready. See the serverSessionReady JWT-race pattern.
  useEffect(() => {
    if (!user || !serverSessionReady) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await getResumeProfileOptionsAction();
        if (cancelled) return;
        setCallRequests(next.callRequests);
        setAssignableUsers(next.assignableUsers);
      } catch {
        // Keep whatever the server component provided.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, serverSessionReady]);

  const handleSelectCall = (id: string) => {
    setSelectedCallId(id);
    const found = callRequests.find((c) => c.$id === id);
    if (found) {
      setCandidateName(found.clientName);
      if (found.assignedToId && !assignedToId) {
        setAssignedToId(found.assignedToId);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!candidateName.trim()) {
      setError('Candidate Name is required.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const selectedCall = callRequests.find((c) => c.$id === selectedCallId);
      const selectedUser = assignableUsers.find((u) => u.$id === assignedToId);

      const input: CreateResumeProfileInput = {
        candidateName: candidateName.trim(),
        technology: technology.trim() || null,
        usaArrival: usaArrival.trim() || null,
        bachelors: bachelors.trim() || null,
        masters: masters.trim() || null,
        cpt,
        cptDetails: cpt === 'YES' ? cptDetails.trim() || null : null,
        opt,
        optDetails: opt === 'YES' ? optDetails.trim() || null : null,
        stemOpt,
        stemOptDetails: stemOpt === 'YES' ? stemOptDetails.trim() || null : null,
        indiaExperience: serializeExperience(experience),
        missingDocs: missingDocs.trim() || null,
        resumeTimeline: resumeTimeline.trim() || null,
        remarks: remarks.trim() || null,
        stage,
        callRequestId: mode === 'from_call' && selectedCallId ? selectedCallId : null,
        leadId: mode === 'from_call' && selectedCall ? selectedCall.leadId : null,
        assignedToId: assignedToId || null,
        assignedToName: selectedUser?.name || null,
      };

      const created = await createResumeProfileAction(input);
      router.push(`/resume/${created.$id}`);
      router.refresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to create resume profile');
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-3">
          <Link href="/resume">
            <Button variant="ghost" size="sm" className="gap-1 px-2 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2 text-foreground">
              <UserPlus className="h-5 w-5 text-primary" />
              New Resume Profile
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Capture candidate details, work authorization, and prior experience.
            </p>
          </div>
        </div>
      </div>

      {/* Source mode toggle */}
      <div className="flex gap-2 max-w-md">
        <Button
          type="button"
          variant={mode === 'from_call' ? 'default' : 'outline'}
          onClick={() => setMode('from_call')}
          className="flex-1 gap-2 text-xs"
        >
          <PhoneCall className="h-4 w-4" />
          From Call Request
        </Button>
        <Button
          type="button"
          variant={mode === 'manual' ? 'default' : 'outline'}
          onClick={() => {
            setMode('manual');
            setSelectedCallId('');
          }}
          className="flex-1 gap-2 text-xs"
        >
          <UserPlus className="h-4 w-4" />
          Manual Entry
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/15 p-3 text-sm text-destructive border border-destructive/20">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: main details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic info */}
          <Card className="p-5 border border-border shadow-sm space-y-4">
            <div className={SECTION_HEADER_CLASS}>
              <UserIcon className="h-4 w-4 text-primary" />
              Basic Information & Education
            </div>

            {mode === 'from_call' && (
              <div>
                <label className={LABEL_CLASS}>Select Completed Call Request</label>
                <select
                  value={selectedCallId}
                  onChange={(e) => handleSelectCall(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">-- Choose Call Request --</option>
                  {callRequests.map((req) => (
                    <option key={req.$id} value={req.$id}>
                      {req.clientName} (Requested by: {req.requestedByName})
                    </option>
                  ))}
                </select>
                {callRequests.length === 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    No Call Requests with status &quot;Call done&quot; found. Switch to Manual Entry.
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={LABEL_CLASS}>Candidate Name *</label>
                <input
                  type="text"
                  required
                  value={candidateName}
                  onChange={(e) => setCandidateName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Technology</label>
                <input
                  type="text"
                  value={technology}
                  onChange={(e) => setTechnology(e.target.value)}
                  placeholder="e.g. Java Full Stack"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>USA Arrival</label>
                <input
                  type="text"
                  value={usaArrival}
                  onChange={(e) => setUsaArrival(e.target.value)}
                  placeholder="e.g. Aug 2022 / F1"
                  className={INPUT_CLASS}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div>
                <label className={LABEL_CLASS}>Bachelors (Start Date - End Date MM YYYY)</label>
                <input
                  type="text"
                  value={bachelors}
                  onChange={(e) => setBachelors(e.target.value)}
                  placeholder="e.g. JNTU Hyderabad (08 2016 - 05 2020)"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Masters (Start Date - End Date MM YYYY)</label>
                <input
                  type="text"
                  value={masters}
                  onChange={(e) => setMasters(e.target.value)}
                  placeholder="e.g. Texas A&M (08 2021 - 05 2023)"
                  className={INPUT_CLASS}
                />
              </div>
            </div>
          </Card>

          {/* Work authorization */}
          <Card className="p-5 border border-border shadow-sm space-y-4">
            <div className={SECTION_HEADER_CLASS}>
              <ShieldCheck className="h-4 w-4 text-primary" />
              Work Authorization Verification (I-20 / I-983)
            </div>

            {/* CPT */}
            <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground">CPT (Curricular Practical Training)</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Status:</span>
                  <select
                    value={cpt}
                    onChange={(e) => setCpt(e.target.value)}
                    className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="NO">NO</option>
                    <option value="YES">YES</option>
                  </select>
                </div>
              </div>
              {cpt === 'YES' && (
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                    Employer Name - Job Title - Start Date and End Date (Confirm it from I-20)
                  </label>
                  <textarea
                    rows={2}
                    value={cptDetails}
                    onChange={(e) => setCptDetails(e.target.value)}
                    placeholder="e.g. ABC Tech - Software Intern - 06/2022 to 08/2022 (Verified from I-20)"
                    className="w-full rounded-md border border-input bg-background p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}
            </div>

            {/* OPT */}
            <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground">OPT (Optional Practical Training)</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Status:</span>
                  <select
                    value={opt}
                    onChange={(e) => setOpt(e.target.value)}
                    className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="NO">NO</option>
                    <option value="YES">YES</option>
                  </select>
                </div>
              </div>
              {opt === 'YES' && (
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                    Employer Name - Job Title - Start Date and End Date (Confirm it from I-20)
                  </label>
                  <textarea
                    rows={2}
                    value={optDetails}
                    onChange={(e) => setOptDetails(e.target.value)}
                    placeholder="e.g. XYZ Systems - Software Engineer - 06/2023 to 05/2024 (Verified from I-20)"
                    className="w-full rounded-md border border-input bg-background p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}
            </div>

            {/* STEM OPT */}
            <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground">STEM OPT Extension</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Status:</span>
                  <select
                    value={stemOpt}
                    onChange={(e) => setStemOpt(e.target.value)}
                    className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="NO">NO</option>
                    <option value="YES">YES</option>
                  </select>
                </div>
              </div>
              {stemOpt === 'YES' && (
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                    Employer Name - Job Title - Start Date and End Date (Confirm it from I-983 and I-20)
                  </label>
                  <textarea
                    rows={2}
                    value={stemOptDetails}
                    onChange={(e) => setStemOptDetails(e.target.value)}
                    placeholder="e.g. TechCorp USA - Full Stack Developer - 06/2024 to 05/2026 (Verified from I-983 & I-20)"
                    className="w-full rounded-md border border-input bg-background p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}
            </div>
          </Card>

          {/* Experience & docs */}
          <Card className="p-5 border border-border shadow-sm space-y-4">
            <div className={SECTION_HEADER_CLASS}>
              <Briefcase className="h-4 w-4 text-primary" />
              Prior Experience & Documentation
            </div>

            <EmployerExperienceFields
              entries={experience}
              onChange={setExperience}
            />

            <div className="pt-2">
              <label className="block text-xs font-semibold text-foreground mb-1">
                Missing Documents / Pending Verification Notes
              </label>
              <textarea
                rows={3}
                value={missingDocs}
                onChange={(e) => setMissingDocs(e.target.value)}
                placeholder="List any missing transcripts, I-20 pages, relieving letters, or passport copies..."
                className="w-full rounded-md border border-input bg-background p-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </Card>
        </div>

        {/* Right: assignment, stage, timeline, remarks */}
        <div className="space-y-6">
          <Card className="p-5 border border-border shadow-sm space-y-4">
            <div className={SECTION_HEADER_CLASS}>
              <UserPlus className="h-4 w-4 text-primary" />
              Assignment & Stage
            </div>

            <div>
              <label className={LABEL_CLASS}>Initial Stage</label>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value as ResumeProfileStage)}
                className={INPUT_CLASS}
              >
                {RESUME_PROFILE_STAGES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL_CLASS}>Assign To</label>
              <select
                value={assignedToId}
                onChange={(e) => setAssignedToId(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">-- Unassigned --</option>
                {assignableUsers.map((u) => (
                  <option key={u.$id} value={u.$id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </Card>

          <Card className="p-5 border border-border shadow-sm space-y-4">
            <div className={SECTION_HEADER_CLASS}>
              <Clock className="h-4 w-4 text-primary" />
              Timeline & Remarks
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Resume Timeline with Clients and Job Role
              </label>
              <textarea
                rows={5}
                value={resumeTimeline}
                onChange={(e) => setResumeTimeline(e.target.value)}
                placeholder="Record draft sent time, modification requests, candidate feedback, client approval notes..."
                className="w-full rounded-md border border-input bg-background p-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                General Remarks / Internal Notes
              </label>
              <textarea
                rows={4}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Any additional remarks regarding resume marketing readiness..."
                className="w-full rounded-md border border-input bg-background p-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </Card>

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              disabled={saving}
              className="flex-1 gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Creating...' : 'Create Profile'}
            </Button>
            <Link href="/resume">
              <Button type="button" variant="outline" disabled={saving}>
                Cancel
              </Button>
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}
