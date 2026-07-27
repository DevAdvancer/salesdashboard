const { Project } = require('ts-morph');
const path = require('path');

const project = new Project({
    tsConfigFilePath: "tsconfig.json",
});

const syncHelpersFile = project.createSourceFile("app/actions/lead/sync-helpers.ts", 
`import { LeadData, CreateLeadInput, Department, Lead } from "@/lib/types";
import { isReferralSource, normalizeSource } from "@/lib/utils/lead-source";
import { parseISO, isValid, format, isAfter, startOfDay, addDays, getDaysInMonth, endOfMonth, endOfDay } from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { EASTERN_TIMEZONE } from "@/lib/utils/eastern-date";
`, { overwrite: true });

const moveMap = {
    "app/actions/lead/validation.ts": ['isValidId', 'normalizeDuplicateFieldValue', 'isBlankLeadValue', 'shouldIgnoreLinkedinDuplicate', 'assertRequiredLeadData'],
    "app/actions/lead/mutations.ts": ['parseLeadDataSafely', 'getLeadAuditName', 'buildAuditChanges', 'getDuplicateValue'],
    "app/actions/lead/queries.ts": ['parseIsoDateLocal', 'daysInMonthLocal']
};

const allMovedFuncs = new Set(Object.values(moveMap).flat());

// 1. Move functions
for (const [filePath, funcs] of Object.entries(moveMap)) {
    const sourceFile = project.getSourceFile(filePath);
    if (!sourceFile) {
        console.error(`Could not find ${filePath}`);
        continue;
    }
    
    for (const funcName of funcs) {
        const funcDecl = sourceFile.getFunction(funcName);
        if (funcDecl) {
            syncHelpersFile.addFunction({
                name: funcName,
                isExported: true,
                parameters: funcDecl.getParameters().map(p => p.getStructure()),
                returnType: funcDecl.getReturnTypeNode()?.getText(),
                statements: funcDecl.getBodyText(),
            });
            funcDecl.remove();
        }
    }
}

syncHelpersFile.formatText();

// 2. Update imports in all files
for (const sourceFile of project.getSourceFiles()) {
    let changed = false;
    const imports = sourceFile.getImportDeclarations();
    
    for (const imp of imports) {
        const moduleSpecifier = imp.getModuleSpecifierValue();
        if (moduleSpecifier.includes('app/actions/lead/') || moduleSpecifier.includes('./') || moduleSpecifier.includes('../')) {
            const namedImports = imp.getNamedImports();
            const toMove = [];
            
            for (const named of namedImports) {
                const name = named.getName();
                if (allMovedFuncs.has(name)) {
                    toMove.push(name);
                    named.remove();
                    changed = true;
                }
            }
            
            // If the import statement is now empty, remove it
            if (imp.getNamedImports().length === 0 && !imp.getDefaultImport()) {
                imp.remove();
            }
            
            // Add the new import for sync-helpers
            if (toMove.length > 0) {
                // Figure out correct relative/absolute path for sync-helpers
                // If they used @/app/actions/lead/validation, we use @/app/actions/lead/sync-helpers
                let newModuleSpecifier = "@/app/actions/lead/sync-helpers";
                if (moduleSpecifier.startsWith('.')) {
                    // It's a relative import. We can resolve relative from current file to sync-helpers.ts
                    const currentDir = sourceFile.getDirectoryPath();
                    let relativePath = path.posix.relative(currentDir, syncHelpersFile.getFilePath());
                    if (!relativePath.startsWith('.')) relativePath = './' + relativePath;
                    relativePath = relativePath.replace(/\.ts$/, '');
                    newModuleSpecifier = relativePath;
                }
                
                sourceFile.addImportDeclaration({
                    namedImports: toMove,
                    moduleSpecifier: newModuleSpecifier
                });
            }
        }
    }
}

project.saveSync();
console.log('Refactoring complete.');
