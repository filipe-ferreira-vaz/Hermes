// Modal Management Module
// Uses global functions: showToast, loadCurrentTab, and the API object.

// Store templates, signatures, and current event for preview rendering
let allModalTemplates = [];
let activeSignature = null;
let currentModalEvent = null;
let configuredSendHour = 20;

// Fetch templates and signature on load
async function loadModalData() {
  try {
    const tplData = await API.getTemplates();
    allModalTemplates = tplData.templates || tplData || [];

    const sigData = await API.getSignatures();
    const signatures = sigData.signatures || sigData || [];
    activeSignature = signatures.find(s => s.is_active) || signatures[0] || null;

    try {
      const settings = await API.getSettings();
      configuredSendHour = settings.send_hour || 20;
    } catch (e) { /* keep default */ }
  } catch (e) { console.error(e); }
}

// Get currently selected template from the modal dropdown
function getSelectedTemplate() {
  const select = document.getElementById('modal-template-select');
  if (!select || !select.value) return allModalTemplates.find(t => t.is_active) || allModalTemplates[0] || null;
  const id = parseInt(select.value);
  return allModalTemplates.find(t => t.id === id) || null;
}

function getSelectedTemplateId() {
  const select = document.getElementById('modal-template-select');
  return select && select.value ? parseInt(select.value) : null;
}

// Populate template dropdown in modal
function populateModalTemplateDropdown() {
  const select = document.getElementById('modal-template-select');
  if (!select) return;
  select.innerHTML = '';
  allModalTemplates.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name + (t.is_active ? ' ★' : '');
    if (t.is_active) opt.selected = true;
    select.appendChild(opt);
  });
}

// Open event detail modal
async function openEventModal(eventId) {
  const modal = document.getElementById('event-modal');
  modal.hidden = false;
  // Trigger reflow then add active class for animation
  modal.offsetHeight;
  modal.classList.add('active');

  try {
    const data = await API.getEvent(eventId);
    const event = data.event || data;
    currentModalEvent = event;
    await loadModalData();

    // Populate fields
    document.getElementById('modal-event-id').value = event.id;
    document.getElementById('modal-event-status').value = event.status;
    document.getElementById('modal-event-name').value = event.event_name || '';
    document.getElementById('modal-first-name').value = event.first_name || '';
    document.getElementById('modal-last-name').value = event.last_name || '';
    document.getElementById('modal-email').value = event.email || '';
    document.getElementById('modal-event-day').value = event.event_day || '';
    document.getElementById('modal-week-day').value = event.week_day || '';
    document.getElementById('modal-event-month').value = event.event_month || '';
    document.getElementById('modal-event-time').value = event.event_time || '';

    // Populate template dropdown
    populateModalTemplateDropdown();

    // Select the template that was used for this event (if applicable)
    if (event.template_id && document.getElementById('modal-template-select')) {
      const select = document.getElementById('modal-template-select');
      const option = select.querySelector(`option[value="${event.template_id}"]`);
      if (option) option.selected = true;
    }

    // Render email preview
    renderEmailPreview();

    // Setup input listeners for real-time preview
    const inputs = ['modal-event-name', 'modal-first-name', 'modal-last-name', 'modal-email', 'modal-event-day', 'modal-week-day', 'modal-event-month', 'modal-event-time'];
    inputs.forEach(id => {
      document.getElementById(id).addEventListener('input', renderEmailPreview);
    });

    // Template dropdown change listener
    document.getElementById('modal-template-select').addEventListener('change', renderEmailPreview);

    // Setup action buttons based on status
    setupModalActions(event);

  } catch (e) {
    showToast('Failed to load event details', 'error');
    closeModal();
  }
}

