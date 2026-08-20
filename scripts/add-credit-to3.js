const fs = require('fs');
const file = 'D:/salesdashboard/components/followups/followups-payment-form.tsx';
let data = fs.readFileSync(file, 'utf8');

data = data.replace(
  'import { listLeadsAction, getLeadAction } from "@/app/actions/lead/queries";',
  'import { listLeadsAction, getLeadAction } from "@/app/actions/lead/queries";\nimport { getCreditableAgentsAction } from "@/app/actions/previous-followups-payments";'
);

data = data.replace(
  '  hasPaymentRecord?: boolean;\n}',
  '  hasPaymentRecord?: boolean;\n  creditedAgentId?: string | null;\n}'
);

data = data.replace(
  '  const [isSearching, setIsSearching] = useState(false);',
  `  const [isSearching, setIsSearching] = useState(false);

  // Agent Selection State
  const [creditableAgents, setCreditableAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [creditedAgentId, setCreditedAgentId] = useState<string>(
    payment?.createdById || user?.$id || ""
  );

  useEffect(() => {
    if (!user?.$id || !serverSessionReady || !canUseManual) return;
    let cancelled = false;
    async function loadAgents() {
      try {
        const agents = await getCreditableAgentsAction(user!.$id);
        if (!cancelled) {
          setCreditableAgents(agents);
          if (!payment?.createdById && agents.length > 0 && !agents.find(a => a.id === user?.$id)) {
            setCreditedAgentId(agents[0].id);
          } else if (payment?.createdById && !agents.find(a => a.id === payment?.createdById)) {
             setCreditedAgentId(payment.createdById);
             setCreditableAgents([{id: payment.createdById, name: "Unknown"}, ...agents]);
          }
        }
      } catch (err) {
        console.error("Failed to fetch creditable agents", err);
      }
    }
    loadAgents();
    return () => { cancelled = true; };
  }, [user?.$id, serverSessionReady, canUseManual, payment?.createdById]);`
);

data = data.replace(
  'status: mode === "client" && selectedLeadId ? status : undefined,\n      hasPaymentRecord,\n    });',
  `status: mode === "client" && selectedLeadId ? status : undefined,\n      hasPaymentRecord,\n      creditedAgentId: canUseManual ? creditedAgentId : null,\n    });`
);

data = data.replace(/{isLoadingClientData && \([\s\S]*?<\/p>\s*\)}/g, `{isLoadingClientData && (
        <p className="text-xs text-muted-foreground animate-pulse">Loading client data...</p>
      )}

      {canUseManual && (
        <div className="space-y-2 bg-muted/30 p-3 rounded-lg border">
          <label className="text-sm font-semibold text-foreground">Credit To (Agent)</label>
          <Select value={creditedAgentId} onValueChange={setCreditedAgentId}>
            <SelectTrigger className="bg-background">
              <SelectValue placeholder="Select Agent" />
            </SelectTrigger>
            <SelectContent>
              {creditableAgents.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1">
            This followup will be securely credited to this agent's daily stats and Target Report.
          </p>
        </div>
      )}`);

fs.writeFileSync(file, data);
console.log("Updated everything!");
