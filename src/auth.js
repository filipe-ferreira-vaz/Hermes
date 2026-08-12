const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

/**
 * OAuth 2.0 Authentication Module
 * 
 * Manages the OAuth 2.0 flow for Google APIs (Calendar, Sheets, Gmail).
 * Persists refresh token to .env file so re-authorization isn't needed on restart.
 */

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
];

let oAuth2Client = null;
let authenticatedEmail = null;

/**
 * Get or create the OAuth2 client (singleton).
 * @returns {google.auth.OAuth2}
 */
function getOAuth2Client() {
  if (oAuth2Client) return oAuth2Client;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const port = process.env.PORT || 3000;
  const redirectUri = `http://localhost:${port}/auth/google/callback`;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env');
  }

  oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // If we already have a refresh token from .env, set it
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (refreshToken) {
    oAuth2Client.setCredentials({ refresh_token: refreshToken });
    console.log('[Auth] Loaded refresh token from .env');
  }

  return oAuth2Client;
}

/**
 * Generate the OAuth consent URL for the user to authorize.
 * @returns {string} The authorization URL
 */
function getAuthUrl() {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // Force consent to always get a refresh token
    scope: SCOPES,
  });
}

/**
 * Exchange the authorization code for tokens and persist the refresh token.
 * @param {string} code - The authorization code from the OAuth callback
 * @returns {Promise<{ email: string }>}
 */
async function handleCallback(code) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  console.log('[Auth] OAuth tokens received');

  // Persist refresh token to .env file
  if (tokens.refresh_token) {
    persistRefreshToken(tokens.refresh_token);
    console.log('[Auth] Refresh token saved to .env');
  }

  // Fetch user email
  const email = await fetchUserEmail();
  return { email };
}

/**
 * Fetch the authenticated user's email address.
 * @returns {Promise<string>} The user's email
 */
async function fetchUserEmail() {
  try {
    const client = getOAuth2Client();
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();
    authenticatedEmail = data.email;
    console.log(`[Auth] Authenticated as: ${authenticatedEmail}`);
    return authenticatedEmail;
  } catch (err) {
    console.error('[Auth] Failed to fetch user email:', err.message);
    return null;
  }
}

/**
 * Get an authenticated OAuth2 client for API calls.
 * Throws if not authenticated.
 * @returns {google.auth.OAuth2}
 */
function getAuthClient() {
  const client = getOAuth2Client();
  if (!client.credentials || (!client.credentials.refresh_token && !client.credentials.access_token)) {
    throw new Error('Not authenticated. Please connect your Google account first.');
  }
  return client;
}

/**
 * Check if the user is authenticated (has valid tokens).
 * @returns {boolean}
 */
function isAuthenticated() {
  try {
    const client = getOAuth2Client();
    return !!(client.credentials && (client.credentials.refresh_token || client.credentials.access_token));
  } catch {
    return false;
  }
}

/**
 * Get the authenticated user's email (cached).
 * @returns {string|null}
 */
function getEmail() {
  return authenticatedEmail;
}

/**
 * Persist the refresh token by writing/updating it in the .env file.
 * Tolerates a commented placeholder line (e.g. "# GOOGLE_REFRESH_TOKEN=..."),
 * replacing it with a live, uncommented entry.
 * @param {string} refreshToken
 */
function persistRefreshToken(refreshToken) {
  const envPath = path.join(process.cwd(), '.env');

  try {
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');
    }

    // Update or append the GOOGLE_REFRESH_TOKEN
    const tokenLine = `GOOGLE_REFRESH_TOKEN=${refreshToken}`;

    // Matches any line that holds the token, even commented (# or ;) — e.g. a
    // placeholder from the .env template. The comment marker is stripped so
    // dotenv actually loads the token on the next launch.
    const tokenLineRegex = /^[ \t]*(?:#|;)?[ \t]*GOOGLE_REFRESH_TOKEN=.*$/gm;

    if (tokenLineRegex.test(envContent)) {
      envContent = envContent.replace(tokenLineRegex, tokenLine);
    } else {
      // Append new line
      if (envContent && !envContent.endsWith('\n')) {
        envContent += '\n';
      }
      envContent += `\n# --- OAuth Refresh Token (auto-generated) ---\n${tokenLine}\n`;
    }

    fs.writeFileSync(envPath, envContent, 'utf-8');

    // Also update process.env so it's available immediately
    process.env.GOOGLE_REFRESH_TOKEN = refreshToken;
  } catch (err) {
    console.error('[Auth] Failed to persist refresh token:', err.message);
  }
}

/**
 * Disconnect the Google account: revoke tokens with Google (best-effort),
 * clear in-memory state, and remove the refresh token from the .env file.
 * @returns {Promise<void>}
 */
async function revokeAccess() {
  const client = getOAuth2Client();

  // Attempt to revoke the refresh token with Google (best-effort — failure
  // here must not block the user from disconnecting).
  const refreshToken = client.credentials && client.credentials.refresh_token;
  if (refreshToken) {
    try {
      const response = await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      if (!response.ok) {
        console.warn(`[Auth] Token revocation returned status ${response.status}`);
      }
    } catch (err) {
      console.warn('[Auth] Token revocation failed:', err.message);
    }
  }

  // Clear in-memory credentials. NOTE: do NOT use client.revokeCredentials()
  // here — it throws when no access_token is present (only a refresh token
  // from .env) and would crash the server via an unhandled rejection.
  client.credentials = {};
  authenticatedEmail = null;
  oAuth2Client = null;

  removeRefreshTokenFromEnv();
}

/**
 * Remove the GOOGLE_REFRESH_TOKEN entry (and its auto-generated comment
 * header) from the .env file so the app starts unauthenticated next time.
 */
function removeRefreshTokenFromEnv() {
  const envPath = path.join(process.cwd(), '.env');
  try {
    if (!fs.existsSync(envPath)) return;
    let envContent = fs.readFileSync(envPath, 'utf-8');
    envContent = envContent.replace(/^[ \t]*(?:#|;)?[ \t]*GOOGLE_REFRESH_TOKEN=.*\n?/gm, '');
    envContent = envContent.replace(/^# --- OAuth Refresh Token \(auto-generated\) ---\n?/gm, '');
    fs.writeFileSync(envPath, envContent, 'utf-8');
    delete process.env.GOOGLE_REFRESH_TOKEN;
    console.log('[Auth] Refresh token removed from .env');
  } catch (err) {
    console.error('[Auth] Failed to remove refresh token from .env:', err.message);
  }
}

/**
 * Initialize auth on startup — if refresh token exists, verify it works.
 */
async function initAuth() {
  if (isAuthenticated()) {
    try {
      await fetchUserEmail();
      return true;
    } catch (err) {
      console.error('[Auth] Token validation failed:', err.message);
      return false;
    }
  }
  return false;
}

module.exports = {
  getAuthUrl,
  handleCallback,
  getAuthClient,
  isAuthenticated,
  getEmail,
  initAuth,
  revokeAccess,
  SCOPES,
};
