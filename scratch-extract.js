const fs = require('fs');
const path = require('path');

const srcDir = 'd:\\salesdashboard';
const targetHelper = path.join(srcDir, 'app', 'actions', 'lead', 'sync-helpers.ts');
const funcsToMove = {
  'validation.ts': ['isValidId', 'normalizeDuplicateFieldValue', 'isBlankLeadValue', 'shouldIgnoreLinkedinDuplicate', 'assertRequiredLeadData'],
  'mutations.ts': ['parseLeadDataSafely', 'getLeadAuditName', 'buildAuditChanges', 'getDuplicateValue'],
  'queries.ts': ['parseIsoDateLocal', 'daysInMonthLocal']
};

let helperContent = `import { LeadData, CreateLeadInput, Department, Lead } from "@/lib/types";\nimport { isReferralSource, normalizeSource } from "@/lib/utils/lead-source";\n\n`;

for (const [fileName, funcs] of Object.entries(funcsToMove)) {
  const filePath = path.join(srcDir, 'app', 'actions', 'lead', fileName);
  let content = fs.readFileSync(filePath, 'utf8');
  
  for (const func of funcs) {
    // Basic extraction logic for functions
    const regex = new RegExp(`export function ${func}\\([\\s\\S]*?\\n\\}`);
    const match = content.match(regex);
    if (match) {
      helperContent += match[0] + '\n\n';
      content = content.replace(regex, '');
    }
  }
  fs.writeFileSync(filePath, content);
}

fs.writeFileSync(targetHelper, helperContent);
console.log('Created sync-helpers.ts');

// Now update all imports
function walkDir(dir, callback) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(f => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (!p.includes('node_modules') && !p.includes('.git') && !p.includes('.next')) walkDir(p, callback);
    } else {
      callback(p);
    }
  });
}

const allFuncs = Object.values(funcsToMove).flat();
walkDir(srcDir, (p) => {
  if (p.endsWith('.ts') || p.endsWith('.tsx')) {
    let c = fs.readFileSync(p, 'utf8');
    let changed = false;
    
    // Quick and dirty: if file contains any of the funcs, ensure sync-helpers is imported
    // Actually, since we're just splitting from existing files, let's just find where they are imported
    // This is complex. A safer way: replace `import { ..., isValidId, ... } from './validation'`
    // with two imports.
  }
});
