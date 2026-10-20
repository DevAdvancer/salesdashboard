import type { ExtensionAccount, ExtensionQuota } from "crm-shared/types/linkedin-extension";

export function AccountPicker({ accounts, value, disabled, onChange }: {
  accounts: Array<ExtensionAccount & ExtensionQuota>; value: string; disabled: boolean; onChange: (value: string) => void;
}) {
  return <>
    {accounts.find(account => account.id === value) && <CompanyBadge company={accounts.find(account => account.id === value)!.company} />}
    <label htmlFor="account">LinkedIn account</label>
    <select id="account" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
      <option value="">Choose an account</option>
      {accounts.map(account => <option key={account.id} value={account.id} disabled={account.remaining === 0 || account.limit === null}>
        {account.company} · {account.name} ({account.type}) · {account.remaining ?? "?"} left
      </option>)}
    </select>
    <p className="hint">Choose the account you use on LinkedIn.</p>
  </>;
}
function CompanyBadge({ company }: { company: string }) {
  const logo = /silver/i.test(company) ? "/silverspace.png" : /vizva/i.test(company) ? "/vizva.png" : null;
  return <div className="company-badge">{logo && <img src={logo} alt={`${company} logo`} />}<span>{company}</span></div>;
}

export function Quota({ quota, today }: { quota?: ExtensionQuota; today: string }) {
  const used = quota?.used ?? 0;
  const limit = quota?.limit ?? null;
  const remaining = quota?.remaining ?? null;
  const progress = limit ? Math.min(100, used / limit * 100) : 0;
  return <div className="quota"><span>Daily allowance <small>{today} · ET</small></span>
    <strong id="remaining">{remaining === null ? "Limit not configured" : `${remaining} remaining`}</strong>
    <div className="progress"><div id="progress-fill" style={{ width: `${progress}%` }} /></div>
    <span className="hint">{used} used{limit === null ? "" : ` of ${limit}`} today</span>
  </div>;
}
