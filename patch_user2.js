const fs = require('fs');
let code = fs.readFileSync('app/actions/user.ts', 'utf8');

code = code.replace(
  '    branchIds?: string[];\n    email?: string;',
  '    branchIds?: string[];\n    primaryBranchId?: string | null;\n    email?: string;'
);

fs.writeFileSync('app/actions/user.ts', code);
