import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { CLIENT_CARD_CSS, FEEDBACK_MILESTONES } from '@/lib/client-card-design';

export const dynamic = 'force-dynamic';
export async function GET() {
  const nonce = randomBytes(18).toString('base64');
  // Standalone HTML avoids mounting CRM auth/data providers on a publicly shared card.
  const html = `<!doctype html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Client Progress · CRM HUB</title><style nonce="${nonce}">${CLIENT_CARD_CSS}</style><script nonce="${nonce}">try{document.documentElement.classList.toggle('dark',(localStorage.getItem('salesdashboard-theme')||'dark')==='dark');}catch{}</script></head><body>
<main class="shell"><article class="client-card" id="card"><p class="message" role="status">Opening shared client card…</p></article><div class="controls"><button class="button" type="button" id="more" hidden>Load more feedback</button><button class="button" type="button" id="copy" hidden>Copy card link</button></div><p class="footer" id="footer">CRM HUB · Shared client progress · View only</p></main>
<script nonce="${nonce}">
(()=>{'use strict';
const root=document.getElementById('card'),more=document.getElementById('more'),copy=document.getElementById('copy'),footer=document.getElementById('footer');
const milestones=${JSON.stringify(FEEDBACK_MILESTONES)};
const token=location.hash.slice(1);let cursor=null,busy=false,count=0,timeline,expiryTimer;
const date=v=>v?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',year:'numeric'}).format(new Date(/^\\d{4}-\\d{2}-\\d{2}$/.test(v)?v+'T12:00:00Z':v)):'Not started';
function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;}
function field(label,value){const n=node('div');n.append(node('div','field-label',label),node('div','field-value',value||'—'));return n;}
function fail(message){clearTimeout(expiryTimer);root.replaceChildren(node('p','message error',message));more.hidden=true;copy.hidden=true;}
function expireAt(value){const remaining=Date.parse(value)-Date.now();if(remaining<=0){fail('This link has expired. Ask the sender for a current link.');return;}expiryTimer=setTimeout(()=>expireAt(value),Math.min(2147483647,remaining));}
function render(data){const c=data.card;root.replaceChildren(node('h1','card-heading',c.candidateName),node('p','card-subtitle','Marketing started: '+(c.marketingStartedOn?date(c.marketingStartedOn):c.progressStatus==='New'?'Not started':'Not recorded')+' | Managed by: '+(c.salespersonName||'—')));
const people=node('div','people');people.append(field('Sales Person:',c.salespersonName),field('Recruiter:',c.recruiterName),field('Marketing TL:',c.marketingTl));root.append(people);
if(c.email!==undefined||c.phone!==undefined){const contact=node('div','contact');contact.append(field('Email:',c.email),field('Phone:',c.phone));root.append(contact);}
const status=node('section','status-block'),top=node('div','status-top');top.append(node('span','section-title','CURRENT STATUS'),node('span','badge'+(c.progressStatus==='Placed'?' placed':''),c.progressStatus));status.append(top);
if(c.notes!==undefined){const remarks=node('div','remarks');remarks.append(node('div','section-title','STATUS COMMENT / REMARKS:'),node('p','copy',c.notes||'No remarks yet.'));status.append(remarks);}root.append(status);
timeline=node('div');root.append(timeline);const final=node('section','feedback final');final.append(node('h2','','FINAL FEEDBACK (OVERALL SERVICE REVIEW)'),node('p','copy',c.finalFeedback||'Final feedback has not been saved yet.'));root.append(final);
footer.textContent='CRM HUB · View only · Link expires '+date(data.expiresAt);copy.hidden=false;expireAt(data.expiresAt);}
async function load(){if(busy)return;busy=true;more.disabled=true;
try{if(!/^s_[0-9a-f]{32}\\.[A-Za-z0-9_-]{43}$/.test(token))throw new Error('This card is unavailable. Ask the sender for a current link.');
const response=await fetch('/api/public/client-card',{method:'POST',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,...(cursor?{cursor}: {})})});
const data=await response.json();if(!response.ok)throw new Error(data.error||'This card is unavailable.');
if(!timeline)render(data);
if(!count&&!data.feedback.length)timeline.append(node('p','copy','No feedback has been added yet.'));
for(const item of data.feedback){count++;const box=node('section','feedback');box.append(node('h2','','FEEDBACK '+count+(milestones[count-1]?' ('+milestones[count-1]+')':'')),node('p','copy',item.text),node('div','feedback-meta',(item.authorName||'CRM team')+' · '+date(item.createdAt)));timeline.append(box);}
cursor=data.nextCursor;more.hidden=!cursor;
}catch(error){fail(error instanceof Error?error.message:'This card is unavailable.');}finally{busy=false;more.disabled=false;}}
more.addEventListener('click',load);copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);copy.textContent='Link copied';}catch{copy.textContent='Copy the link from your address bar';}});load();
})();</script></body></html>`;
  return new NextResponse(html, { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; font-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  } });
}
