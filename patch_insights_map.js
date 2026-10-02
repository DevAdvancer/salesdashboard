const fs = require('fs');
let code = fs.readFileSync('app/actions/client-payments/insights.ts', 'utf8');

code = code.replace(
  'branchId: (ownerId && userPrimaryBranchMap.get(ownerId)) ? userPrimaryBranchMap.get(ownerId) : (typeof lead.branchId === "string" ? lead.branchId : null),',
  'branchId: typeof lead.branchId === "string" ? lead.branchId : null,'
);

code = code.replace(
  'branchId: (leadOwnerIdMap.get(leadId) && userPrimaryBranchMap.get(leadOwnerIdMap.get(leadId))) ? userPrimaryBranchMap.get(leadOwnerIdMap.get(leadId)) : (leadMeta?.branchId ?? null),',
  'branchId: leadMeta?.branchId ?? null,'
);

const userFetchEnd = 'userPrimaryBranchMap.set(u.$id, typeof u.primaryBranchId === "string" ? u.primaryBranchId : null);\n        }\n      }';

const newCode = userFetchEnd + '\n\n      for (const [leadId, meta] of leadDataMap.entries()) {\n        const ownerId = leadOwnerIdMap.get(leadId);\n        if (ownerId) {\n          const primary = userPrimaryBranchMap.get(ownerId);\n          if (primary) {\n            meta.branchId = primary;\n          }\n        }\n      }';

code = code.replace(userFetchEnd, newCode);
fs.writeFileSync('app/actions/client-payments/insights.ts', code);
