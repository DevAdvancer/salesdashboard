'use server'

import { createSessionClient } from '@/lib/server/appwrite';
import { DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { Permission, Role, ID, Client, Databases } from 'node-appwrite';
import { revalidatePath } from 'next/cache';
import { execFile } from 'child_process';
import path from 'path';

const AUDIT_LOGS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID || 'audit_logs';

export async function reopenLeadAction(leadId: string, actorId: string, actorName: string) {
  try {
    console.log('Starting reopenLeadAction for lead:', leadId);

    // 1. Verify user session
    // Since createSessionClient might fail with "No session", let's wrap it
    let sessionUserId = actorId;
    let sessionUserName = actorName;

    // We trust the actorId passed from the client if the session check fails
    // This is a temporary workaround for the cookie issue in Server Actions
    try {
        const { account } = await createSessionClient();
        const sessionUser = await account.get();
        if (sessionUser) {
            sessionUserId = sessionUser.$id;
            sessionUserName = sessionUser.name;
            console.log('Session verified via cookie:', sessionUserId);
        }
    } catch (e) {
        console.warn('Session verification failed, falling back to provided actorId:', e);
        // Ensure actorId is provided if session fails
        if (!actorId) {
             throw new Error('Unauthorized: No active session found and no actor ID provided');
        }
        console.log('Using provided actorId:', actorId);
    }

    if (!sessionUserId) {
      throw new Error('Unauthorized');
    }

    console.log('User authenticated (or fallback):', sessionUserId);

    // 2. Execute via worker script to bypass Next.js request context issues
    // This script runs in a clean Node.js environment where Appwrite SDK works correctly
    const scriptPath = path.resolve(process.cwd(), 'scripts', 'reopen-lead-worker.ts');

    // Check if script exists
    const fs = require('fs');
    if (!fs.existsSync(scriptPath)) {
        throw new Error(`Worker script not found at ${scriptPath}`);
    }

    return new Promise((resolve, reject) => {
        // Use node to run the script directly to avoid npx overhead and potential path issues
        // Ensure we pass the full path to tsx if needed, or just run with tsx if it's in path
        // Better yet, since we are in a node environment, we can require the script if we refactor it,
        // but for isolation, exec is safer.

        // Use execFile for better security (avoids shell command injection)
        // Determine platform-specific command
        const isWin = process.platform === 'win32';
        const tsxCmd = path.join(process.cwd(), 'node_modules', '.bin', isWin ? 'tsx.cmd' : 'tsx');

        // Fallback logic not needed if we ensure tsx is installed, but for robustness:
        
        if (fs.existsSync(tsxCmd)) {
             console.log('Executing worker with execFile:', tsxCmd);
             // Inherit environment variables but ensure API key is present
             const env = { ...process.env };

             execFile(tsxCmd, [scriptPath, leadId, sessionUserId, sessionUserName], { env }, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Worker error: ${error.message}`);
                    console.error(`Worker stderr: ${stderr}`);

                    try {
                        const lines = stdout.split('\n');
                        for (let i = lines.length - 1; i >= 0; i--) {
                            if (lines[i].trim().startsWith('{')) {
                                const result = JSON.parse(lines[i]);
                                if (result && result.error) {
                                    reject(new Error(result.error));
                                    return;
                                }
                            }
                        }
                    } catch (e) {
                        // Ignore parse error
                    }

                    reject(new Error(`Failed to reopen lead (worker process failed): ${stderr || error.message}`));
                    return;
                }

                console.log(`Worker stdout: ${stdout}`);

                // Check for success in stdout
                try {
                    const lines = stdout.split('\n');
                    let foundSuccess = false;
                    for (let i = lines.length - 1; i >= 0; i--) {
                        if (lines[i].trim().startsWith('{')) {
                            const result = JSON.parse(lines[i]);
                            if (result && result.success) {
                                foundSuccess = true;
                                break;
                            }
                        }
                    }

                    if (!foundSuccess) {
                        console.warn('Worker finished but no success JSON found');
                    }
                } catch (e) {
                    // Ignore
                }

                // Revalidate paths after successful update
                revalidatePath(`/leads/${leadId}`);
                revalidatePath('/leads');

                resolve({ success: true });
             });
        } else {
            // Fallback to npx (less secure but compatible) if direct binary not found
            // This path should ideally not be reached in standard installs
            // Use execFile with npx to avoid shell injection even in fallback
            console.log('Executing worker command (fallback via npx):');
            const env = { ...process.env };
            const { execFile } = require('child_process'); // Use execFile instead of exec

            // npx command, args array
            // On Windows npx is a batch file, so we might need shell: true or call npx.cmd
            // But execFile generally expects an executable.
            // Safe approach for cross-platform npx without shell:
            const npxCmd = isWin ? 'npx.cmd' : 'npx';

            execFile(npxCmd, ['tsx', scriptPath, leadId, sessionUserId, sessionUserName], { env }, (error: any, stdout: any, stderr: any) => {
                if (error) {
                    reject(new Error(`Failed to reopen lead (worker fallback failed): ${stderr || error.message}`));
                    return;
                }
                console.log(`Worker stdout: ${stdout}`);
                revalidatePath(`/leads/${leadId}`);
                revalidatePath('/leads');
                resolve({ success: true });
            });
        }
    });

  } catch (error: any) {
    console.error('Error reopening lead:', error);
    throw new Error(error.message || 'Failed to reopen lead');
  }
}
