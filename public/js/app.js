/**
 * App.js – Main Application Controller
 * Handles tab navigation, event rendering, search/filter, toasts,
 * badge polling, and force sync.
 *
 * Depends on: api.js (global API object)
 * Exposes globally: showToast, loadCurrentTab, loadPendingTab,
 *   loadScheduledTab, loadCanceledTab, loadSentTab, handleFastSchedule
 */

// ── Toast System (global – available before DOMContentLoaded) ─────────────

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
    <div class="toast-progress" style="animation-duration: 4s"></div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

window.showToast = showToast;

// ── Main App (after DOM ready) ────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // ── State ─────────────────────────────────────────────────────────────
  let currentTab = 'pending';
  let debounceTimer = null;
  let cachedTemplates = [];

  const tabTitles = {
    pending: '📋 Pending Events',
    scheduled: '📅 Scheduled Events',
    past: '⏳ Past Events',
    canceled: '❌ Canceled Events',
    sent: '✅ Sent Events',
    settings: '⚙️ Settings',
  };

  // ── Helpers ───────────────────────────────────────────────────────────

  function formatDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Tab Navigation ────────────────────────────────────────────────────

  const navItems = document.querySelectorAll('.nav-item[data-tab]');
  const tabContents = document.querySelectorAll('.tab-content');
  const headerTitle = document.getElementById('header-title');

  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      if (!tab) return;

      // Update active nav
      navItems.forEach((n) => n.classList.remove('active'));
      item.classList.add('active');

      // Show / hide content sections
      tabContents.forEach((tc) => tc.classList.remove('active'));
      const targetContent = document.getElementById(`${tab}-content`);
      if (targetContent) targetContent.classList.add('active');

      // Update header
      if (headerTitle) headerTitle.textContent = tabTitles[tab] || tab;

      currentTab = tab;

      // Clear canceled badge when visiting canceled tab
      if (tab === 'canceled') {
        API.clearCanceledBadge().catch(() => {});
        const badge = document.getElementById('canceled-badge');
        if (badge) {
          badge.textContent = '0';
          badge.style.display = 'none';
        }
      }

      // Load data for the selected tab
      if (tab === 'settings') {
        loadSettingsTab();
      } else {
        loadCurrentTab();
      }
    });
  });

  // ── Settings Tab Loader ───────────────────────────────────────────────

  async function loadSchedulingSettings() {
    const select = document.getElementById('send-hour-select');
    if (!select) return;
    let sendHour = 20;
    try {
      const settings = await API.getSettings();
      sendHour = settings.send_hour || 20;
    } catch (e) { /* keep default */ }

    select.innerHTML = '';
    for (let h = 0; h < 24; h++) {
      const opt = document.createElement('option');
      opt.value = h;
      const label = String(h).padStart(2, '0');
      opt.textContent = `${label}:00`;
      if (h === sendHour) opt.selected = true;
      select.appendChild(opt);
    }
  }

  async function loadSettingsTab() {
    if (typeof window.loadTemplates === 'function') {
      window.loadTemplates();
    }
    if (typeof window.loadSignatures === 'function') {
      window.loadSignatures();
    }
    loadSchedulingSettings();
  }

  window.loadSettingsTab = loadSettingsTab;

  // Save global send hour
  const sendHourSaveBtn = document.getElementById('send-hour-save-btn');
  if (sendHourSaveBtn) {
    sendHourSaveBtn.addEventListener('click', async () => {
      const select = document.getElementById('send-hour-select');
      if (!select) return;
      const statusEl = document.getElementById('send-hour-status');
      sendHourSaveBtn.disabled = true;
      try {
        const result = await API.saveSettings({ send_hour: parseInt(select.value, 10) });
        if (statusEl) {
          statusEl.textContent = `✓ Send hour saved to ${String(result.settings.send_hour).padStart(2, '0')}:00`;
          statusEl.hidden = false;
          setTimeout(() => { statusEl.hidden = true; }, 3000);
        }
      } catch (e) {
        console.error(e);
      } finally {
        sendHourSaveBtn.disabled = false;
      }
    });
  }

  // ── Event Rendering ───────────────────────────────────────────────────

  function renderEventList(containerId, events, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (!events || events.length === 0) {
      container.innerHTML =
        '<div class="empty-state">' +
        '<div class="empty-state-icon">📭</div>' +
        '<div class="empty-state-text">No events found</div>' +
        '</div>';
      return;
    }

    events.forEach((event) => {
      const card = document.createElement('div');
      card.className = 'event-card' + (event.status === 'canceled' || event.status === 'past' ? ' muted' : '');
      card.addEventListener('click', () => {
        if (typeof window.openEventModal === 'function') {
          window.openEventModal(event.id);
        }
      });

      // Build detail parts
      const participant = [event.first_name, event.last_name].filter(Boolean).join(' ');
      const datePart = [event.event_day, event.event_month].filter(Boolean).join(' ');

      let detailParts = [];
      if (participant) detailParts.push(participant);
      if (event.email) detailParts.push(event.email);
      if (datePart) detailParts.push(datePart);
      if (event.event_time) detailParts.push(event.event_time);
      if (event.week_day) detailParts.push(event.week_day);

      // Extra status-specific lines
      let extraLine = '';
      if (event.status === 'scheduled' && event.scheduled_send_at) {
        extraLine = `<div class="event-card-scheduled">📧 Scheduled for: ${formatDateTime(event.scheduled_send_at)}</div>`;
      } else if (event.status === 'sent' && event.updated_at) {
        extraLine = `<div class="event-card-sent">✅ Sent: ${formatDateTime(event.updated_at)}</div>`;
      }

      // Action buttons (fast schedule + template picker for pending)
      let actionHTML = '';
      if (options.showFastSchedule && event.status === 'pending') {
        // Build template options from cached list
        let tplOptions = '';
        if (cachedTemplates.length > 0) {
          cachedTemplates.forEach(t => {
            const selected = t.is_active ? ' selected' : '';
            tplOptions += `<option value="${t.id}"${selected}>${escapeHTML(t.name)}</option>`;
          });
        }
        actionHTML =
          '<div class="event-card-actions">' +
          `<select class="fast-template-select select-input" data-event-id="${escapeHTML(event.id)}" title="Select template">${tplOptions}</select>` +
          `<button class="fast-schedule-btn" data-event-id="${escapeHTML(event.id)}">Schedule ⚡</button>` +
          `<button class="fast-send-btn" data-event-id="${escapeHTML(event.id)}" title="Send immediately">Send Now ✉️</button>` +
          '</div>';
      }

      card.innerHTML =
        '<div class="event-card-info">' +
        `<div class="event-card-name">${escapeHTML(event.event_name || 'Untitled Event')}</div>` +
        `<div class="event-card-detail">${escapeHTML(detailParts.join(' · '))}</div>` +
        extraLine +
        '</div>' +
        actionHTML;

      // Attach fast schedule handler to button (if present) after innerHTML
      const fastBtn = card.querySelector('.fast-schedule-btn');
      if (fastBtn) {
        fastBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tplSelect = card.querySelector('.fast-template-select');
          const templateId = tplSelect ? parseInt(tplSelect.value) : null;
          handleFastSchedule(event.id, templateId);
        });
      }
      // Attach fast send-now handler (green button)
      const fastSendBtn = card.querySelector('.fast-send-btn');
      if (fastSendBtn) {
        fastSendBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tplSelect = card.querySelector('.fast-template-select');
          const templateId = tplSelect ? parseInt(tplSelect.value) : null;
          handleFastSend(event.id, templateId);
        });
      }
      // Prevent template dropdown click from opening modal
      const tplSelect = card.querySelector('.fast-template-select');
      if (tplSelect) {
        tplSelect.addEventListener('click', (e) => e.stopPropagation());
      }

      container.appendChild(card);
    });
  }

  // ── Loading Skeletons ─────────────────────────────────────────────────

  function showSkeletons(containerId, count = 5) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = Array.from(
      { length: count },
      () => '<div class="skeleton skeleton-card"></div>'
    ).join('');
  }

  // ── Tab Loading Functions ─────────────────────────────────────────────

  async function loadPendingTab() {
    showSkeletons('pending-events');
    try {
      // Fetch templates for the fast-schedule dropdown
      try {
        const tplData = await API.getTemplates();
        cachedTemplates = tplData.templates || tplData || [];
      } catch (e) { /* keep existing cache */ }

      const toggle = document.getElementById('day-filter-toggle');
      const daySelect = document.getElementById('day-filter-select');
      const days = toggle && toggle.checked ? daySelect.value : null;
      const data = await API.getEvents('pending', days);
      let events = data.events || data || [];
      events.sort((a, b) => new Date(a.event_datetime) - new Date(b.event_datetime));
      events = filterEventsBySearch(events, 'pending-search');
      renderEventList('pending-events', events, { showFastSchedule: true });
    } catch (e) {
      console.error(e);
    }
  }

  async function loadScheduledTab() {
    showSkeletons('scheduled-events');
    try {
      const data = await API.getEvents('scheduled');
      let events = data.events || data || [];
      events.sort((a, b) => new Date(b.scheduled_send_at) - new Date(a.scheduled_send_at));
      events = filterEventsBySearch(events, 'scheduled-search');
      renderEventList('scheduled-events', events);
    } catch (e) {
      console.error(e);
    }
  }

  async function loadPastTab() {
    showSkeletons('past-events');
    try {
      const data = await API.getEvents('past');
      let events = data.events || data || [];
      events.sort((a, b) => new Date(b.event_datetime) - new Date(a.event_datetime));
      events = filterEventsBySearch(events, 'past-search');
      renderEventList('past-events', events);
    } catch (e) {
      console.error(e);
    }
  }

  async function loadCanceledTab() {
    showSkeletons('canceled-events');
    try {
      const data = await API.getEvents('canceled');
      let events = data.events || data || [];
      events.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      events = filterEventsBySearch(events, 'canceled-search');
      renderEventList('canceled-events', events);
    } catch (e) {
      console.error(e);
    }
  }

  async function loadSentTab() {
    showSkeletons('sent-events');
    try {
      const data = await API.getEvents('sent');
      let events = data.events || data || [];
      events.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      events = filterEventsBySearch(events, 'sent-search');
      renderEventList('sent-events', events);
    } catch (e) {
      console.error(e);
    }
  }

  // ── Search / Filter ───────────────────────────────────────────────────

  function filterEventsBySearch(events, searchInputId) {
    const input = document.getElementById(searchInputId);
    if (!input) return events;
    const query = input.value.toLowerCase().trim();
    if (!query) return events;
    return events.filter(
      (e) =>
        (e.event_name || '').toLowerCase().includes(query) ||
        (e.first_name || '').toLowerCase().includes(query) ||
        (e.last_name || '').toLowerCase().includes(query)
    );
  }

  // Debounced search handlers
  const searchIds = ['pending-search', 'scheduled-search', 'past-search', 'canceled-search', 'sent-search'];
  searchIds.forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => loadCurrentTab(), 300);
    });
  });

  // Day filter controls (pending tab)
  const dayFilterToggle = document.getElementById('day-filter-toggle');
  const dayFilterSelect = document.getElementById('day-filter-select');

  if (dayFilterToggle) {
    dayFilterToggle.addEventListener('change', () => loadPendingTab());
  }
  if (dayFilterSelect) {
    dayFilterSelect.addEventListener('change', () => {
      if (dayFilterToggle && dayFilterToggle.checked) loadPendingTab();
    });
  }

  // ── Fast Schedule ─────────────────────────────────────────────────────

  async function handleFastSchedule(eventId, templateId) {
    try {
      await API.scheduleEvent(eventId, templateId);
      showToast('Event scheduled successfully! ⚡', 'success');
      loadPendingTab();
    } catch (e) {
      showToast(e.message || 'Failed to schedule', 'error');
      console.error(e);
    }
  }

  async function handleFastSend(eventId, templateId) {
    try {
      await API.sendEventNow(eventId, templateId);
      showToast('Email sent immediately! ✉️', 'success');
      loadPendingTab();
    } catch (e) {
      showToast(e.message || 'Failed to send', 'error');
      console.error(e);
    }
  }

  // ── Badge Polling ─────────────────────────────────────────────────────

  async function updateBadge() {
    try {
      const stats = await API.getStats();
      const badge = document.getElementById('canceled-badge');
      if (!badge) return;
      const count = stats.newCanceledCount || 0;
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    } catch (e) {
      /* silent */
    }
  }

  setInterval(updateBadge, 30000);
  updateBadge();

  // ── Force Sync ────────────────────────────────────────────────────────

  const forceSyncBtn = document.getElementById('force-sync-btn');
  if (forceSyncBtn) {
    forceSyncBtn.addEventListener('click', async () => {
      forceSyncBtn.disabled = true;
      forceSyncBtn.textContent = '🔄 Syncing...';
      try {
        await API.forceSync();
        showToast('Calendar synced successfully! 🔄', 'success');
        loadCurrentTab();
        updateBadge();
      } catch (e) {
        console.error(e);
      } finally {
        forceSyncBtn.disabled = false;
        forceSyncBtn.innerHTML = '<span class="btn-icon">🔄</span> Force Sync';
      }
    });
  }

  // ── Load Current Tab ──────────────────────────────────────────────────

  function loadCurrentTab() {
    switch (currentTab) {
      case 'pending':
        loadPendingTab();
        break;
      case 'scheduled':
        loadScheduledTab();
        break;
      case 'past':
        loadPastTab();
        break;
      case 'canceled':
        loadCanceledTab();
        break;
      case 'sent':
        loadSentTab();
        break;
    }
  }

  // ── Auth Check ──────────────────────────────────────────────────────
  async function checkAuthStatus() {
    try {
      const status = await API.getAuthStatus();
      const banner = document.getElementById('auth-banner');
      const authStatus = document.getElementById('auth-status');
      const authEmail = document.getElementById('auth-email');

      if (status.authenticated) {
        if (banner) banner.hidden = true;
        if (authStatus) {
          authStatus.hidden = false;
          if (authEmail) authEmail.textContent = status.email || 'your account';
          // Auto-hide after 5 seconds
          setTimeout(() => { authStatus.hidden = true; }, 5000);
        }
        return true;
      } else {
        if (banner) banner.hidden = false;
        if (authStatus) authStatus.hidden = true;
        return false;
      }
    } catch (e) {
      console.error('Auth check failed:', e);
      return false;
    }
  }

  // ── Initial Load ─────────────────────────────────────────────────────

  // Check for auth redirect params
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('auth') === 'success') {
    showToast('Google account connected successfully! 🎉', 'success');
    window.history.replaceState({}, '', '/');
  } else if (urlParams.get('auth') === 'error') {
    showToast('Failed to connect Google account. Please try again.', 'error');
    window.history.replaceState({}, '', '/');
  }

  // Check auth then load — and force a full sync on launch so the
  // Calendar data is compared against the Google Sheet (sent statuses,
  // latest changes) before anything is rendered.
  checkAuthStatus().then(async authenticated => {
    if (authenticated) {
      try {
        await API.forceSync();
      } catch (e) {
        console.error('Launch sync failed:', e);
      }
      loadPendingTab();
    }
  });

  // ── Expose Globals ────────────────────────────────────────────────────
  window.loadCurrentTab = loadCurrentTab;
  window.loadPendingTab = loadPendingTab;
  window.loadScheduledTab = loadScheduledTab;
  window.loadPastTab = loadPastTab;
  window.loadCanceledTab = loadCanceledTab;
  window.loadSentTab = loadSentTab;
  window.handleFastSchedule = handleFastSchedule;
  window.handleFastSend = handleFastSend;
  window.checkAuthStatus = checkAuthStatus;
});
