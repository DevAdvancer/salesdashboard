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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/contexts/auth-context';
import { useToast } from '@/components/ui/use-toast';
import {
  RESUME_PROFILE_STAGES,
  type ResumeProfile,
  type ResumeProfileStage,
} from '@/lib/types';
import {
  updateResumeProfileAction,
  moveResumeProfileToMarketingAction,
  updateComplianceStatusAction,
  updateComplianceNotesAction,
  type UpdateResumeProfileInput,
} from '@/app/actions/resume-profiles';
import { EmployerExperienceFields } from '@/components/resume/employer-experience-fields';
import { EducationFields } from '@/components/resume/education-fields';
import { TimelineFields } from '@/components/resume/timeline-fields';
import {
  type EmployerEntry,
  parseExperience,
  serializeExperience,
} from '@/lib/utils/resume-experience';
import {
  type EducationEntry,
  type TimelineEntry,
  parseEducation,
  serializeEducation,
  parseTimeline,
  serializeTimeline,
} from '@/lib/utils/resume-fields';
import { formatEasternDateTime } from "@/lib/utils/eastern-date";

interface ResumeProfileDetailProps {
  initialProfile: ResumeProfile & { $id: string };
  assignableUsers: { $id: string; name: string; email: string }[];
  mode?: 'default' | 'compliance';
}

