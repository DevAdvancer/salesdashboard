const fs = require('fs');
const { execSync } = require('child_process');

const files = execSync('git grep -l special-lead-access').toString().split('\n').filter(Boolean);
for (const file of files) {
  if (file.endsWith('.js') || file.endsWith('.md')) continue;
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/import \{ getSpecialBranchLeadAccess \} from ["'][^"']+["'];\r?\n/g, '');
  
  // Remove jest.mock
  content = content.replace(/jest\.mock\(['"]@\/lib\/constants\/special-lead-access['"], \(\) => \(\{\r?\n\s*getSpecialBranchLeadAccess: jest\.fn\(\(\) => null\),\r?\n\}\)\);\r?\n/g, '');
  content = content.replace(/jest\.mock\(['"]@\/lib\/constants\/special-lead-access['"], \(\) => \(\{\r?\n\s*getSpecialBranchLeadAccess: jest\.fn\(\(\) => null\),\r?\n\}\)\);\r?\n/g, '');
  
  fs.writeFileSync(file, content);
}
