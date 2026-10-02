const fs = require('fs');
let code = fs.readFileSync('lib/types/index.ts', 'utf8');

code = code.replace(
  /branchIds: string\[\];\r?\n\s*notificationsEnabled\?: boolean;/g,
  'branchIds: string[];\n    primaryBranchId?: string | null;\n    notificationsEnabled?: boolean;'
);

code = code.replace(
  /branchIds: string\[\];\r?\n\s*\}/g,
  'branchIds: string[];\n    primaryBranchId?: string | null;\n  }'
);

fs.writeFileSync('lib/types/index.ts', code);
