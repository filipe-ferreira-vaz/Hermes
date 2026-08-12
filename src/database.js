const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'hermes.db');

async function initDatabase() {
  const SQL = await initSqlJs();
  let db;

  // Load existing database file or create new
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Enable WAL mode equivalent
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  // Migration: add sent_at column to existing databases
  const eventCols = getAll("PRAGMA table_info(events)");
  if (!eventCols.some((col) => col.name === 'sent_at')) {
    db.run('ALTER TABLE events ADD COLUMN sent_at TEXT');
    save();
    console.log('[Database] Added sent_at column to events table');
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      event_name TEXT,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      event_datetime TEXT,
      event_day TEXT,
      week_day TEXT,
      event_month TEXT,
      event_time TEXT,
      status TEXT DEFAULT 'pending',
      email_subject TEXT,
      email_body TEXT,
      template_id INTEGER,
      signature_id INTEGER,
      scheduled_send_at TEXT,
      sent_at TEXT,
      sheet_row INTEGER,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      is_active INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS signatures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      is_active INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Helper: save database to file
  function save() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }

  // Helper: get single row
  function getOne(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    let result = null;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();
    return result;
  }

  // Helper: get all rows
  function getAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  // Helper: run statement
  function run(sql, params = []) {
    db.run(sql, params);
    save();
  }

  // Seed defaults on first run
  const templateCount = getOne('SELECT COUNT(*) as count FROM templates');
  if (!templateCount || templateCount.count === 0) {
    const now = new Date().toISOString();
    run(
      `INSERT INTO templates (name, subject, body, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
      [
        'Default Reminder',
        'Reminder: {{event_name}} on {{event_day}} {{event_month}}',
        '<p>Hello {{first_name}},</p><p>This is a friendly reminder about your upcoming event: <strong>{{event_name}}</strong>.</p><p><strong>Date:</strong> {{event_day}} de {{event_month}} ({{week_day}})<br><strong>Time:</strong> {{event_time}}</p><p>We look forward to seeing you!</p><p>Best regards</p>',
        now,
        now
      ]
    );
  }

  const signatureCount = getOne('SELECT COUNT(*) as count FROM signatures');
  if (!signatureCount || signatureCount.count === 0) {
    const now = new Date().toISOString();
    run(
      `INSERT INTO signatures (name, content, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`,
      [
        'Default Signature',
        '<p style="color: #888; font-size: 13px;">— Hermes Dashboard<br>Automated Email System</p>',
        now,
        now
      ]
    );
  }

  // Initialize app_state defaults
  const syncTime = getOne("SELECT value FROM app_state WHERE key = 'last_sync_time'");
  if (!syncTime) run("INSERT INTO app_state (key, value) VALUES ('last_sync_time', 'never')");
  const cancelCount = getOne("SELECT value FROM app_state WHERE key = 'new_canceled_count'");
  if (!cancelCount) run("INSERT INTO app_state (key, value) VALUES ('new_canceled_count', '0')");
  const sendHour = getOne("SELECT value FROM app_state WHERE key = 'send_hour'");
  if (!sendHour) run("INSERT INTO app_state (key, value) VALUES ('send_hour', '20')");

  // ===================== EVENTS =====================
  const events = {
    getAllByStatus(status, days) {
      let sql = 'SELECT * FROM events WHERE 1=1';
      const params = [];

      if (status) {
        sql += ' AND status = ?';
        params.push(status);
      }

      if (days) {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + parseInt(days));
        sql += ' AND event_datetime <= ?';
        params.push(futureDate.toISOString());
      }

      sql += ' ORDER BY event_datetime ASC';
      return getAll(sql, params);
    },

    getById(id) {
      return getOne('SELECT * FROM events WHERE id = ?', [id]);
    },

    insert(event) {
      const now = new Date().toISOString();
      run(
        `INSERT INTO events (id, event_name, first_name, last_name, email, event_datetime,
          event_day, week_day, event_month, event_time, status, email_subject, email_body,
          template_id, signature_id, scheduled_send_at, sent_at, sheet_row, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.id,
          event.event_name || null,
          event.first_name || null,
          event.last_name || null,
          event.email || null,
          event.event_datetime || null,
          event.event_day || null,
          event.week_day || null,
          event.event_month || null,
          event.event_time || null,
          event.status || 'pending',
          event.email_subject || null,
          event.email_body || null,
          event.template_id || null,
          event.signature_id || null,
          event.scheduled_send_at || null,
          event.sent_at || null,
          event.sheet_row || null,
          now,
          now
        ]
      );
      return this.getById(event.id);
    },

    update(id, fields) {
      const now = new Date().toISOString();
      const allowedFields = [
        'event_name', 'first_name', 'last_name', 'email', 'event_datetime',
        'event_day', 'week_day', 'event_month', 'event_time', 'status',
        'email_subject', 'email_body', 'template_id', 'signature_id',
        'scheduled_send_at', 'sent_at', 'sheet_row'
      ];

      const updates = [];
      const params = [];

      for (const [key, value] of Object.entries(fields)) {
        if (allowedFields.includes(key)) {
          updates.push(`${key} = ?`);
          params.push(value);
        }
      }

      if (updates.length === 0) return this.getById(id);

      updates.push('updated_at = ?');
      params.push(now);
      params.push(id);

      run(`UPDATE events SET ${updates.join(', ')} WHERE id = ?`, params);
      return this.getById(id);
    },

    updateStatus(id, status, sentAt) {
      const now = new Date().toISOString();
      if (sentAt) {
        run('UPDATE events SET status = ?, sent_at = ?, updated_at = ? WHERE id = ?', [status, sentAt, now, id]);
      } else {
        run('UPDATE events SET status = ?, updated_at = ? WHERE id = ?', [status, now, id]);
      }
      return this.getById(id);
    },

    getScheduledEvents() {
      return getAll("SELECT * FROM events WHERE status = 'scheduled' ORDER BY event_datetime ASC");
    },

    getAllNonFinal() {
      return getAll("SELECT * FROM events WHERE status NOT IN ('sent', 'canceled', 'past') ORDER BY event_datetime ASC");
    }
  };

  // ===================== TEMPLATES =====================
  const templates = {
    getAll() {
      return getAll('SELECT * FROM templates ORDER BY created_at DESC');
    },

    getById(id) {
      return getOne('SELECT * FROM templates WHERE id = ?', [id]);
    },

    getActive() {
      return getOne('SELECT * FROM templates WHERE is_active = 1');
    },

    create(template) {
      const now = new Date().toISOString();
      run(
        `INSERT INTO templates (name, subject, body, is_active, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
        [template.name, template.subject, template.body, now, now]
      );
      const lastId = getOne('SELECT last_insert_rowid() as id');
      return this.getById(lastId.id);
    },

    update(id, fields) {
      const now = new Date().toISOString();
      const updates = [];
      const params = [];

      if (fields.name !== undefined) { updates.push('name = ?'); params.push(fields.name); }
      if (fields.subject !== undefined) { updates.push('subject = ?'); params.push(fields.subject); }
      if (fields.body !== undefined) { updates.push('body = ?'); params.push(fields.body); }

      if (updates.length === 0) return this.getById(id);

      updates.push('updated_at = ?');
      params.push(now);
      params.push(id);

      run(`UPDATE templates SET ${updates.join(', ')} WHERE id = ?`, params);
      return this.getById(id);
    },

    delete(id) {
      run('DELETE FROM templates WHERE id = ?', [id]);
    },

    setActive(id) {
      run('UPDATE templates SET is_active = 0', []);
      run('UPDATE templates SET is_active = 1, updated_at = ? WHERE id = ?', [new Date().toISOString(), id]);
      return this.getById(id);
    }
  };

  // ===================== SIGNATURES =====================
  const signatures = {
    getAll() {
      return getAll('SELECT * FROM signatures ORDER BY created_at DESC');
    },

    getById(id) {
      return getOne('SELECT * FROM signatures WHERE id = ?', [id]);
    },

    getActive() {
      return getOne('SELECT * FROM signatures WHERE is_active = 1');
    },

    create(sig) {
      const now = new Date().toISOString();
      run(
        `INSERT INTO signatures (name, content, is_active, created_at, updated_at) VALUES (?, ?, 0, ?, ?)`,
        [sig.name, sig.content, now, now]
      );
      const lastId = getOne('SELECT last_insert_rowid() as id');
      return this.getById(lastId.id);
    },

    update(id, fields) {
      const now = new Date().toISOString();
      const updates = [];
      const params = [];

      if (fields.name !== undefined) { updates.push('name = ?'); params.push(fields.name); }
      if (fields.content !== undefined) { updates.push('content = ?'); params.push(fields.content); }

      if (updates.length === 0) return this.getById(id);

      updates.push('updated_at = ?');
      params.push(now);
      params.push(id);

      run(`UPDATE signatures SET ${updates.join(', ')} WHERE id = ?`, params);
      return this.getById(id);
    },

    delete(id) {
      run('DELETE FROM signatures WHERE id = ?', [id]);
    },

    setActive(id) {
      run('UPDATE signatures SET is_active = 0', []);
      run('UPDATE signatures SET is_active = 1, updated_at = ? WHERE id = ?', [new Date().toISOString(), id]);
      return this.getById(id);
    }
  };

  // ===================== APP STATE =====================
  const appState = {
    get(key) {
      const row = getOne('SELECT value FROM app_state WHERE key = ?', [key]);
      return row ? row.value : null;
    },

    set(key, value) {
      run('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)', [key, String(value)]);
    }
  };

  // ===================== RESET =====================
  function resetAll() {
    // Clear all data tables
    run('DELETE FROM events', []);
    run('DELETE FROM templates', []);
    run('DELETE FROM signatures', []);

    // Re-insert default template
    const now = new Date().toISOString();
    run(
      `INSERT INTO templates (name, subject, body, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
      [
        'Default Reminder',
        'Reminder: {{event_name}} on {{event_day}} {{event_month}}',
        '<p>Hello {{first_name}},</p><p>This is a friendly reminder about your upcoming event: <strong>{{event_name}}</strong>.</p><p><strong>Date:</strong> {{event_day}} de {{event_month}} ({{week_day}})<br><strong>Time:</strong> {{event_time}}</p><p>We look forward to seeing you!</p><p>Best regards</p>',
        now,
        now
      ]
    );

    // Re-insert default signature
    run(
      `INSERT INTO signatures (name, content, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`,
      [
        'Default Signature',
        '<p style="color: #888; font-size: 13px;">— Hermes Dashboard<br>Automated Email System</p>',
        now,
        now
      ]
    );

    // Reset app_state counters but preserve config
    appState.set('new_canceled_count', '0');
    appState.set('last_sync_time', 'never');
  }

  return {
    events,
    templates,
    signatures,
    appState,
    resetAll,
    close() {
      save();
      db.close();
    }
  };
}

module.exports = { initDatabase };
