// Signatures Management Module
// Uses global functions: showToast, openConfirmModal, closeConfirmModal, and the API object.
// Also handles Setup Guide toggle and Reset button.

let currentSignatureId = null;
let allSignatures = [];

async function loadSignatures() {
  try {
    const data = await API.getSignatures();
    allSignatures = data.signatures || data || [];
    renderSignatureList();
    populateActiveSignatureDropdown();
    updateSignaturePreview();
  } catch (e) { console.error(e); }
}

function renderSignatureList() {
  const list = document.getElementById('signature-list');
  list.innerHTML = '';
  
  allSignatures.forEach(sig => {
    const item = document.createElement('div');
    item.className = 'signature-item' + (sig.id === currentSignatureId ? ' active' : '');
    item.innerHTML = `
      <span class="signature-item-name">
        ${sig.is_active ? '<span class="star-icon">★</span>' : ''}
        ${sig.name}
      </span>
      <div class="signature-item-actions">
        <button class="btn btn-sm btn-ghost" onclick="editSignature(${sig.id})">✏️</button>
        <button class="btn btn-sm btn-ghost" onclick="deleteSignatureById(${sig.id})" style="color: var(--danger);">🗑️</button>
      </div>
    `;
    item.addEventListener('click', (e) => {
      if (!e.target.closest('button')) editSignature(sig.id);
    });
    list.appendChild(item);
  });
}

function populateActiveSignatureDropdown() {
  const select = document.getElementById('active-signature-select');
  select.innerHTML = '<option value="">Select active signature...</option>';
  allSignatures.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    if (s.is_active) opt.selected = true;
    select.appendChild(opt);
  });
}

function editSignature(id) {
  const sig = allSignatures.find(s => s.id === id);
  if (!sig) return;
  currentSignatureId = id;
  document.getElementById('signature-name').value = sig.name;
  document.getElementById('signature-editor').innerHTML = sig.content || '';
  document.getElementById('signature-delete-btn').style.display = 'inline-flex';
  renderSignatureList();
  updateSignaturePreview();
}

function newSignature() {
  currentSignatureId = null;
  document.getElementById('signature-name').value = '';
  document.getElementById('signature-editor').innerHTML = '';
  document.getElementById('signature-delete-btn').style.display = 'none';
  renderSignatureList();
  updateSignaturePreview();
}

async function saveSignature() {
  const data = {
    name: document.getElementById('signature-name').value.trim(),
    content: document.getElementById('signature-editor').innerHTML,
  };
  if (!data.name) { showToast('Signature name is required', 'error'); return; }
  
  try {
    if (currentSignatureId) {
      await API.updateSignature(currentSignatureId, data);
      showToast('Signature updated! ✅', 'success');
    } else {
      const result = await API.createSignature(data);
      currentSignatureId = (result.signature || result).id;
      showToast('Signature created! ✅', 'success');
    }
    await loadSignatures();
  } catch (e) { console.error(e); }
}

async function deleteSignatureById(id) {
  openConfirmModal('Are you sure you want to delete this signature?', async () => {
    try {
      await API.deleteSignature(id);
      showToast('Signature deleted', 'info');
      if (currentSignatureId === id) newSignature();
      closeConfirmModal();
      await loadSignatures();
    } catch (e) { console.error(e); }
  });
}

async function activateSignature(id) {
  try {
    await API.activateSignature(id);
    showToast('Active signature updated! ⭐', 'success');
    await loadSignatures();
  } catch (e) { console.error(e); }
}

function updateSignaturePreview() {
  const preview = document.getElementById('signature-preview');
  const content = document.getElementById('signature-editor').innerHTML;
  preview.innerHTML = content ? content : '<p style="color: #999; font-style: italic;">Preview will appear here...</p>';
}

// Rich text toolbar commands
function execCmd(command, value = null) {
  document.execCommand(command, false, value);
  document.getElementById('signature-editor').focus();
  updateSignaturePreview();
}

