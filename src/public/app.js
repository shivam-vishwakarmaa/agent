/**
 * NexusApply AI - Frontend Application Controller
 * Handles live execution tracking, verification review modals, resume uploads,
 * profile sync, and multi-API key pool management.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Navigation Tabs
  const navItems = document.querySelectorAll('.nav-item');
  const tabPanels = document.querySelectorAll('.tab-panel');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.getAttribute('data-tab');
      navItems.forEach(n => n.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));

      item.classList.add('active');
      const panel = document.getElementById(targetTab);
      if (panel) panel.classList.add('active');
    });
  });

  // Mode Selection Cards (Review vs Auto)
  const modeCardReview = document.getElementById('modeCardReview');
  const modeCardAuto = document.getElementById('modeCardAuto');
  const currentModeBadge = document.getElementById('currentModeBadge');

  function updateModeSelection(mode) {
    if (mode === 'review') {
      modeCardReview.classList.add('selected');
      modeCardAuto.classList.remove('selected');
      modeCardReview.querySelector('input').checked = true;
      currentModeBadge.textContent = '🛡️ Verification Mode';
    } else {
      modeCardAuto.classList.add('selected');
      modeCardReview.classList.remove('selected');
      modeCardAuto.querySelector('input').checked = true;
      currentModeBadge.textContent = '⚡ Full Auto-Pilot';
    }
  }

  modeCardReview.addEventListener('click', () => updateModeSelection('review'));
  modeCardAuto.addEventListener('click', () => updateModeSelection('auto'));

  // Load Initial Data
  loadProfile();
  loadApiKeys();
  startSessionPolling();

  // ==================== 1. Target Application Console ====================
  const applyForm = document.getElementById('applyForm');
  const startApplyBtn = document.getElementById('startApplyBtn');
  const terminalLogs = document.getElementById('terminalLogs');
  const sessionStatusBadge = document.getElementById('sessionStatusBadge');
  const sessionProgressBar = document.getElementById('sessionProgressBar');
  const reviewContainer = document.getElementById('reviewContainer');
  const filledFieldsList = document.getElementById('filledFieldsList');
  const reviewScreenshotImg = document.getElementById('reviewScreenshotImg');
  const approveSubmitBtn = document.getElementById('approveSubmitBtn');

  applyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const jobUrl = document.getElementById('targetJobUrl').value.trim();
    const companyName = document.getElementById('targetCompanyName').value.trim();
    const jobTitle = document.getElementById('targetJobTitle').value.trim();
    const mode = document.querySelector('input[name="execMode"]:checked').value;

    if (!jobUrl) return alert('Please enter a job or career URL');

    startApplyBtn.disabled = true;
    startApplyBtn.innerHTML = '<span>⏳ Agent Initializing...</span>';
    reviewContainer.classList.add('hidden');

    try {
      const res = await fetch('/api/apply/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobUrl, companyName, jobTitle, mode })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start agent');

      appendLog(`[Agent] Application process initiated in ${mode.toUpperCase()} mode.`, 'agent');
    } catch (err) {
      alert(`Error starting agent: ${err.message}`);
      startApplyBtn.disabled = false;
      startApplyBtn.innerHTML = '<span class="btn-icon">⚡</span> Launch Application Agent';
    }
  });

  approveSubmitBtn.addEventListener('click', async () => {
    approveSubmitBtn.disabled = true;
    approveSubmitBtn.textContent = 'Submitting Application...';
    try {
      const res = await fetch('/api/session/approve', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        appendLog('[User Approval] Final submission approved!', 'success');
        reviewContainer.classList.add('hidden');
      } else {
        alert(data.message || 'Approval failed');
        approveSubmitBtn.disabled = false;
      }
    } catch (err) {
      alert('Error approving submission: ' + err.message);
      approveSubmitBtn.disabled = false;
    }
  });

  // Polling loop for active session
  let lastLogCount = 0;
  function startSessionPolling() {
    setInterval(async () => {
      try {
        const res = await fetch('/api/session/active');
        const session = await res.json();
        if (!session || !session.status) return;

        updateSessionUI(session);
      } catch (err) {}
    }, 1500);
  }

  function updateSessionUI(session) {
    sessionStatusBadge.textContent = session.status || 'IDLE';
    sessionStatusBadge.className = `badge ${getStatusBadgeClass(session.status)}`;

    // Update progress bar
    const progressMap = {
      'IDLE': 0,
      'INITIALIZING': 15,
      'NAVIGATING': 35,
      'ANALYZING': 55,
      'FILLING': 75,
      'WAITING_FOR_REVIEW': 90,
      'SUBMITTING': 95,
      'COMPLETED': 100,
      'FAILED': 100
    };
    sessionProgressBar.style.width = `${progressMap[session.status] || 0}%`;

    // Append new logs
    if (session.logs && session.logs.length > lastLogCount) {
      for (let i = lastLogCount; i < session.logs.length; i++) {
        const l = session.logs[i];
        appendLog(`[${l.timestamp}] ${l.message}`, l.type);
      }
      lastLogCount = session.logs.length;
    }

    // Handle Review Mode Pause
    if (session.status === 'WAITING_FOR_REVIEW') {
      startApplyBtn.disabled = false;
      startApplyBtn.innerHTML = '<span class="btn-icon">⚡</span> Launch Application Agent';

      reviewContainer.classList.remove('hidden');
      renderReviewFields(session.fieldsFilled || []);

      const latestScreenshot = session.screenshots?.slice(-1)[0];
      if (latestScreenshot) {
        reviewScreenshotImg.src = `/screenshots/${latestScreenshot}`;
      }
    } else if (session.status === 'COMPLETED' || session.status === 'FAILED') {
      startApplyBtn.disabled = false;
      startApplyBtn.innerHTML = '<span class="btn-icon">⚡</span> Launch Application Agent';
    }
  }

  function getStatusBadgeClass(status) {
    if (status === 'COMPLETED') return 'badge-success';
    if (status === 'WAITING_FOR_REVIEW' || status === 'CAPTCHA_PAUSE') return 'badge-warning';
    if (status === 'FAILED') return 'badge-danger';
    return '';
  }

  function appendLog(text, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.textContent = text;
    terminalLogs.appendChild(entry);
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
  }

  function renderReviewFields(fields) {
    filledFieldsList.innerHTML = '';
    if (fields.length === 0) {
      filledFieldsList.innerHTML = '<div class="empty-state">No fields recorded.</div>';
      return;
    }

    fields.forEach(f => {
      const item = document.createElement('div');
      item.className = 'field-item';
      item.innerHTML = `
        <span class="field-label">${escapeHtml(f.label || 'Field')} ${f.isAiGenerated ? '✨ (AI Generated)' : ''}</span>
        <div class="field-val">${escapeHtml(f.value || '')}</div>
      `;
      filledFieldsList.appendChild(item);
    });
  }

  // ==================== 2. Fresher Role Matcher ====================
  const matcherForm = document.getElementById('matcherForm');
  const matcherCareersUrl = document.getElementById('matcherCareersUrl');
  const matcherRoleQuery = document.getElementById('matcherRoleQuery');
  const searchRolesBtn = document.getElementById('searchRolesBtn');
  const rolesResults = document.getElementById('rolesResults');

  matcherForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const careersUrl = matcherCareersUrl.value.trim();
    const rolePreference = matcherRoleQuery.value.trim();

    searchRolesBtn.disabled = true;
    searchRolesBtn.innerHTML = '<span>Scanning Careers...</span>';
    rolesResults.innerHTML = '<div class="empty-state">Agent is inspecting open roles on target company portal...</div>';

    try {
      const res = await fetch('/api/jobs/search-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ careersUrl, rolePreference })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to scan roles');

      renderMatchedRoles(data.jobs || []);
    } catch (err) {
      rolesResults.innerHTML = `<div class="empty-state" style="color:var(--rose)">Error: ${escapeHtml(err.message)}</div>`;
    } finally {
      searchRolesBtn.disabled = false;
      searchRolesBtn.innerHTML = '<span>🔍 Scan Careers Page</span>';
    }
  });

  function renderMatchedRoles(jobs) {
    if (jobs.length === 0) {
      rolesResults.innerHTML = '<div class="empty-state">No matching roles found on this portal. Try a different URL or keyword.</div>';
      return;
    }

    const container = document.createElement('div');
    container.className = 'roles-list';

    jobs.forEach(job => {
      const card = document.createElement('div');
      card.className = 'role-card';
      card.innerHTML = `
        <div>
          <div class="role-header">
            <h4 class="role-title">${escapeHtml(job.title)}</h4>
            <span class="match-score">${job.matchScore}% Match</span>
          </div>
          <div class="role-location">📍 ${escapeHtml(job.location || 'Location Not Specified')} • ${escapeHtml(job.experienceLevel || 'Fresher Eligible')}</div>
        </div>
        <button class="btn btn-primary btn-apply-direct" data-url="${escapeHtml(job.url || '')}" data-title="${escapeHtml(job.title)}">
          ⚡ Apply to this Role
        </button>
      `;

      card.querySelector('.btn-apply-direct').addEventListener('click', () => {
        if (job.url) {
          document.getElementById('targetJobUrl').value = job.url;
        } else {
          document.getElementById('targetJobUrl').value = matcherCareersUrl.value.trim();
        }
        document.getElementById('targetJobTitle').value = job.title;
        // Switch to apply tab
        document.querySelector('[data-tab="tab-apply"]').click();
      });

      container.appendChild(card);
    });

    rolesResults.innerHTML = '';
    rolesResults.appendChild(container);
  }

  // ==================== 3. Resume Upload & Knowledge ====================
  const resumeDropzone = document.getElementById('resumeDropzone');
  const resumeFileInput = document.getElementById('resumeFileInput');
  const uploadStatusText = document.getElementById('uploadStatusText');
  const currentResumeName = document.getElementById('currentResumeName');
  const skillsContainer = document.getElementById('skillsContainer');
  const educationContainer = document.getElementById('educationContainer');
  const projectsContainer = document.getElementById('projectsContainer');

  resumeDropzone.addEventListener('click', () => resumeFileInput.click());

  resumeDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    resumeDropzone.style.borderColor = 'var(--primary)';
  });

  resumeDropzone.addEventListener('dragleave', () => {
    resumeDropzone.style.borderColor = 'rgba(139, 92, 246, 0.3)';
  });

  resumeDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    resumeDropzone.style.borderColor = 'rgba(139, 92, 246, 0.3)';
    if (e.dataTransfer.files.length > 0) {
      handleResumeUpload(e.dataTransfer.files[0]);
    }
  });

  resumeFileInput.addEventListener('change', () => {
    if (resumeFileInput.files.length > 0) {
      handleResumeUpload(resumeFileInput.files[0]);
    }
  });

  async function handleResumeUpload(file) {
    if (!file.name.endsWith('.pdf')) {
      return alert('Please upload a PDF format resume');
    }

    uploadStatusText.textContent = 'Parsing and extracting structured profile...';
    const formData = new FormData();
    formData.append('resume', file);

    try {
      const res = await fetch('/api/resume/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      uploadStatusText.textContent = '✅ Resume parsed successfully!';
      currentResumeName.textContent = file.name;
      renderParsedProfile(data.profile);
      loadProfile(); // refresh form
    } catch (err) {
      uploadStatusText.textContent = `❌ ${err.message}`;
    }
  }

  function renderParsedProfile(profile) {
    const resume = profile.resume || {};
    currentResumeName.textContent = resume.fileName || 'Uploaded Resume';

    // Skills
    const skills = resume.skills || {};
    const allSkills = [
      ...(skills.languages || []),
      ...(skills.frameworks || []),
      ...(skills.databases || []),
      ...(skills.tools || [])
    ];

    if (allSkills.length > 0) {
      skillsContainer.innerHTML = allSkills.map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`).join('');
    }

    // Education
    if (resume.education && resume.education.length > 0) {
      educationContainer.innerHTML = resume.education.map(edu => `
        <div class="info-card">
          <strong>${escapeHtml(edu.degree || 'Degree')}</strong>
          <span>${escapeHtml(edu.institution || '')} • ${escapeHtml(edu.endDate || '')}</span>
        </div>
      `).join('');
    }

    // Projects
    if (resume.projects && resume.projects.length > 0) {
      projectsContainer.innerHTML = resume.projects.map(proj => `
        <div class="info-card">
          <strong>${escapeHtml(proj.title || 'Project')}</strong>
          <span>${escapeHtml(proj.description || '')}</span>
        </div>
      `).join('');
    }
  }

  // ==================== 4. Profile & Fallbacks ====================
  const profileForm = document.getElementById('profileForm');
  const quickName = document.getElementById('quickName');
  const quickRole = document.getElementById('quickRole');
  const avatarLetter = document.getElementById('avatarLetter');

  async function loadProfile() {
    try {
      const res = await fetch('/api/profile');
      const profile = await res.json();
      if (!profile) return;

      const p = profile.personal || {};
      const prefs = profile.preferences || {};

      document.getElementById('fullName').value = p.fullName || '';
      document.getElementById('email').value = p.email || '';
      document.getElementById('phone').value = p.phone || '';
      document.getElementById('dateOfBirth').value = p.dateOfBirth || '';
      document.getElementById('gender').value = p.gender || 'Prefer not to say';
      document.getElementById('currentCity').value = p.currentCity || '';
      document.getElementById('linkedinUrl').value = p.linkedinUrl || '';
      document.getElementById('githubUrl').value = p.githubUrl || '';
      document.getElementById('portfolioUrl').value = p.portfolioUrl || '';

      document.getElementById('experienceLevel').value = prefs.experienceLevel || 'Fresher (0-1 YOE)';
      document.getElementById('noticePeriodDays').value = String(prefs.noticePeriodDays ?? 0);
      document.getElementById('requiresSponsorship').value = String(prefs.requiresSponsorship ?? false);
      document.getElementById('willingToRelocate').value = String(prefs.willingToRelocate ?? true);
      document.getElementById('remotePreference').value = prefs.remotePreference || 'Flexible';
      document.getElementById('preferredRoles').value = (prefs.preferredRoles || []).join(', ');

      if (p.fullName) {
        quickName.textContent = p.fullName;
        avatarLetter.textContent = p.fullName.charAt(0).toUpperCase();
      }
      if (prefs.experienceLevel) {
        quickRole.textContent = prefs.experienceLevel;
      }

      if (profile.resume?.fileName) {
        renderParsedProfile(profile);
      }
    } catch (err) {}
  }

  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById('saveProfileBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const updated = {
      personal: {
        fullName: document.getElementById('fullName').value.trim(),
        email: document.getElementById('email').value.trim(),
        phone: document.getElementById('phone').value.trim(),
        dateOfBirth: document.getElementById('dateOfBirth').value.trim(),
        gender: document.getElementById('gender').value,
        currentCity: document.getElementById('currentCity').value.trim(),
        linkedinUrl: document.getElementById('linkedinUrl').value.trim(),
        githubUrl: document.getElementById('githubUrl').value.trim(),
        portfolioUrl: document.getElementById('portfolioUrl').value.trim()
      },
      preferences: {
        experienceLevel: document.getElementById('experienceLevel').value,
        noticePeriodDays: parseInt(document.getElementById('noticePeriodDays').value, 10),
        requiresSponsorship: document.getElementById('requiresSponsorship').value === 'true',
        willingToRelocate: document.getElementById('willingToRelocate').value === 'true',
        remotePreference: document.getElementById('remotePreference').value,
        preferredRoles: document.getElementById('preferredRoles').value.split(',').map(s => s.trim()).filter(Boolean)
      }
    };

    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      const data = await res.json();
      if (data.success) {
        alert('Profile & Fallback questions saved successfully!');
        loadProfile();
      }
    } catch (err) {
      alert('Error saving profile: ' + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 Save Profile & Fallbacks';
    }
  });

  // ==================== 5. Multi-API Key Failover Pool ====================
  const addApiKeyForm = document.getElementById('addApiKeyForm');
  const newApiKeyInput = document.getElementById('newApiKeyInput');
  const apiKeysList = document.getElementById('apiKeysList');
  const apiPoolStatus = document.getElementById('apiPoolStatus');
  const apiPoolPill = document.getElementById('apiPoolPill');

  async function loadApiKeys() {
    try {
      const res = await fetch('/api/keys');
      const data = await res.json();
      renderApiKeys(data.keys || []);
    } catch (err) {}
  }

  function renderApiKeys(keys) {
    apiPoolStatus.textContent = `API Pool: ${keys.length} Key${keys.length === 1 ? '' : 's'}`;
    const hasActive = keys.some(k => k.status === 'active');
    const dot = apiPoolPill.querySelector('.status-dot');
    dot.className = `status-dot ${hasActive ? 'dot-active' : 'dot-warn'}`;

    if (keys.length === 0) {
      apiKeysList.innerHTML = '<div class="empty-state">No Gemini API keys in pool. Add at least one key below to enable AI question answering.</div>';
      return;
    }

    apiKeysList.innerHTML = keys.map(k => {
      const isCooldown = k.status === 'cooldown';
      const statusBadge = isCooldown 
        ? `<span class="badge badge-warning">COOLDOWN (${k.remainingCooldownSec}s left)</span>`
        : (k.status === 'active' ? `<span class="badge badge-success">ACTIVE</span>` : `<span class="badge badge-danger">ERROR</span>`);

      return `
        <div class="api-key-item">
          <div class="key-left">
            <span class="status-dot ${isCooldown ? 'dot-warn' : 'dot-active'}"></span>
            <div>
              <span class="key-name">${escapeHtml(k.masked)}</span>
              <div class="key-stats">Success: ${k.successCount} | Failures: ${k.failCount} ${k.lastError ? `(${escapeHtml(k.lastError)})` : ''}</div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:1rem;">
            ${statusBadge}
            <button class="btn-danger" onclick="removeApiKey('${k.id}')">Remove</button>
          </div>
        </div>
      `;
    }).join('');
  }

  window.removeApiKey = async (id) => {
    if (!confirm('Remove this API key from pool?')) return;
    try {
      await fetch(`/api/keys/${id}`, { method: 'DELETE' });
      loadApiKeys();
    } catch (err) {}
  };

  addApiKeyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = newApiKeyInput.value.trim();
    if (!key) return;

    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
      });
      const data = await res.json();
      if (data.success) {
        newApiKeyInput.value = '';
        renderApiKeys(data.keys);
      }
    } catch (err) {
      alert('Failed to add key: ' + err.message);
    }
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