function setupModalActions(event) {
  const scheduleBtn = document.getElementById('modal-schedule-btn');
  const sendNowBtn = document.getElementById('modal-send-now-btn');
  const cancelEmailBtn = document.getElementById('modal-cancel-email-btn');
  const pastCutoffAlert = document.getElementById('modal-past-cutoff-alert');
  const templateGroup = document.getElementById('modal-template-group');

  // Hide all first
  scheduleBtn.style.display = 'none';
  sendNowBtn.style.display = 'none';
  cancelEmailBtn.style.display = 'none';
  pastCutoffAlert.hidden = true;
  if (templateGroup) templateGroup.style.display = 'none';

  // Make fields editable or read-only based on status
  const inputs = document.querySelectorAll('#event-modal-card input:not([type=hidden])');

  switch (event.status) {
    case 'pending':
      inputs.forEach(i => i.readOnly = false);
      if (templateGroup) templateGroup.style.display = 'block';

      // Check if past cutoff (event datetime - 2 days at the configured send hour < now)
      if (event.event_datetime) {
        const cutoff = new Date(event.event_datetime);
        cutoff.setDate(cutoff.getDate() - 2);
        cutoff.setHours(configuredSendHour, 0, 0, 0);
        if (Date.now() > cutoff.getTime()) {
          // Past cutoff — show alert and Send Immediately only
          pastCutoffAlert.hidden = false;
          sendNowBtn.style.display = 'inline-flex';
        } else {
          // Normal — show Schedule button and also Send Now as option
          scheduleBtn.style.display = 'inline-flex';
          sendNowBtn.style.display = 'inline-flex';
        }
      } else {
        scheduleBtn.style.display = 'inline-flex';
      }
      break;
    case 'scheduled':
      cancelEmailBtn.style.display = 'inline-flex';
      inputs.forEach(i => i.readOnly = true);
      break;
    case 'past':
    case 'canceled':
    case 'sent':
      inputs.forEach(i => i.readOnly = true);
      break;
  }
}

function renderEmailPreview() {
  const preview = document.getElementById('email-preview');
  const status = document.getElementById('modal-event-status').value;

  // For sent/scheduled/canceled/past events, show the stored email as-is
  if ((status === 'sent' || status === 'scheduled' || status === 'canceled' || status === 'past') && currentModalEvent && currentModalEvent.email_body) {
    let html = '';
    if (currentModalEvent.email_subject) {
      html += `<div style="margin-bottom: 8px; color: #666; font-size: 0.85rem;"><strong>Subject:</strong> ${currentModalEvent.email_subject}</div><hr style="border: none; border-top: 1px solid #eee; margin: 8px 0;">`;
    }
    html += currentModalEvent.email_body;
    preview.innerHTML = html;
    return;
  }

  // For pending events, render live from the selected template
  const template = getSelectedTemplate();

  if (!template) {
    preview.innerHTML = '<p style="color: #999; font-style: italic;">No template found. Create a template in Settings.</p>';
    return;
  }

  const fields = {
    first_name: document.getElementById('modal-first-name').value,
    last_name: document.getElementById('modal-last-name').value,
    event_name: document.getElementById('modal-event-name').value,
    event_day: document.getElementById('modal-event-day').value,
    week_day: document.getElementById('modal-week-day').value,
    event_month: document.getElementById('modal-event-month').value,
    event_time: document.getElementById('modal-event-time').value,
  };

  // Render subject
  let subject = template.subject || '';
  Object.keys(fields).forEach(key => {
    subject = subject.replace(new RegExp(`{{${key}}}`, 'g'), fields[key] || `{{${key}}}`);
  });

  // Render body
  let body = template.body || '';
  Object.keys(fields).forEach(key => {
    body = body.replace(new RegExp(`{{${key}}}`, 'g'), fields[key] || `{{${key}}}`);
  });

  // Convert plain-text newlines to <br> if no block HTML present
  const hasBlockHtml = /<(p|div|table|ul|ol|h[1-6]|br)\b/i.test(body);
  if (!hasBlockHtml) {
    body = body.replace(/\n/g, '<br>\n');
  }

  let html = `<div style="margin-bottom: 8px; color: #666; font-size: 0.85rem;"><strong>Subject:</strong> ${subject}</div><hr style="border: none; border-top: 1px solid #eee; margin: 8px 0;">`;
  html += body;

  // Append signature if available
  if (activeSignature && activeSignature.content) {
    html += activeSignature.content;
  }

  preview.innerHTML = html;
}

