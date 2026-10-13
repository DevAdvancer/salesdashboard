'use client';

import { useEffect, useState } from 'react';
import { Download, Puzzle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getMyLinkedinHelperAccessAction } from '@/app/actions/beta';
import { useAuth } from '@/lib/contexts/auth-context';

const VERSION = '1.6.0';
const ATTRIBUTE = 'data-crm-hub-linkedin-helper-version';
const DOWNLOAD = `/downloads/crm-hub-linkedin-helper-${VERSION}-chrome.zip`;

export function LinkedinExtensionSection() {
  const { user, serverSessionReady } = useAuth();
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    if (!user || !serverSessionReady) return;
    let active = true;
    getMyLinkedinHelperAccessAction().then(result => { if (active) setAllowed(result); })
      .catch(() => { if (active) setAllowed(false); });
    return () => { active = false; };
  }, [user, serverSessionReady]);
  return allowed ? <LinkedinExtensionGuide /> : null;
}

export function LinkedinExtensionGuide() {
  const [detectedVersion, setDetectedVersion] = useState<string | null>(null);

  useEffect(() => {
    const read = () => setDetectedVersion(document.documentElement.getAttribute(ATTRIBUTE));
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [ATTRIBUTE] });
    return () => observer.disconnect();
  }, []);

  return <Card>
    <CardHeader className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2"><Puzzle className="h-5 w-5" /> LinkedIn Helper beta</CardTitle>
        <Badge variant={detectedVersion === VERSION ? 'default' : 'secondary'}>
          {detectedVersion === VERSION ? `Detected · v${detectedVersion}` :
            detectedVersion ? `Update needed · v${detectedVersion}` : 'Not detected in this tab'}
        </Badge>
      </div>
      <CardDescription>Check requests from a LinkedIn profile and record invitations you sent in CRM HUB.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4 text-sm">
      {!detectedVersion && <p className="text-muted-foreground">An older extension cannot report its version here. Check your browser’s Extensions page before installing this release.</p>}
      <div className="flex flex-wrap gap-2">
        <a href={DOWNLOAD} download className={`${buttonVariants({ variant: 'default' })} gap-2`}>
          <Download className="h-4 w-4" /> Download v{VERSION}
        </a>
      </div>
      <ol className="list-decimal space-y-2 pl-5">
        <li>Download the ZIP and extract it to a folder you will keep on this computer.</li>
        <li>Open <strong>chrome://extensions</strong> or <strong>edge://extensions</strong>. Find any older <strong>CRM HUB LinkedIn Helper</strong> or previous LinkedIn helper, open <strong>Details</strong> to check its version, then click <strong>Remove</strong>.</li>
        <li>Turn on <strong>Developer mode</strong>, click <strong>Load unpacked</strong>, and select the extracted folder containing <strong>manifest.json</strong>.</li>
        <li>Pin the extension, keep this signed-in CRM tab open, open a LinkedIn profile, and select <strong>Connect</strong> in the extension. Approve access to the CRM site if the browser asks.</li>
        <li>Return to this page and refresh it. The status above should show <strong>Detected · v{VERSION}</strong>.</li>
      </ol>
      <p className="text-muted-foreground">The extension cannot send LinkedIn invitations for you. Send one on LinkedIn first, then record it in CRM.</p>
    </CardContent>
  </Card>;
}
