const fs = require('fs');
let code = fs.readFileSync('components/users/edit-user-dialog.tsx', 'utf8');

code = code.replace(
  'selectedBranchIds: string[];\n  toggleBranch: ',
  'selectedBranchIds: string[];\n  selectedPrimaryBranchId: string | null;\n  setSelectedPrimaryBranchId: (id: string | null) => void;\n  toggleBranch: '
);

code = code.replace(
  'availableBranches,\n  selectedBranchIds,\n  toggleBranch,',
  'availableBranches,\n  selectedBranchIds,\n  selectedPrimaryBranchId,\n  setSelectedPrimaryBranchId,\n  toggleBranch,'
);

const editBranchSectionEnd = `                  {error && error.includes("Branch") && (
                    <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                      {error}
                    </p>
                  )}
                </div>`;

const newEditBranchSection = `                  {error && error.includes("Branch") && (
                    <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                      {error}
                    </p>
                  )}
                </div>
                
                {selectedBranchIds.length > 1 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Primary Branch
                    </label>
                    <select
                      value={selectedPrimaryBranchId || ''}
                      onChange={(e) => setSelectedPrimaryBranchId(e.target.value || null)}
                      className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- None --</option>
                      {availableBranches.filter(b => selectedBranchIds.includes(b.$id)).map((branch) => (
                        <option key={branch.$id} value={branch.$id}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}`;

code = code.replace(editBranchSectionEnd, newEditBranchSection);
fs.writeFileSync('components/users/edit-user-dialog.tsx', code);