function insertLink() {
  const url = prompt('Enter URL:');
  if (url) execCmd('createLink', url);
}

function insertImage() {
  const url = prompt('Enter image URL:');
  if (url) execCmd('insertImage', url);
}

function changeFontSize(select) {
  execCmd('fontSize', '7'); // execCommand only supports 1-7
  // Apply actual pixel size via span replacement
  const editor = document.getElementById('signature-editor');
  const fonts = editor.querySelectorAll('font[size="7"]');
  fonts.forEach(font => {
    const span = document.createElement('span');
    span.style.fontSize = select.value + 'px';
    span.innerHTML = font.innerHTML;
    font.parentNode.replaceChild(span, font);
  });
  updateSignaturePreview();
}

function changeColor(input) {
  execCmd('foreColor', input.value);
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Signature buttons
  document.getElementById('signature-new-btn').addEventListener('click', newSignature);
  document.getElementById('signature-save-btn').addEventListener('click', saveSignature);
  document.getElementById('signature-delete-btn').addEventListener('click', () => {
    if (currentSignatureId) deleteSignatureById(currentSignatureId);
  });
  document.getElementById('active-signature-select').addEventListener('change', (e) => {
    if (e.target.value) activateSignature(e.target.value);
  });
  
  // Signature editor preview update
  document.getElementById('signature-editor').addEventListener('input', updateSignaturePreview);
  
  // Rich text toolbar button handlers
  document.querySelectorAll('#signature-toolbar .toolbar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.command;
      if (cmd === 'createLink') {
        insertLink();
      } else if (cmd === 'insertImage') {
        insertImage();
      } else if (cmd) {
        execCmd(cmd);
      }
    });
  });
  
  // Font size select
  const fontSizeSelect = document.querySelector('#signature-toolbar .toolbar-select');
  if (fontSizeSelect) {
    fontSizeSelect.addEventListener('change', function() {
      if (this.value) changeFontSize(this);
      this.selectedIndex = 0;
    });
  }
  
  // Color picker
  const colorInput = document.querySelector('#signature-toolbar .toolbar-color');
  if (colorInput) {
    colorInput.addEventListener('input', function() {
      changeColor(this);
    });
  }
  
  // Setup guide toggle
  document.getElementById('setup-guide-toggle').addEventListener('click', () => {
    const content = document.getElementById('setup-guide-content');
    const icon = document.querySelector('#setup-guide-toggle .toggle-icon');
    const isHidden = content.hidden;
    content.hidden = !isHidden;
    if (!isHidden) {
      content.classList.remove('active');
      if (icon) icon.textContent = '▶';
    } else {
      content.classList.add('active');
      if (icon) icon.textContent = '▼';
    }
  });
  
  // Copy script button
  document.getElementById('copy-script-btn').addEventListener('click', () => {
    const code = document.querySelector('#setup-guide-content .code-block code').textContent;
    navigator.clipboard.writeText(code).then(() => {
      showToast('Code copied to clipboard! 📋', 'success');
    }).catch(() => {
      showToast('Failed to copy code', 'error');
    });
  });
  
  // Reset button
  document.getElementById('reset-btn').addEventListener('click', () => {
    openConfirmModal('⚠️ This will delete ALL data including events, templates, and signatures. This action cannot be undone. Are you sure?', async () => {
      try {
        await API.resetApp();
        showToast('Application data has been reset', 'info');
        closeConfirmModal();
        setTimeout(() => window.location.reload(), 1000);
      } catch (e) { console.error(e); }
    });
  });
});

// Make globally accessible
window.loadSignatures = loadSignatures;
window.editSignature = editSignature;
window.deleteSignatureById = deleteSignatureById;
window.execCmd = execCmd;
window.insertLink = insertLink;
window.insertImage = insertImage;
window.changeFontSize = changeFontSize;
window.changeColor = changeColor;
