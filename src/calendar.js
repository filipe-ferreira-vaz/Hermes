const { google } = require('googleapis');

const WEEK_DAYS_PT = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const { getAuthClient } = require('./auth');

/**
 * Fetch events from Google Calendar within a reasonable window.
 * Goes back 30 days so newly-added past events are picked up.
 * @returns {Promise<Array>} Array of calendar event objects
 */
async function fetchCalendarEvents() {
  const auth = getAuthClient();
  const calendar = google.calendar({ version: 'v3', auth });

  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 30);

  const response = await calendar.events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    timeMin: pastDate.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250,
  });

  return response.data.items || [];
}

/**
 * Parse event name from calendar summary.
 * Format: "Event Name - Extra Info" → returns "Event Name"
 * @param {string} summary - Calendar event summary
 * @returns {string} Parsed event name
 */
function parseEventName(summary) {
  if (!summary) return 'Untitled Event';
  const trimmed = summary.trim();
  if (!trimmed) return 'Untitled Event';

  const separatorIndex = trimmed.indexOf(' - ');
  if (separatorIndex !== -1) {
    return trimmed.substring(0, separatorIndex).trim();
  }
  return trimmed;
}

/**
 * Decode common HTML entities that may appear in a calendar description.
 * @param {string} str - Raw description string
 * @returns {string} String with entities decoded
 */
function decodeEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Extract a clean email address from arbitrary text.
 * Strips mailto: prefixes, HTML tags and surrounding punctuation.
 * @param {string} raw - Raw captured email text
 * @returns {string} Clean email address (or '')
 */
