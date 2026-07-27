const fs = require('fs');
const { execSync } = require('child_process');

// 2. Remove from all files using canExportLeadsByEmail
const files2 = execSync('git grep -l canExportLeadsByEmail').toString().split('\n').filter(Boolean);
for (const file of files2) {
  if (file.includes('lead-export-access')) continue;
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/import \{ canExportLeadsByEmail \} from ["'][^"']+["'];\r?\n/g, '');
  content = content.replace(/const canExportLeads = canExportLeadsByEmail\([^)]+\);\r?\n/g, '');
  // For JSX usage, we might need to remove `{canExportLeads && (...) }` but wait, in app/leads/page.tsx, it's used as:
  // const canExportLeads = canExportLeadsByEmail(user?.email);
  // and passed to LeadList as `canExportLeads={canExportLeads}` or similar.
  // Actually, wait, if I just remove `const canExportLeads = ...`, what happens to `canExportLeads`? It becomes undefined.
  // We should also remove it from LeadList props if it's there.
}
