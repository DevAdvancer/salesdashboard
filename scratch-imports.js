const fs = require('fs');
const files = [
  'app/actions/lead/constants.ts',
  'app/actions/lead/mutations.ts',
  'app/actions/lead/status.ts',
  'app/actions/lead/validation.ts',
  'app/actions/lead/visibility.ts'
];
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/, normalizeSource, isReferralSource } from "\.\/queries";/g, '} from "./queries";\nimport { normalizeSource, isReferralSource } from "@/lib/utils/lead-source";');
  content = content.replace(/, normalizeSource, isReferralSource } from '\.\/queries';/g, '} from \'./queries\';\nimport { normalizeSource, isReferralSource } from "@/lib/utils/lead-source";');
  fs.writeFileSync(file, content);
  console.log('Updated ' + file);
}
