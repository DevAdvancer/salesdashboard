const fs = require('fs');
let content = fs.readFileSync('scripts/sync-appwrite-schema.ts', 'utf8');

const target = `        key: 'candidate_name_search_idx',
        type: 'fulltext',
        attributes: ['candidateName'],
      }
    ],
  },
  {
    name: 'calendar_events',`;

const replacement = `        key: 'candidate_name_search_idx',
        type: 'fulltext',
        attributes: ['candidateName'],
      },
      {
        key: 'compliance_status_idx',
        type: 'key',
        attributes: ['complianceStatus'],
        orders: ['ASC']
      }
    ],
  },
  {
    name: 'calendar_events',`;

if (content.includes('compliance_status_idx')) {
  console.log('Already added');
} else {
  content = content.replace(target, replacement);
  fs.writeFileSync('scripts/sync-appwrite-schema.ts', content);
  console.log(content.includes('compliance_status_idx') ? 'Patched' : 'Target string not found');
}
