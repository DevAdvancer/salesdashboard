'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Save,
  User,
  ShieldCheck,
  Briefcase,
  AlertCircle,
  ExternalLink,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/contexts/auth-context';
import {
  RESUME_PROFILE_STAGES,
  type ResumeProfile,
  type ResumeProfileStage,
} from '@/lib/types';
import {
  updateResumeProfileAction,
  moveResumeProfileToMarketingAction,
  type UpdateResumeProfileInput,
} from '@/app/actions/resume-profiles';
import { EmployerExperienceFields } from '@/components/resume/employer-experience-fields';
import {
  type EmployerEntry,
  parseExperience,
  serializeExperience,
} from '@/lib/utils/resume-experience';

interface ResumeProfileDetailProps {
  initialProfile: ResumeProfile & { $id: string };
  assignableUsers: { $id: string; name: string; email: string }[];
}

export function ResumeProfileDetail({
  initialProfile,
  assignableUsers,
}: ResumeProfileDetailProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [profile, setProfile] = useState(initialProfile);

  const isLeadership =
    user?.role === 'admin' ||
    user?.role === 'developer' ||
    user?.role === 'monitor' ||
    user?.role === 'operations';
  const canAssign = user?.role === 'team_lead' || isLeadership;

  const [candidateName, setCandidateName] = useState(profile.candidateName || '');
  const [technology, setTechnology] = useState(profile.technology || '');
  const [usaArrival, setUsaArrival] = useState(profile.usaArrival || '');
  const [bachelors, setBachelors] = useState(profile.bachelors || '');
  const [masters, setMasters] = useState(profile.masters || '');

  const [cpt, setCpt] = useState(profile.cpt || 'NO');
  const [cptDetails, setCptDetails] = useState(profile.cptDetails || '');
  const [opt, setOpt] = useState(profile.opt || 'NO');
  const [optDetails, setOptDetails] = useState(profile.optDetails || '');
  const [stemOpt, setStemOpt] = useState(profile.stemOpt || 'NO');
  const [stemOptDetails, setStemOptDetails] = useState(profile.stemOptDetails || '');

  const parsedExperience = parseExperience(profile.indiaExperience);
  const [experience, setExperience] = useState<EmployerEntry[]>(parsedExperience.entries);
  const [experienceLegacyText] = useState(parsedExperience.legacyText);
  const [missingDocs, setMissingDocs] = useState(profile.missingDocs || '');
  const [resumeTimeline, setResumeTimeline] = useState(profile.resumeTimeline || '');
  const [remarks, setRemarks] = useState(profile.remarks || '');
  const [stage, setStage] = useState<ResumeProfileStage>(
    (profile.stage as ResumeProfileStage) || '1. Draft'
  );
  const [assignedToId, setAssignedToId] = useState(profile.assignedToId || '');

  const [saving, setSaving] = useState(false);
  const [movingToMarketing, setMovingToMarketing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // The profile lands on the Marketing page once this flag flips. The button
  // that sets it is only enabled at the '4. Marketing' stage, mirroring how a
  // lead surfaces on the Client page only after it's closed.
  const movedToMarketing = profile.movedToMarketing === true;
  const canMoveToMarketing = stage === '4. Marketing' && !movedToMarketing;

  const handleMoveToMarketing = async () => {
    setMovingToMarketing(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const updated = await moveResumeProfileToMarketingAction(profile.$id);
      setProfile(updated);
      setSuccessMsg('Profile moved to Marketing.');
      setTimeout(() => setSuccessMsg(null), 3500);
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to move profile to marketing');
    } finally {
      setMovingToMarketing(false);
    }
  };

  const handleSave = async (eOrStage?: React.FormEvent | ResumeProfileStage) => {
    if (eOrStage && typeof eOrStage === 'object' && 'preventDefault' in eOrStage) {
      eOrStage.preventDefault();
    }
    const customStage = typeof eOrStage === 'string' ? eOrStage : undefined;

    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const selectedUser = assignableUsers.find((u) => u.$id === assignedToId);
      const updates: UpdateResumeProfileInput = {
        $id: profile.$id,
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
        stage: customStage || stage,
        assignedToId: canAssign ? (assignedToId || null) : profile.assignedToId,
        assignedToName: canAssign ? (selectedUser?.name || null) : profile.assignedToName,
      };

      const updated = await updateResumeProfileAction(updates);
      setProfile(updated);
      setStage(updated.stage as ResumeProfileStage);
      setSuccessMsg('Profile saved successfully.');
      setTimeout(() => setSuccessMsg(null), 3500);
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickStageMove = async (nextStage: ResumeProfileStage) => {
    setStage(nextStage);
    await handleSave(nextStage);
  };

  const hasCpt = cpt === 'YES';
  const hasOpt = opt === 'YES';
  const hasStem = stemOpt === 'YES';

  return (
    <div className="space-y-6 pb-12">
      {/* Header Bar */}
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
              {candidateName || 'Untitled Profile'}
              <span className="text-xs font-normal text-muted-foreground px-2 py-0.5 bg-muted rounded-full border">
                ID: {profile.$id}
              </span>
            </h1>
            {profile.callRequestId && (
              <Link href="/call-requests" className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5">
                Linked Call Request <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">Stage:</span>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value as ResumeProfileStage)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary shadow-sm"
            >
              {RESUME_PROFILE_STAGES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">Assigned:</span>
            <select
              value={assignedToId}
              disabled={!canAssign || saving}
              onChange={(e) => setAssignedToId(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <option value="">-- Unassigned --</option>
              {assignableUsers.map((u) => (
                <option key={u.$id} value={u.$id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          <Button
            onClick={() => handleSave()}
            disabled={saving}
            className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>

          {movedToMarketing ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-100 dark:bg-emerald-900/40 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <TrendingUp className="h-4 w-4" />
              In Marketing
            </span>
          ) : (
            <Button
              onClick={handleMoveToMarketing}
              disabled={!canMoveToMarketing || movingToMarketing || saving}
              variant="outline"
              title={
                canMoveToMarketing
                  ? 'Move this profile to the Marketing page'
                  : 'Available once the profile reaches the "4. Marketing" stage'
              }
              className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <TrendingUp className="h-4 w-4" />
              {movingToMarketing ? 'Moving...' : 'Move to Marketing'}
            </Button>
          )}
        </div>
      </div>

      {successMsg && (
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 dark:bg-emerald-950/40 p-3 text-sm text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/15 p-3 text-sm text-destructive border border-destructive/20">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Grid Forms */}
      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 columns: Education, Work Authorization, Experience */}
        <div className="lg:col-span-2 space-y-6">
          {/* Section 1: Basic Information & Education */}
          <Card className="p-5 border border-border shadow-sm space-y-4">
            <div className="flex items-center gap-2 border-b pb-2 text-sm font-semibold text-foreground">
              <User className="h-4 w-4 text-primary" />
              Basic Information & Education
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Candidate Name *
                </label>
                <input
                  type="text"
                  required
                  value={candidateName}
                  onChange={(e) => setCandidateName(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Technology
                </label>
                <input
                  type="text"
                  value={technology}
                  onChange={(e) => setTechnology(e.target.value)}
                  placeholder="e.g. Data Engineer / Java"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  USA Arrival
                </label>
                <input
                  type="text"
                  value={usaArrival}
                  onChange={(e) => setUsaArrival(e.target.value)}
                  placeholder="e.g. Aug 2021 / F1"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Bachelors (Start Date - End Date MM YYYY)
                </label>
                <input
                  type="text"
                  value={bachelors}
                  onChange={(e) => setBachelors(e.target.value)}
                  placeholder="e.g. JNTU Hyderabad (08 2016 - 05 2020)"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Masters (Start Date - End Date MM YYYY)
                </label>
                <input
                  type="text"
                  value={masters}
                  onChange={(e) => setMasters(e.target.value)}
                  placeholder="e.g. Texas A&M (08 2021 - 05 2023)"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </Card>

          {/* Section 2: Work Authorization */}
          <Card className="p-5 border border-border shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Work Authorization Verification (I-20 / I-983)
              </div>
            </div>

            {/* CPT block */}
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
                    placeholder="e.g. ABC Tech - Software Intern - 06/01/2022 to 08/15/2022 (Verified from I-20 pg 2)"
                    className="w-full rounded-md border border-input bg-background p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}
            </div>

            {/* OPT block */}
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
                    placeholder="e.g. XYZ Systems - Software Engineer - 06/01/2023 to 05/31/2024 (Verified from I-20)"
                    className="w-full rounded-md border border-input bg-background p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}
            </div>

            {/* STEM OPT block */}
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
                    placeholder="e.g. TechCorp USA - Full Stack Developer - 06/01/2024 to 05/31/2026 (Verified from Form I-983 training plan & I-20)"
                    className="w-full rounded-md border border-input bg-background p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}
            </div>
          </Card>

          {/* Section 3: India Experience & Missing Documentation */}
          <Card className="p-5 border border-border shadow-sm space-y-4">
            <div className="flex items-center gap-2 border-b pb-2 text-sm font-semibold text-foreground">
              <Briefcase className="h-4 w-4 text-primary" />
              Prior Experience & Documentation Checklist
            </div>

            <EmployerExperienceFields
              entries={experience}
              onChange={setExperience}
              legacyText={experienceLegacyText}
            />

            <div>
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

        {/* Right 1 column: Timeline, Remarks, SLA info */}
        <div className="space-y-6">
          {/* Timeline & SLA info */}
          <Card className="p-5 border border-border shadow-sm space-y-4">
            <div className="flex items-center gap-2 border-b pb-2 text-sm font-semibold text-foreground">
              <Clock className="h-4 w-4 text-primary" />
              Stage SLA & Timeline Notes
            </div>

            <div className="rounded-md bg-muted/40 p-3 text-xs space-y-1.5">
              <div className="font-semibold text-foreground flex items-center justify-between">
                <span>Current Stage SLA:</span>
                <span className="text-primary font-bold">
                  {stage === '1. Draft' && '2 Hours'}
                  {stage === '2. Sent' && '3 Hours'}
                  {stage === '3. Modification /Approval (candidate/client)' && '2 Hours'}
                  {stage === '4. Marketing' && '4 Hours'}
                  {stage === '5. Doc Missing (Not calculated in the timeline)' && 'Paused (Excluded)'}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                If the candidate remains in this stage longer than the SLA threshold without moving to the next stage, an alert notification is automatically sent to the assigned agent and Resume Team Leads.
              </p>
              {profile.stageUpdatedAt && (
                <div className="text-[11px] text-muted-foreground pt-1 border-t">
                  Last stage transition: {new Date(profile.stageUpdatedAt).toLocaleString()}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Resume Timeline Tracking & Stage Notes
              </label>
              <textarea
                rows={6}
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

            <Button
              type="submit"
              disabled={saving}
              className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90 mt-2"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving Profile...' : 'Save Profile Changes'}
            </Button>
          </Card>
        </div>
      </form>
    </div>
  );
}
