import { ID, Permission, Role, Query } from 'appwrite';
import { account, databases } from '@/lib/appwrite';

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!;

export interface CreateAgentInput {
  name: string;
  email: string;
  password: string;
  managerId: string;
}

export interface User {
  $id: string;
  name: string;
  email: string;
  role: 'manager' | 'agent';
  managerId: string | null;
  $createdAt: string;
  $updatedAt: string;
}

/**
 * Create a new agent account
 *
 * This function:
 * 1. Creates an Appwrite Auth account
 * 2. Creates a user document with role='agent' and managerId
 * 3. Sets up document-level permissions for the agent
 *
 * @param input - Agent creation data
 * @returns The created user document
 */
export async function createAgent(input: CreateAgentInput): Promise<User> {
  const { name, email, password, managerId } = input;

  try {
    // Generate a unique ID for the user
    const userId = ID.unique();

    // Step 1: Create Appwrite Auth account
    await account.create(userId, email, password, name);

    // Step 2: Create user document with role='agent' and managerId
    const userDoc = await databases.createDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      userId,
      {
        name,
        email,
        role: 'agent',
        managerId,
      },
      [
        // Document-level permissions
        Permission.read(Role.user(userId)), // Agent can read their own document
        Permission.read(Role.user(managerId)), // Manager can read agent's document
        Permission.update(Role.user(userId)), // Agent can update their own document
        Permission.update(Role.user(managerId)), // Manager can update agent's document
        Permission.delete(Role.user(managerId)), // Manager can delete agent's document
      ]
    );

    return userDoc as User;
  } catch (error: any) {
    console.error('Error creating agent:', error);

    // Provide more specific error messages
    if (error.code === 409 || error.message?.includes('already exists')) {
      throw new Error('A user with this email already exists');
    }

    throw new Error(error.message || 'Failed to create agent account');
  }
}

/**
 * Get all agents for a specific manager
 *
 * @param managerId - The manager's user ID
 * @returns List of agents linked to the manager
 */
export async function getAgentsByManager(managerId: string): Promise<User[]> {
  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [
        Query.equal('role', 'agent'),
        Query.equal('managerId', managerId),
      ]
    );

    return response.documents as User[];
  } catch (error: any) {
    console.error('Error fetching agents:', error);
    throw new Error(error.message || 'Failed to fetch agents');
  }
}

/**
 * Get a user by ID
 *
 * @param userId - The user's ID
 * @returns The user document
 */
export async function getUserById(userId: string): Promise<User> {
  try {
    const userDoc = await databases.getDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      userId
    );

    return userDoc as User;
  } catch (error: any) {
    console.error('Error fetching user:', error);
    throw new Error(error.message || 'Failed to fetch user');
  }
}

/**
 * Update a user's information
 *
 * @param userId - The user's ID
 * @param data - The data to update
 * @returns The updated user document
 */
export async function updateUser(
  userId: string,
  data: Partial<Pick<User, 'name' | 'email'>>
): Promise<User> {
  try {
    const userDoc = await databases.updateDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      userId,
      data
    );

    return userDoc as User;
  } catch (error: any) {
    console.error('Error updating user:', error);
    throw new Error(error.message || 'Failed to update user');
  }
}

/**
 * Delete an agent account
 * Note: This only deletes the user document, not the Appwrite Auth account
 *
 * @param agentId - The agent's user ID
 */
export async function deleteAgent(agentId: string): Promise<void> {
  try {
    await databases.deleteDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      agentId
    );
  } catch (error: any) {
    console.error('Error deleting agent:', error);
    throw new Error(error.message || 'Failed to delete agent');
  }
}
