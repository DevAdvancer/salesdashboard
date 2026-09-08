import { normalizeLeadStatus } from "@/lib/utils/lead-status-workflow";
import { cn } from "@/lib/utils";

interface LeadStatusBadgeProps {
  status: string;
  className?: string;
}

export function LeadStatusBadge({ status, className }: LeadStatusBadgeProps) {
  const normalized = normalizeLeadStatus(status);
  
  let colorClass = "bg-gray-100 text-gray-800 border-gray-300"; // default
  
  switch (normalized) {
    case "interested":
      colorClass = "bg-green-100 text-green-800 border-green-300";
      break;
    case "notinterested":
      colorClass = "bg-red-100 text-red-800 border-red-300";
      break;
    case "pipelinefollowup":
    case "pipeline":
      colorClass = "bg-blue-100 text-blue-800 border-blue-300";
      break;
    case "signedclosure":
    case "signed":
    case "closure":
      colorClass = "bg-emerald-100 text-emerald-800 border-emerald-300";
      break;
    case "backedout":
    case "backout":
      colorClass = "bg-orange-100 text-orange-800 border-orange-300";
      break;
    case "linkedin":
      colorClass = "bg-sky-100 text-sky-800 border-sky-300";
      break;
    case "leads":
      colorClass = "bg-purple-100 text-purple-800 border-purple-300";
      break;
    case "connectionaccepted":
      colorClass = "bg-teal-100 text-teal-800 border-teal-300";
      break;
    case "reopened":
      colorClass = "bg-amber-100 text-amber-800 border-amber-300";
      break;
  }
  
  return (
    <span className={cn(`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border transition-colors ${colorClass}`, className)}>
      {status || "Unknown"}
    </span>
  );
}
