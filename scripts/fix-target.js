const fs = require('fs');
let content = fs.readFileSync('app/actions/target-report.ts', 'utf8');

const startStr = "// 4c. Followup payments in the month window.";
const endStr = "  // 5. Build users map for the agent set so the report can show names.";

const startIdx = content.indexOf(startStr);
const endIdx = content.indexOf(endStr);

if (startIdx === -1 || endIdx === -1) { throw new Error("not found"); }

const followupCode = content.substring(startIdx, endIdx);
content = content.substring(0, startIdx) + content.substring(endIdx);

const insertIdx = content.indexOf("// 4a. Dynamically calculate Upfront Client Payments for the month");
content = content.substring(0, insertIdx) + followupCode + "\n\n  " + content.substring(insertIdx);

const searchStr = `    for (const [agentId, amount] of agentTotals.entries()) {
      if (readableAgentIds.includes(agentId)) {
        if (!agentStatsByUserId[agentId]) {
          agentStatsByUserId[agentId] = { achieved: 0, leadCount: 0, referralExcludedCount: 0, notInterestedCount: 0 };
        }
        agentStatsByUserId[agentId].achieved += amount;
      }
    }`;

const replaceStr = `    // Deduct followups
    const followupsForThisLead = docs
      .filter((doc) => doc.leadId === leadId)
      .reduce((sum, doc) => sum + (Number(doc.amount) || 0), 0);

    for (let [agentId, amount] of agentTotals.entries()) {
      amount -= followupsForThisLead;
      if (amount < 0) amount = 0;
      
      if (amount > 0 && readableAgentIds.includes(agentId)) {
        if (!agentStatsByUserId[agentId]) {
          agentStatsByUserId[agentId] = { achieved: 0, leadCount: 0, referralExcludedCount: 0, notInterestedCount: 0 };
        }
        agentStatsByUserId[agentId].achieved += amount;
      }
    }`;

content = content.replace(searchStr, replaceStr);
// wait, CRLF issues with replace? I will split lines instead if searchStr has CRLF.
// Let's just fix the CRLF.
content = content.replace(searchStr.replace(/\n/g, '\r\n'), replaceStr);
fs.writeFileSync('app/actions/target-report.ts', content);
