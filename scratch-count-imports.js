const fs = require('fs');
const cp = require('child_process');

function countImports(funcName) {
  try {
    const out = cp.execSync(`findstr /s /c:"${funcName}" app\\*.ts app\\*.tsx lib\\*.ts`).toString();
    console.log(funcName + ' usages:');
    console.log(out.split('\n').filter(l => l.includes('import ')).join('\n'));
  } catch(e) { }
}

countImports('isValidId');
