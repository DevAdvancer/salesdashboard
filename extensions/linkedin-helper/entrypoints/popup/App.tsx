import { useEffect, useState } from "react";
import type { ExtensionState } from "crm-shared/types/linkedin-extension";
import { useLinkedinHelper } from "../../lib/use-linkedin-helper";
import { usePageTheme } from "../../lib/use-page-theme";
import { AccountPicker, History, Quota } from "./RequestDetails";

const descriptions: Record<ExtensionState, [string, string]> = {
  new: ["Ready to record", "No blocking request was found for this company. Record after you send the invitation."],
  active_request: ["Already exists", "An active request exists for this company. View history for details."],
  lead_exists: ["Existing CRM lead", "A lead with this profile already exists. Manage it in CRM."],
  resend_available: ["Previous request found", "The existing CRM rules allow a resend. Confirm below after sending the new invitation."],
  limit_reached: ["Daily allowance reached", "Choose another assigned account or return on the next Eastern business date."],
  missing_limit: ["Account limit not configured", "Ask your team lead or administrator to configure a connection limit."],
};

export function App() {
  const helper = useLinkedinHelper();
  usePageTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showSilverspace, setShowSilverspace] = useState(true);
  const { state } = helper;
  const { connected, quota, title, isResend, canRecord } = getView(state);
  useEffect(() => {
    const timer = setInterval(() => { setShowSilverspace(previous => !previous); }, 4500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (connected) setSettingsOpen(false); }, [connected]);
  return <>
    <PopupHeader showSilverspace={showSilverspace} connected={connected} connection={state.connection}
      settingsOpen={settingsOpen} toggleSettings={() => setSettingsOpen(previous => !previous)} />
    <main>
      {!connected && !settingsOpen && <div className="connect-prompt"><p>Sign in to CRM, then connect once.</p>
        <button className="secondary" disabled={state.pending} onClick={() => setSettingsOpen(true)}>Set up connection</button></div>}
      {settingsOpen && <section id="settings" className="settings-panel" aria-label="Connection settings">
        <label htmlFor="crm-url">CRM environment</label>
        <div className="row"><select id="crm-url" value={state.crmUrl} disabled={state.pending}
          onChange={event => helper.setCrmUrl(event.target.value)}>
          <option value="https://crm.silverspaceinc.tech">crm.silverspaceinc.tech</option>
          <option value="http://localhost:5000">localhost:5000</option>
        </select>
          <button id="connect" type="button" disabled={state.pending} onClick={helper.connect}>Connect</button></div>
        <p className="hint">Keep your signed-in CRM tab open.</p>
      </section>}
      {connected && state.bootstrap && <div id="workspace">
        <div className="section-heading"><span>Hello, {state.bootstrap.user.name}</span>
          <button id="refresh" className="text-button" disabled={state.pending} onClick={helper.refresh}>Refresh</button></div>
        <AccountPicker accounts={state.bootstrap.accounts} value={state.accountId} disabled={state.pending} onChange={helper.selectAccount} />
        <Quota quota={quota} today={state.checked?.today || state.bootstrap.today} />
        <label htmlFor="profile">Profile URL</label>
        <div className="row"><input id="profile" type="text" value={state.profile} disabled={state.pending}
          onChange={event => helper.setProfile(event.target.value)} placeholder="https://www.linkedin.com/in/…" spellCheck={false} />
          <button id="detect" className="secondary" disabled={state.pending} onClick={helper.detect}>Detect</button></div>
        {title && <div className="result" data-state={state.checked?.canRecord ? "ready" : "blocked"}><span>{title[0]}</span><p>{title[1]}</p></div>}
        {isResend && <div className="confirmation"><label><input type="checkbox" checked={state.confirmResend} disabled={state.pending}
          onChange={event => helper.setConfirmResend(event.target.checked)} /> I sent a new invitation and want to update the existing CRM request.</label></div>}
        <div className="actions"><button id="record" disabled={!canRecord} onClick={helper.record}>{isResend ? "Record resend" : "Record request sent"}</button></div>
        <div className="actions"><button id="check" className="secondary" disabled={state.pending || !state.accountId || !state.profile.trim()} onClick={helper.check}>Check before inviting</button>
          <button id="history" className="secondary" disabled={state.pending || !state.accountId || !state.profile.trim()} onClick={helper.history}>View history</button></div>
        <p className="hint">Send the invitation on LinkedIn first, then record it here.</p>
        {state.historyVisible && state.checked && <History key={state.checked.revision} items={state.checked.history} />}
      </div>}
      <p id="message" role="status" aria-live="polite" data-kind={state.noteKind}>{state.note}</p>
    </main>
    <footer><button className="text-button" disabled={state.pending} onClick={helper.openCrm}>Open CRM</button>
      <span>Manual outreach</span></footer>
  </>;
}

function PopupHeader({ showSilverspace, connected, connection, settingsOpen, toggleSettings }: {
  showSilverspace: boolean; connected: boolean; connection: string; settingsOpen: boolean; toggleSettings: () => void;
}) {
  return <header><div className="company-brands" aria-label={showSilverspace ? "Silverspace" : "Vizva"}>
    <img src="/silverspace.png" alt="" className={showSilverspace ? "visible" : ""} />
    <img src="/vizva.png" alt="" className={showSilverspace ? "" : "visible"} /></div><div><h1>CRM HUB</h1><p>LinkedIn Helper</p></div>
    <span id="connection" className={`badge${connected ? " connected" : ""}`}>
      {connected ? "Connected" : connection === "connecting" ? "Connecting…" : "Not connected"}
    </span>
    <button id="settings-toggle" className="icon-button" aria-label={settingsOpen ? "Close settings" : "Connection settings"}
      aria-expanded={settingsOpen} aria-controls="settings" onClick={toggleSettings}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></svg>
    </button>
  </header>;
}

function getView(state: ReturnType<typeof useLinkedinHelper>["state"]) {
  const connected = state.connection === "connected" && state.bootstrap !== null;
  const quota = state.checked || state.bootstrap?.accounts.find(account => account.id === state.accountId);
  const title = state.noteKind === "success" && state.checked?.state === "active_request"
    ? ["Added successfully", "The sent invitation is recorded in CRM. View history whenever you need it."]
    : state.checked ? descriptions[state.checked.state] : null;
  const isResend = state.checked?.state === "resend_available";
  const canRecord = connected && !state.pending && !!state.accountId && !!state.profile.trim() &&
    (!state.checked || state.checked.canRecord) && (!isResend || state.confirmResend);
  return { connected, quota, title, isResend, canRecord };
}
