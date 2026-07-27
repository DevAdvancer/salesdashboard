"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateTimePicker } from "@/components/ui/date-picker";
import type { MockFormData } from "./mock-types";

function RequiredText({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <span className="ml-1 text-destructive">*</span>
    </>
  );
}

const lockedPrefilledInputClassName = "h-8 bg-muted text-muted-foreground";

interface MockDialogProps {
  isModalOpen: boolean;
  setIsModalOpen: (val: boolean) => void;
  formData: MockFormData;
  setFormData: (fn: MockFormData | ((prev: MockFormData) => MockFormData)) => void;
  minDateTime: string;
  fileInputKey: number;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  sendEmail: () => void;
  isSending: boolean;
}

export function MockDialog({
  isModalOpen,
  setIsModalOpen,
  formData,
  setFormData,
  minDateTime,
  fileInputKey,
  handleFileChange,
  sendEmail,
  isSending,
}: MockDialogProps) {
  return (
    <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Mock Interview</DialogTitle>
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
                  setFormData({ ...formData, cc: e.target.value })
                }
                placeholder="manager@example.com"
              />
            </div>

            <div className="col-span-2">
              <Label>Subject</Label>
              <div className="p-2 border rounded-md bg-muted text-muted-foreground">
                Request to schedule mock interview - {formData.candidateName}
              </div>
            </div>

            <div className="col-span-2 border rounded-md overflow-hidden">
              <div className="grid grid-cols-[200px_1fr] text-sm">
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

                <div className="p-3 bg-muted font-semibold border-b">End Client</div>
                <div className="p-2 border-b">
                  <Input
                    value={formData.endClient}
                    onChange={(e) =>
                      setFormData({ ...formData, endClient: e.target.value })
                    }
                    placeholder="e.g. Vizva INC"
                    className="h-8"
                  />
                </div>

                <div className="p-3 bg-muted font-semibold border-b">Email ID</div>
                <div className="p-2 border-b">
                  <Input
                    value={formData.emailId}
                    onChange={(e) =>
                      setFormData({ ...formData, emailId: e.target.value })
                    }
                    placeholder="candidate@email.com"
                    className="h-8"
                  />
                </div>

                <div className="p-3 bg-muted font-semibold">Contact Number</div>
                <div className="p-2">
                  <Input
                    value={formData.contactNumber}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        contactNumber: e.target.value,
                      })
                    }
                    placeholder="+1234567890"
                    className="h-8"
                  />
                </div>
              </div>
            </div>

            <div className="col-span-2">
              <Label htmlFor="emailBody">Email Content</Label>
              <Textarea
                id="emailBody"
                value={formData.emailBody}
                onChange={(e) =>
                  setFormData({ ...formData, emailBody: e.target.value })
                }
                rows={4}
              />
            </div>

            <div className="col-span-2 md:col-span-1">
              <Label htmlFor="role">Role</Label>
              <Input
                id="role"
                value={formData.role}
                onChange={(e) =>
                  setFormData({ ...formData, role: e.target.value })
                }
                placeholder="e.g. Data Analyst"
              />
            </div>

            <div className="col-span-2 md:col-span-1">
              <Label htmlFor="schedule">Schedule</Label>
              <DateTimePicker
                id="schedule"
                min={minDateTime}
                value={formData.schedule}
                onChange={(value) =>
                  setFormData({ ...formData, schedule: value })
                }
              />
            </div>

            <div className="col-span-2 md:col-span-1">
              <Label htmlFor="company">Company (Signature)</Label>
              <select
                id="company"
                className="flex h-9 w-full rounded-md border border-input bg-transparent pl-3 pr-8 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={formData.company}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    company: e.target.value as MockFormData["company"],
                  })
                }>
                <option value="Silverspace Inc.">Silverspace Inc.</option>
                <option value="Vizva Consultancy">Vizva Consultancy</option>
              </select>
            </div>

            <div className="col-span-2">
              <Label htmlFor="resume">Upload Resume</Label>
              <Input
                id="resume"
                key={fileInputKey}
                type="file"
                onChange={handleFileChange}
                accept=".pdf,.doc,.docx"
              />
            </div>

            <div className="col-span-2 border-t pt-4 mt-2">
              <h3 className="font-semibold mb-2">Signature Details</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 md:col-span-1">
                  <Label htmlFor="yourName">Your Name</Label>
                  <Input
                    id="yourName"
                    value={formData.yourName}
                    onChange={(e) =>
                      setFormData({ ...formData, yourName: e.target.value })
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
                      setFormData({ ...formData, yourRole: e.target.value })
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
                      setFormData({ ...formData, yourPhone: e.target.value })
                    }
                    placeholder="+1 (555) 123-4567"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => setIsModalOpen(false)}>
            Go Back
          </Button>
          <Button onClick={sendEmail} disabled={isSending}>
            {isSending ? "Sending..." : "Create Mock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
