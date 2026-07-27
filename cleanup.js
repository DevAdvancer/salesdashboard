const fs = require('fs');
const { execSync } = require('child_process');

const files = execSync('git grep -l special-lead-access').toString().split('\n').filter(Boolean);
for (const file of files) {
  if (file.endsWith('.js') || file.endsWith('.md')) continue;
  let content = fs.readFileSync(file, 'utf8');
  
  // Split into lines and filter out any line containing 'special-lead-access'
  const lines = content.split(/\r?\n/);
  const newLines = lines.filter(line => !line.includes('special-lead-access') && !line.includes('getSpecialBranchLeadAccess'));
  
  fs.writeFileSync(file, newLines.join('\n'));
}