function cleanEmail(raw) {
  let value = String(raw || '').trim();
  value = decodeEntities(value);
  // Prefer a mailto: href, which unambiguously contains the address.
  const mailtoMatch = value.match(/mailto:\s*([^\s"'<>#]+)/i);
  if (mailtoMatch) return (mailtoMatch[1] || '').trim();
  // Otherwise grab the first plausible address anywhere in the text.
  // (This intentionally runs before any tag stripping, so plain
  // <user@example.com> forms survive.)
  const match = value.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : '';
}

/**
 * Extract any email address found anywhere in the raw description,
 * preferring one that appears inside a "Participant:" line.
 * @param {string} description - Raw calendar event description
 * @returns {string} Clean email address (or '')
 */
function findEmailAnywhere(description) {
  if (!description) return '';
  const decoded = decodeEntities(description);

  // Prefer an address from a "Participant:" line when present
  const participantSection = decoded.match(/(?:Participant|Participante|Inscrito|Email|E-?mail):\s*([^\n]+)/i);
  if (participantSection) {
    const lineEmail = cleanEmail(participantSection[1]);
    if (lineEmail) return lineEmail;
  }

  return cleanEmail(decoded);
}

/**
 * Parse participant data from event description.
 * Expected format: "Participant: FirstName LastName (email@example.com)"
 * Falls back to any email address found in the description.
 * @param {string} description - Calendar event description
 * @returns {{ firstName: string, lastName: string, email: string }}
 */
function parseDescription(description) {
  if (!description) {
    return { firstName: 'Unknown', lastName: 'Unknown', email: '' };
  }

  // Decode HTML entities, then strip HTML tags so
  // <a href="mailto:..."...> doesn't get captured as the email.
  // (Emails in plain <user@example.com> form are preserved by cleanEmail.)
  const decoded = decodeEntities(description);
  const plainText = decoded.replace(/<[^>]+>/g, '');

  // Primary pattern: Participant: FirstName LastName (email)
  const primaryRegex = /Participant:\s*([\w\-À-ÿ]+)\s+([\w\-À-ÿ]+)\s*\(([^)]+)\)/i;
  let match = plainText.match(primaryRegex);
  if (match) {
    return { firstName: match[1].trim(), lastName: match[2].trim(), email: cleanEmail(match[3]) };
  }

  // Try with more than two name parts: Participant: First Middle Last (email)
  const extendedRegex = /Participant:\s*([\w\-À-ÿ]+)\s+([\w\-À-ÿ\s]+?)\s*\(([^)]+)\)/i;
  match = plainText.match(extendedRegex);
  if (match) {
    const nameParts = match[2].trim().split(/\s+/);
    const lastName = nameParts[nameParts.length - 1];
    return { firstName: match[1].trim(), lastName: lastName, email: cleanEmail(match[3]) };
  }

  // Fallback: Participant: FirstName LastName email (no parentheses)
  const noParenRegex = /Participant:\s*([\w\-À-ÿ]+)\s+([\w\-À-ÿ]+)\s+(\S+@\S+\.\S+)/i;
  match = plainText.match(noParenRegex);
  if (match) {
    return { firstName: match[1].trim(), lastName: match[2].trim(), email: cleanEmail(match[3]) };
  }

  // Any remaining "Participant: ..." line — grab whatever name starts it.
  const nameLineRegex = /Participant:\s*([\w\-À-ÿ]+)(?:\s+([\w\-À-ÿ]+))?/i;
  const nameLine = plainText.match(nameLineRegex);

  // Generic fallback: any email found in the description.
  const fallbackEmail = findEmailAnywhere(description);
  if (fallbackEmail) {
    return {
      firstName: nameLine ? nameLine[1].trim() : 'Unknown',
      lastName: nameLine && nameLine[2] ? nameLine[2].trim() : 'Unknown',
      email: fallbackEmail,
    };
  }

  return { firstName: 'Unknown', lastName: 'Unknown', email: '' };
}

/**
 * Parse an ISO datetime string into structured date components.
 * @param {string} dateTimeStr - ISO datetime string
 * @returns {{ event_day: string, week_day: string, event_month: string, event_time: string }}
 */
function parseDateTime(dateTimeStr) {
  const date = new Date(dateTimeStr);

  const event_day = String(date.getDate());
  const week_day = WEEK_DAYS_PT[date.getDay()];
  const event_month = MONTHS_PT[date.getMonth()];
  const event_time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  return { event_day, week_day, event_month, event_time };
}

/**
 * Sync Google Calendar events with the local database.
 * CRITICAL: When events are deleted from Calendar and were 'scheduled',
 * also cancel the corresponding Google Sheet email job.
 * @param {object} db - Database operations object
 * @param {object} sheets - Google Sheets operations object
 * @returns {Promise<{ synced: number, newEvents: number, canceled: number }>}
 */
async function syncEvents(db, sheets) {
  try {
    console.log('[Calendar] Starting sync...');

    // 1. Fetch events from Google Calendar
    const fetchedEvents = await fetchCalendarEvents();
    console.log(`[Calendar] Fetched ${fetchedEvents.length} events from Google Calendar`);

    // 2. Get ALL events from DB for the lookup map (prevents UNIQUE constraint on re-insert)
    const allDbEvents = db.events.getAllByStatus(null);
    // For cancellation detection, only consider active (non-final) events
    const activeDbEvents = allDbEvents.filter(e => e.status === 'pending' || e.status === 'scheduled');

    // 3. Build lookup maps
    const fetchedIds = new Set(fetchedEvents.map(e => e.id));
    const dbEventMap = new Map(allDbEvents.map(e => [e.id, e]));

    let newCount = 0;
    let canceledCount = 0;

    // 4. Process fetched events — add new ones, update changed ones
    for (const calEvent of fetchedEvents) {
      const existingEvent = dbEventMap.get(calEvent.id);

      // Get datetime from event
      const dateTimeStr = calEvent.start.dateTime || (calEvent.start.date + 'T00:00:00');
      const eventName = parseEventName(calEvent.summary);
      const parsedDate = parseDateTime(dateTimeStr);
      const participant = parseDescription(calEvent.description);

      if (!existingEvent) {
        // Truly new event — determine initial status based on whether it's past
        const eventDate = new Date(dateTimeStr);
        const isPast = !isNaN(eventDate.getTime()) && eventDate < new Date();
        const initialStatus = isPast ? 'past' : 'pending';
        db.events.insert({
          id: calEvent.id,
          event_name: eventName,
          first_name: participant.firstName,
          last_name: participant.lastName,
          email: participant.email,
          event_datetime: dateTimeStr,
          event_day: parsedDate.event_day,
          week_day: parsedDate.week_day,
          event_month: parsedDate.event_month,
          event_time: parsedDate.event_time,
          status: initialStatus
        });
        newCount++;
        console.log(`[Calendar] New event added: ${eventName} (${calEvent.id}) — status: ${initialStatus}`);
      } else if (existingEvent.status === 'canceled') {
        // Event was previously canceled but reappeared in calendar — reactivate
        db.events.update(calEvent.id, {
          event_name: eventName,
          first_name: participant.firstName,
          last_name: participant.lastName,
          email: participant.email,
          event_datetime: dateTimeStr,
          event_day: parsedDate.event_day,
          week_day: parsedDate.week_day,
          event_month: parsedDate.event_month,
          event_time: parsedDate.event_time,
          status: 'pending',
          email_subject: null,
          email_body: null,
          scheduled_send_at: null,
          sheet_row: null
        });
        newCount++;
        console.log(`[Calendar] Reactivated event: ${eventName} (${calEvent.id}) — was ${existingEvent.status}`);
      } else if (existingEvent.status === 'sent') {
        // Email was already delivered — refresh metadata only and keep the
        // 'sent' status. Never reset to 'pending'/re-schedule, otherwise the
        // Sheet sent-status sync and this sync ping-pong the event forever.
        db.events.update(calEvent.id, {
          event_name: eventName,
          first_name: participant.firstName,
          last_name: participant.lastName,
          email: participant.email,
          event_datetime: dateTimeStr,
          event_day: parsedDate.event_day,
          week_day: parsedDate.week_day,
          event_month: parsedDate.event_month,
          event_time: parsedDate.event_time
        });
        console.log(`[Calendar] Event already sent — kept as sent: ${eventName} (${calEvent.id})`);
      } else {
        // Existing active or past event — check for calendar-side changes
        const updates = {};
        if (eventName !== existingEvent.event_name) {
          updates.event_name = eventName;
        }
        if (dateTimeStr !== existingEvent.event_datetime) {
          updates.event_datetime = dateTimeStr;
          updates.event_day = parsedDate.event_day;
          updates.week_day = parsedDate.week_day;
          updates.event_month = parsedDate.event_month;
          updates.event_time = parsedDate.event_time;
        }

        // Update participant data only if it was previously Unknown/empty,
        // or if the stored email is unusable HTML (e.g. an <a> anchor that
        // older syncs mistakenly saved instead of the real address).
        const emailLooksLikeHtml = /[<>]|mailto:/i.test(existingEvent.email || '');
        if (existingEvent.first_name === 'Unknown' || existingEvent.email === '' || emailLooksLikeHtml) {
          if (participant.firstName !== 'Unknown') {
            updates.first_name = participant.firstName;
            updates.last_name = participant.lastName;
          }
          if (participant.email) {
            updates.email = participant.email;
          }
        }

        // Sync status with reality: pending→past if datetime passed, past→pending if datetime moved to future
        const eventDate = new Date(dateTimeStr);
        const isPast = !isNaN(eventDate.getTime()) && eventDate < new Date();
        if (existingEvent.status === 'pending' && isPast) {
          updates.status = 'past';
        } else if (existingEvent.status === 'past' && !isPast) {
          updates.status = 'pending';
          updates.email_subject = null;
          updates.email_body = null;
          updates.scheduled_send_at = null;
          updates.sheet_row = null;
        }

        // Apply updates if any (but don't overwrite user-edited email fields)
        if (Object.keys(updates).length > 0) {
          db.events.update(calEvent.id, updates);
          console.log(`[Calendar] Updated event: ${eventName} (${calEvent.id})`);
        }
      }
    }

    // 5. Detect deleted/past events — only from ACTIVE events (pending + scheduled)
    for (const dbEvent of activeDbEvents) {
      if (!fetchedIds.has(dbEvent.id)) {
        const eventDate = new Date(dbEvent.event_datetime);
        const isPast = !isNaN(eventDate.getTime()) && eventDate < new Date();

        if (isPast) {
          // Event's start time has passed — mark as past, not canceled
          console.log(`[Calendar] Event is now in the past: ${dbEvent.event_name} (${dbEvent.id})`);
          db.events.updateStatus(dbEvent.id, 'past');
        } else {
          console.log(`[Calendar] Event no longer in calendar: ${dbEvent.event_name} (${dbEvent.id}), status was: ${dbEvent.status}`);

          // CRITICAL: If event was scheduled, also cancel the Sheet email job
          if (dbEvent.status === 'scheduled') {
            try {
              await sheets.cancelEmailJob(dbEvent.id);
              console.log(`[Calendar] CRITICAL: Canceled Sheet email job for deleted scheduled event: ${dbEvent.id}`);
            } catch (sheetErr) {
              console.error(`[Calendar] Failed to cancel Sheet job for ${dbEvent.id}:`, sheetErr.message);
            }
          }

          db.events.updateStatus(dbEvent.id, 'canceled');
          canceledCount++;
        }
      }
    }

    // 6. Update app_state
    db.appState.set('last_sync_time', new Date().toISOString());

    if (canceledCount > 0) {
      const currentCount = parseInt(db.appState.get('new_canceled_count')) || 0;
      db.appState.set('new_canceled_count', String(currentCount + canceledCount));
    }

    console.log(`[Calendar] Sync complete: ${fetchedEvents.length} synced, ${newCount} new, ${canceledCount} canceled`);

    return {
      synced: fetchedEvents.length,
      newEvents: newCount,
      canceled: canceledCount
    };
  } catch (err) {
    console.error('[Calendar] Sync error:', err.message);
    throw err;
  }
}

module.exports = {
  fetchCalendarEvents,
  parseEventName,
  parseDescription,
  parseDateTime,
  syncEvents
};
