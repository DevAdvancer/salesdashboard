import { useEffect, useState } from "react";
import type { ExtensionState } from "crm-shared/types/linkedin-extension";
import { useLinkedinHelper } from "../../lib/use-linkedin-helper";
import { usePageTheme } from "../../lib/use-page-theme";
import { AccountPicker, Quota } from "./RequestDetails";
import { profileStatusLabel } from '../../lib/profile-status';

const descriptions: Record<ExtensionState, [string, string]> = {
  new: ["Ready to send", "Use Connect/Send on LinkedIn. A confirmed invitation is recorded automatically."],
  existing_lead: ["Already in CRM", "This profile already exists as a CRM lead. CRM will not add another request."],
  active_request: ["Already sent", "An active CRM request already exists for this company. CRM will not add another request."],
  resend_available: ["Resend available", "Confirm the resend in the extension dialog on LinkedIn before sending."],
  limit_reached: ["Daily allowance reached", "Choose another assigned account or return on the next Eastern business date."],
  missing_limit: ["Account limit not configured", "Ask your team lead or administrator to configure a connection limit."],
};
const resultTones: Record<ExtensionState, "sent" | "existing" | "blocked"> = {
  new: "sent", existing_lead: "existing", active_request: "existing", resend_available: "blocked",
  limit_reached: "existing", missing_limit: "existing",
};

export function App() {
  const helper = useLinkedinHelper();
  usePageTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showSilverspace, setShowSilverspace] = useState(true);
  const { state } = helper;
  const { connected, quota, title, resultState } = getView(state);
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
        <AccountPicker accounts={state.bootstrap.accounts} value={state.accountId} disabled={state.pending || state.locked} onChange={helper.selectAccount} />
        <div className="actions"><button id="account-lock" disabled={state.pending || (!state.locked && !state.accountId)}
          onClick={state.locked ? helper.unlockAccount : helper.lockAccount}>{state.locked ? "Unlock account" : "Lock account for this browser profile"}</button></div>
        <p className="hint">{state.locked ? "Locked. Confirmed LinkedIn invitations are recorded from this account automatically." : "Choose the account signed in on LinkedIn, then lock it to enable CRM tracking."} LinkedIn controls remain available. Each Chrome/Edge browser profile keeps its own lock.</p>
        {state.attempts.map(attempt => <ReviewAttempt key={attempt.id} attempt={attempt} pending={state.pending} clear={helper.clearAttempt} />)}
        <Quota quota={quota} today={state.checked?.today || state.bootstrap.today} />
        <label htmlFor="profile">Profile URL</label>
        <div className="row"><input id="profile" type="text" value={state.profile} disabled={state.pending}
          onChange={event => helper.setProfile(event.target.value)} placeholder="https://www.linkedin.com/in/…" spellCheck={false} />
          <button id="detect" className="secondary" disabled={state.pending} onClick={helper.detect}>Detect</button></div>
        {title && <div className="result" data-state={resultState} role="status" title={title[1]}><span>{title[0]}</span></div>}
        <div className="actions"><button id="check" className="secondary" disabled={state.pending || !state.accountId || !state.profile.trim()} onClick={helper.check}>Check send status</button></div>
        <div className="actions"><button id="open-profile" className="secondary" disabled={state.pending || !state.profile.trim()}
          onClick={helper.openProfile}>Open profile on LinkedIn</button></div>
        <p className="hint">Status follows the profile you open. The bar shows CRM recording availability; it does not block LinkedIn invitations. Click it for details.</p>
      </div>}
      <p id="message" role="status" aria-live="polite" data-kind={state.noteKind}>{state.note}</p>
    </main>
    <footer><button className="text-button" disabled={state.pending} onClick={helper.openCrm}>Open CRM</button>
      <span>Automatic recording</span></footer>
  </>;
}

function ReviewAttempt({ attempt, pending, clear }: { attempt: { id: string; targetUrl: string }; pending: boolean; clear: (id: string) => void }) {
  const [reviewed, setReviewed] = useState(false);
  return <section className="confirmation"><p>An invitation needs review: <a href={attempt.targetUrl} target="_blank" rel="noreferrer">Open profile</a></p>
    <label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I checked LinkedIn and CRM and resolved any missing request.</label>
    <button className="secondary" disabled={pending || !reviewed} onClick={() => clear(attempt.id)}>Clear reviewed attempt</button></section>;
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
  const title = state.checked ? [profileStatusLabel(state.checked), descriptions[state.checked.state][1]] : null;
  const resultState = state.checked ? resultTones[state.checked.state] : 'ready';
  return { connected, quota, title, resultState };
}
