/**
 * API Client Module
 * Centralizes all fetch calls to the backend API.
 * Depends on window.showToast (defined in app.js) for error notifications.
 */
const API = {
  /**
   * Base request helper. Wraps fetch with JSON content-type for POST/PUT,
   * parses JSON responses, and shows a toast on error.
   */
  async _request(url, options = {}) {
    try {
      const method = (options.method || 'GET').toUpperCase();

      if (method === 'POST' || method === 'PUT') {
        options.headers = {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        };
      }

      const response = await fetch(url, options);

      if (!response.ok) {
        let errorMessage = `Request failed (${response.status})`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch {
          // Response body wasn't JSON – keep the default message
        }
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (error) {
      if (typeof showToast === 'function') {
        showToast(error.message || 'An unexpected error occurred', 'error');
      }
      throw error;
    }
  },

  // ── Auth ───────────────────────────────────────────────────────────────

  async getAuthStatus() {
    return this._request('/api/auth/status');
  },

  async disconnectGoogle() {
    return this._request('/api/auth/disconnect', { method: 'POST' });
  },

  // ── Events ──────────────────────────────────────────────────────────────

  async getEvents(status, days = null) {
    let url = `/api/events?status=${status}`;
    if (days) url += `&days=${days}`;
    return this._request(url);
  },

  async getEvent(id) {
    return this._request(`/api/events/${id}`);
  },

  async updateEvent(id, data) {
    return this._request(`/api/events/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async scheduleEvent(id, templateId) {
    return this._request(`/api/events/${id}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ template_id: templateId || null }),
    });
  },

  async sendEventNow(id, templateId) {
    return this._request(`/api/events/${id}/send-now`, {
      method: 'POST',
      body: JSON.stringify({ template_id: templateId || null }),
    });
  },

  async cancelEvent(id) {
    return this._request(`/api/events/${id}/cancel`, { method: 'POST' });
  },

  // ── Templates ───────────────────────────────────────────────────────────

  async getTemplates() {
    return this._request('/api/templates');
  },

  async createTemplate(data) {
    return this._request('/api/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateTemplate(id, data) {
    return this._request(`/api/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteTemplate(id) {
    return this._request(`/api/templates/${id}`, { method: 'DELETE' });
  },

  async activateTemplate(id) {
    return this._request(`/api/templates/${id}/activate`, { method: 'PUT' });
  },

  // ── Signatures ──────────────────────────────────────────────────────────

  async getSignatures() {
    return this._request('/api/signatures');
  },

  async createSignature(data) {
    return this._request('/api/signatures', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateSignature(id, data) {
    return this._request(`/api/signatures/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteSignature(id) {
    return this._request(`/api/signatures/${id}`, { method: 'DELETE' });
  },

  async activateSignature(id) {
    return this._request(`/api/signatures/${id}/activate`, { method: 'PUT' });
  },

  // ── System ──────────────────────────────────────────────────────────────

  async getStats() {
    return this._request('/api/stats');
  },

  async clearCanceledBadge() {
    return this._request('/api/stats/clear-canceled-badge', { method: 'POST' });
  },

  async forceSync() {
    return this._request('/api/sync', { method: 'POST' });
  },

  async getSettings() {
    return this._request('/api/settings');
  },

  async saveSettings(data) {
    return this._request('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async resetApp() {
    return this._request('/api/reset', { method: 'POST' });
  },

  async getEmailPreview(data) {
    const params = new URLSearchParams(data);
    return this._request(`/api/email-preview?${params.toString()}`);
  },
};
