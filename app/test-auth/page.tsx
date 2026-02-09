'use client';

import { useState } from 'react';
import { account, databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { ID } from 'appwrite';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function TestAuthPage() {
  const [logs, setLogs] = useState<string[]>([]);
  const [testEmail] = useState(`test${Date.now()}@example.com`);

  const addLog = (message: string) => {
    setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
    console.log(message);
  };

  const testFullSignupFlow = async () => {
    setLogs([]);
    try {
      addLog('🚀 Starting full signup test...');
      addLog(`📧 Test email: ${testEmail}`);
      addLog(`🗄️ Database ID: ${DATABASE_ID}`);
      addLog(`📁 Users Collection: ${COLLECTIONS.USERS}`);

      // Step 0: Clear any existing session
      addLog('0️⃣ Clearing any existing session...');
      try {
        await account.deleteSession('current');
        addLog('✅ Existing session cleared');
      } catch (error) {
        addLog('ℹ️  No existing session to clear');
      }

      // Step 1: Create account
      addLog('1️⃣ Creating Appwrite account...');
      const newAccount = await account.create(
        ID.unique(),
        testEmail,
        'TestPassword123!',
        'Test User'
      );
      addLog(`✅ Account created with ID: ${newAccount.$id}`);

      // Step 2: Create user document
      addLog('2️⃣ Creating user document...');
      const userDoc = await databases.createDocument(
        DATABASE_ID,
        COLLECTIONS.USERS,
        newAccount.$id,
        {
          name: 'Test User',
          email: testEmail,
          role: 'manager',
          managerId: null,
        }
      );
      addLog(`✅ User document created with ID: ${userDoc.$id}`);

      // Step 3: Create session
      addLog('3️⃣ Creating session...');
      await account.createEmailPasswordSession(testEmail, 'TestPassword123!');
      addLog('✅ Session created successfully');

      // Step 4: Verify session
      addLog('4️⃣ Verifying session...');
      const session = await account.get();
      addLog(`✅ Session verified for user: ${session.$id}`);

      // Step 5: Fetch user document
      addLog('5️⃣ Fetching user document...');
      const fetchedDoc = await databases.getDocument(
        DATABASE_ID,
        COLLECTIONS.USERS,
        session.$id
      );
      addLog(`✅ User document fetched: ${JSON.stringify(fetchedDoc, null, 2)}`);

      addLog('🎉 All tests passed!');
    } catch (error: any) {
      addLog(`❌ Error: ${error.message}`);
      addLog(`📋 Error details: ${JSON.stringify(error, null, 2)}`);
    }
  };

  const testDatabaseConnection = async () => {
    setLogs([]);
    try {
      addLog('🔍 Testing database connection...');
      addLog(`🗄️ Database ID: ${DATABASE_ID}`);
      addLog(`📁 Users Collection: ${COLLECTIONS.USERS}`);

      // Try to list documents from users collection (client-safe method)
      addLog('Attempting to list users documents...');
      const users = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS);
      addLog(`✅ Successfully connected to database`);
      addLog(`✅ Found ${users.total} user(s) in collection`);
    } catch (error: any) {
      addLog(`❌ Error: ${error.message}`);
      addLog(`Code: ${error.code}, Type: ${error.type}`);
    }
  };

  const testPermissions = async () => {
    setLogs([]);
    try {
      addLog('🔐 Testing permissions...');

      // Try to create a test document
      const testId = ID.unique();
      addLog(`Creating test document with ID: ${testId}`);

      const doc = await databases.createDocument(
        DATABASE_ID,
        COLLECTIONS.USERS,
        testId,
        {
          name: 'Permission Test',
          email: `permtest${Date.now()}@example.com`,
          role: 'manager',
          managerId: null,
        }
      );

      addLog(`✅ Document created successfully: ${doc.$id}`);

      // Clean up
      await databases.deleteDocument(DATABASE_ID, COLLECTIONS.USERS, testId);
      addLog('✅ Test document deleted');
    } catch (error: any) {
      addLog(`❌ Permission error: ${error.message}`);
      addLog(`Code: ${error.code}, Type: ${error.type}`);
    }
  };

  const clearLogs = () => setLogs([]);

  const logoutCurrentUser = async () => {
    setLogs([]);
    try {
      addLog('🚪 Logging out current user...');
      await account.deleteSession('current');
      addLog('✅ Logged out successfully');
      addLog('ℹ️  You can now test signup with a fresh session');
    } catch (error: any) {
      addLog(`❌ Error: ${error.message}`);
      addLog('ℹ️  No active session to logout');
    }
  };

  return (
    <div className="container mx-auto p-8">
      <Card>
        <CardHeader>
          <CardTitle>Authentication Testing Tool</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <Button onClick={testFullSignupFlow}>
              Test Full Signup Flow
            </Button>
            <Button onClick={testDatabaseConnection} variant="outline">
              Test Database Connection
            </Button>
            <Button onClick={testPermissions} variant="outline">
              Test Permissions
            </Button>
            <Button onClick={logoutCurrentUser} variant="secondary">
              Logout Current User
            </Button>
            <Button onClick={clearLogs} variant="destructive">
              Clear Logs
            </Button>
          </div>

          <div className="mt-4">
            <h3 className="font-semibold mb-2">Test Logs:</h3>
            <div className="bg-black text-green-400 p-4 rounded-md font-mono text-sm h-96 overflow-y-auto">
              {logs.length === 0 ? (
                <p className="text-gray-500">Click a test button to start...</p>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="mb-1">
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-950 rounded-md">
            <h4 className="font-semibold mb-2">Configuration:</h4>
            <pre className="text-xs">
              Database ID: {DATABASE_ID}
              {'\n'}Users Collection: {COLLECTIONS.USERS}
              {'\n'}Test Email: {testEmail}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
