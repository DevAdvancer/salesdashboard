const fs = require('fs');
const path = 'D:/salesdashboard/components/followups/followups-payment-form.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add getCreditableAgentsAction import
content = content.replace(
  'import { listLeadsAction, getLeadAction } from "@/app/actions/lead/queries";',
  'import { listLeadsAction, getLeadAction } from "@/app/actions/lead/queries";\nimport { getCreditableAgentsAction } from "@/app/actions/previous-followups-payments";'
);

// 2. Add creditedAgentId to FollowupsPaymentFormValues
content = content.replace(
  '  hasPaymentRecord?: boolean;\n}',
  '  hasPaymentRecord?: boolean;\n  creditedAgentId?: string | null;\n}'
);

// 3. Add Agent Selection State and Effect
const searchEffectPoint = '  // Search effect';
const agentStateContent =   // Agent Selection State
  const [creditableAgents, setCreditableAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [creditedAgentId, setCreditedAgentId] = useState<string>(
    payment?.createdById || user?. || ""
  );

  useEffect(() => {
    if (!user?. || !serverSessionReady || !canUseManual) return;
    let cancelled = false;
    async function loadAgents() {
      try {
        const agents = await getCreditableAgentsAction(user!.);
        if (!cancelled) {
          setCreditableAgents(agents);
          if (!payment?.createdById && agents.length > 0 && !agents.find(a => a.id === user?.)) {
            setCreditedAgentId(agents[0].id);
          } else if (payment?.createdById && !agents.find(a => a.id === payment?.createdById)) {
             setCreditedAgentId(payment.createdById);
             setCreditableAgents([{id: payment.createdById, name: payment.createdByName || "Unknown"}, ...agents]);
          }
        }
      } catch (err) {
        console.error("Failed to fetch creditable agents", err);
      }
    }
    loadAgents();
    return () => { cancelled = true; };
  }, [user?., serverSessionReady, canUseManual, payment?.createdById]);\n\n;

content = content.replace(searchEffectPoint, agentStateContent + searchEffectPoint);

// 4. Pass creditedAgentId to onSave
const submitStr =       hasPaymentRecord,
    });;
const newSubmitStr =       hasPaymentRecord,
      creditedAgentId: mode === "manual" ? creditedAgentId : null,
    });;
content = content.replace(submitStr, newSubmitStr);

// 5. Add Select UI
const uiInsertPoint = {mode === "manual" && canUseManual && (
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
      )}\n\n      ;
      
const targetHTML = '{isLoadingClientData && (\n        <p className="text-xs text-muted-foreground animate-pulse">Loading client data...</p>\n      )}';
content = content.replace(targetHTML, uiInsertPoint + targetHTML);

fs.writeFileSync(path, content);
console.log("Updated followups-payment-form.tsx");