function closeModal() {
  const modal = document.getElementById('event-modal');
  modal.classList.remove('active');
  setTimeout(() => { modal.hidden = true; }, 300);
  // Remove input listeners by cloning
  const inputs = ['modal-event-name', 'modal-first-name', 'modal-last-name', 'modal-email', 'modal-event-day', 'modal-week-day', 'modal-event-month', 'modal-event-time'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const newEl = el.cloneNode(true);
      el.parentNode.replaceChild(newEl, el);
    }
  });
  // Also clone template select to remove listeners
  const tplSelect = document.getElementById('modal-template-select');
  if (tplSelect) {
    const newSelect = tplSelect.cloneNode(true);
    tplSelect.parentNode.replaceChild(newSelect, tplSelect);
  }
}

// Get current form values
function getModalFormData() {
  return {
    event_name: document.getElementById('modal-event-name').value,
    first_name: document.getElementById('modal-first-name').value,
    last_name: document.getElementById('modal-last-name').value,
    email: document.getElementById('modal-email').value,
    event_day: document.getElementById('modal-event-day').value,
    week_day: document.getElementById('modal-week-day').value,
    event_month: document.getElementById('modal-event-month').value,
    event_time: document.getElementById('modal-event-time').value,
  };
}

// Confirmation modal
let confirmCallback = null;

function openConfirmModal(message, onConfirm) {
  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-modal-message').textContent = message;
  confirmCallback = onConfirm;
  modal.hidden = false;
  modal.offsetHeight;
  modal.classList.add('active');
}

function closeConfirmModal() {
  const modal = document.getElementById('confirm-modal');
  modal.classList.remove('active');
  setTimeout(() => { modal.hidden = true; }, 300);
  confirmCallback = null;
}

// Event listeners (on DOMContentLoaded)
document.addEventListener('DOMContentLoaded', () => {
  // Close modal
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('event-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('event-modal')) closeModal();
  });

  // Schedule button
  document.getElementById('modal-schedule-btn').addEventListener('click', async () => {
    const id = document.getElementById('modal-event-id').value;
    const templateId = getSelectedTemplateId();
    try {
      await API.updateEvent(id, getModalFormData());
      await API.scheduleEvent(id, templateId);
      showToast('Email scheduled successfully! 📅', 'success');
      closeModal();
      if (typeof loadCurrentTab === 'function') loadCurrentTab();
    } catch (e) {
      showToast(e.message || 'Failed to schedule', 'error');
      console.error(e);
    }
  });

  // Send now button
  document.getElementById('modal-send-now-btn').addEventListener('click', async () => {
    const id = document.getElementById('modal-event-id').value;
    const templateId = getSelectedTemplateId();
    try {
      await API.updateEvent(id, getModalFormData());
      await API.sendEventNow(id, templateId);
      showToast('Email sent immediately! ✉️', 'success');
      closeModal();
      if (typeof loadCurrentTab === 'function') loadCurrentTab();
    } catch (e) {
      showToast(e.message || 'Failed to send', 'error');
      console.error(e);
    }
  });

  // Cancel email button
  document.getElementById('modal-cancel-email-btn').addEventListener('click', () => {
    openConfirmModal('Are you sure you want to cancel this scheduled email?', async () => {
      const id = document.getElementById('modal-event-id').value;
      try {
        await API.cancelEvent(id);
        showToast('Email canceled', 'info');
        closeModal();
        closeConfirmModal();
        if (typeof loadCurrentTab === 'function') loadCurrentTab();
      } catch (e) { console.error(e); }
    });
  });

  // Confirm modal buttons
  document.getElementById('confirm-modal-confirm-btn').addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
  });
  document.getElementById('confirm-modal-cancel-btn').addEventListener('click', closeConfirmModal);
  document.getElementById('confirm-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('confirm-modal')) closeConfirmModal();
  });
});

// Make globally accessible
window.openEventModal = openEventModal;
window.closeModal = closeModal;
window.openConfirmModal = openConfirmModal;
window.closeConfirmModal = closeConfirmModal;
window.getSelectedTemplateId = getSelectedTemplateId;
