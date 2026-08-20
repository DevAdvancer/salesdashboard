const fs = require('fs'); 
const file = 'D:/salesdashboard/components/followups/followups-payment-form.tsx'; 
let data = fs.readFileSync(file, 'utf8'); 

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
console.log('Replaced dropdown');
