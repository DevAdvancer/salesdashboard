const fs = require('fs');
const { execSync } = require('child_process');

// 1. Remove from all files using getSpecialBranchLeadAccess
const files1 = execSync('git grep -l getSpecialBranchLeadAccess').toString().split('\n').filter(Boolean);
for (const file of files1) {
  if (file.includes('special-lead-access')) continue; // Skip the constant file itself
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/import \{ getSpecialBranchLeadAccess \} from ["'][^"']+["'];\r?\n/g, '');
  content = content.replace(/const specialBranchId = getSpecialBranchLeadAccess\([^)]+\);\r?\n/g, '');
  content = content.replace(/\s*if \(specialBranchId && branchId === specialBranchId\) \{\r?\n\s*return true;\r?\n\s*\}/g, '');
  content = content.replace(/\s*if \(specialBranchId && branchIds\?.includes\(specialBranchId\)\) \{\r?\n\s*return true;\r?\n\s*\}/g, '');
  fs.writeFileSync(file, content);
}
