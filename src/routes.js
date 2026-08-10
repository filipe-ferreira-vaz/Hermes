const express = require('express');

/**
 * Create the Express Router with all API endpoints.
 * @param {object} deps - Dependencies: { db, sheets, mailer, scheduler, calendar }
 * @returns {express.Router}
 */
function createRouter({ db, sheets, mailer, scheduler, calendar }) {
  const router = express.Router();

  // ===================== EVENTS =====================

  /**
   * GET /api/events — List events with optional status and days filters
   */
  router.get('/api/events', (req, res) => {
    try {
      const { status, days } = req.query;
      const events = db.events.getAllByStatus(status || null, days || null);
      res.json({ events });
    } catch (err) {
      console.error('[Routes] GET /api/events error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/events/:id — Get a single event by ID
   */
  router.get('/api/events/:id', (req, res) => {
    try {
      const event = db.events.getById(req.params.id);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }
      res.json({ event });
    } catch (err) {
      console.error('[Routes] GET /api/events/:id error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PUT /api/events/:id — Update event fields
   */
  router.put('/api/events/:id', (req, res) => {
    try {
      const existing = db.events.getById(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'Event not found' });
      }
      const updated = db.events.update(req.params.id, req.body);
      res.json({ success: true, event: updated });
    } catch (err) {
      console.error('[Routes] PUT /api/events/:id error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/events/:id/schedule — Schedule email for an event
   * Body: { template_id?: number }
   */
  router.post('/api/events/:id/schedule', async (req, res) => {
    try {
      const templateId = req.body.template_id || null;
      const result = await scheduler.scheduleEmail(req.params.id, db, sheets, mailer, templateId);
      res.json(result);
    } catch (err) {
      console.error('[Routes] POST /api/events/:id/schedule error:', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * POST /api/events/:id/send-now — Send email immediately via SMTP
   * Body: { template_id?: number }
   */
  router.post('/api/events/:id/send-now', async (req, res) => {
    try {
      const templateId = req.body.template_id || null;
      const result = await scheduler.sendImmediately(req.params.id, db, sheets, mailer, templateId);
      res.json(result);
    } catch (err) {
      console.error('[Routes] POST /api/events/:id/send-now error:', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * POST /api/events/:id/cancel — Cancel a scheduled email
   */
  router.post('/api/events/:id/cancel', async (req, res) => {
    try {
      const result = await scheduler.cancelScheduledEmail(req.params.id, db, sheets);
      res.json(result);
    } catch (err) {
      console.error('[Routes] POST /api/events/:id/cancel error:', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  // ===================== TEMPLATES =====================

  /**
   * GET /api/templates — List all templates
   */
  router.get('/api/templates', (req, res) => {
    try {
      const templates = db.templates.getAll();
      res.json({ templates });
    } catch (err) {
      console.error('[Routes] GET /api/templates error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/templates — Create a new template
   */
  router.post('/api/templates', (req, res) => {
    try {
      const { name, subject, body } = req.body;
      if (!name || !subject || !body) {
        return res.status(400).json({ error: 'Name, subject, and body are required' });
      }
      const template = db.templates.create({ name, subject, body });
      res.status(201).json({ success: true, template });
    } catch (err) {
      console.error('[Routes] POST /api/templates error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PUT /api/templates/:id — Update an existing template
   */
  router.put('/api/templates/:id', (req, res) => {
    try {
      const existing = db.templates.getById(parseInt(req.params.id));
      if (!existing) {
        return res.status(404).json({ error: 'Template not found' });
      }
      const updated = db.templates.update(parseInt(req.params.id), req.body);
      res.json({ success: true, template: updated });
    } catch (err) {
      console.error('[Routes] PUT /api/templates/:id error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/templates/:id — Delete a template (cannot delete active)
   */
  router.delete('/api/templates/:id', (req, res) => {
    try {
      const template = db.templates.getById(parseInt(req.params.id));
      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }
      if (template.is_active) {
        return res.status(400).json({ error: 'Cannot delete the active template' });
      }
      db.templates.delete(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err) {
      console.error('[Routes] DELETE /api/templates/:id error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PUT /api/templates/:id/activate — Set a template as active (deactivates others)
   */
  router.put('/api/templates/:id/activate', (req, res) => {
    try {
      const existing = db.templates.getById(parseInt(req.params.id));
      if (!existing) {
        return res.status(404).json({ error: 'Template not found' });
      }
      db.templates.setActive(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err) {
      console.error('[Routes] PUT /api/templates/:id/activate error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ===================== SIGNATURES =====================

  /**
   * GET /api/signatures — List all signatures
   */
  router.get('/api/signatures', (req, res) => {
    try {
      const signatures = db.signatures.getAll();
      res.json({ signatures });
    } catch (err) {
      console.error('[Routes] GET /api/signatures error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/signatures — Create a new signature
   */
  router.post('/api/signatures', (req, res) => {
    try {
      const { name, content } = req.body;
      if (!name || !content) {
        return res.status(400).json({ error: 'Name and content are required' });
      }
      const signature = db.signatures.create({ name, content });
      res.status(201).json({ success: true, signature });
    } catch (err) {
      console.error('[Routes] POST /api/signatures error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PUT /api/signatures/:id — Update an existing signature
   */
  router.put('/api/signatures/:id', (req, res) => {
    try {
      const existing = db.signatures.getById(parseInt(req.params.id));
      if (!existing) {
        return res.status(404).json({ error: 'Signature not found' });
      }
      const updated = db.signatures.update(parseInt(req.params.id), req.body);
      res.json({ success: true, signature: updated });
    } catch (err) {
      console.error('[Routes] PUT /api/signatures/:id error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/signatures/:id — Delete a signature (cannot delete active)
   */
  router.delete('/api/signatures/:id', (req, res) => {
    try {
      const signature = db.signatures.getById(parseInt(req.params.id));
      if (!signature) {
        return res.status(404).json({ error: 'Signature not found' });
      }
      if (signature.is_active) {
        return res.status(400).json({ error: 'Cannot delete the active signature' });
      }
      db.signatures.delete(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err) {
      console.error('[Routes] DELETE /api/signatures/:id error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PUT /api/signatures/:id/activate — Set a signature as active (deactivates others)
   */
  router.put('/api/signatures/:id/activate', (req, res) => {
    try {
      const existing = db.signatures.getById(parseInt(req.params.id));
      if (!existing) {
        return res.status(404).json({ error: 'Signature not found' });
      }
      db.signatures.setActive(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err) {
      console.error('[Routes] PUT /api/signatures/:id/activate error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ===================== STATS =====================

  /**
   * GET /api/stats — Dashboard statistics
   */
  router.get('/api/stats', (req, res) => {
    try {
      const stats = {
        newCanceledCount: parseInt(db.appState.get('new_canceled_count')) || 0,
        totalPending: db.events.getAllByStatus('pending').length,
        totalScheduled: db.events.getAllByStatus('scheduled').length,
        totalSent: db.events.getAllByStatus('sent').length,
        lastSyncTime: db.appState.get('last_sync_time'),
      };
      res.json(stats);
    } catch (err) {
      console.error('[Routes] GET /api/stats error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/stats/clear-canceled-badge — Reset the canceled notification badge
   */
  router.post('/api/stats/clear-canceled-badge', (req, res) => {
    try {
      db.appState.set('new_canceled_count', '0');
      res.json({ success: true });
    } catch (err) {
      console.error('[Routes] POST /api/stats/clear-canceled-badge error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ===================== SYNC =====================

  /**
   * POST /api/sync — Force a full sync: compare Calendar events against the
   * Google Sheet data so the local database is always up to date.
   */
  router.post('/api/sync', async (req, res) => {
    try {
      const calendarResult = await calendar.syncEvents(db, sheets);
      await sheets.syncSentStatus(db);
      res.json({ calendar: calendarResult, sentStatusSynced: true });
    } catch (err) {
      console.error('[Routes] POST /api/sync error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ===================== SETTINGS =====================

  /**
   * GET /api/settings — Retrieve app settings (e.g. global send hour)
   */
  router.get('/api/settings', (req, res) => {
    try {
      const sendHour = parseInt(db.appState.get('send_hour')) || 20;
      res.json({ send_hour: sendHour });
    } catch (err) {
      console.error('[Routes] GET /api/settings error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PUT /api/settings — Update app settings (e.g. global send hour)
   * Body: { send_hour?: number }
   */
  router.put('/api/settings', (req, res) => {
    try {
      if (req.body.send_hour !== undefined) {
        const hour = parseInt(req.body.send_hour, 10);
        if (isNaN(hour) || hour < 0 || hour > 23) {
          return res.status(400).json({ error: 'send_hour must be a number between 0 and 23' });
        }
        db.appState.set('send_hour', String(hour));
      }
      const sendHour = parseInt(db.appState.get('send_hour')) || 20;
      res.json({ success: true, settings: { send_hour: sendHour } });
    } catch (err) {
      console.error('[Routes] PUT /api/settings error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ===================== RESET =====================

  /**
   * POST /api/reset — Purge all data and reset to defaults
   */
  router.post('/api/reset', async (req, res) => {
    try {
      db.resetAll();
      await sheets.clearAllJobs();
      res.json({ success: true, message: 'All data has been reset' });
    } catch (err) {
      console.error('[Routes] POST /api/reset error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ===================== EMAIL PREVIEW =====================

  /**
   * GET /api/email-preview — Render a template preview with provided variables
   */
  router.get('/api/email-preview', (req, res) => {
    try {
      const {
        first_name, last_name, event_name,
        event_day, week_day, event_month, event_time,
        template_subject, template_body, signature_content
      } = req.query;

      const variables = {
        first_name: first_name || '',
        last_name: last_name || '',
        event_name: event_name || '',
        event_day: event_day || '',
        week_day: week_day || '',
        event_month: event_month || '',
        event_time: event_time || '',
      };

      const renderedSubject = mailer.renderTemplate(template_subject || '', variables);
      const renderedBody = mailer.renderTemplate(template_body || '', variables);
      const fullHtml = mailer.buildEmailHtml(renderedBody, signature_content || '');

      res.json({ subject: renderedSubject, html: fullHtml });
    } catch (err) {
      console.error('[Routes] GET /api/email-preview error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createRouter };
