'use client';

import { useEffect, useState } from 'react';
import { Download, Puzzle, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/contexts/auth-context';
import { canUseLinkedinExtension } from '@/lib/server/linkedin-extension-policy';

const VERSION = '2.0.0';
const ATTRIBUTE = 'data-crm-hub-linkedin-helper-version';
const DOWNLOAD = `/downloads/crm-hub-linkedin-helper-${VERSION}-chrome.zip`;

export function LinkedinExtensionSection({ onDetection }: { onDetection?: (detected: boolean) => void }) {
  const { user } = useAuth();
  return user && canUseLinkedinExtension(user) ? <LinkedinExtensionGuide onDetection={onDetection} /> : null;
}

export function LinkedinExtensionGuide({ onDetection }: { onDetection?: (detected: boolean) => void }) {
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
  }, [onDetection]);

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
        <CardTitle className="flex items-center gap-2"><Puzzle className="h-5 w-5" /> LinkedIn Helper</CardTitle>
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
        {detectedVersion === VERSION && <Button variant="outline" onClick={() => setExpanded(false)}>Collapse</Button>}
        {detectedVersion && detectedVersion !== VERSION && <p className="w-full font-medium">Update available: download LinkedIn Helper v{VERSION} below.</p>}
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
      <p className="text-muted-foreground">Send the invitation on LinkedIn first, then record it in CRM. After a successful save, the profile URL is copied to your clipboard.</p>
    </CardContent>
  </Card>;
}
