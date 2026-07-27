"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateTimePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { AssessmentFormData } from "./types";

function RequiredText({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <span className="ml-1 text-destructive">*</span>
    </>
  );
}

const lockedPrefilledInputClassName = "h-8 bg-muted text-muted-foreground";

interface AssessmentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formData: AssessmentFormData;
  onFormDataChange: (data: AssessmentFormData) => void;
  liveSubject: string;
  minDateTime: string;
  resumeInputKey: number;
  additionalInputKey: number;
  onFileChange: (
    e: React.ChangeEvent<HTMLInputElement>,
    field: "resume" | "additionalAttachment",
  ) => void;
  onSend: () => void;
  onClose: () => void;
  isReadOnly: boolean;
  isSending: boolean;
  onClearUpfrontAmount: () => void;
}

export function AssessmentFormDialog({
  open,
  onOpenChange,
  formData,
  onFormDataChange,
  liveSubject,
  minDateTime,
  resumeInputKey,
  additionalInputKey,
  onFileChange,
  onSend,
  onClose,
  isReadOnly,
  isSending,
  onClearUpfrontAmount,
}: AssessmentFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(openState) => {
      onOpenChange(openState);
      if (!openState) {
        onClearUpfrontAmount();
      }
    }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Assessment Support</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label htmlFor="to">To (Comma separated)</Label>
              <Input
                id="to"
                value={formData.to}
                readOnly
                className="bg-muted"
              />
            </div>

            <div className="col-span-2">
              <Label htmlFor="cc">CC (Comma separated)</Label>
              <Input
                id="cc"
                value={formData.cc}
                onChange={(e) =>
                  onFormDataChange({ ...formData, cc: e.target.value })
                }
                placeholder="manager@example.com"
              />
            </div>

            <div className="col-span-2">
              <Label>Subject</Label>
              <div className="p-3 border-2 border-primary/30 rounded-md bg-primary/5 text-sm font-medium transition-all duration-200">
                {liveSubject}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                This subject updates in real-time as you fill in the fields below.
              </p>
            </div>

            {/* Assessment-specific fields in table-like layout */}
            <div className="col-span-2 border rounded-md overflow-hidden">
              <div className="grid grid-cols-[200px_1fr] text-sm">
                <div className="p-3 bg-muted font-semibold border-b">
                  <RequiredText>Assessment Received (EST)</RequiredText>
                </div>
                <div className="p-2 border-b">
                  <DateTimePicker
                    id="assessmentReceived"
                    min={minDateTime}
                    value={formData.assessmentReceived}
                    onChange={(value) =>
                      onFormDataChange({ ...formData, assessmentReceived: value })
                    }
                    className="h-8"
                    required
                    aria-required="true"
                  />
                </div>

                <div className="p-3 bg-muted font-semibold border-b">
                  <RequiredText>Assessment Deadline (EST)</RequiredText>
                </div>
                <div className="p-2 border-b">
                  <DateTimePicker
                    id="assessmentDeadline"
                    min={formData.assessmentReceived || minDateTime}
                    value={formData.assessmentDeadline}
                    onChange={(value) =>
                      onFormDataChange({ ...formData, assessmentDeadline: value })
                    }
                    className="h-8"
                    required
                    aria-required="true"
                  />
                </div>

                <div className="p-3 bg-muted font-semibold border-b">
                  <RequiredText>Candidate Name</RequiredText>
                </div>
                <div className="p-2 border-b">
                  <Input
                    value={formData.candidateName}
                    placeholder="Full name"
                    className={lockedPrefilledInputClassName}
                    readOnly
                    required
                    aria-required="true"
                  />
                </div>

                <div className="p-3 bg-muted font-semibold border-b">
                  <RequiredText>Technology</RequiredText>
                </div>
                <div className="p-2 border-b">
                  <Input
                    value={formData.technology}
                    onChange={(e) =>
                      onFormDataChange({ ...formData, technology: e.target.value })
                    }
                    placeholder="e.g. Full Stack Developer"
                    className="h-8"
                    required
                    aria-required="true"
                  />
                </div>

                <div className="p-3 bg-muted font-semibold border-b">Email ID</div>
                <div className="p-2 border-b">
                  <Input
                    value={formData.emailId}
                    onChange={(e) =>
                      onFormDataChange({ ...formData, emailId: e.target.value })
                    }
                    placeholder="candidate@email.com"
                    className="h-8"
                  />
                </div>

                <div className="p-3 bg-muted font-semibold border-b">
                  <RequiredText>Contact Number</RequiredText>
                </div>
                <div className="p-2 border-b">
                  <Input
                    value={formData.contactNumber}
                    onChange={(e) =>
                      onFormDataChange({ ...formData, contactNumber: e.target.value })
                    }
                    placeholder="+1234567890"
                    className="h-8"
                    required
                    aria-required="true"
                  />
                </div>

                <div className="p-3 bg-muted font-semibold border-b">
                  <RequiredText>End Client</RequiredText>
                </div>
                <div className="p-2 border-b">
                  <Input
                    value={formData.endClient}
                    onChange={(e) =>
                      onFormDataChange({ ...formData, endClient: e.target.value })
                    }
                    placeholder="e.g. Hacker Rank"
                    className="h-8"
                    required
                    aria-required="true"
                  />
                </div>

                <div className="p-3 bg-muted font-semibold border-b">
                  <RequiredText>Job Title</RequiredText>
                </div>
                <div className="p-2 border-b">
                  <Input
                    value={formData.jobTitle}
                    onChange={(e) =>
                      onFormDataChange({ ...formData, jobTitle: e.target.value })
                    }
                    placeholder="e.g. Sde-2 Backend Engineer"
                    className="h-8"
                    required
                    aria-required="true"
                  />
                </div>

                <div className="p-3 bg-muted font-semibold border-b">
                  <RequiredText>Interview Round</RequiredText>
                </div>
                <div className="p-2 border-b">
                  <Input
                    value={formData.interviewRound}
                    onChange={(e) =>
                      onFormDataChange({ ...formData, interviewRound: e.target.value })
                    }
                    placeholder="e.g. 1st Round"
                    className="h-8"
                    required
                    aria-required="true"
                  />
                </div>

                <div className="p-3 bg-muted font-semibold">
                  <RequiredText>Assessment Duration</RequiredText>
                </div>
                <div className="p-2">
                  <Input
                    value={formData.assessmentDuration}
                    onChange={(e) =>
                      onFormDataChange({ ...formData, assessmentDuration: e.target.value })
                    }
                    placeholder="e.g. 60 minutes"
                    className="h-8"
                    required
                    aria-required="true"
                  />
                </div>
              </div>
            </div>

            {/* Attachments */}
            <div className="col-span-2 md:col-span-1">
              <Label htmlFor="resume">
                <RequiredText>Resume</RequiredText>
              </Label>
              <Input
                id="resume"
                key={resumeInputKey}
                type="file"
                onChange={(e) => onFileChange(e, "resume")}
                accept=".pdf,.doc,.docx"
                required
                aria-required="true"
              />
            </div>

            <div className="col-span-2 md:col-span-1">
              <Label htmlFor="additionalAttachment">Additional Attachment</Label>
              <Input
                id="additionalAttachment"
                key={additionalInputKey}
                type="file"
                onChange={(e) => onFileChange(e, "additionalAttachment")}
              />
            </div>

            {/* Job Description */}
            <div className="col-span-2">
              <Label htmlFor="jobDescription">Job Description</Label>
              <Textarea
                id="jobDescription"
                value={formData.jobDescription}
                onChange={(e) =>
                  onFormDataChange({ ...formData, jobDescription: e.target.value })
                }
                rows={4}
                placeholder="Paste job description here (leave empty for 'JD Not Available')"
              />
            </div>

            {/* Company selector */}
            <div className="col-span-2 md:col-span-1">
              <Label htmlFor="company">Company (Signature)</Label>
              <select
                id="company"
                className="flex h-9 w-full rounded-md border border-input bg-transparent pl-3 pr-8 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={formData.company}
                onChange={(e) =>
                  onFormDataChange({ ...formData, company: e.target.value as AssessmentFormData["company"] })
                }>
                <option value="Silverspace Inc.">Silverspace Inc.</option>
                <option value="Vizva Consultancy">Vizva Consultancy</option>
              </select>
            </div>

            {/* Signature Details */}
            <div className="col-span-2 border-t pt-4 mt-2">
              <h3 className="font-semibold mb-2">Signature Details</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 md:col-span-1">
                  <Label htmlFor="yourName">Your Name</Label>
                  <Input
                    id="yourName"
                    value={formData.yourName}
                    onChange={(e) =>
                      onFormDataChange({ ...formData, yourName: e.target.value })
                    }
                    placeholder="John Doe"
                  />
                </div>
                <div className="col-span-2 md:col-span-1">
                  <Label htmlFor="yourRole">Your Role</Label>
                  <Input
                    id="yourRole"
                    value={formData.yourRole}
                    onChange={(e) =>
                      onFormDataChange({ ...formData, yourRole: e.target.value })
                    }
                    placeholder="HR Manager"
                  />
                </div>
                <div className="col-span-2 md:col-span-1">
                  <Label htmlFor="yourPhone">Your Phone</Label>
                  <Input
                    id="yourPhone"
                    value={formData.yourPhone}
                    onChange={(e) =>
                      onFormDataChange({ ...formData, yourPhone: e.target.value })
                    }
                    placeholder="+1 (555) 123-4567"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            Go Back
          </Button>
          <Button onClick={onSend} disabled={isReadOnly || isSending}>
            {isSending ? "Sending..." : "Send Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
