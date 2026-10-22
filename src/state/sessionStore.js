/**
 * Decoupled State & Context Engine
 * Stores the user profile, application session state, and screener question history.
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
        return JSON.parse(raw);
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
      preferences: {
        preferredRoles: ['Software Engineer', 'Frontend Developer', 'Full Stack Developer'],
        experienceLevel: 'Fresher (0-1 YOE)',
        targetRoleType: 'Full-time', // Full-time, Internship, Contract
        workAuthorization: 'Authorized to work without sponsorship',
        requiresSponsorship: false,
        noticePeriodDays: 0, // 0 = Immediate joiner
        willingToRelocate: true,
        remotePreference: 'Flexible', // Remote, Hybrid, Onsite, Flexible
        expectedSalary: '',
        currentSalary: ''
      },
      resume: {
        fileName: '',
        filePath: '',
        rawText: '',
        summary: '',
        education: [],
        experience: [],
        projects: [],
        skills: {
          languages: [],
          frameworks: [],
          databases: [],
          tools: []
        },
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
      mode, // 'review' (ask confirmation before submit) or 'auto' (direct submit)
      atsType: 'detecting',
      currentStep: 1,
      totalStepsEstimated: 1,
      status: 'INITIALIZING', // INITIALIZING | NAVIGATING | EXTRACTING_FIELDS | FILLING | WAITING_FOR_REVIEW | SUBMITTING | COMPLETED | FAILED
      fieldsFilled: [],
      screenerAnswers: {},
      reviewData: null,
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

  addSessionLog(message, type = 'info') {
    if (!this.activeSession) return;
    const logEntry = {
      timestamp: new Date().toLocaleTimeString(),
      type, // 'info' | 'success' | 'warn' | 'error' | 'agent'
      message
    };
    this.activeSession.logs.push(logEntry);
    this.saveActiveSession();
  }

  saveActiveSession() {
    if (!this.activeSession) return;
    const sessionFile = path.join(SESSIONS_DIR, `${this.activeSession.id}.json`);
    try {
      fs.writeFileSync(sessionFile, JSON.stringify(this.activeSession, null, 2), 'utf-8');
    } catch (e) {}
  }
}

// Singleton
const sessionStore = new SessionStore();

module.exports = { sessionStore, SessionStore };
