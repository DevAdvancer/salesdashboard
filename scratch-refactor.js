const fs = require('fs');
const glob = require('glob');
const path = require('path');

const patterns = [
  'lib/services/lead-service.ts',
  'lib/services/user-service.ts',
  'lib/services/branch-service.ts',
  'app/actions/lead/**/*.ts',
  'lib/actions/lead/**/*.ts',
  'app/actions/linkedin/**/*.ts',
  'app/actions/attendance/**/*.ts',
  'app/actions/client-payments/**/*.ts',
  'app/leads/[id]/page.tsx',
  'app/users/page.tsx',
  'app/client/[id]/page.tsx',
  'app/assessment-support/page.tsx',
  'app/leads/page.tsx',
  'app/leads/new/page.tsx',
  'app/interview-support/page.tsx',
  'app/mock/page.tsx'
];

// Instead of global glob, we manually resolve if no glob package is available,
// but let's assume we can just use `fs` manually to traverse.
function getAllFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllFiles(fullPath));
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = [
  'lib/services/lead-service.ts',
  'lib/services/user-service.ts',
  'lib/services/branch-service.ts',
  ...getAllFiles('app/actions/lead'),
  ...getAllFiles('lib/actions/lead'),
  ...getAllFiles('app/actions/linkedin'),
  ...getAllFiles('app/actions/attendance'),
  ...getAllFiles('app/actions/client-payments'),
  'app/leads/[id]/page.tsx',
  'app/users/page.tsx',
  'app/client/[id]/page.tsx',
  'app/assessment-support/page.tsx',
  'app/leads/page.tsx',
  'app/leads/new/page.tsx',
  'app/interview-support/page.tsx',
  'app/mock/page.tsx'
].map(f => path.resolve(f)).filter(fs.existsSync);

for (const file of Array.from(new Set(files))) {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  // 1. Replace `catch (error: any)` with `catch (error: unknown)`
  if (content.includes('catch (error: any)')) {
    content = content.replace(/catch\s*\(\s*error:\s*any\s*\)/g, 'catch (error: unknown)');
    changed = true;
  }
  // Replace `error.message` with `(error instanceof Error ? error.message : "Unknown error")` where needed?
  // It's easier to just replace `error.message` with `(error instanceof Error ? error.message : String(error))`
  // but let's just do `getErrorMessage(error, "...")` if available, or just standard typescript approach.
  // We'll just replace `error.message` with `(error instanceof Error ? error.message : 'Unknown error')` inside those files
  // but only if it's safe. 
  if (content.includes('error.message') && changed) {
    content = content.replace(/error\.message/g, '(error instanceof Error ? error.message : String(error))');
  }

  // Replace console.* with logger.*
  if (content.match(/console\.(log|error|warn|info)/)) {
    content = content.replace(/console\.log/g, 'logger.info');
    content = content.replace(/console\.error/g, 'logger.error');
    content = content.replace(/console\.warn/g, 'logger.warn');
    content = content.replace(/console\.info/g, 'logger.info');
    
    // Add import { logger } from '@/lib/utils/logger'; if not present
    if (!content.includes('import { logger }')) {
      // Find the last import statement or put it at top
      const importRegex = /import\s+.*?;?\n/g;
      let lastIndex = 0;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        lastIndex = importRegex.lastIndex;
      }
      const importStmt = "import { logger } from '@/lib/utils/logger';\n";
      if (lastIndex > 0) {
        content = content.slice(0, lastIndex) + importStmt + content.slice(lastIndex);
      } else {
        content = importStmt + content;
      }
    }
    changed = true;
  }
  
  if (changed) {
    fs.writeFileSync(file, content);
    console.log('Updated ' + file);
  }
}
