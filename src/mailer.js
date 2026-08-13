const { google } = require('googleapis');
const { getAuthClient, getEmail } = require('./auth');

/**
 * Send an email via the Gmail API.
 * Uses the OAuth2 client — no SMTP or App Passwords needed.
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} htmlBody - Full HTML email body
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
/**
 * Repair "mojibake" strings — UTF-8 text that was accidentally read/encoded
 * as Latin-1 one or more times (e.g. "SessÃ£o" instead of "Sessão", or the
 * double-encoded "SessÃƒÂ£o"). The repair is safe and idempotent: valid
 * UTF-8 strings are returned unchanged.
 * @param {string} value - Value to normalize
 * @returns {string} Repaired UTF-8 string (or original if nothing to repair)
 */
function normalizeUtf8(value) {
  if (typeof value !== 'string') return value;
  let current = value;
  for (let i = 0; i < 3; i++) {
    // Interpret the current string's chars as Latin-1 bytes, then decode as UTF-8.
    // Only accept the result if it's valid UTF-8 and actually changed.
    const decoded = Buffer.from(current, 'latin1').toString('utf8');
    if (decoded.includes('\uFFFD')) break; // invalid -> not mojibake, stop
    if (decoded === current) break; // no change
    current = decoded;
  }
  return current;
}

/**
 * Replace every non-ASCII character with its HTML numeric character reference
 * (e.g. "📍" -> "&#x1f4cd;", "é" -> "&#xe9;"). The result is pure ASCII, so
 * emoji and accents survive storage in Google Sheets cells and reading back
 * from Apps Script without corruption (astral-plane emoji such as 📍 are
 * otherwise lost in the sheet round-trip, while BMP characters like ✉️ survive).
 * @param {string} value - Value to encode
 * @returns {string} ASCII-encoded string (or original if not a string)
 */
function toHtmlEntities(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/[^\x00-\x7F]/gu, (ch) => `&#x${ch.codePointAt(0).toString(16)};`);
}

/**
 * Inverse of toHtmlEntities — decode HTML numeric character references
 * (e.g. "&#x1f4cd;" -> "📍", "&#xe9;" -> "é") back into Unicode.
 * @param {string} value - ASCII-encoded string
 * @returns {string} Decoded string (or original if not a string)
 */
function decodeHtmlEntities(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return m; }
    })
    .replace(/&#(\d+);/g, (m, dec) => {
      try { return String.fromCodePoint(parseInt(dec, 10)); } catch { return m; }
    });
}

/**
 * Encode a header value containing non-ASCII characters using RFC 2047.
 * Any mojibake (double-encoded UTF-8) is repaired before encoding.
 * @param {string} value - Header value to encode
 * @returns {string} RFC 2047 encoded value (or original if pure ASCII)
 */
function encodeHeader(value) {
  value = normalizeUtf8(value);
  if (/^[\x00-\x7F]*$/.test(value)) {
    return value;
  }
  const encoded = Buffer.from(value, 'utf-8').toString('base64');
  return `=?UTF-8?B?${encoded}?=`;
}

async function sendEmail(to, subject, htmlBody) {
  try {
    const auth = getAuthClient();
    const gmail = google.gmail({ version: 'v1', auth });

    const fromName = process.env.EMAIL_FROM_NAME || 'Hermes Dashboard';
    const fromEmail = getEmail() || 'me';

    // Build RFC 2822 MIME message
    const messageParts = [
      `From: "${fromName}" <${fromEmail}>`,
      `To: ${to}`,
      `Subject: ${encodeHeader(subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      htmlBody,
    ];
    const rawMessage = messageParts.join('\r\n');

    // Base64url encode the message
    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    console.log(`[Mailer] Email sent to ${to} via Gmail API, messageId: ${result.data.id}`);
    return { success: true, messageId: result.data.id };
  } catch (err) {
    console.error(`[Mailer] Failed to send email to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Replace all {{placeholder}} tokens in a template string with values.
 * Also converts plain-text newlines to <br> tags for HTML rendering.
 * @param {string} templateStr - Template string with {{key}} placeholders
 * @param {object} variables - Key-value map of variables to substitute
 * @returns {string} Rendered string
 */
function renderTemplate(templateStr, variables) {
  if (!templateStr) return '';

  let rendered = templateStr;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    rendered = rendered.replace(placeholder, value || '');
  }

  // Repair any mojibake (double-encoded UTF-8) that slipped into the template
  // or the variable values, so subjects/bodies are always clean UTF-8.
  rendered = normalizeUtf8(rendered);

  // Convert plain-text newlines to <br> if the template doesn't already
  // contain block-level HTML elements (i.e. it's mostly plain text)
  const hasBlockHtml = /<(p|div|table|ul|ol|h[1-6]|br)\b/i.test(rendered);
  if (!hasBlockHtml) {
    rendered = rendered.replace(/\n/g, '<br>\n');
  }

  return rendered;
}

/**
 * Combine rendered body HTML and signature HTML into a clean email.
 * Minimal wrapper — no forced fonts, no centering, no max-width.
 * This makes emails look like they were composed natively in Gmail.
 * @param {string} bodyHtml - Rendered email body HTML
 * @param {string} signatureHtml - Signature HTML (optional)
 * @returns {string} Email HTML content
 */
function buildEmailHtml(bodyHtml, signatureHtml) {
  let html = `<div dir="ltr">${bodyHtml}`;

  if (signatureHtml) {
    html += `<div class="gmail_signature">${signatureHtml}</div>`;
  }

  html += '</div>';
  return html;
}

module.exports = {
  sendEmail,
  renderTemplate,
  buildEmailHtml,
  encodeHeader,
  normalizeUtf8,
  toHtmlEntities,
  decodeHtmlEntities
};
