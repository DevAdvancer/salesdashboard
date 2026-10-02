const fs = require('fs');
let code = fs.readFileSync('app/actions/technical-payments.ts', 'utf8');

code = code.replace(
  'const userNameMap = new Map<string, string>(',
  'const userPrimaryBranchMap = new Map<string, string | null>(\n    userDocs.map((u: any) => [u.$id, typeof u.primaryBranchId === "string" ? u.primaryBranchId : null])\n  );\n\n  const userNameMap = new Map<string, string>('
);

code = code.replace(
  'leadEmail: leadMeta.email,\n        branchId: leadMeta.branchId,',
  'leadEmail: leadMeta.email,\n        branchId: userPrimaryBranchMap.get(userId) || leadMeta.branchId,'
);

fs.writeFileSync('app/actions/technical-payments.ts', code);
