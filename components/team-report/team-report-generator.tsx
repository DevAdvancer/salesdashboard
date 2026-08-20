"use client";

import { useEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import { useToast } from "@/components/ui/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveTeamReportAction, getTeamReportAction, getLatestTeamReportAction } from "@/app/actions/team-reports";
import { Trash2, Plus } from "lucide-react";

const INITIAL_REPS_LIST = [
  "Akshay Kumar", "Alisha D'souza", "Mohit Dabhi", "Prakash Puri", "Pankaj Rajput",
  "Dhananjay Patil", "Shreya Pandey", "Abhilash Tewary", "Prakash Makwana", "Others"
];

interface TeamReportGeneratorProps {
  currentUserId: string;
  companies: string[];
}

export function TeamReportGenerator({ currentUserId, companies }: TeamReportGeneratorProps) {
  const { toast } = useToast();
  const [company, setCompany] = useState(companies[0]);
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [preview, setPreview] = useState("");
  const [newRepName, setNewRepName] = useState("");

  const [data, setData] = useState({
    leads: 0,
    connected: 0,
    pipeline: 0,
    gcDaily: 0,
    uscDaily: 0,
    h1bDaily: 0,
    nonIt: 0,
    refund: 0,
    baseGcMonthly: 0,
    baseUscMonthly: 0,
    baseH1bMonthly: 0,
    baseUpfrontMonth: 0,
    reps: INITIAL_REPS_LIST.map(name => ({ name, closures: 0, upfront: 0 }))
  });

  // Calculate autos
  const closuresToday = data.reps.reduce((acc, rep) => acc + (Number(rep.closures) || 0), 0);
  const upfrontToday = data.reps.reduce((acc, rep) => acc + (Number(rep.upfront) || 0), 0);
  const gcMonthly = data.baseGcMonthly + (Number(data.gcDaily) || 0);
  const uscMonthly = data.baseUscMonthly + (Number(data.uscDaily) || 0);
  const h1bMonthly = data.baseH1bMonthly + (Number(data.h1bDaily) || 0);
  const upfrontMonth = data.baseUpfrontMonth + upfrontToday;
  const upfrontAfterRefund = upfrontMonth - (Number(data.refund) || 0);

  // Load data when company or date changes
  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        let report = await getTeamReportAction({
          currentUserId,
          companyName: company,
          reportDate: date,
        });

        if (report) {
          // Report for TODAY exists - load it directly
          const parsed = JSON.parse(report.data);
          
          setData({
            leads: parsed.leads || 0,
            connected: parsed.connected || 0,
            pipeline: parsed.pipeline || 0,
            gcDaily: parsed.gcDaily || 0,
            uscDaily: parsed.uscDaily || 0,
            h1bDaily: parsed.h1bDaily || 0,
            nonIt: parsed.nonIt || 0,
            refund: parsed.refund || 0,
            // Fallback for legacy format that didn't have base fields
            baseGcMonthly: parsed.baseGcMonthly !== undefined ? parsed.baseGcMonthly : (parsed.gcMonthly - (parsed.gcDaily || 0)) || 0,
            baseUscMonthly: parsed.baseUscMonthly !== undefined ? parsed.baseUscMonthly : (parsed.uscMonthly - (parsed.uscDaily || 0)) || 0,
            baseH1bMonthly: parsed.baseH1bMonthly !== undefined ? parsed.baseH1bMonthly : (parsed.h1bMonthly - (parsed.h1bDaily || 0)) || 0,
            baseUpfrontMonth: parsed.baseUpfrontMonth !== undefined ? parsed.baseUpfrontMonth : (parsed.upfrontMonth - (parsed.reps?.reduce((a: any, r: any) => a + (r.upfront || 0), 0) || 0)) || 0,
            reps: parsed.reps || INITIAL_REPS_LIST.map(name => ({ name, closures: 0, upfront: 0 }))
          });
        } else {
          // No report for today, try finding latest report to prepopulate bases
          report = await getLatestTeamReportAction({
            currentUserId,
            companyName: company,
          });

          if (report) {
            const parsed = JSON.parse(report.data);
            const reportMonth = report.reportDate.substring(0, 7);
            const currentMonth = date.substring(0, 7);
            const isSameMonth = reportMonth === currentMonth;

            // Carry over totals to use as "bases" if in the same month.
            // If the old record had `baseGcMonthly`, we sum it with `gcDaily` to get its final daily total.
            // If it's a legacy record without `baseGcMonthly`, we just use `gcMonthly`.
            const prevGcMonthly = parsed.baseGcMonthly !== undefined ? parsed.baseGcMonthly + (parsed.gcDaily || 0) : (parsed.gcMonthly || 0);
            const prevUscMonthly = parsed.baseUscMonthly !== undefined ? parsed.baseUscMonthly + (parsed.uscDaily || 0) : (parsed.uscMonthly || 0);
            const prevH1bMonthly = parsed.baseH1bMonthly !== undefined ? parsed.baseH1bMonthly + (parsed.h1bDaily || 0) : (parsed.h1bMonthly || 0);
            const prevUpfrontMonth = parsed.baseUpfrontMonth !== undefined ? parsed.baseUpfrontMonth + (parsed.reps?.reduce((a: any, r: any) => a + (r.upfront || 0), 0) || 0) : (parsed.upfrontMonth || 0);

            setData({
              leads: 0,
              connected: 0,
              pipeline: 0,
              gcDaily: 0,
              uscDaily: 0,
              h1bDaily: 0,
              nonIt: 0,
              refund: isSameMonth ? (parsed.refund || 0) : 0,
              baseGcMonthly: isSameMonth ? prevGcMonthly : 0,
              baseUscMonthly: isSameMonth ? prevUscMonthly : 0,
              baseH1bMonthly: isSameMonth ? prevH1bMonthly : 0,
              baseUpfrontMonth: isSameMonth ? prevUpfrontMonth : 0,
              reps: (parsed.reps || INITIAL_REPS_LIST).map((r: any) => ({ name: r.name, closures: 0, upfront: 0 }))
            });
          } else {
            // Completely fresh
            setData({
              leads: 0, connected: 0, pipeline: 0, gcDaily: 0, uscDaily: 0, h1bDaily: 0, nonIt: 0, refund: 0,
              baseGcMonthly: 0, baseUscMonthly: 0, baseH1bMonthly: 0, baseUpfrontMonth: 0,
              reps: INITIAL_REPS_LIST.map(name => ({ name, closures: 0, upfront: 0 }))
            });
          }
        }
      } catch (err) {
        toast({ title: "Error", description: "Failed to load report data", variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [company, date, currentUserId]);

  const updateField = (field: keyof typeof data, value: number) => {
    setData(prev => ({ ...prev, [field]: value || 0 }));
  };

  const updateRep = (index: number, field: "closures" | "upfront", value: number) => {
    setData(prev => {
      const newReps = [...prev.reps];
      newReps[index] = { ...newReps[index], [field]: value || 0 };
      return { ...prev, reps: newReps };
    });
  };

  const handleAddRep = () => {
    if (!newRepName.trim()) return;
    setData(prev => ({
      ...prev,
      reps: [...prev.reps, { name: newRepName.trim(), closures: 0, upfront: 0 }]
    }));
    setNewRepName("");
  };

  const handleRemoveRep = (index: number) => {
    setData(prev => {
      const newReps = [...prev.reps];
      newReps.splice(index, 1);
      return { ...prev, reps: newReps };
    });
  };

  // Build Preview
  const buildReport = useCallback(() => {
    let out = `${company} Team Report (${format(new Date(date + "T00:00:00"), "dd/MM/yyyy")})\n\n`;
    out += `Leads generated- ${data.leads}\n`;
    out += `Connected- ${data.connected}\n`;
    out += `Pipeline- ${data.pipeline}\n\n`;
    out += `Total closures:-\n\n`;

    data.reps.forEach(rep => {
      out += `${rep.name}: Closures: ${rep.closures} Upfront: $${rep.upfront}\n`;
    });

    out += `\nGC onboard daily :${data.gcDaily}\n`;
    out += `GC onboard Monthly :${gcMonthly}\n`;
    out += `USC onboard daily: ${data.uscDaily}\n`;
    out += `USC onboard monthly :${uscMonthly}\n`;
    out += `H1B candidates daily :${data.h1bDaily}\n`;
    out += `H1B candidates Monthly :${h1bMonthly}\n`;
    out += `Non-IT candidates- ${data.nonIt}\n\n`;

    out += `Closures today:- ${closuresToday}\n`;
    out += `Upfront today:- $${upfrontToday}\n`;
    out += `Upfront this month:- $${upfrontMonth}\n`;
    out += `Refund till date:-$${data.refund}\n`;
    out += `Total Upfront after Refund:-$${upfrontAfterRefund}`;

    return out;
  }, [company, date, data, closuresToday, upfrontToday, gcMonthly, uscMonthly, h1bMonthly, upfrontMonth, upfrontAfterRefund]);

  useEffect(() => {
    setPreview(buildReport());
  }, [buildReport]);

  const handleSaveAndCopy = async () => {
    setIsSaving(true);
    try {
      const payload = {
        ...data,
        gcMonthly,
        uscMonthly,
        h1bMonthly,
        upfrontMonth,
        upfrontAfterRefund
      };

      await saveTeamReportAction({
        currentUserId,
        companyName: company,
        reportDate: date,
        data: JSON.stringify(payload),
      });

      try {
        await navigator.clipboard.writeText(preview);
        toast({ title: "Success", description: "Report saved and copied to clipboard!" });
      } catch (err) {
        toast({ title: "Success", description: "Report saved! Select and copy the preview manually." });
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to save report", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div>Loading data...</div>;
  }

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Report Config</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Company</Label>
              <Select value={company} onValueChange={setCompany}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {companies.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Overview</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Leads generated</Label>
              <Input type="number" value={data.leads} onChange={e => updateField("leads", parseFloat(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>Connected</Label>
              <Input type="number" value={data.connected} onChange={e => updateField("connected", parseFloat(e.target.value))} />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Pipeline</Label>
              <Input type="number" value={data.pipeline} onChange={e => updateField("pipeline", parseFloat(e.target.value))} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Individual Closures</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              {data.reps.map((rep, idx) => (
                <div key={`${rep.name}-${idx}`} className="grid grid-cols-12 gap-4 items-end pb-4 border-b last:border-0 last:pb-0">
                  <div className="col-span-4 font-medium text-sm pt-2 flex items-center justify-between">
                    <span className="truncate pr-2" title={rep.name}>{rep.name}</span>
                  </div>
                  <div className="col-span-3 space-y-2">
                    <Label>Closures</Label>
                    <Input type="number" value={rep.closures} onChange={e => updateRep(idx, "closures", parseFloat(e.target.value))} />
                  </div>
                  <div className="col-span-4 space-y-2">
                    <Label>Upfront ($)</Label>
                    <Input type="number" value={rep.upfront} onChange={e => updateRep(idx, "upfront", parseFloat(e.target.value))} />
                  </div>
                  <div className="col-span-1 pb-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleRemoveRep(idx)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-end gap-2 pt-4 border-t">
              <div className="space-y-2 flex-1">
                <Label>Add New Representative</Label>
                <Input 
                  placeholder="Enter name" 
                  value={newRepName} 
                  onChange={e => setNewRepName(e.target.value)} 
                  onKeyDown={e => e.key === "Enter" && handleAddRep()}
                />
              </div>
              <Button onClick={handleAddRep} variant="secondary">
                <Plus className="h-4 w-4 mr-2" /> Add
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Onboarding & Candidates</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>GC daily</Label>
              <Input type="number" value={data.gcDaily} onChange={e => updateField("gcDaily", parseFloat(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label className="flex justify-between">GC monthly <span className="text-muted-foreground text-[10px] uppercase bg-muted px-1 rounded">Auto</span></Label>
              <Input type="number" value={gcMonthly} readOnly className="bg-muted font-medium" />
            </div>
            <div className="space-y-2">
              <Label>USC daily</Label>
              <Input type="number" value={data.uscDaily} onChange={e => updateField("uscDaily", parseFloat(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label className="flex justify-between">USC monthly <span className="text-muted-foreground text-[10px] uppercase bg-muted px-1 rounded">Auto</span></Label>
              <Input type="number" value={uscMonthly} readOnly className="bg-muted font-medium" />
            </div>
            <div className="space-y-2">
              <Label>H1B daily</Label>
              <Input type="number" value={data.h1bDaily} onChange={e => updateField("h1bDaily", parseFloat(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label className="flex justify-between">H1B monthly <span className="text-muted-foreground text-[10px] uppercase bg-muted px-1 rounded">Auto</span></Label>
              <Input type="number" value={h1bMonthly} readOnly className="bg-muted font-medium" />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Non-IT</Label>
              <Input type="number" value={data.nonIt} onChange={e => updateField("nonIt", parseFloat(e.target.value))} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Totals</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex justify-between">Closures today <span className="text-muted-foreground text-[10px] uppercase bg-muted px-1 rounded">Auto</span></Label>
              <Input type="number" value={closuresToday} readOnly className="bg-muted font-medium" />
            </div>
            <div className="space-y-2">
              <Label className="flex justify-between">Upfront today ($) <span className="text-muted-foreground text-[10px] uppercase bg-muted px-1 rounded">Auto</span></Label>
              <Input type="number" value={upfrontToday} readOnly className="bg-muted font-medium" />
            </div>
            <div className="space-y-2">
              <Label className="flex justify-between">Upfront this month ($) <span className="text-muted-foreground text-[10px] uppercase bg-muted px-1 rounded">Auto</span></Label>
              <Input type="number" value={upfrontMonth} readOnly className="bg-muted font-medium" />
            </div>
            <div className="space-y-2">
              <Label>Refund till date ($)</Label>
              <Input type="number" value={data.refund} onChange={e => updateField("refund", parseFloat(e.target.value))} />
            </div>
            <div className="space-y-2 col-span-2">
              <Label className="flex justify-between">Total upfront after refund ($) <span className="text-muted-foreground text-[10px] uppercase bg-muted px-1 rounded">Auto</span></Label>
              <Input type="number" value={upfrontAfterRefund} readOnly className="bg-muted font-medium" />
            </div>
          </CardContent>
        </Card>

        <Card className="sticky top-6">
          <CardHeader>
            <CardTitle>Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <textarea
              className="w-full min-h-[400px] p-4 text-sm font-mono border rounded-md bg-muted/50 focus:outline-none"
              readOnly
              value={preview}
            />
            <Button className="w-full" size="lg" onClick={handleSaveAndCopy} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save & Copy to Clipboard"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
