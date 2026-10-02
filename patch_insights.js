const fs = require('fs');
let code = fs.readFileSync('app/actions/client-payments/insights.ts', 'utf8');

code = code.replace(
  'const userNameMap = new Map<string, string>();',
  'const userNameMap = new Map<string, string>();\n    const userPrimaryBranchMap = new Map<string, string | null>();'
);

code = code.replace(
  'Query.select(["$id", "name"])',
  'Query.select(["$id", "name", "primaryBranchId"])'
);

code = code.replace(
  'userNameMap.set(u.$id, u.name);',
  'userNameMap.set(u.$id, u.name);\n          userPrimaryBranchMap.set(u.$id, typeof u.primaryBranchId === "string" ? u.primaryBranchId : null);'
);

code = code.replace(
  'branchId: leadMeta?.branchId ?? null,',
  'branchId: (leadOwnerIdMap.get(leadId) && userPrimaryBranchMap.get(leadOwnerIdMap.get(leadId))) ? userPrimaryBranchMap.get(leadOwnerIdMap.get(leadId)) : (leadMeta?.branchId ?? null),'
);

code = code.replace(
  'branchId: typeof lead.branchId === "string" ? lead.branchId : null,',
  'branchId: (ownerId && userPrimaryBranchMap.get(ownerId)) ? userPrimaryBranchMap.get(ownerId) : (typeof lead.branchId === "string" ? lead.branchId : null),'
);

fs.writeFileSync('app/actions/client-payments/insights.ts', code);
