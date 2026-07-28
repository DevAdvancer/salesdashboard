const fs = require('fs');
const path = require('path');

function findFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const stat = fs.statSync(path.join(dir, file));
    if (stat.isDirectory()) {
      findFiles(path.join(dir, file), fileList);
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      fileList.push(path.join(dir, file));
    }
  }
  return fileList;
}

const allTsFiles = findFiles('./app').concat(findFiles('./lib'));

let changedFiles = 0;
for (const file of allTsFiles) {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  if (content.includes('AUDIT_LOGS')) {
    // 1. replace const AUDIT_LOGS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID!;
    if (content.includes('const AUDIT_LOGS_COLLECTION_ID')) {
      content = content.replace(/const AUDIT_LOGS_COLLECTION_ID = process\.env\.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID!;/g, 'const AUDIT_LOGS_COLLECTION_ID = \"\";');
      changed = true;
    }

    // 2. replace COLLECTIONS.AUDIT_LOGS with ''
    if (content.includes('COLLECTIONS.AUDIT_LOGS')) {
      content = content.replace(/COLLECTIONS\.AUDIT_LOGS/g, '\"\"');
      changed = true;
    }
    
    // 3. replace process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID! with ''
    if (content.includes('process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID!')) {
      content = content.replace(/process\.env\.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID!/g, '\"\"');
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(file, content);
    changedFiles++;
    console.log('Updated: ' + file);
  }
}
console.log('Total changed: ' + changedFiles);
