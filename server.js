const fs = require('fs');
const path = require('path');
const paths = require('./src/paths');

require('dotenv').config({ path: paths.envPath });

// First run (or fresh download): create .env from the template so a
// double-clicked executable asks nicely instead of crashing.
if (!fs.existsSync(paths.envPath) && fs.existsSync(paths.envTemplatePath)) {
  fs.copyFileSync(paths.envTemplatePath, paths.envPath);
  console.log('[Server] No .env found — created one from env.template. Fill it in and restart.');
}

const express = require('express');
const { initDatabase } = require('./src/database');
const calendar = require('./src/calendar');
const sheets = require('./src/sheets');
const mailer = require('./src/mailer');
const scheduler = require('./src/scheduler');
const { createRouter } = require('./src/routes');
const auth = require('./src/auth');

const PORT = process.env.PORT || 3000;

async function startServer() {
  const app = express();

  // Middleware
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Serve static files from public/
  app.use(express.static(paths.publicDir));

  // Initialize database (async with sql.js)
  const db = await initDatabase();

  // ── OAuth Routes ───────────────────────────────────────────────────────

  /**
   * GET /auth/google — Redirect user to Google OAuth consent screen
   */
  app.get('/auth/google', (req, res) => {
    try {
      const authUrl = auth.getAuthUrl();
      res.redirect(authUrl);
    } catch (err) {
      console.error('[Auth] Error generating auth URL:', err.message);
      res.status(500).send('OAuth configuration error. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
    }
  });

  /**
   * GET /auth/google/callback — Handle OAuth callback
   */
  app.get('/auth/google/callback', async (req, res) => {
    const { code, error } = req.query;

    if (error) {
      console.error('[Auth] OAuth error:', error);
      return res.redirect('/?auth=error');
    }

    if (!code) {
      return res.redirect('/?auth=error');
    }

    try {
      const result = await auth.handleCallback(code);
      console.log(`[Auth] Successfully authenticated as: ${result.email}`);

      // Now that we're authenticated, initialize Sheet and start syncing
      await initGoogleServices(db);

      res.redirect('/?auth=success');
    } catch (err) {
      console.error('[Auth] Callback error:', err.message);
      res.redirect('/?auth=error');
    }
  });

  /**
   * GET /api/auth/status — Check authentication status
   */
  app.get('/api/auth/status', (req, res) => {
    res.json({
      authenticated: auth.isAuthenticated(),
      email: auth.getEmail(),
    });
  });

  /**
   * POST /api/auth/disconnect — Disconnect the Google account
   */
  app.post('/api/auth/disconnect', async (req, res) => {
    try {
      await auth.revokeAccess();
      res.json({ success: true });
    } catch (err) {
      console.error('[Auth] Disconnect error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Mount API routes
  const router = createRouter({ db, sheets, mailer, scheduler, calendar });
  app.use(router);

  // Fallback: serve index.html for non-API routes (SPA support)
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(paths.publicDir, 'index.html'));
    }
  });

  // Start sync intervals
  const SYNC_INTERVAL = (parseInt(process.env.SYNC_INTERVAL_MINUTES) || 5) * 60 * 1000;

  // Calendar sync interval (only runs if authenticated)
  setInterval(async () => {
    if (!auth.isAuthenticated()) return;
    try {
      const result = await calendar.syncEvents(db, sheets);
      console.log(`[Sync] Calendar sync complete: ${result.synced} events, ${result.newEvents} new, ${result.canceled} canceled`);
    } catch (err) {
      console.error('[Sync] Calendar sync failed:', err.message);
    }
  }, SYNC_INTERVAL);

  // Sheet sent-status sync interval (every 2 minutes, only if authenticated)
  setInterval(async () => {
    if (!auth.isAuthenticated()) return;
    try {
      await sheets.syncSentStatus(db);
    } catch (err) {
      console.error('[Sync] Sheet status sync failed:', err.message);
    }
  }, 2 * 60 * 1000);

  // Start server
  app.listen(PORT, async () => {
    console.log(`To open the dashboard, press CTRL + this link: http://localhost:${PORT}`);

    // Auto-open browser (direct system opener — robust under pkg/ESM)
    const { openBrowser } = require('./src/opener');
    openBrowser(`http://localhost:${PORT}`);

    // Try to initialize auth from existing refresh token
    const authenticated = await auth.initAuth();

    if (authenticated) {
      await initGoogleServices(db);
    } else {
      console.log('[Server] Not authenticated yet. Visit the dashboard and click "Connect Google Account".');
    }
  });

  // Google services initialization (runs after successful OAuth)
  async function initGoogleServices(db) {
    // Ensure Google Sheet headers
    try {
      await sheets.ensureHeaders();
      console.log('[Server] Google Sheet headers verified');
    } catch (err) {
      console.error('[Server] Failed to verify Sheet headers:', err.message);
      console.log('[Server] Sheet integration may not work. Check your GOOGLE_SHEET_ID.');
    }

    // Run initial calendar sync
    try {
      const result = await calendar.syncEvents(db, sheets);
      console.log(`[Sync] Initial sync complete: ${result.synced} events, ${result.newEvents} new, ${result.canceled} canceled`);
    } catch (err) {
      console.error('[Sync] Initial sync failed:', err.message);
    }

    // Catch up on emails sent by Apps Script while the app was offline
    // (their Sheet rows are marked 'sent', the local DB must catch that too)
    try {
      await sheets.syncSentStatus(db);
      console.log('[Server] Initial sheet sent-status sync complete');
    } catch (err) {
      console.error('[Server] Initial sheet sent-status sync failed:', err.message);
    }
  }

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[Server] Shutting down...');
    if (db && db.close) {
      db.close();
      console.log('[Server] Database closed');
    }
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n[Server] Shutting down...');
    if (db && db.close) {
      db.close();
      console.log('[Server] Database closed');
    }
    process.exit(0);
  });
}

startServer().catch(err => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
