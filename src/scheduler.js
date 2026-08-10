/**
 * Scheduling orchestrator — coordinates database, Google Sheets, and mailer
 * to manage email scheduling lifecycle.
 */

const DEFAULT_SEND_HOUR = 20;

/**
 * Get the configured global send hour from app state.
 * @param {object} db - Database operations object
 * @returns {number} Hour (0-23), defaults to 20
 */
function getSendHour(db) {
  const stored = db && db.appState ? db.appState.get('send_hour') : null;
  const hour = parseInt(stored, 10);
  return !isNaN(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_SEND_HOUR;
}

/**
 * Calculate the send time for a scheduled email.
 * Rule: event datetime minus 2 days, set to the configured global send hour.
 * @param {string} eventDatetime - ISO datetime string of the event
 * @param {number} [sendHour] - Hour of day for the send (0-23, defaults to 20)
 * @returns {string} ISO datetime string for the scheduled send time
 */
function calculateSendTime(eventDatetime, sendHour = DEFAULT_SEND_HOUR) {
  const eventDate = new Date(eventDatetime);
  eventDate.setDate(eventDate.getDate() - 2);
  eventDate.setHours(sendHour, 0, 0, 0);
  return eventDate.toISOString();
}

/**
 * Check if the send time cutoff has already passed.
 * Returns true if now > (eventDatetime - 2 days at the configured send hour),
 * meaning the scheduled send time would be in the past.
 * @param {string} eventDatetime - ISO datetime string of the event
 * @param {number} [sendHour] - Hour of day for the send (0-23, defaults to 20)
 * @returns {boolean}
 */
function checkPastCutoff(eventDatetime, sendHour = DEFAULT_SEND_HOUR) {
  const cutoff = new Date(eventDatetime);
  cutoff.setDate(cutoff.getDate() - 2);
  cutoff.setHours(sendHour, 0, 0, 0);
  return Date.now() > cutoff.getTime();
}

/**
 * Build the template variables object from an event record.
 * @param {object} event - Database event record
 * @returns {object} Variables map for template rendering
 */
function buildVariables(event) {
  return {
    first_name: event.first_name || '',
    last_name: event.last_name || '',
    event_name: event.event_name || '',
    event_day: event.event_day || '',
    week_day: event.week_day || '',
    event_month: event.event_month || '',
    event_time: event.event_time || '',
  };
}

/**
 * Schedule an email for an event via Google Sheets.
 * The email will be sent by Apps Script at the calculated send time.
 * @param {string} eventId - Google Calendar event ID
 * @param {object} db - Database operations object
 * @param {object} sheets - Google Sheets operations object
 * @param {object} mailer - Mailer operations object
 * @param {number} [templateId] - Optional template ID. Uses active template if not provided.
 * @returns {Promise<{ success: boolean, scheduledFor: string }>}
 */
async function scheduleEmail(eventId, db, sheets, mailer, templateId) {
  // Get event
  const event = db.events.getById(eventId);
  if (!event) throw new Error('Event not found');
  if (event.status !== 'pending') throw new Error('Event is not in pending status');

  // Get template (specific or active)
  const template = templateId ? db.templates.getById(templateId) : db.templates.getActive();
  if (!template) throw new Error(templateId ? `Template with ID ${templateId} not found` : 'No active template found');

  // Get active signature (optional)
  const signature = db.signatures.getActive();

  // Build variables and render
  const variables = buildVariables(event);
  const renderedSubject = mailer.renderTemplate(template.subject, variables);
  const renderedBody = mailer.renderTemplate(template.body, variables);
  const fullHtml = mailer.buildEmailHtml(renderedBody, signature ? signature.content : '');

  // Calculate send time
  const sendHour = getSendHour(db);
  const sendAt = calculateSendTime(event.event_datetime, sendHour);

  // Check cutoff
  if (checkPastCutoff(event.event_datetime, sendHour)) {
    throw new Error('Event is too close to send date. Send time would be in the past. Use Send Immediately instead.');
  }

  // Write to Google Sheet
  const rowNumber = await sheets.writeEmailJob(eventId, event.email, renderedSubject, fullHtml, sendAt);

  // Update DB
  db.events.update(eventId, {
    status: 'scheduled',
    email_subject: renderedSubject,
    email_body: fullHtml,
    template_id: template.id,
    signature_id: signature ? signature.id : null,
    scheduled_send_at: sendAt,
    sheet_row: rowNumber,
  });

  console.log(`[Scheduler] Email scheduled for event ${eventId}, send at ${sendAt}`);
  return { success: true, scheduledFor: sendAt };
}

/**
 * Cancel a scheduled email for an event.
 * Updates both the Google Sheet row and the database status.
 * @param {string} eventId - Google Calendar event ID
 * @param {object} db - Database operations object
 * @param {object} sheets - Google Sheets operations object
 * @returns {Promise<{ success: boolean }>}
 */
async function cancelScheduledEmail(eventId, db, sheets) {
  const event = db.events.getById(eventId);
  if (!event) throw new Error('Event not found');

  // Cancel on Google Sheet
  await sheets.cancelEmailJob(eventId);

  // Update DB status
  db.events.updateStatus(eventId, 'canceled');

  console.log(`[Scheduler] Email canceled for event ${eventId}`);
  return { success: true };
}

/**
 * Send an email immediately via Gmail API (bypasses Google Sheets scheduling).
 * The sent email is also registered on the Google Sheet with status 'sent',
 * so the Sheet always holds a complete history of every sent email and the
 * launch-time sync can compare Calendar vs Sheet data.
 * @param {string} eventId - Google Calendar event ID
 * @param {object} db - Database operations object
 * @param {object} sheets - Google Sheets operations object
 * @param {object} mailer - Mailer operations object
 * @param {number} [templateId] - Optional template ID. Uses active template if not provided.
 * @returns {Promise<{ success: boolean, messageId: string }>}
 */
async function sendImmediately(eventId, db, sheets, mailer, templateId) {
  const event = db.events.getById(eventId);
  if (!event) throw new Error('Event not found');

  // Get template (specific or active)
  const template = templateId ? db.templates.getById(templateId) : db.templates.getActive();
  if (!template) throw new Error(templateId ? `Template with ID ${templateId} not found` : 'No active template found');

  // Get active signature (optional)
  const signature = db.signatures.getActive();

  // Build variables and render
  const variables = buildVariables(event);
  const renderedSubject = mailer.renderTemplate(template.subject, variables);
  const renderedBody = mailer.renderTemplate(template.body, variables);
  const fullHtml = mailer.buildEmailHtml(renderedBody, signature ? signature.content : '');

  // Send via Gmail API
  const result = await mailer.sendEmail(event.email, renderedSubject, fullHtml);
  if (!result.success) {
    throw new Error(`Failed to send email: ${result.error}`);
  }

  // Register the sent email on the Google Sheet (status 'sent')
  const nowIso = new Date().toISOString();
  let sheetRow = null;
  if (sheets) {
    try {
      sheetRow = await sheets.writeEmailJob(eventId, event.email, renderedSubject, fullHtml, nowIso, 'sent', nowIso);
    } catch (sheetErr) {
      console.error(`[Scheduler] Email was sent but failed to register on the Sheet for event ${eventId}:`, sheetErr.message);
    }
  }

  // Update DB
  db.events.update(eventId, {
    status: 'sent',
    email_subject: renderedSubject,
    email_body: fullHtml,
    template_id: template.id,
    signature_id: signature ? signature.id : null,
    sheet_row: sheetRow,
  });

  console.log(`[Scheduler] Email sent immediately for event ${eventId}`);
  return { success: true, messageId: result.messageId };
}

/**
 * Schedule an email with user-provided edits to fields.
 * Allows overriding subject, body, recipient, and send time.
 * @param {string} eventId - Google Calendar event ID
 * @param {object} edits - Override fields: { email_subject?, email_body?, email?, scheduled_send_at? }
 * @param {object} db - Database operations object
 * @param {object} sheets - Google Sheets operations object
 * @param {object} mailer - Mailer operations object
 * @returns {Promise<{ success: boolean, scheduledFor: string }>}
 */
async function scheduleWithEdits(eventId, edits, db, sheets, mailer) {
  const event = db.events.getById(eventId);
  if (!event) throw new Error('Event not found');

  // Get active template and signature for fallback rendering
  const template = db.templates.getActive();
  const signature = db.signatures.getActive();
  const variables = buildVariables(event);

  // Determine subject
  let finalSubject;
  if (edits.email_subject) {
    finalSubject = edits.email_subject;
  } else if (template) {
    finalSubject = mailer.renderTemplate(template.subject, variables);
  } else {
    throw new Error('No subject provided and no active template found');
  }

  // Determine body HTML
  let finalHtml;
  if (edits.email_body) {
    finalHtml = mailer.buildEmailHtml(edits.email_body, signature ? signature.content : '');
  } else if (template) {
    const renderedBody = mailer.renderTemplate(template.body, variables);
    finalHtml = mailer.buildEmailHtml(renderedBody, signature ? signature.content : '');
  } else {
    throw new Error('No body provided and no active template found');
  }

  // Determine recipient
  const recipient = edits.email || event.email;

  // Determine send time
  const sendHour = getSendHour(db);
  let sendAt;
  if (edits.scheduled_send_at) {
    sendAt = edits.scheduled_send_at;
  } else {
    sendAt = calculateSendTime(event.event_datetime, sendHour);
  }

  // Validate send time is not in the past
  if (new Date(sendAt).getTime() < Date.now()) {
    throw new Error('Scheduled send time is in the past. Use Send Immediately instead.');
  }

  // Write to Google Sheet
  const rowNumber = await sheets.writeEmailJob(eventId, recipient, finalSubject, finalHtml, sendAt);

  // Update DB
  db.events.update(eventId, {
    status: 'scheduled',
    email_subject: finalSubject,
    email_body: finalHtml,
    email: recipient,
    template_id: template ? template.id : null,
    signature_id: signature ? signature.id : null,
    scheduled_send_at: sendAt,
    sheet_row: rowNumber,
  });

  console.log(`[Scheduler] Email scheduled with edits for event ${eventId}, send at ${sendAt}`);
  return { success: true, scheduledFor: sendAt };
}

module.exports = {
  scheduleEmail,
  cancelScheduledEmail,
  checkPastCutoff,
  sendImmediately,
  scheduleWithEdits,
  getSendHour
};
