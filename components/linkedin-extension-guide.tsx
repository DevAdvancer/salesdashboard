'use client';

import { useEffect, useState } from 'react';
import { Download, Puzzle, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/contexts/auth-context';
import { canUseLinkedinExtension } from '@/lib/server/linkedin-extension-policy';
import { useQuery } from '@tanstack/react-query';
import { getMyLinkedinHelperAccessAction } from '@/app/actions/beta';
import { queryKeys } from '@/lib/queries/keys';
import { LINKEDIN_HELPER_BETA_VERSION, LINKEDIN_HELPER_STABLE_VERSION, LINKEDIN_HELPER_DOWNLOAD } from '@/lib/constants/linkedin-helper-release';

const ATTRIBUTE = 'data-crm-hub-linkedin-helper-version';

export function LinkedinExtensionSection({ onDetection }: { onDetection?: (detected: boolean) => void }) {
  const { user, serverSessionReady } = useAuth();
  const eligible = !!user && canUseLinkedinExtension(user);
  const access = useQuery({ queryKey: queryKeys.linkedinHelper.access(user?.$id ?? ''),
    queryFn: () => getMyLinkedinHelperAccessAction(), enabled: eligible && serverSessionReady,
    staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: 'always', refetchInterval: 60_000, retry: 1 });
  if (!eligible) return null;
  if (access.isPending) return <p className="text-sm text-muted-foreground">Loading LinkedIn Helper…</p>;
  if (access.isError) return <Button variant="outline" onClick={() => access.refetch()}>Retry loading LinkedIn Helper</Button>;
  return <LinkedinExtensionGuide key={`${user?.$id}:${access.data}`} beta={access.data} onDetection={onDetection} />;
}

export function LinkedinExtensionGuide({ onDetection, beta = false }: { onDetection?: (detected: boolean) => void; beta?: boolean }) {
  const VERSION = beta ? LINKEDIN_HELPER_BETA_VERSION : LINKEDIN_HELPER_STABLE_VERSION;
  const [detectedVersion, setDetectedVersion] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let previousVersion: string | null = null;
    const read = () => {
      const version = document.documentElement.getAttribute(ATTRIBUTE);
      setDetectedVersion(version);
      if (version !== previousVersion) {
        previousVersion = version;
        const current = version === VERSION;
        setExpanded(!current);
        onDetection?.(current);
      }
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [ATTRIBUTE] });
    return () => observer.disconnect();
  }, [onDetection, VERSION]);

  if (!expanded && detectedVersion === VERSION) return <Card className="py-3">
    <div className="flex flex-wrap items-center justify-between gap-2 px-6 text-sm">
      <span className="flex items-center gap-2 font-medium"><Puzzle className="h-4 w-4" /> LinkedIn Helper</span>
      <div className="flex items-center gap-2">
        <Badge variant={detectedVersion === VERSION ? 'default' : 'secondary'}>Detected · v{detectedVersion}{detectedVersion !== VERSION ? ' · Update available' : ''}</Badge>
        <Button size="sm" variant="ghost" onClick={() => setExpanded(true)} aria-label="Show LinkedIn Helper installation guide"><ChevronDown className="h-4 w-4" /></Button>
      </div>
    </div>
  </Card>;

  return <Card>
    <CardHeader className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2"><Puzzle className="h-5 w-5" /> LinkedIn Helper {beta && <Badge variant="secondary">Beta</Badge>}</CardTitle>
        <Badge variant={detectedVersion === VERSION ? 'default' : 'secondary'}>
          {detectedVersion === VERSION ? `Detected · v${detectedVersion}` :
            detectedVersion ? `Update needed · v${detectedVersion}` : 'Not detected in this tab'}
        </Badge>
      </div>
      <CardDescription>{beta ? 'Lock your LinkedIn account and automatically record confirmed invitations in CRM HUB. LinkedIn controls remain available while CRM checks run in the background.' : 'Check requests from a LinkedIn profile and record invitations you sent in CRM HUB.'}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4 text-sm">
      {!detectedVersion && <p className="text-muted-foreground">An older extension cannot report its version here. Check your browser’s Extensions page before installing this release.</p>}
      <div className="flex flex-wrap gap-2">
        {detectedVersion === VERSION && <Button variant="outline" onClick={() => setExpanded(false)}>Collapse</Button>}
        {detectedVersion && detectedVersion !== VERSION && <p className="w-full font-medium">{beta ? 'Update available' : 'Your available version'}: download LinkedIn Helper v{VERSION} below.</p>}
        <a href={LINKEDIN_HELPER_DOWNLOAD} download="LinkedIn Helper.zip" className={`${buttonVariants({ variant: 'default' })} gap-2`}>
          <Download className="h-4 w-4" /> Download LinkedIn Helper
        </a>
      </div>
      <ol className="list-decimal space-y-2 pl-5">
        <li>Download <strong>LinkedIn Helper.zip</strong>. For a first installation, use Extract All and keep the resulting <strong>LinkedIn Helper</strong> folder in a permanent location. The ZIP contains <strong>manifest.json</strong> directly, without a versioned folder inside.</li>
        <li>Open <strong>chrome://extensions</strong> or <strong>edge://extensions</strong> and turn on <strong>Developer mode</strong>. For an update, replace the files in the existing loaded folder and click <strong>Reload</strong> on LinkedIn Helper. Keep its existing folder path, even if it has an older name; no renaming, removal, or Load unpacked again is needed. Resolve interrupted invitations in CRM before updating; reloading clears tracking session storage.</li>
        <li>For a first installation only, click <strong>Load unpacked</strong> and select the <strong>LinkedIn Helper</strong> folder containing <strong>manifest.json</strong>.</li>
        <li>Pin the extension, keep this signed-in CRM tab open, open a LinkedIn profile, and select <strong>Connect</strong> in the extension. Approve access to the CRM site if the browser asks.</li>
        {beta && <li>Select the account signed in on LinkedIn, then click <strong>Lock account for this browser profile</strong>. Reload existing LinkedIn tabs after installing or updating the extension.</li>}
        <li>Return to this page and refresh it. The status above should show <strong>Detected · v{VERSION}</strong>.</li>
      </ol>
      {beta ? <>
        <p className="text-muted-foreground">A compact status bar follows the profile you open: green when CRM recording is available, red when CRM cannot record, and yellow when a resend needs confirmation. Click the bar for details or to confirm a resend. Use Connect or More → Connect, then Send on LinkedIn. The helper observes your clicks without stopping, delaying, or replaying them. A confirmed Pending invitation is recorded automatically and the bar shows Sent with your remaining allowance. To change accounts, unlock and deliberately select the account you are using.</p>
        <p className="text-muted-foreground">If a tracked invitation was interrupted, return to its original LinkedIn tab and expand Needs review. Once LinkedIn shows Pending, confirm the named sending account and choose Record confirmed invitation. An uncertain save must be checked in CRM before clearing the attempt.</p>
      </> : <p className="text-muted-foreground">Send the invitation on LinkedIn first, then record it in CRM. After a successful save, the profile URL is copied to your clipboard.</p>}
    </CardContent>
  </Card>;
}
