const fs = require('fs');
const cp = require('child_process');

function countUsages(funcName) {
  try {
    const out = cp.execSync(`findstr /s /c:"${funcName}" app\\*.ts app\\*.tsx lib\\*.ts`).toString();
    return out.split('\n').filter(l => l.trim() !== '' && !l.includes('validation.ts') && !l.includes('mutations.ts') && !l.includes('queries.ts')).length;
  } catch(e) { return 0; }
}

const funcs = [
  'isValidId', 'normalizeDuplicateFieldValue', 'isBlankLeadValue', 'shouldIgnoreLinkedinDuplicate', 'assertRequiredLeadData',
  'parseLeadDataSafely', 'getLeadAuditName', 'buildAuditChanges', 'getDuplicateValue',
  'parseIsoDateLocal', 'daysInMonthLocal'
];

for (const f of funcs) {
  console.log(f + ': ' + countUsages(f) + ' usages outside their own files');
}
