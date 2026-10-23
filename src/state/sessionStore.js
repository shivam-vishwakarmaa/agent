/**
 * Decoupled State & Context Engine
 * Stores the user profile, multiple resumes, application session state, and screener question history.
 * Ensures 100% context continuity across multi-step forms and API key failovers.
 */

const fs = require('fs');
const path = require('path');

const PROFILE_FILE = path.join(__dirname, '../../data/profile.json');
const SESSIONS_DIR = path.join(__dirname, '../../data/sessions');

class SessionStore {
  constructor() {
    this.ensureDirs();
    this.profile = this.loadProfile();
    this.activeSession = null;
    this.globalAnswerHistory = this.loadAnswerHistory();
  }

  ensureDirs() {
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  /**
   * Load or initialize the user profile
   */
  loadProfile() {
    try {
      if (fs.existsSync(PROFILE_FILE)) {
        const raw = fs.readFileSync(PROFILE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed.resumes) parsed.resumes = [];
        if (!parsed.credentials) {
          parsed.credentials = {
            accountEmail: parsed.personal?.email || 'shivamvishwa844@gmail.com',
            defaultPassword: '',
            savePasswords: true
          };
        }
        if (parsed.resume && parsed.resume.fileName && !parsed.resumes.some(r => r.fileName === parsed.resume.fileName)) {
          parsed.resumes.push({
            id: `res_${Date.now()}`,
            ...parsed.resume,
            uploadedAt: new Date().toISOString(),
            isActive: true
          });
          parsed.activeResumeId = parsed.resumes[0].id;
        }
        return parsed;
      }
    } catch (err) {
      console.error('[SessionStore] Error reading profile.json:', err.message);
    }

    // Default structure
    const defaultProfile = {
      personal: {
        fullName: '',
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        dateOfBirth: '', // YYYY-MM-DD
        gender: 'Prefer not to say',
        currentCity: '',
        state: '',
        country: 'India',
        postalCode: '',
        addressLine: '',
        linkedinUrl: '',
        githubUrl: '',
        portfolioUrl: ''
      },
      credentials: {
        accountEmail: 'shivamvishwa844@gmail.com',
        defaultPassword: '',
        savePasswords: true
      },
      preferences: {
        preferredRoles: ['Software Engineer', 'Frontend Developer', 'Full Stack Developer'],
        experienceLevel: 'Fresher (0-1 YOE)',
        targetRoleType: 'Full-time',
        workAuthorization: 'Authorized to work without sponsorship',
        requiresSponsorship: false,
        noticePeriodDays: 0,
        willingToRelocate: true,
        remotePreference: 'Flexible',
        expectedSalary: '',
        currentSalary: ''
      },
      resumes: [],
      activeResumeId: null,
      resume: {
        fileName: '',
        filePath: '',
        rawText: '',
        summary: '',
        education: [],
        experience: [],
        projects: [],
        skills: { languages: [], frameworks: [], databases: [], tools: [] },
        certifications: []
      },
      screenerDefaults: {
        whyHireMe: '',
        strengths: '',
        weaknesses: '',
        noticePeriodAnswer: 'Available immediately as a fresher graduate.',
        sponsorshipAnswer: 'I am legally authorized to work and do not require visa sponsorship.'
      },
      updatedAt: new Date().toISOString()
    };

    this.saveProfile(defaultProfile);
    return defaultProfile;
  }

  saveProfile(updatedProfile) {
    this.profile = { ...this.profile, ...updatedProfile, updatedAt: new Date().toISOString() };
    fs.writeFileSync(PROFILE_FILE, JSON.stringify(this.profile, null, 2), 'utf-8');
    return this.profile;
  }

  getProfile() {
    return this.profile;
  }

  getCredentials() {
    return this.profile.credentials || {
      accountEmail: this.profile.personal?.email || 'shivamvishwa844@gmail.com',
      defaultPassword: '',
      savePasswords: true
    };
  }

  saveCredentials({ accountEmail, defaultPassword, savePasswords }) {
    if (!this.profile.credentials) this.profile.credentials = {};
    if (accountEmail !== undefined) this.profile.credentials.accountEmail = accountEmail;
    if (defaultPassword !== undefined) this.profile.credentials.defaultPassword = defaultPassword;
    if (savePasswords !== undefined) this.profile.credentials.savePasswords = Boolean(savePasswords);
    if (accountEmail && this.profile.personal) {
      this.profile.personal.email = accountEmail;
    }
    this.saveProfile(this.profile);
    return this.profile.credentials;
  }

  /**
   * Multi-Resume Management
   */
  addResume(resumeData) {
    if (!this.profile.resumes) this.profile.resumes = [];

    // Check duplicate by original name or file path
    const isDuplicate = this.profile.resumes.find(r => 
      r.originalName === resumeData.originalName ||
      (r.rawText && resumeData.rawText && r.rawText.trim() === resumeData.rawText.trim())
    );

    if (isDuplicate) {
      // Set existing as active
      this.setActiveResume(isDuplicate.id);
      return { isDuplicate: true, resume: isDuplicate };
    }

    const newResume = {
      id: `resume_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      originalName: resumeData.originalName || resumeData.fileName,
      fileName: resumeData.fileName,
      filePath: resumeData.filePath,
      rawText: resumeData.rawText,
      summary: resumeData.summary,
      education: resumeData.education || [],
      experience: resumeData.experience || [],
      projects: resumeData.projects || [],
      skills: resumeData.skills || { languages: [], frameworks: [], databases: [], tools: [] },
      certifications: resumeData.certifications || [],
      uploadedAt: new Date().toISOString(),
      isActive: true
    };

    // Deactivate previous active resumes
    this.profile.resumes.forEach(r => r.isActive = false);
    this.profile.resumes.push(newResume);
    this.profile.activeResumeId = newResume.id;
    this.profile.resume = newResume;

    this.saveProfile(this.profile);
    return { isDuplicate: false, resume: newResume };
  }

  setActiveResume(resumeId) {
    if (!this.profile.resumes) return null;
    const target = this.profile.resumes.find(r => r.id === resumeId);
    if (!target) return null;

    this.profile.resumes.forEach(r => r.isActive = (r.id === resumeId));
    this.profile.activeResumeId = resumeId;
    this.profile.resume = target;

    this.saveProfile(this.profile);
    return target;
  }

  deleteResume(resumeId) {
    if (!this.profile.resumes) return false;
    const idx = this.profile.resumes.findIndex(r => r.id === resumeId);
    if (idx === -1) return false;

    const removed = this.profile.resumes.splice(idx, 1)[0];
    if (removed && removed.filePath && fs.existsSync(removed.filePath)) {
      try { fs.unlinkSync(removed.filePath); } catch (e) {}
    }

    if (this.profile.activeResumeId === resumeId) {
      if (this.profile.resumes.length > 0) {
        this.profile.resumes[0].isActive = true;
        this.profile.activeResumeId = this.profile.resumes[0].id;
        this.profile.resume = this.profile.resumes[0];
      } else {
        this.profile.activeResumeId = null;
        this.profile.resume = {};
      }
    }

    this.saveProfile(this.profile);
    return true;
  }

  /**
   * Global answers history to prevent inconsistent answers across forms
   */
  loadAnswerHistory() {
    const historyFile = path.join(__dirname, '../../data/answer_history.json');
    try {
      if (fs.existsSync(historyFile)) {
        return JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
      }
    } catch (e) {}
    return {};
  }

  saveAnswerHistory(qText, aText) {
    if (!qText || !aText) return;
    const normalizedKey = qText.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 80);
    this.globalAnswerHistory[normalizedKey] = {
      question: qText.trim(),
      answer: aText.trim(),
      timestamp: new Date().toISOString()
    };
    try {
      const historyFile = path.join(__dirname, '../../data/answer_history.json');
      fs.writeFileSync(historyFile, JSON.stringify(this.globalAnswerHistory, null, 2));
    } catch (e) {}
  }

  getExistingAnswer(qText) {
    if (!qText) return null;
    const normalizedKey = qText.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 80);
    return this.globalAnswerHistory[normalizedKey]?.answer || null;
  }

  /**
   * Active application session management
   */
  createSession({ companyName, jobTitle, jobUrl, mode = 'review' }) {
    const sessionId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.activeSession = {
      id: sessionId,
      companyName: companyName || 'Target Company',
      jobTitle: jobTitle || 'Target Role',
      jobUrl,
      mode,
      atsType: 'detecting',
      currentStep: 1,
      totalStepsEstimated: 1,
      pipelineStep: 1,
      currentAction: 'Agent Idle',
      currentActionDetail: 'Ready for target career URL',
      status: 'INITIALIZING',
      fieldsFilled: [],
      screenerAnswers: {},
      reviewData: null,
      errorDetails: null,
      logs: [],
      screenshots: [],
      confirmationReceipt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.saveActiveSession();
    return this.activeSession;
  }

  getActiveSession() {
    return this.activeSession;
  }

  updateSession(updates) {
    if (!this.activeSession) return null;
    this.activeSession = {
      ...this.activeSession,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    this.saveActiveSession();
    return this.activeSession;
  }

  setCurrentAction(action, detail = '', pipelineStep = null) {
    if (!this.activeSession) return;
    this.activeSession.currentAction = action;
    if (detail) this.activeSession.currentActionDetail = detail;
    if (pipelineStep) this.activeSession.pipelineStep = pipelineStep;
    this.activeSession.updatedAt = new Date().toISOString();
    this.saveActiveSession();
  }

  setErrorDetails(errorObj) {
    if (!this.activeSession) return;
    this.activeSession.errorDetails = errorObj;
    this.activeSession.status = 'FAILED';
    this.activeSession.updatedAt = new Date().toISOString();
    this.saveActiveSession();
  }

  addSessionLog(message, type = 'info', actionTag = null, detail = null) {
    if (!this.activeSession) return;
    const tag = actionTag || this.inferActionTag(message, type);
    const logEntry = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
      actionTag: tag,
      detail: detail || ''
    };
    this.activeSession.logs.push(logEntry);
    this.saveActiveSession();
  }

  inferActionTag(msg, type) {
    const m = (msg || '').toLowerCase();
    if (type === 'error' || m.includes('error') || m.includes('fail')) return 'ERROR';
    if (type === 'warn' || m.includes('warn') || m.includes('captcha')) return 'ALERT';
    if (m.includes('navigat') || m.includes('page') || m.includes('url')) return 'NAVIGATE';
    if (m.includes('platform') || m.includes('ats') || m.includes('detect') || m.includes('analyz') || m.includes('inspect')) return 'SCAN';
    if (m.includes('ai') || m.includes('screener') || m.includes('gemini') || m.includes('reason') || m.includes('answer')) return 'AI_THINK';
    if (m.includes('fill') || m.includes('input') || m.includes('select')) return 'AUTOFILL';
    if (m.includes('resume') || m.includes('upload') || m.includes('attach') || m.includes('file')) return 'ATTACH';
    if (m.includes('screenshot') || m.includes('snapshot')) return 'SNAPSHOT';
    if (m.includes('review') || m.includes('verif') || m.includes('approv') || m.includes('paused')) return 'VERIFY';
    if (m.includes('submit')) return 'SUBMIT';
    if (type === 'success' || m.includes('success')) return 'SUCCESS';
    return 'INFO';
  }

  saveActiveSession() {
    if (!this.activeSession) return;
    const sessionFile = path.join(SESSIONS_DIR, `${this.activeSession.id}.json`);
    try {
      fs.writeFileSync(sessionFile, JSON.stringify(this.activeSession, null, 2), 'utf-8');
    } catch (e) {}
  }
}

const sessionStore = new SessionStore();
module.exports = { sessionStore, SessionStore };