export function ResumeProfileDetail({
  initialProfile,
  assignableUsers,
  mode = 'default',
}: ResumeProfileDetailProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const [profile, setProfile] = useState(initialProfile);

  const isLeadership =
    user?.role === 'admin' ||
    user?.role === 'developer' ||
    user?.role === 'monitor' ||
    user?.role === 'operations';
  const canAssign = user?.role === 'team_lead' || isLeadership;

  const [candidateName, setCandidateName] = useState(profile.candidateName || '');
  
  let parsedData: any = {};
  try {
    if (profile.data) {
      parsedData = JSON.parse(profile.data);
    }
  } catch {
    // Ignore invalid JSON
  }

  const [technology, setTechnology] = useState(parsedData.technology || profile.technology || '');
  const [usaArrival, setUsaArrival] = useState(parsedData.usaArrival || profile.usaArrival || '');

  const parsedEducation = parseEducation(parsedData.educationHistory);
  const [educationHistory, setEducationHistory] = useState<EducationEntry[]>(parsedEducation.entries);
  const [educationLegacyText] = useState(() => {
    const parts = [];
    if (parsedEducation.legacyText) parts.push(parsedEducation.legacyText);
    if (parsedData.bachelors || profile.bachelors) parts.push(`Bachelors: ${parsedData.bachelors || profile.bachelors}`);
    if (parsedData.masters || profile.masters) parts.push(`Masters: ${parsedData.masters || profile.masters}`);
    return parts.join(' | ');
  });

  const [cpt, setCpt] = useState(parsedData.cpt || profile.cpt || 'NO');
  const parsedCpt = parseExperience(parsedData.cptEmployers || profile.cptDetails);
  const [cptEmployers, setCptEmployers] = useState<EmployerEntry[]>(parsedCpt.entries);
  const [cptLegacyText] = useState(parsedCpt.legacyText);

  const [opt, setOpt] = useState(parsedData.opt || profile.opt || 'NO');
  const parsedOpt = parseExperience(parsedData.optEmployers || profile.optDetails);
  const [optEmployers, setOptEmployers] = useState<EmployerEntry[]>(parsedOpt.entries);
  const [optLegacyText] = useState(parsedOpt.legacyText);

  const [stemOpt, setStemOpt] = useState(parsedData.stemOpt || profile.stemOpt || 'NO');
  const parsedStemOpt = parseExperience(parsedData.stemOptEmployers || profile.stemOptDetails);
  const [stemOptEmployers, setStemOptEmployers] = useState<EmployerEntry[]>(parsedStemOpt.entries);
  const [stemOptLegacyText] = useState(parsedStemOpt.legacyText);

  const parsedExperience = parseExperience(parsedData.experience || profile.experience);
  const [experience, setExperience] = useState<EmployerEntry[]>(parsedExperience.entries);
  const [experienceLegacyText] = useState(parsedExperience.legacyText);
  
  const [missingDocs, setMissingDocs] = useState(parsedData.missingDocs || profile.missingDocs || '');
  
  const parsedTimeline = parseTimeline(parsedData.timelineEntries || profile.resumeTimeline);
  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[]>(parsedTimeline.entries);
  const [timelineLegacyText] = useState(parsedTimeline.legacyText);
  const [visaStatus, setVisaStatus] = useState(parsedData.visaStatus || 'F1');
  const [gcEadYear, setGcEadYear] = useState(parsedData.gcEadYear || '');
  const [gcEadStartDate, setGcEadStartDate] = useState(parsedData.gcEadStartDate || '');
  const [gcEadEndDate, setGcEadEndDate] = useState(parsedData.gcEadEndDate || '');
  const [greenCardYear, setGreenCardYear] = useState(parsedData.greenCardYear || '');
  const [greenCardStartDate, setGreenCardStartDate] = useState(parsedData.greenCardStartDate || '');
  const [greenCardEndDate, setGreenCardEndDate] = useState(parsedData.greenCardEndDate || '');
  const [usCitizenYear, setUsCitizenYear] = useState(parsedData.usCitizenYear || '');

  const parsedH1b = parseExperience(parsedData.h1bEmployers);
  const [h1bEmployers, setH1bEmployers] = useState<EmployerEntry[]>(parsedH1b.entries);
  const [h1bLegacyText] = useState(parsedH1b.legacyText);

  const [remarks, setRemarks] = useState(parsedData.remarks || profile.remarks || '');
  const [stage, setStage] = useState<ResumeProfileStage>(
    (profile.stage as ResumeProfileStage) || '1. Draft'
  );
  const [assignedToId, setAssignedToId] = useState(profile.assignedToId || '');

  const [saving, setSaving] = useState(false);
  const [movingToMarketing, setMovingToMarketing] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showMarketingDialog, setShowMarketingDialog] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const movedToMarketing = profile.movedToMarketing === true;

  const handleCancelEdit = () => {
    let parsedData: any = {};
    try { if (profile.data) parsedData = JSON.parse(profile.data); } catch {}

    setCandidateName(profile.candidateName);
    setTechnology(parsedData.technology || profile.technology || '');
    setUsaArrival(parsedData.usaArrival || profile.usaArrival || '');
    
    setEducationHistory(parseEducation(parsedData.educationHistory).entries);
    
    setCpt(parsedData.cpt || profile.cpt || 'NO');
    setCptEmployers(parseExperience(parsedData.cptEmployers || profile.cptDetails).entries);
    
    setOpt(parsedData.opt || profile.opt || 'NO');
    setOptEmployers(parseExperience(parsedData.optEmployers || profile.optDetails).entries);
    
    setStemOpt(parsedData.stemOpt || profile.stemOpt || 'NO');
    setStemOptEmployers(parseExperience(parsedData.stemOptEmployers || profile.stemOptDetails).entries);
    
    setExperience(parseExperience(parsedData.experience || profile.experience).entries);
    setMissingDocs(parsedData.missingDocs || profile.missingDocs || '');
    setTimelineEntries(parseTimeline(parsedData.timelineEntries || profile.resumeTimeline).entries);
    
    setVisaStatus(parsedData.visaStatus || 'F1');
    setGcEadYear(parsedData.gcEadYear || '');
    setGcEadStartDate(parsedData.gcEadStartDate || '');
    setGcEadEndDate(parsedData.gcEadEndDate || '');
    setGreenCardYear(parsedData.greenCardYear || '');
    setGreenCardStartDate(parsedData.greenCardStartDate || '');
    setGreenCardEndDate(parsedData.greenCardEndDate || '');
    setUsCitizenYear(parsedData.usCitizenYear || '');
    setH1bEmployers(parseExperience(parsedData.h1bEmployers).entries);
    
    setRemarks(parsedData.remarks || profile.remarks || '');
    
    setStage(profile.stage as ResumeProfileStage);
    setAssignedToId(profile.assignedToId || '');
    
    setIsEditing(false);
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleMoveToMarketing = async () => {
    setShowMarketingDialog(false);
    setMovingToMarketing(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const updated = await moveResumeProfileToMarketingAction(profile.$id);
      setProfile(updated);
      setStage(updated.stage as ResumeProfileStage);
      toast({
        title: "Success",
        description: "Profile moved to Marketing.",
      });
      setSuccessMsg('Profile moved to Marketing.');
      setTimeout(() => setSuccessMsg(null), 3500);
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to move profile to marketing');
      toast({
        variant: "destructive",
        title: "Error",
        description: err?.message || 'Failed to move profile to marketing',
      });
    } finally {
      setMovingToMarketing(false);
    }
  };

  const handleSave = async (eOrStage?: React.FormEvent | ResumeProfileStage) => {
    if (eOrStage && typeof eOrStage === 'object' && 'preventDefault' in eOrStage) {
      eOrStage.preventDefault();
    }
    const customStage = typeof eOrStage === 'string' ? eOrStage : undefined;
    const finalStage = customStage || stage;

    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const selectedUser = assignableUsers.find((u) => u.$id === assignedToId);
      const updates: UpdateResumeProfileInput = {
        $id: profile.$id,
        candidateName: candidateName.trim(),
        stage: customStage || stage,
        assignedToId: canAssign ? (assignedToId || null) : profile.assignedToId,
        assignedToName: canAssign ? (selectedUser?.name || null) : profile.assignedToName,
        data: {
          technology: technology.trim() || null,
          usaArrival: usaArrival.trim() || null,
          cpt,
          opt,
          stemOpt,
          experience: serializeExperience(experience),
          educationHistory: serializeEducation(educationHistory),
          cptEmployers: cpt === 'YES' ? serializeExperience(cptEmployers) : null,
          optEmployers: opt === 'YES' ? serializeExperience(optEmployers) : null,
          stemOptEmployers: stemOpt === 'YES' ? serializeExperience(stemOptEmployers) : null,
          timelineEntries: serializeTimeline(timelineEntries),
          visaStatus,
          gcEadYear: visaStatus === 'GC EAD' ? gcEadYear.trim() : null,
          gcEadStartDate: visaStatus === 'GC EAD' ? gcEadStartDate.trim() : null,
          gcEadEndDate: visaStatus === 'GC EAD' ? gcEadEndDate.trim() : null,
          greenCardYear: visaStatus === 'Green Card' ? greenCardYear.trim() : null,
          greenCardStartDate: visaStatus === 'Green Card' ? greenCardStartDate.trim() : null,
          greenCardEndDate: visaStatus === 'Green Card' ? greenCardEndDate.trim() : null,
          usCitizenYear: visaStatus === 'US Citizen' ? usCitizenYear.trim() : null,
          h1bEmployers: visaStatus === 'H1B' ? serializeExperience(h1bEmployers) : null,
          missingDocs: missingDocs.trim() || null,
          remarks: remarks.trim() || null,
        }
      };

      const updated = await updateResumeProfileAction(updates);
      setProfile(updated);
      setStage(updated.stage as ResumeProfileStage);
      setIsEditing(false);
      setSuccessMsg('Profile saved successfully.');
      toast({
        title: "Success",
        description: "Profile saved successfully.",
      });
      setTimeout(() => setSuccessMsg(null), 3500);
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to update profile');
      toast({
        variant: "destructive",
        title: "Error",
        description: err?.message || 'Failed to update profile',
      });
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

  const isComplianceMode = mode === 'compliance';
  const [savingNotes, setSavingNotes] = useState(false);

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      await updateComplianceNotesAction(profile.$id, remarks);
      toast({
        title: "Success",
        description: "Notes saved.",
      });
      router.refresh();
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: err?.message || 'Failed to save notes',
      });
    } finally {
      setSavingNotes(false);
    }
  };

  const handleRejectProfile = async () => {
    setShowRejectDialog(false);
    try {
      await updateComplianceStatusAction(profile.$id, 'rejected');
      toast({
        title: "Success",
        description: "Profile rejected.",
      });
      router.refresh();
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: err?.message || 'Failed to reject profile',
      });
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Dialogs */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Profile</DialogTitle>
            <DialogDescription>
              Are you sure you want to reject this profile?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleRejectProfile}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showMarketingDialog} onOpenChange={setShowMarketingDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move to Marketing</DialogTitle>
            <DialogDescription>
              Are you sure you want to move this profile to Marketing? It will no longer be visible on the Resume Profiles page.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMarketingDialog(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleMoveToMarketing}>Move to Marketing</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isComplianceMode && profile.complianceStatus === 'pending' && (
        <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 p-4 mb-6 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-400 flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Compliance Approval Required
              </h3>
              <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
                This profile requires verification before the team can begin processing it.
              </p>
            </div>
            <div className="flex gap-2 items-center shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => setShowRejectDialog(true)}
              >
                Reject Profile
              </Button>
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white"
                onClick={async () => {
                  try {
                    await updateComplianceStatusAction(profile.$id, 'approved');
                    router.refresh();
                  } catch (e: any) { alert(e.message); }
                }}
              >
                Approve Profile
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-3">
          <Link href={isComplianceMode ? "/compliance-dashboard" : "/resume"}>
            <Button variant="ghost" size="sm" className="gap-1 px-2 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2 text-foreground">
              {candidateName || 'Untitled Profile'}
            </h1>
            {profile.callRequestId && (
              <Link href="/call-requests" className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5">
                Linked Call Request <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {profile.complianceStatus === 'pending' && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-100 dark:bg-amber-900/40 pl-3 pr-4 py-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              <Clock className="h-4 w-4" />
              Pending Compliance Approval
            </span>
          )}
          {profile.complianceStatus === 'rejected' && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-red-100 dark:bg-red-900/40 pl-3 pr-4 py-1.5 text-xs font-semibold text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800">
              <AlertCircle className="h-4 w-4" />
              Compliance Rejected
            </span>
          )}
          
          {!isComplianceMode && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">Stage:</span>
              <select
                value={stage}
                disabled={!isEditing || profile.complianceStatus !== 'approved'}
                onChange={(e) => setStage(e.target.value as ResumeProfileStage)}
                title={profile.complianceStatus !== 'approved' ? 'Profile must be approved by Compliance to change stage' : undefined}
                className="rounded-2xl border border-transparent bg-[var(--input)] pl-3 pr-8 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {(() => {
                  const currentIndex = RESUME_PROFILE_STAGES.indexOf(profile.stage as ResumeProfileStage);
                  return RESUME_PROFILE_STAGES.map((st, i) => {
                    if (i !== currentIndex && i !== currentIndex + 1) return null;
                    return (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    );
                  }).filter(Boolean);
                })()}
              </select>
            </div>
          )}

          {!isComplianceMode && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">Assigned:</span>
              <select
                value={assignedToId}
                disabled={!canAssign || saving || !isEditing}
                onChange={(e) => setAssignedToId(e.target.value)}
                className="rounded-2xl border border-transparent bg-[var(--input)] pl-3 pr-8 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="">-- Unassigned --</option>
                {assignableUsers.map((u) => (
                  <option key={u.$id} value={u.$id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!isComplianceMode && (
            <>
              {!isEditing ? (
                <Button
                  onClick={(e) => { e.preventDefault(); setIsEditing(true); }}
                  className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                >
                  Edit
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    onClick={(e) => { e.preventDefault(); handleCancelEdit(); }}
                    disabled={saving}
                    variant="outline"
                    className="gap-1.5 shadow-sm"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => handleSave()}
                    disabled={saving}
                    className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                  >
                    <Save className="h-4 w-4" />
                    {saving ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              )}
            </>
          )}

          {!isComplianceMode && (
            <>
              {movedToMarketing ? (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-100 dark:bg-emerald-900/40 pl-3 pr-8 py-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  <TrendingUp className="h-4 w-4" />
                  In Marketing
                </span>
              ) : (
                <Button
                  onClick={() => setShowMarketingDialog(true)}
                  disabled={movingToMarketing || saving}
                  variant="outline"
                  title="Move this profile to the Marketing page"
                  className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <TrendingUp className="h-4 w-4" />
                  {movingToMarketing ? 'Moving...' : 'Move to Marketing'}
                </Button>
              )}
            </>
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
          <fieldset disabled={!isEditing} className="space-y-6">
            {/* Section 1: Basic Information & Education */}
            <Card className="p-5 border border-border shadow-sm space-y-4">
              <div className="flex items-center gap-2 border-b pb-2 text-sm font-semibold text-foreground">
                <User className="h-4 w-4 text-primary" />
                Basic Information & Education
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Candidate Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={candidateName}
                    onChange={(e) => setCandidateName(e.target.value)}
                    className="w-full rounded-2xl border border-transparent bg-[var(--input)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
                    className="w-full rounded-2xl border border-transparent bg-[var(--input)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
                    placeholder="e.g. Aug 2021"
                    className="w-full rounded-2xl border border-transparent bg-[var(--input)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Visa Status
                  </label>
                  <select
                    value={visaStatus}
                    onChange={(e) => setVisaStatus(e.target.value)}
                    className="w-full rounded-2xl border border-transparent bg-[var(--input)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="F1">F1</option>
                    <option value="H1B">H1B</option>
                    <option value="H4 EAD">H4 EAD</option>
                    <option value="L2S">L2S</option>
                    <option value="GC EAD">GC EAD</option>
                    <option value="Green Card">Green Card</option>
                    <option value="US Citizen">US Citizen</option>
                    <option value="Asylum">Asylum</option>
                  </select>
                </div>
              </div>

              {visaStatus === 'GC EAD' && (
                <div className="pt-2 border-t mt-2">
                  <div className="text-sm font-semibold text-foreground mb-3">GC EAD Information</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">
                        Year GC EAD Was Obtained
                      </label>
                      <input
                        type="text"
                        value={gcEadYear}
                        onChange={(e) => setGcEadYear(e.target.value)}
                        className="w-full rounded-2xl border border-transparent bg-[var(--input)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="e.g. 2023"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">
                        GC EAD Start Date
                      </label>
                      <input
                        type="date"
                        value={gcEadStartDate}
                        onChange={(e) => setGcEadStartDate(e.target.value)}
                        className="w-full rounded-2xl border border-transparent bg-[var(--input)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">
                        GC EAD End Date
                      </label>
                      <input
                        type="date"
                        value={gcEadEndDate}
                        onChange={(e) => setGcEadEndDate(e.target.value)}
                        className="w-full rounded-2xl border border-transparent bg-[var(--input)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>
                </div>
              )}

              {visaStatus === 'Green Card' && (
                <div className="pt-2 border-t mt-2">
                  <div className="text-sm font-semibold text-foreground mb-3">Green Card Information</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">
                        Year Green Card Was Obtained
                      </label>
                      <input
                        type="text"
                        value={greenCardYear}
                        onChange={(e) => setGreenCardYear(e.target.value)}
                        className="w-full rounded-2xl border border-transparent bg-[var(--input)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="e.g. 2023"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">
                        Green Card Start Date
                      </label>
                      <input
                        type="date"
                        value={greenCardStartDate}
                        onChange={(e) => setGreenCardStartDate(e.target.value)}
                        className="w-full rounded-2xl border border-transparent bg-[var(--input)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">
                        Green Card End Date
                      </label>
                      <input
                        type="date"
                        value={greenCardEndDate}
                        onChange={(e) => setGreenCardEndDate(e.target.value)}
                        className="w-full rounded-2xl border border-transparent bg-[var(--input)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>
                </div>
              )}

              {visaStatus === 'US Citizen' && (
                <div className="pt-2 border-t mt-2">
                  <div className="text-sm font-semibold text-foreground mb-3">US Citizenship Information</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">
                        Year Became a US Citizen (USC)
                      </label>
                      <input
                        type="text"
                        value={usCitizenYear}
                        onChange={(e) => setUsCitizenYear(e.target.value)}
                        className="w-full rounded-2xl border border-transparent bg-[var(--input)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="e.g. 2020"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-2 border-t mt-2">
                <EducationFields
                  entries={educationHistory}
                  onChange={setEducationHistory}
                  legacyText={educationLegacyText}
                />
              </div>
            </Card>

            {/* Section 2: Work Authorization */}
            {['F1', 'H1B', 'H4 EAD', 'L2S'].includes(visaStatus) && (
              <Card className="p-5 border border-border shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    Work Authorization Verification
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
                        className="rounded-2xl border border-transparent bg-[var(--input)] pl-2.5 pr-8 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="NO">NO</option>
                        <option value="YES">YES</option>
                      </select>
                    </div>
                  </div>
                  {cpt === 'YES' && (
                    <div className="pt-2">
                      <EmployerExperienceFields
                        entries={cptEmployers}
                        onChange={setCptEmployers}
                        legacyText={cptLegacyText}
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
                        className="rounded-2xl border border-transparent bg-[var(--input)] pl-2.5 pr-8 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="NO">NO</option>
                        <option value="YES">YES</option>
                      </select>
                    </div>
                  </div>
                  {opt === 'YES' && (
                    <div className="pt-2">
                      <EmployerExperienceFields
                        entries={optEmployers}
                        onChange={setOptEmployers}
                        legacyText={optLegacyText}
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
                        className="rounded-2xl border border-transparent bg-[var(--input)] pl-2.5 pr-8 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="NO">NO</option>
                        <option value="YES">YES</option>
                      </select>
                    </div>
                  </div>
                  {stemOpt === 'YES' && (
                    <div className="pt-2">
                      <EmployerExperienceFields
                        entries={stemOptEmployers}
                        onChange={setStemOptEmployers}
                        legacyText={stemOptLegacyText}
                      />
                    </div>
                  )}
                </div>

                {/* H1B block */}
                {visaStatus === 'H1B' && (
                  <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-foreground">I-797 / Employer Verification</span>
                    </div>
                    <div className="pt-2">
                      <EmployerExperienceFields
                        entries={h1bEmployers}
                        onChange={setH1bEmployers}
                        legacyText={h1bLegacyText}
                      />
                    </div>
                  </div>
                )}
              </Card>
            )}

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
                  className="w-full rounded-2xl border border-transparent bg-[var(--input)] p-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </Card>
          </fieldset>
        </div>

        {/* Right 1 column: Timeline, Remarks, SLA info */}
        <div className="space-y-6">
          {/* Timeline & SLA info */}
          <Card className="p-5 border border-border shadow-sm space-y-4">
            <fieldset disabled={!isEditing} className="space-y-4 contents">
              <div className="flex items-center gap-2 border-b pb-2 text-sm font-semibold text-foreground">
                <Clock className="h-4 w-4 text-primary" />
                Stage SLA & Timeline Notes
              </div>

              <div className="rounded-md bg-muted/40 p-3 text-xs space-y-1.5">
                <div className="font-semibold text-foreground flex items-center justify-between">
                  <span>Current Stage SLA:</span>
                  <span className="text-primary font-bold">
                    {stage === 'Draft & Approval' && '2 Hours'}
                    {stage === 'Sent' && '3 Hours'}
                    {stage === 'Modification /Approval (candidate/client)' && '2 Hours'}
                    {stage === 'Doc Missing (Not calculated in the timeline)' && 'Paused (Excluded)'}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  If the candidate remains in this stage longer than the SLA threshold without moving to the next stage, an alert notification is automatically sent to the assigned agent and Resume Team Leads.
                </p>
                {profile.stageUpdatedAt && (
                  <p className="text-sm text-muted-foreground mt-2">
                    Last stage transition: {formatEasternDateTime(profile.stageUpdatedAt)}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Resume Timeline Tracking & Stage Notes
                </label>
                <TimelineFields
                  entries={timelineEntries}
                  onChange={setTimelineEntries}
                  legacyText={timelineLegacyText}
                />
              </div>

            </fieldset>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                General Remarks / Internal Notes
              </label>
              <textarea
                disabled={!isEditing && !isComplianceMode}
                rows={4}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder={isComplianceMode ? "Add compliance notes or remarks..." : "Any additional remarks regarding resume marketing readiness..."}
                className="w-full rounded-md border border-input bg-background p-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {isComplianceMode && (
                <div className="mt-2 flex justify-end">
                  <Button
                    type="button"
                    onClick={handleSaveNotes}
                    disabled={savingNotes}
                    size="sm"
                    className="gap-2"
                  >
                    <Save className="h-4 w-4" />
                    {savingNotes ? 'Saving Notes...' : 'Save Notes'}
                  </Button>
                </div>
              )}
            </div>
            
            {isEditing && (
              <div className="flex items-center gap-3 pt-2">
                <Button
                  onClick={(e) => { e.preventDefault(); handleCancelEdit(); }}
                  disabled={saving}
                  variant="outline"
                  className="flex-1 gap-2 shadow-sm"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={saving}
                  className="flex-[2] gap-2 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                >
                  <Save className="h-4 w-4" />
                  {saving ? 'Saving Profile...' : 'Save Profile Changes'}
                </Button>
              </div>
            )}
          </Card>
        </div>
      </form>
    </div>
  );
}
