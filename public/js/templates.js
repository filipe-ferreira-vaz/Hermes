// Templates Management Module
// Uses global functions: showToast, openConfirmModal, closeConfirmModal, and the API object.

let currentTemplateId = null;
let allTemplates = [];

async function loadTemplates() {
  try {
    const data = await API.getTemplates();
    allTemplates = data.templates || data || [];
    renderTemplateList();
    populateActiveTemplateDropdown();
    updateTemplatePreview();
  } catch (e) { console.error(e); }
}

function renderTemplateList() {
  const list = document.getElementById('template-list');
  list.innerHTML = '';
  
  allTemplates.forEach(template => {
    const item = document.createElement('div');
    item.className = 'template-item' + (template.id === currentTemplateId ? ' active' : '');
    item.innerHTML = `
      <span class="template-item-name">
        ${template.is_active ? '<span class="star-icon">★</span>' : ''}
        ${template.name}
      </span>
      <div class="template-item-actions">
        <button class="btn btn-sm btn-ghost" onclick="editTemplate(${template.id})">✏️</button>
        <button class="btn btn-sm btn-ghost" onclick="deleteTemplate(${template.id})" style="color: var(--danger);">🗑️</button>
      </div>
    `;
    item.addEventListener('click', (e) => {
      if (!e.target.closest('button')) editTemplate(template.id);
    });
    list.appendChild(item);
  });
}

function populateActiveTemplateDropdown() {
  const select = document.getElementById('active-template-select');
  select.innerHTML = '<option value="">Select active template...</option>';
  allTemplates.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    if (t.is_active) opt.selected = true;
    select.appendChild(opt);
  });
}

function getTemplateBodyEditor() {
  return document.getElementById('template-body');
}

function getTemplateBodyContent() {
  const editor = getTemplateBodyEditor();
  // contenteditable div returns innerHTML
  return editor.innerHTML || '';
}

function setTemplateBodyContent(html) {
  const editor = getTemplateBodyEditor();
  editor.innerHTML = html || '';
}

function editTemplate(id) {
  const template = allTemplates.find(t => t.id === id);
  if (!template) return;
  currentTemplateId = id;
  document.getElementById('template-name').value = template.name;
  document.getElementById('template-subject').value = template.subject || '';
  setTemplateBodyContent(template.body || '');
  document.getElementById('template-delete-btn').style.display = 'inline-flex';
  renderTemplateList();
  updateTemplatePreview();
}

function newTemplate() {
  currentTemplateId = null;
  document.getElementById('template-name').value = '';
  document.getElementById('template-subject').value = '';
  setTemplateBodyContent('');
  document.getElementById('template-delete-btn').style.display = 'none';
  renderTemplateList();
  updateTemplatePreview();
}

async function saveTemplate() {
  const data = {
    name: document.getElementById('template-name').value.trim(),
    subject: document.getElementById('template-subject').value.trim(),
    body: getTemplateBodyContent(),
  };
  if (!data.name) { showToast('Template name is required', 'error'); return; }
  
  try {
    if (currentTemplateId) {
      await API.updateTemplate(currentTemplateId, data);
      showToast('Template updated! ✅', 'success');
    } else {
      const result = await API.createTemplate(data);
      currentTemplateId = (result.template || result).id;
      showToast('Template created! ✅', 'success');
    }
    await loadTemplates();
  } catch (e) { console.error(e); }
}

async function deleteTemplate(id) {
  openConfirmModal('Are you sure you want to delete this template?', async () => {
    try {
      await API.deleteTemplate(id);
      showToast('Template deleted', 'info');
      if (currentTemplateId === id) newTemplate();
      closeConfirmModal();
      await loadTemplates();
    } catch (e) { console.error(e); }
  });
}

async function activateTemplate(id) {
  try {
    await API.activateTemplate(id);
    showToast('Active template updated! ⭐', 'success');
    await loadTemplates();
  } catch (e) { console.error(e); }
}

function updateTemplatePreview() {
  const preview = document.getElementById('template-preview');
  const subject = document.getElementById('template-subject').value;
  const body = getTemplateBodyContent();
  
  // Replace placeholders with sample data
  const sampleData = {
    first_name: 'João',
    last_name: 'Silva',
    event_name: 'Reunião de Equipa',
    event_day: '15',
    week_day: 'Segunda-feira',
    event_month: 'Janeiro',
    event_time: '10:00',
  };
  
  let renderedSubject = subject || '';
  let renderedBody = body || '';
  Object.keys(sampleData).forEach(key => {
    renderedSubject = renderedSubject.replace(new RegExp(`{{${key}}}`, 'g'), sampleData[key]);
    renderedBody = renderedBody.replace(new RegExp(`{{${key}}}`, 'g'), sampleData[key]);
  });

  if (!renderedBody && !renderedSubject) {
    preview.innerHTML = '<p style="color: #999; font-style: italic;">Preview will appear here...</p>';
    return;
  }

  // Build Gmail-like preview
  let html = '';
  if (renderedSubject) {
    html += `<div style="margin-bottom: 8px; color: var(--text-secondary); font-size: 0.85rem;"><strong>Subject:</strong> ${renderedSubject}</div>`;
    html += '<hr style="border: none; border-top: 1px solid var(--border-color); margin: 8px 0;">';
  }
  html += `<div dir="ltr">${renderedBody}</div>`;

  preview.innerHTML = html;
}

// Rich text toolbar commands for template editor
function execTemplateCmd(command, value = null) {
  document.execCommand(command, false, value);
  getTemplateBodyEditor().focus();
  updateTemplatePreview();
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('template-new-btn').addEventListener('click', newTemplate);
  document.getElementById('template-save-btn').addEventListener('click', saveTemplate);
  document.getElementById('template-delete-btn').addEventListener('click', () => {
    if (currentTemplateId) deleteTemplate(currentTemplateId);
  });
  document.getElementById('active-template-select').addEventListener('change', (e) => {
    if (e.target.value) activateTemplate(e.target.value);
  });

  // Template body editor (contenteditable) — live preview on input
  const bodyEditor = getTemplateBodyEditor();
  if (bodyEditor) {
    bodyEditor.addEventListener('input', updateTemplatePreview);
  }

  // Rich text toolbar for template body
  document.querySelectorAll('#template-toolbar .toolbar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.command;
      if (cmd === 'createLink') {
        const url = prompt('Enter URL:');
        if (url) execTemplateCmd('createLink', url);
      } else if (cmd) {
        execTemplateCmd(cmd);
      }
    });
  });

  // Font size select for template
  const fontSizeSelect = document.querySelector('#template-toolbar .toolbar-select');
  if (fontSizeSelect) {
    fontSizeSelect.addEventListener('change', function() {
      if (this.value) {
        execTemplateCmd('fontSize', this.value);
      }
      this.selectedIndex = 0;
    });
  }

  // Color picker for template
  const colorInput = document.querySelector('#template-toolbar .toolbar-color');
  if (colorInput) {
    colorInput.addEventListener('input', function() {
      execTemplateCmd('foreColor', this.value);
    });
  }

  // Subject field also updates preview
  document.getElementById('template-subject').addEventListener('input', updateTemplatePreview);
});

// Make globally accessible
window.loadTemplates = loadTemplates;
window.editTemplate = editTemplate;
window.deleteTemplate = deleteTemplate;
