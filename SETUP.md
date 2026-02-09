# SalesHub CRM - Setup Guide

This guide will help you set up the SalesHub CRM application with Appwrite backend.

## Prerequisites

- Node.js 20+ installed
- An Appwrite account (sign up at https://cloud.appwrite.io)
- npm or yarn package manager

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Create Appwrite Project

1. Go to https://cloud.appwrite.io
2. Create a new project
3. Note your Project ID from the project settings

## Step 3: Create API Key

1. In your Appwrite project, go to "Settings" → "API Keys"
2. Click "Create API Key"
3. Name it "Database Setup Key"
4. Under "Scopes", select:
   - `databases.read`
   - `databases.write`
   - `collections.read`
   - `collections.write`
   - `attributes.read`
   - `attributes.write`
   - `indexes.read`
   - `indexes.write`
   - `documents.read`
   - `documents.write`
5. Click "Create"
6. Copy the API key (you won't be able to see it again)

## Step 4: Configure Environment Variables

1. Copy `.env.local.example` to `.env.local`:
   ```bash
   cp .env.local.example .env.local
   ```

2. Edit `.env.local` and update:
   ```env
   NEXT_PUBLIC_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
   NEXT_PUBLIC_APPWRITE_PROJECT_ID=your-project-id-here
   APPWRITE_API_KEY=your-api-key-here
   ```

3. Replace `your-project-id-here` with your actual Appwrite Project ID
4. Replace `your-api-key-here` with the API key you created

## Step 5: Run Database Setup Script

This script will create the database, collections, indexes, and seed default data:

```bash
npm run setup:appwrite
```

You should see output like:
```
🚀 Starting Appwrite database setup...

📦 Creating database: crm-database-1
✅ Database created successfully

📋 Creating collection: users
✅ Collection users created with attributes and indexes

📋 Creating collection: leads
✅ Collection leads created with attributes and indexes

📋 Creating collection: form_config
✅ Collection form_config created with attributes and indexes

📋 Creating collection: access_config
✅ Collection access_config created with attributes and indexes

🌱 Seeding default data.
 8: Create Your First Manager Account

1. Navigate to the signup page
2. Create an account with your email and password
3. You will automatically be assigned the "Manager" role
4. You can now access all system features

## Database Structure

The setup script creates the following collections:

### users
- Stores user accounts with role (manager/agent) and hierarchy
- Attributes: name, email, role, managerId
- Indexes: email (unique), role, managerId

### leads
- Stores lead data with dynamic JSON structure
- Attributes: data (JSON), status, ownerId, assignedToId, isClosed, closedAt
- Indexes: ownerId, assignedToId, status, isClosed

### form_config
- Stores form field configuration (singleton with ID 'current')
- Attributes: fields (JSON array), version, updatedBy
- Indexes: version

### access_config
- Stores component visibility rules
- Attributes: componentKey, role, allowed
- Indexes: componentKey + role (unique composite)

## Default Configuration

### Default Form Fields
The system comes pre-configured with these fields:
- First Name (required)
- Last Name (required)
- Email (required)
- Phone
- Company
- Source (dropdown)
- Status (dropdown, required)
- Owner (hidden)
- Assigned To
- Legal Name
- SSN (Last 4)
- Visa Status (dropdown)
- Notes (textarea)

### Default Access Rules
Agents have access to:
- ✅ Dashboard
- ✅ Leads
- ❌ History
- ❌ User Management
- ❌ Field Management
- ❌ Settings

Managers have access to all components.

## Troubleshooting

### "Missing required environment variables"
- Make sure you've created `.env.local` and filled in all values
- Restart your development server after changing environment variables

### "Failed to create database"
- Check that your API key has the correct permissions
- Verify your Project ID is correct
- Ensure you have an active internet connection

### "Collection already exists"
- This is normal if you've run the setup script before
- The script will skip existing collections and continue

### Authentication not working
- Verify Email/Password auth is enabled in Appwrite console
- Check that your endpoint and project ID are correct
- Clear browser cookies and try again

## Next Steps

After setup is complete:

1. **Create Agent Accounts**: Use the User Management module to create agent accounts
2. **Configure Form Fields**: Use the Field Management module to customize lead forms
3. **Adjust Access Rules**: Use the Settings module to control component visibility
4. **Create Leads**: Start adding leads and assigning them to agents

## Security Notes

- **Never commit `.env.local`** to version control (it's in .gitignore)
- **Keep your API key secure** - it has full access to your database
- **Use different API keys** for development and production
- **Rotate API keys regularly** for security

## Support

For issues or questions:
- Check the main README.md for project documentation
- Review the requirements.md and design.md in `.kiro/specs/saleshub-crm/`
- Consult Appwrite documentation at https://appwrite.io/docs
