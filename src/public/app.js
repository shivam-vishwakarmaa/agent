/**
 * NexusApply AI - Frontend Application Controller
 * Handles live execution tracking, verification review modals, multi-resume management,
 * autonomous job discovery radar, and batch Gemini API key pool sync.
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

  // Live Agent Hero & Stepper Elements
  const heroActionChip = document.getElementById('heroActionChip');
  const heroPlatformChip = document.getElementById('heroPlatformChip');
  const heroStepChip = document.getElementById('heroStepChip');
  const heroActionTitle = document.getElementById('heroActionTitle');
  const heroActionDetail = document.getElementById('heroActionDetail');
  const heroRadarEmoji = document.getElementById('heroRadarEmoji');
  const radarPulseEffect = document.getElementById('radarPulseEffect');

  const errorDiagnosticCard = document.getElementById('errorDiagnosticCard');
  const errorDiagTitle = document.getElementById('errorDiagTitle');
  const errorDiagCode = document.getElementById('errorDiagCode');
  const errorDiagMessage = document.getElementById('errorDiagMessage');
  const errorDiagSuggestion = document.getElementById('errorDiagSuggestion');
  const btnRetryApplication = document.getElementById('btnRetryApplication');
  const btnDismissError = document.getElementById('btnDismissError');

  const authGateCard = document.getElementById('authGateCard');
  const authGateTitle = document.getElementById('authGateTitle');
  const authGateDesc = document.getElementById('authGateDesc');
  const authGateFormSection = document.getElementById('authGateFormSection');
  const authGateVerifySection = document.getElementById('authGateVerifySection');
  const authEmailInput = document.getElementById('authEmailInput');
  const authPasswordInput = document.getElementById('authPasswordInput');
  const btnToggleAuthPass = document.getElementById('btnToggleAuthPass');
  const authRememberPassword = document.getElementById('authRememberPassword');
  const btnSubmitAuthCredentials = document.getElementById('btnSubmitAuthCredentials');
  const btnSignInInstead = document.getElementById('btnSignInInstead');
  const btnResumeAuth = document.getElementById('btnResumeAuth');

  if (btnToggleAuthPass && authPasswordInput) {
    btnToggleAuthPass.addEventListener('click', () => {
      const isPass = authPasswordInput.type === 'password';
      authPasswordInput.type = isPass ? 'text' : 'password';
      btnToggleAuthPass.textContent = isPass ? '🙈' : '👁️';
    });
  }

  async function submitAuthCredentials(action = 'CREATE_ACCOUNT') {
    if (!authPasswordInput || !authPasswordInput.value.trim()) {
      alert('Please enter a password for your account.');
      authPasswordInput?.focus();
      return;
    }

    const email = authEmailInput ? authEmailInput.value.trim() : 'shivamvishwa844@gmail.com';
    const password = authPasswordInput.value;
    const rememberPassword = authRememberPassword ? authRememberPassword.checked : true;

    const targetBtn = action === 'CREATE_ACCOUNT' ? btnSubmitAuthCredentials : btnSignInInstead;
    if (targetBtn) {
      targetBtn.disabled = true;
      targetBtn.innerHTML = '<span>⏳ Submitting...</span>';
    }

    try {
      const res = await fetch('/api/session/provide-auth-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, action, rememberPassword })
      });
      const data = await res.json();
      if (data.success) {
        if (authGateFormSection) authGateFormSection.classList.add('hidden');
        if (authGateVerifySection) authGateVerifySection.classList.remove('hidden');
        if (authGateDesc) authGateDesc.textContent = 'Account credentials submitted! Processing registration...';
      }
    } catch (err) {
      alert('Failed to submit credentials: ' + err.message);
    } finally {
      if (targetBtn) {
        targetBtn.disabled = false;
        targetBtn.innerHTML = action === 'CREATE_ACCOUNT' ? '🚀 Create Account & Proceed Application' : '🔑 Sign In With This Password';
      }
    }
  }

  if (btnSubmitAuthCredentials) {
    btnSubmitAuthCredentials.addEventListener('click', () => submitAuthCredentials('CREATE_ACCOUNT'));
  }

  if (btnSignInInstead) {
    btnSignInInstead.addEventListener('click', () => submitAuthCredentials('SIGN_IN'));
  }

  if (btnResumeAuth) {
    btnResumeAuth.addEventListener('click', async () => {
      btnResumeAuth.disabled = true;
      btnResumeAuth.textContent = 'Resuming Application...';
      try {
        const res = await fetch('/api/session/resume-auth', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          if (authGateCard) authGateCard.classList.add('hidden');
        }
      } catch (e) {} finally {
        btnResumeAuth.disabled = false;
        btnResumeAuth.textContent = "✅ I've Completed Sign-In / Verified Code - Continue";
      }
    });
  }

  if (btnRetryApplication) {
    btnRetryApplication.addEventListener('click', () => {
      if (errorDiagnosticCard) errorDiagnosticCard.classList.add('hidden');
      if (authGateCard) authGateCard.classList.add('hidden');
      if (applyForm) {
        applyForm.dispatchEvent(new Event('submit'));
      }
    });
  }

  if (btnDismissError) {
    btnDismissError.addEventListener('click', () => {
      if (errorDiagnosticCard) errorDiagnosticCard.classList.add('hidden');
    });
  }

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
    if (errorDiagnosticCard) errorDiagnosticCard.classList.add('hidden');
    if (authGateCard) authGateCard.classList.add('hidden');

    // Reset live terminal
    terminalLogs.innerHTML = '';
    lastLogCount = 0;

    // Immediately reflect active status in Hero Card & Stepper
    if (heroActionTitle) heroActionTitle.textContent = `Connecting to ${companyName || 'Career Portal'}...`;
    if (heroActionDetail) heroActionDetail.textContent = `Launching browser and navigating to ${jobUrl.slice(0, 70)}...`;
    if (heroActionChip) {
      heroActionChip.textContent = 'STATUS: INITIALIZING';
      heroActionChip.className = 'hero-tag tag-active';
    }
    if (radarPulseEffect) radarPulseEffect.classList.add('active');
    updatePipelineStepper({ pipelineStep: 1, status: 'INITIALIZING' });

    try {
      const res = await fetch('/api/apply/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobUrl, companyName, jobTitle, mode })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start agent');

      appendLog({
        timestamp: new Date().toLocaleTimeString(),
        type: 'agent',
        actionTag: 'NAVIGATE',
        message: `Application launched in ${mode.toUpperCase()} mode for ${companyName || 'Target Company'}.`
      });
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
        appendLog({
          timestamp: new Date().toLocaleTimeString(),
          type: 'success',
          actionTag: 'SUCCESS',
          message: 'User approved! Final submission in progress...'
        });
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
    }, 1200);
  }

  window.updateSessionUI = updateSessionUI;

  function updateSessionUI(session) {
    if (!session) return;

    sessionStatusBadge.textContent = session.status || 'IDLE';
    sessionStatusBadge.className = `badge ${getStatusBadgeClass(session.status)}`;

    const progressMap = {
      'IDLE': 0,
      'INITIALIZING': 15,
      'NAVIGATING': 35,
      'WAITING_FOR_AUTH': 45,
      'ANALYZING': 55,
      'FILLING': 75,
      'WAITING_FOR_REVIEW': 90,
      'SUBMITTING': 95,
      'COMPLETED': 100,
      'FAILED': 100
    };
    sessionProgressBar.style.width = `${progressMap[session.status] || 0}%`;

    // 1. Update Hero Status Card
    updateHeroStatusCard(session);

    // 2. Update 5-Step Pipeline
    updatePipelineStepper(session);

    // 3. Update Error Diagnostic Box
    updateErrorDiagnostic(session);

    // 4. Update Authentication Gateway Card
    if (session.status === 'WAITING_FOR_AUTH') {
      if (authGateCard) {
        authGateCard.classList.remove('hidden');
        const details = session.authDetails || {};
        if (details.title && authGateTitle) authGateTitle.textContent = details.title;
        if (details.message && authGateDesc) authGateDesc.textContent = details.message;
        if (details.email && authEmailInput) authEmailInput.value = details.email;

        if (details.reason === 'NEED_PASSWORD' || details.action === 'CREATE_ACCOUNT') {
          if (authGateFormSection) authGateFormSection.classList.remove('hidden');
          if (authGateVerifySection) authGateVerifySection.classList.add('hidden');
        } else {
          if (authGateFormSection) authGateFormSection.classList.add('hidden');
          if (authGateVerifySection) authGateVerifySection.classList.remove('hidden');
        }
      }
    } else {
      if (authGateCard) authGateCard.classList.add('hidden');
    }

    // 5. Update Header Live Pill
    updateHeaderLiveActivity(session);

    // 5. Append new logs
    if (session.logs && session.logs.length > lastLogCount) {
      for (let i = lastLogCount; i < session.logs.length; i++) {
        appendLog(session.logs[i]);
      }
      lastLogCount = session.logs.length;
    }
    if (terminalLogCount) {
      terminalLogCount.textContent = `${session.logs ? session.logs.length : 0} events`;
    }

    // 6. Handle Review Mode Pause
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

  function updateHeroStatusCard(session) {
    const isRunning = ['INITIALIZING', 'NAVIGATING', 'ANALYZING', 'FILLING', 'SUBMITTING'].includes(session.status);
    const isPaused = session.status === 'WAITING_FOR_REVIEW' || session.status === 'CAPTCHA_PAUSE';
    const isFailed = session.status === 'FAILED';
    const isComplete = session.status === 'COMPLETED';

    // Pulse effect
    if (radarPulseEffect) {
      if (isRunning) {
        radarPulseEffect.classList.add('active');
      } else {
        radarPulseEffect.classList.remove('active');
      }
    }

    // Radar Emoji
    if (heroRadarEmoji) {
      if (isRunning) heroRadarEmoji.textContent = '⚡';
      else if (isPaused) heroRadarEmoji.textContent = '🛑';
      else if (isFailed) heroRadarEmoji.textContent = '❌';
      else if (isComplete) heroRadarEmoji.textContent = '🎉';
      else heroRadarEmoji.textContent = '🤖';
    }

    // Action Chip Tag
    if (heroActionChip) {
      heroActionChip.textContent = `STATUS: ${session.status || 'IDLE'}`;
      heroActionChip.className = `hero-tag ${
        isComplete ? 'tag-primary' :
        isFailed ? 'tag-error' :
        isPaused ? 'tag-warn' :
        isRunning ? 'tag-active' : 'tag-muted'
      }`;
    }

    // Platform Tag
    if (heroPlatformChip) {
      heroPlatformChip.textContent = `Platform: ${session.atsType || 'Auto-Detect'}`;
    }

    // Step Tag
    if (heroStepChip) {
      heroStepChip.textContent = `Step ${session.currentStep || 1} of ${session.totalStepsEstimated || 1}`;
    }

    // Hero Action Title & Detail
    if (heroActionTitle) {
      heroActionTitle.textContent = session.currentAction || (isComplete ? 'Application Completed' : 'Agent Ready');
    }
    if (heroActionDetail) {
      heroActionDetail.textContent = session.currentActionDetail || (
        isComplete ? 'Application has been successfully submitted.' :
        isFailed ? (session.errorDetails?.message || 'Application process was interrupted.') :
        'Ready to process application.'
      );
    }
  }

  function updatePipelineStepper(session) {
    const pipeStep = session.pipelineStep || 1;
    const isFailed = session.status === 'FAILED';
    const isComplete = session.status === 'COMPLETED';

    for (let i = 1; i <= 5; i++) {
      const stepEl = document.getElementById(`pipeStep${i}`);
      const lineEl = document.getElementById(`pipeLine${i}`);
      if (!stepEl) continue;

      stepEl.className = 'pipe-step';
      if (isComplete) {
        stepEl.classList.add('step-completed');
      } else if (isFailed && i === pipeStep) {
        stepEl.classList.add('step-failed');
      } else if (i < pipeStep) {
        stepEl.classList.add('step-completed');
      } else if (i === pipeStep) {
        stepEl.classList.add('step-active');
      } else {
        stepEl.classList.add('step-idle');
      }

      if (lineEl) {
        lineEl.className = 'pipe-line';
        if (isComplete || i < pipeStep) {
          lineEl.classList.add('completed');
        }
      }
    }
  }

  function updateErrorDiagnostic(session) {
    if (!errorDiagnosticCard) return;

    if (session.status === 'FAILED') {
      const err = session.errorDetails || {
        title: 'Application Process Interrupted',
        message: 'An unexpected error occurred during execution.',
        suggestion: 'Check the URL or try applying to a different portal.',
        code: 'EXECUTION_ERROR'
      };

      if (errorDiagTitle) errorDiagTitle.textContent = err.title;
      if (errorDiagCode) errorDiagCode.textContent = err.code || 'ERROR';
      if (errorDiagMessage) errorDiagMessage.textContent = err.message;
      if (errorDiagSuggestion) errorDiagSuggestion.textContent = err.suggestion;

      errorDiagnosticCard.classList.remove('hidden');
    } else {
      errorDiagnosticCard.classList.add('hidden');
    }
  }

  function updateHeaderLiveActivity(session) {
    if (!headerLiveActivity) return;
    const isRunning = ['INITIALIZING', 'NAVIGATING', 'ANALYZING', 'FILLING', 'SUBMITTING', 'WAITING_FOR_REVIEW'].includes(session.status);
    if (isRunning) {
      headerLiveActivity.classList.remove('hidden');
      if (headerLiveText) {
        headerLiveText.textContent = session.currentAction || 'Agent Working...';
      }
    } else {
      headerLiveActivity.classList.add('hidden');
    }
  }

  function getStatusBadgeClass(status) {
    if (status === 'COMPLETED') return 'badge-success';
    if (status === 'WAITING_FOR_REVIEW' || status === 'CAPTCHA_PAUSE') return 'badge-warning';
    if (status === 'FAILED') return 'badge-danger';
    return '';
  }

  function appendLog(logItem) {
    let text = '';
    let type = 'info';
    let actionTag = 'INFO';
    let timestamp = '';

    if (typeof logItem === 'string') {
      text = logItem;
      timestamp = new Date().toLocaleTimeString();
    } else {
      text = logItem.message || '';
      type = logItem.type || 'info';
      actionTag = logItem.actionTag || 'INFO';
      timestamp = logItem.timestamp || new Date().toLocaleTimeString();
    }

    const tagIconMap = {
      'NAVIGATE': '🌐',
      'SCAN': '🔍',
      'AI_THINK': '✨',
      'AUTOFILL': '📝',
      'ATTACH': '📎',
      'SNAPSHOT': '📸',
      'VERIFY': '🛡️',
      'SUBMIT': '⚡',
      'SUCCESS': '✅',
      'ERROR': '❌',
      'ALERT': '⚠️',
      'INFO': 'ℹ️'
    };

    const icon = tagIconMap[actionTag] || 'ℹ️';
    const chipClass = `chip-${actionTag.toLowerCase()}`;

    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.innerHTML = `
      <span class="log-chip ${chipClass}">${icon} ${actionTag}</span>
      <span class="log-time">${escapeHtml(timestamp)}</span>
      <span class="log-text">${escapeHtml(text)}</span>
    `;

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

  // ==================== 2. Autonomous Job Discovery Radar ====================
  const btnDiscoverIndiaCompanies = document.getElementById('btnDiscoverIndiaCompanies');
  const radarRoleQuery = document.getElementById('radarRoleQuery');
  const radarLocationQuery = document.getElementById('radarLocationQuery');
  const discoveredCompaniesGrid = document.getElementById('discoveredCompaniesGrid');
  const matcherForm = document.getElementById('matcherForm');
  const matcherCareersUrl = document.getElementById('matcherCareersUrl');
  const matcherRoleQuery = document.getElementById('matcherRoleQuery');
  const searchRolesBtn = document.getElementById('searchRolesBtn');
  const rolesResults = document.getElementById('rolesResults');

  btnDiscoverIndiaCompanies.addEventListener('click', () => {
    discoverCompanies();
  });

  async function discoverCompanies() {
    if (btnDiscoverIndiaCompanies) {
      btnDiscoverIndiaCompanies.disabled = true;
      btnDiscoverIndiaCompanies.innerHTML = '<span>⚡ Scanning Portals...</span>';
    }
    if (discoveredCompaniesGrid) {
      discoveredCompaniesGrid.innerHTML = '<div class="empty-state">Scanning active tech hiring portals in India...</div>';
    }

    const targetRole = (radarRoleQuery && radarRoleQuery.value.trim()) || 'Software Engineer';
    const location = (radarLocationQuery && radarLocationQuery.value.trim()) || 'India';

    try {
      const res = await fetch('/api/jobs/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetRole, location })
      });
      const data = await res.json();
      renderDiscoveredCompanies(data.companies || [], data);
    } catch (err) {
      if (discoveredCompaniesGrid) {
        discoveredCompaniesGrid.innerHTML = `<div class="empty-state" style="color:var(--rose)">Error: ${escapeHtml(err.message)}</div>`;
      }
    } finally {
      if (btnDiscoverIndiaCompanies) {
        btnDiscoverIndiaCompanies.disabled = false;
        btnDiscoverIndiaCompanies.innerHTML = '<span>⚡ Auto-Scan Hiring Companies</span>';
      }
    }
  }

  function renderDiscoveredCompanies(companies, meta = {}) {
    if (companies.length === 0) {
      discoveredCompaniesGrid.innerHTML = '<div class="empty-state">No portals returned. Try adjusting role keywords.</div>';
      return;
    }

    const typoBanner = meta.hasTypoCorrection ? `
      <div style="grid-column: 1 / -1; margin-bottom: 0.5rem; padding: 0.8rem 1.2rem; background: rgba(139, 92, 246, 0.15); border: 1px solid var(--primary); border-radius: 8px; font-size: 0.85rem; color: #e2e8f0;">
        ✨ <strong>Spelling Auto-Corrected:</strong> "<em>${escapeHtml(meta.originalQuery)}</em>" ➔ <strong>"${escapeHtml(meta.queryUsed)}"</strong>
        <span style="display:block; font-size:0.78rem; color:var(--text-secondary); margin-top:0.2rem;">
          Includes expanded roles: Frontend, Backend, Full Stack, SDE 1, Platform & Trainee positions.
        </span>
      </div>
    ` : '';

    discoveredCompaniesGrid.innerHTML = typoBanner + companies.map(c => `
      <div class="company-radar-card">
        <div>
          <div class="radar-card-header">
            <h4 class="radar-company-name">${escapeHtml(c.company)}</h4>
            <span class="badge badge-success">${escapeHtml(c.hiringStatus || 'Actively Hiring')}</span>
          </div>
          <div class="radar-role-title">💼 ${escapeHtml(c.typicalFresherRole || 'Software Engineer')}</div>
          <div class="radar-meta">
            📍 ${escapeHtml(c.locations || 'India')}<br>
            🎓 ${escapeHtml(c.experienceRequired || 'Fresher / Entry-Level')}
          </div>
          <div class="tags-container" style="margin-bottom:0.8rem;">
            ${(c.tags || []).map(t => `<span class="skill-tag">${escapeHtml(t)}</span>`).join('')}
          </div>
        </div>
        <div class="radar-actions">
          <button class="btn btn-secondary btn-crawl-portal" data-url="${escapeHtml(c.careersUrl)}" data-company="${escapeHtml(c.company)}">
            🔍 Crawl Open Jobs
          </button>
          <button class="btn btn-primary btn-auto-apply" data-url="${escapeHtml(c.careersUrl)}" data-company="${escapeHtml(c.company)}" data-role="${escapeHtml(c.typicalFresherRole)}">
            ⚡ Apply with Agent
          </button>
        </div>
      </div>
    `).join('');

    // Attach actions
    discoveredCompaniesGrid.querySelectorAll('.btn-crawl-portal').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.getAttribute('data-url');
        matcherCareersUrl.value = url;
        crawlPortal(url, radarRoleQuery.value.trim());
      });
    });

    discoveredCompaniesGrid.querySelectorAll('.btn-auto-apply').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('targetJobUrl').value = btn.getAttribute('data-url');
        document.getElementById('targetCompanyName').value = btn.getAttribute('data-company');
        document.getElementById('targetJobTitle').value = btn.getAttribute('data-role');
        document.querySelector('[data-tab="tab-apply"]').click();
      });
    });
  }

  // Specific portal DOM crawler
  matcherForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const careersUrl = matcherCareersUrl.value.trim();
    const rolePreference = matcherRoleQuery.value.trim();
    crawlPortal(careersUrl, rolePreference);
  });

  async function crawlPortal(careersUrl, rolePreference) {
    if (!careersUrl) return alert('Please enter or select a career portal URL');

    searchRolesBtn.disabled = true;
    searchRolesBtn.innerHTML = '<span>Crawling DOM...</span>';
    rolesResults.innerHTML = `<div class="empty-state">Agent browser is actively inspecting <strong>${escapeHtml(careersUrl)}</strong>...</div>`;

    try {
      const res = await fetch('/api/jobs/search-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ careersUrl, rolePreference })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to scan roles');

      renderMatchedRoles(data.jobs || [], data);
    } catch (err) {
      rolesResults.innerHTML = `<div class="empty-state" style="color:var(--rose)">Error: ${escapeHtml(err.message)}</div>`;
    } finally {
      searchRolesBtn.disabled = false;
      searchRolesBtn.innerHTML = '<span>🔍 Crawl Portal DOM</span>';
    }
  }

  function renderMatchedRoles(jobs, meta = {}) {
    if (jobs.length === 0) {
      rolesResults.innerHTML = '<div class="empty-state">No matching roles found on this portal. Try a different role query or company portal.</div>';
      return;
    }

    const container = document.createElement('div');
    container.className = 'roles-list';

    if (meta.hasTypoCorrection) {
      const banner = document.createElement('div');
      banner.style.cssText = 'padding: 0.8rem 1.2rem; margin-bottom: 1rem; background: rgba(139, 92, 246, 0.15); border: 1px solid var(--primary); border-radius: 8px; font-size: 0.85rem; color: #e2e8f0;';
      banner.innerHTML = `
        ✨ <strong>Spelling Auto-Corrected:</strong> "<em>${escapeHtml(meta.originalQuery)}</em>" ➔ <strong>"${escapeHtml(meta.queryUsed)}"</strong>
        <div style="font-size:0.78rem; color:var(--text-secondary); margin-top:0.2rem;">
          Semantic role expansion active: Matching Frontend, Backend, Full Stack, SDE & Platform positions.
        </div>
      `;
      container.appendChild(banner);
    }

    jobs.forEach(job => {
      const card = document.createElement('div');
      card.className = 'role-card';

      const skillsHtml = (job.matchedSkills && job.matchedSkills.length > 0)
        ? `<div class="tags-container" style="margin-bottom:0.8rem;">
            ${job.matchedSkills.map(s => `<span class="skill-tag" style="font-size:0.75rem;">✓ ${escapeHtml(s)}</span>`).join('')}
           </div>`
        : '';

      const scoreColor = job.matchScore >= 70 ? '#6ee7b7' : (job.matchScore >= 50 ? '#fde68a' : '#fda4af');

      card.innerHTML = `
        <div>
          <div class="role-header">
            <h4 class="role-title">${escapeHtml(job.title)}</h4>
            <span class="match-score" style="color:${scoreColor}; border-color:${scoreColor}40;">${job.matchScore}% Match</span>
          </div>
          <div class="role-location">📍 ${escapeHtml(job.location || 'Location Not Specified')} • ${job.isFresherFriendly ? '🌱 Fresher Friendly' : '⚡ Experience Required'}</div>
          ${skillsHtml}
          <div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:1rem; line-height:1.4;">
            💡 <strong>Match Reason:</strong> ${escapeHtml(job.reason || 'General role match')}
          </div>
        </div>
        <button class="btn btn-primary btn-apply-direct" data-url="${escapeHtml(job.url || '')}" data-title="${escapeHtml(job.title)}">
          ⚡ Auto-Apply with Agent
        </button>
      `;

      card.querySelector('.btn-apply-direct').addEventListener('click', () => {
        document.getElementById('targetJobUrl').value = job.url || matcherCareersUrl.value.trim();
        document.getElementById('targetJobTitle').value = job.title;
        document.querySelector('[data-tab="tab-apply"]').click();
      });

      container.appendChild(card);
    });

    rolesResults.innerHTML = '';
    rolesResults.appendChild(container);
  }

  // ==================== 3. Multi-Resume Manager ====================
  const resumeDropzone = document.getElementById('resumeDropzone');
  const resumeFileInput = document.getElementById('resumeFileInput');
  const uploadStatusText = document.getElementById('uploadStatusText');
  const resumesListContainer = document.getElementById('resumesListContainer');
  const skillsContainer = document.getElementById('skillsContainer');
  const educationContainer = document.getElementById('educationContainer');
  const projectsContainer = document.getElementById('projectsContainer');

  resumeDropzone.addEventListener('click', (e) => {
    if (e.target !== resumeFileInput) {
      resumeFileInput.click();
    }
  });

  resumeDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    resumeDropzone.style.borderColor = 'var(--primary)';
    resumeDropzone.style.background = 'rgba(139, 92, 246, 0.12)';
  });

  resumeDropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    resumeDropzone.style.borderColor = 'rgba(139, 92, 246, 0.3)';
    resumeDropzone.style.background = 'rgba(139, 92, 246, 0.04)';
  });

  resumeDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    resumeDropzone.style.borderColor = 'rgba(139, 92, 246, 0.3)';
    resumeDropzone.style.background = 'rgba(139, 92, 246, 0.04)';
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleResumeUpload(e.dataTransfer.files[0]);
    }
  });

  resumeFileInput.addEventListener('change', () => {
    if (resumeFileInput.files && resumeFileInput.files.length > 0) {
      handleResumeUpload(resumeFileInput.files[0]);
    }
  });

  async function handleResumeUpload(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return alert('Please upload a PDF format resume');
    }

    uploadStatusText.className = 'file-status status-loading';
    uploadStatusText.innerHTML = '⏳ <strong>Parsing resume...</strong> Extracting skills, education, and links.';
    const formData = new FormData();
    formData.append('resume', file);

    try {
      const res = await fetch('/api/resume/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      if (data.isDuplicate) {
        uploadStatusText.className = 'file-status status-loading';
        uploadStatusText.innerHTML = `ℹ️ <strong>Already Uploaded:</strong> "${file.name}" is already saved. Switched to active.`;
      } else {
        uploadStatusText.className = 'file-status status-success';
        uploadStatusText.innerHTML = `✅ <strong>Resume parsed & saved:</strong> "${file.name}"`;
      }

      loadResumes();
      loadProfile();
    } catch (err) {
      uploadStatusText.className = 'file-status status-error';
      uploadStatusText.innerHTML = `❌ <strong>Upload error:</strong> ${escapeHtml(err.message)}`;
    }
  }

  async function loadResumes() {
    try {
      const res = await fetch('/api/resumes');
      const data = await res.json();
      renderResumesList(data.resumes || [], data.activeResumeId);
    } catch (e) {}
  }

  function renderResumesList(resumes, activeId) {
    if (!resumesListContainer) return;
    if (resumes.length === 0) {
      resumesListContainer.innerHTML = '<div class="empty-state" style="padding:1rem;">No resumes uploaded yet. Drop a PDF above.</div>';
      return;
    }

    resumesListContainer.innerHTML = resumes.map(r => {
      const isActive = r.id === activeId || r.isActive;
      return `
        <div class="resume-item-card ${isActive ? 'is-active' : ''}">
          <div>
            <div class="resume-item-name">
              <span>📄 ${escapeHtml(r.originalName || r.fileName)}</span>
              ${isActive ? '<span class="badge badge-success" style="font-size:0.7rem;">✓ Active Resume</span>' : ''}
            </div>
            <div class="resume-item-meta">
              Skills: ${(r.skills?.languages || []).slice(0, 4).join(', ') || 'Parsed'} • Uploaded: ${new Date(r.uploadedAt).toLocaleDateString()}
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:0.6rem;">
            ${!isActive ? `<button class="btn-secondary" onclick="activateResume('${r.id}')" style="padding:0.4rem 0.8rem; font-size:0.78rem;">Use This Resume</button>` : ''}
            <button class="btn-danger" onclick="deleteResume('${r.id}')" title="Delete Resume">🗑️</button>
          </div>
        </div>
      `;
    }).join('');
  }

  window.activateResume = async (id) => {
    try {
      const res = await fetch(`/api/resumes/${id}/activate`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        loadResumes();
        loadProfile();
      }
    } catch (e) {}
  };

  window.deleteResume = async (id) => {
    if (!confirm('Are you sure you want to delete this resume?')) return;
    try {
      await fetch(`/api/resumes/${id}`, { method: 'DELETE' });
      loadResumes();
      loadProfile();
    } catch (e) {}
  };

  function renderParsedProfile(profile) {
    const resume = profile.resume || {};

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

      const setPill = (id, val) => {
        const el = document.getElementById(id);
        if (el) {
          if (val && String(val).trim()) {
            el.textContent = val;
            el.style.color = '#a7f3d0';
          } else {
            el.textContent = '(Not detected in resume)';
            el.style.color = 'var(--text-muted)';
          }
        }
      };

      setPill('displayFullName', p.fullName);
      setPill('displayEmail', p.email);
      setPill('displayPhone', p.phone);
      setPill('displayLinkedin', p.linkedinUrl);
      setPill('displayGithub', p.githubUrl);
      setPill('displayPortfolio', p.portfolioUrl);

      if (document.getElementById('fullName')) document.getElementById('fullName').value = p.fullName || '';
      if (document.getElementById('email')) document.getElementById('email').value = p.email || '';
      if (document.getElementById('phone')) document.getElementById('phone').value = p.phone || '';
      if (document.getElementById('dateOfBirth')) document.getElementById('dateOfBirth').value = p.dateOfBirth || '';
      if (document.getElementById('gender')) document.getElementById('gender').value = p.gender || 'Prefer not to say';
      if (document.getElementById('currentCity')) document.getElementById('currentCity').value = p.currentCity || '';
      if (document.getElementById('linkedinUrl')) document.getElementById('linkedinUrl').value = p.linkedinUrl || '';
      if (document.getElementById('githubUrl')) document.getElementById('githubUrl').value = p.githubUrl || '';
      if (document.getElementById('portfolioUrl')) document.getElementById('portfolioUrl').value = p.portfolioUrl || '';

      if (document.getElementById('experienceLevel')) document.getElementById('experienceLevel').value = prefs.experienceLevel || 'Fresher (0-1 YOE)';
      if (document.getElementById('noticePeriodDays')) document.getElementById('noticePeriodDays').value = String(prefs.noticePeriodDays ?? 0);
      if (document.getElementById('requiresSponsorship')) document.getElementById('requiresSponsorship').value = String(prefs.requiresSponsorship ?? false);
      if (document.getElementById('willingToRelocate')) document.getElementById('willingToRelocate').value = String(prefs.willingToRelocate ?? true);
      if (document.getElementById('remotePreference')) document.getElementById('remotePreference').value = prefs.remotePreference || 'Flexible';
      if (document.getElementById('preferredRoles')) document.getElementById('preferredRoles').value = (prefs.preferredRoles || []).join(', ');

      const creds = profile.credentials || {};
      if (document.getElementById('credAccountEmail')) {
        document.getElementById('credAccountEmail').value = creds.accountEmail || p.email || 'shivamvishwa844@gmail.com';
      }
      if (document.getElementById('credDefaultPassword')) {
        document.getElementById('credDefaultPassword').value = creds.defaultPassword || '';
      }

      if (p.fullName) {
        quickName.textContent = p.fullName;
        avatarLetter.textContent = p.fullName.charAt(0).toUpperCase();
      }
      if (prefs.experienceLevel) {
        quickRole.textContent = prefs.experienceLevel;
      }

      renderParsedProfile(profile);
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
      credentials: {
        accountEmail: (document.getElementById('credAccountEmail') ? document.getElementById('credAccountEmail').value.trim() : '') || 'shivamvishwa844@gmail.com',
        defaultPassword: document.getElementById('credDefaultPassword') ? document.getElementById('credDefaultPassword').value : '',
        savePasswords: true
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

  // ==================== 5. Multi-API Key Failover Pool (Batch Support) ====================
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
      apiKeysList.innerHTML = '<div class="empty-state">No Gemini API keys in pool. Paste 1 or more keys above to enable AI question answering.</div>';
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
    const rawKeys = newApiKeyInput.value.trim();
    if (!rawKeys) return;

    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: rawKeys })
      });
      const data = await res.json();
      if (data.success) {
        newApiKeyInput.value = '';
        alert(`Successfully added ${data.countAdded || 1} API key(s) to the pool!`);
        renderApiKeys(data.keys);
      }
    } catch (err) {
      alert('Failed to add keys: ' + err.message);
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

  // ==================== Initialize Application on Load ====================
  loadProfile();
  loadResumes();
  loadApiKeys();
  startSessionPolling();
  discoverCompanies();
});
