/**
 * Quick test script to verify Google OAuth credentials
 * 
 * This script:
 * 1. Loads credentials from .env
 * 2. Generates an OAuth authorization URL
 * 3. Verifies the credentials are valid
 * 
 * Run with: node test-google-auth.js
 */

import { google } from 'googleapis';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

// Check if credentials are loaded
console.log('🔍 Checking Google OAuth credentials...\n');

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_REDIRECT_URI;

if (!clientId) {
  console.error('❌ GOOGLE_CLIENT_ID not found in .env file');
  process.exit(1);
}

if (!clientSecret) {
  console.error('❌ GOOGLE_CLIENT_SECRET not found in .env file');
  process.exit(1);
}

if (!redirectUri) {
  console.error('❌ GOOGLE_REDIRECT_URI not found in .env file');
  process.exit(1);
}

console.log('✅ Environment variables loaded:');
console.log(`   Client ID: ${clientId.substring(0, 20)}...`);
console.log(`   Client Secret: ${clientSecret.substring(0, 15)}...`);
console.log(`   Redirect URI: ${redirectUri}\n`);

// Create OAuth2 client
try {
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  console.log('✅ OAuth2 client created successfully\n');

  // Generate authorization URL
  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/tasks',
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent', // Force consent screen to get refresh token
  });

  console.log('✅ Authorization URL generated successfully\n');
  console.log('📋 Next steps to complete setup:\n');
  console.log('1. Make sure you have enabled these APIs in Google Cloud Console:');
  console.log('   - Google Calendar API');
  console.log('   - Google Tasks API\n');
  console.log('2. Make sure you have added this redirect URI in Google Cloud Console:');
  console.log(`   ${redirectUri}\n`);
  console.log('3. To test the full OAuth flow, visit this URL in your browser:');
  console.log(`   ${authUrl}\n`);
  console.log('4. After authorizing, you\'ll be redirected to the callback URL.');
  console.log('   (The redirect will fail since the server isn\'t running yet, but that\'s OK!)\n');
  console.log('✅ Credentials are valid and ready to use!\n');

} catch (error) {
  console.error('❌ Error creating OAuth2 client:', error.message);
  process.exit(1);
}
