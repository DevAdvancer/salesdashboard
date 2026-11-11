'use client';

import { useEffect, useState } from 'react';
import { Download, Puzzle, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/contexts/auth-context';
import { canUseLinkedinExtension } from '@/lib/server/linkedin-extension-policy';

const STANDARD_VERSION = '2.0.0';
const CONVERSATION_VERSION = '2.1.0';
const ATTRIBUTE = 'data-crm-hub-linkedin-helper-version';

type GuideProps = { onDetection?: (detected: boolean) => void; conversationsBeta?: boolean };

export function LinkedinExtensionSection({ onDetection, conversationsBeta }: GuideProps) {
  const { user } = useAuth();
  return user && canUseLinkedinExtension(user) ? <LinkedinExtensionGuide onDetection={onDetection} conversationsBeta={conversationsBeta} /> : null;
}

export function LinkedinExtensionGuide({ onDetection, conversationsBeta }: GuideProps) {
  const version = conversationsBeta ? CONVERSATION_VERSION : STANDARD_VERSION;
  const download = `/downloads/crm-hub-linkedin-helper-${version}-chrome.zip`;
  const [detectedVersion, setDetectedVersion] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const current = detectedVersion === version || (!conversationsBeta && detectedVersion === CONVERSATION_VERSION);

  useEffect(() => {
    let previousVersion: string | null = null;
    const read = () => {
      const detected = document.documentElement.getAttribute(ATTRIBUTE);
      setDetectedVersion(detected);
      if (detected !== previousVersion) {
        previousVersion = detected;
        const installed = detected === version || (!conversationsBeta && detected === CONVERSATION_VERSION);
        setExpanded(!installed);
        onDetection?.(installed);
      }
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [ATTRIBUTE] });
    return () => observer.disconnect();
  }, [onDetection, version, conversationsBeta]);

  if (!expanded && current) return <Card className="py-3">
    <div className="flex flex-wrap items-center justify-between gap-2 px-6 text-sm">
      <span className="flex items-center gap-2 font-medium"><Puzzle className="h-4 w-4" /> LinkedIn Helper</span>
      <div className="flex items-center gap-2">
        <Badge>Detected · v{detectedVersion}</Badge>
        <Button size="sm" variant="ghost" onClick={() => setExpanded(true)} aria-label="Show LinkedIn Helper installation guide"><ChevronDown className="h-4 w-4" /></Button>
      </div>
    </div>
  </Card>;

  return <Card>
    <CardHeader className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2"><Puzzle className="h-5 w-5" /> LinkedIn Helper</CardTitle>
        <Badge variant={current ? 'default' : 'secondary'}>
          {current ? `Detected · v${detectedVersion}` :
            detectedVersion ? `Update needed · v${detectedVersion}` : 'Not detected in this tab'}
        </Badge>
      </div>
      <CardDescription>Check requests from a LinkedIn profile and record invitations you sent in CRM HUB.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4 text-sm">
      {!detectedVersion && <p className="text-muted-foreground">An older extension cannot report its version here. Check your browser’s Extensions page before installing this release.</p>}
      <div className="flex flex-wrap gap-2">
        {current && <Button variant="outline" onClick={() => setExpanded(false)}>Collapse</Button>}
        {detectedVersion && !current && <p className="w-full font-medium">Update available. Download LinkedIn Helper v{version} below.</p>}
        <a href={download} download className={`${buttonVariants({ variant: 'default' })} gap-2`}>
          <Download className="h-4 w-4" /> Download v{version}{conversationsBeta ? ' beta' : ''}
        </a>
      </div>
      <ol className="list-decimal space-y-2 pl-5">
        <li>Download the ZIP and extract it to a folder you will keep on this computer.</li>
        <li>Open <strong>chrome://extensions</strong> or <strong>edge://extensions</strong>. Find any older <strong>CRM HUB LinkedIn Helper</strong> or previous LinkedIn helper, open <strong>Details</strong> to check its version, then click <strong>Remove</strong>.</li>
        <li>Turn on <strong>Developer mode</strong>, click <strong>Load unpacked</strong>, and select the extracted folder containing <strong>manifest.json</strong>.</li>
        <li>Pin the extension, keep this signed-in CRM tab open, open a LinkedIn profile, and select <strong>Connect</strong> in the extension. Approve access to the CRM site if the browser asks.</li>
        <li>Return to this page and refresh it. The status above should show <strong>Detected · v{detectedVersion && current ? detectedVersion : version}</strong>.</li>
      </ol>
      <p className="text-muted-foreground">Send the invitation on LinkedIn first, then record it in CRM. After a successful save, the profile URL is copied to your clipboard.</p>
    </CardContent>
  </Card>;
}
