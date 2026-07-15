const fs = require('fs');
const path = require('path');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(function(file) {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) { 
            results = results.concat(walk(file));
        } else {
            if (file.endsWith('.ts') || file.endsWith('.tsx')) {
                results.push(file);
            }
        }
    });
    return results;
}

const files = walk('tests');
let modifiedCount = 0;

for (const file of files) {
    let content = fs.readFileSync(file, 'utf8');
    let original = content;

    // Remove duplicate teamLeadId properties
    // Pattern matches teamLeadId: <something>, ... teamLeadId: <something>
    // Just simple lines:
    const lines = content.split('\n');
    const newLines = [];
    let insideObject = false;
    let seenTeamLeadId = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('{')) insideObject = true;
        if (line.includes('}')) {
            insideObject = false;
            seenTeamLeadId = false;
        }

        if (line.match(/^\s*teamLeadId\s*:/)) {
            if (seenTeamLeadId) {
                // skip duplicate line
                continue;
            }
            seenTeamLeadId = true;
        }

        // Also fix assistant_manager
        let fixedLine = line.replace(/assistant_manager/g, 'assistant_team_lead');
        // Fix getTeamLeadsByTeamLead? Wait, did getAgentsByManager get replaced to getAgentsByTeamLead?
        fixedLine = fixedLine.replace(/createManager/g, 'createTeamLead');
        fixedLine = fixedLine.replace(/buildTeamLeadHierarchy/g, 'buildHierarchy'); // wait, let's see what is exported
        fixedLine = fixedLine.replace(/canCreateManagerlessTeamLead/g, 'canCreateOrphanTeamLead');

        newLines.push(fixedLine);
    }

    content = newLines.join('\n');

    if (content !== original) {
        fs.writeFileSync(file, content, 'utf8');
        modifiedCount++;
    }
}

console.log(`Modified ${modifiedCount} files.`);
