const fs = require('fs');
for (const file of ['app/assessment-support/page.tsx', 'app/interview-support/page.tsx', 'app/leads/[id]/page.tsx']) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(/import \{ logger \} from '@\/lib\/utils\/logger';\n/g, '');
    content = content.replace(/catch\s*\(\s*error:\s*any\s*\)/g, 'catch (error: unknown)');
    content = content.replace(/error\.message/g, '(error instanceof Error ? error.message : String(error))');
    content = content.replace(/console\.log/g, 'logger.info');
    content = content.replace(/console\.error/g, 'logger.error');
    content = content.replace(/console\.warn/g, 'logger.warn');
    content = content.replace(/console\.info/g, 'logger.info');
    
    if (content.includes('"use client"')) {
      content = content.replace('"use client";', '"use client";\nimport { logger } from \'@/lib/utils/logger\';');
    } else {
      content = 'import { logger } from \'@/lib/utils/logger\';\n' + content;
    }
    fs.writeFileSync(file, content);
    console.log('Fixed ' + file);
  }
}
