/**
 * AI Job Agent - Express API Server & Web Controller
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const { apiPool } = require('./config/apiPool');
const { sessionStore } = require('./state/sessionStore');
const { resumeParser } = require('./parsers/resumeParser');
const { applicationOrchestrator } = require('./automation/applicationOrchestrator');
const { jobMatcher } = require('./ai/jobMatcher');
const { jobFinder } = require('./ai/jobFinder');
const { queryNormalizer } = require('./ai/queryNormalizer');
const { browserController } = require('./automation/browser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/screenshots', express.static(path.join(__dirname, '../screenshots')));

// Configure Multer for resume uploads
const uploadDir = path.join(__dirname, '../data/resumes');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `resume_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '')}`)
});
const upload = multer({ storage });

// ==================== Profile & Multi-Resume Endpoints ====================

app.get('/api/profile', (req, res) => {
  res.json(sessionStore.getProfile());
});

app.post('/api/profile', (req, res) => {
  const updated = sessionStore.saveProfile(req.body);
  res.json({ success: true, profile: updated });
});

app.get('/api/resumes', (req, res) => {
  const profile = sessionStore.getProfile();
  res.json({
    resumes: profile.resumes || [],
    activeResumeId: profile.activeResumeId
  });
});

app.post('/api/resumes/:id/activate', (req, res) => {
  const updated = sessionStore.setActiveResume(req.params.id);
  if (!updated) return res.status(404).json({ error: 'Resume not found' });
  res.json({ success: true, activeResume: updated, profile: sessionStore.getProfile() });
});

app.delete('/api/resumes/:id', (req, res) => {
  const success = sessionStore.deleteResume(req.params.id);
  res.json({ success, profile: sessionStore.getProfile() });
});

app.post('/api/resume/upload', upload.single('resume'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No resume PDF uploaded' });
  }

  try {
    const filePath = req.file.path;
    const parsed = await resumeParser.parsePdf(filePath);

    // Add resume to multi-resume store with duplicate check
    const addResult = sessionStore.addResume({
      originalName: req.file.originalname,
      fileName: req.file.filename,
      filePath,
      rawText: parsed.rawText,
      summary: parsed.summary,
      education: parsed.education,
      experience: parsed.experience,
      projects: parsed.projects,
      skills: parsed.skills,
      certifications: parsed.certifications
    });

    // Also update personal contact data in profile
    const currentProfile = sessionStore.getProfile();
    const updatedPersonal = {
      ...currentProfile.personal,
      fullName: parsed.personal?.fullName || currentProfile.personal.fullName,
      firstName: parsed.personal?.firstName || currentProfile.personal.firstName,
      lastName: parsed.personal?.lastName || currentProfile.personal.lastName,
      email: parsed.personal?.email || currentProfile.personal.email,
      phone: parsed.personal?.phone || currentProfile.personal.phone,
      linkedinUrl: parsed.personal?.linkedinUrl || currentProfile.personal.linkedinUrl,
      githubUrl: parsed.personal?.githubUrl || currentProfile.personal.githubUrl,
      portfolioUrl: parsed.personal?.portfolioUrl || currentProfile.personal.portfolioUrl,
      currentCity: parsed.personal?.currentCity || currentProfile.personal.currentCity
    };

    sessionStore.saveProfile({ personal: updatedPersonal });

    res.json({
      success: true,
      isDuplicate: addResult.isDuplicate,
      message: addResult.isDuplicate 
        ? `"${req.file.originalname}" was already uploaded. Set as current active resume.` 
        : `"${req.file.originalname}" uploaded and parsed successfully.`,
      profile: sessionStore.getProfile()
    });
  } catch (err) {
    console.error('[Server] Resume parse error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== API Key Pool Endpoints ====================

app.get('/api/keys', (req, res) => {
  res.json({
    keys: apiPool.getStatus(),
    activeCount: apiPool.keys.length
  });
});

app.post('/api/keys', (req, res) => {
  const { key, keys } = req.body;
  const input = keys || key;
  if (!input) return res.status(400).json({ error: 'At least one API key is required' });

  // Supports single key or batch pasting
  const added = apiPool.addBatchKeys(input);
  res.json({ success: true, countAdded: added.length, keys: apiPool.getStatus() });
});

app.delete('/api/keys/:id', (req, res) => {
  apiPool.removeKey(req.params.id);
  res.json({ success: true, keys: apiPool.getStatus() });
});

// ==================== Application Session Endpoints ====================

app.get('/api/session/active', (req, res) => {
  const session = sessionStore.getActiveSession();
  res.json(session || {
    status: 'IDLE',
    currentAction: 'Agent Ready',
    currentActionDetail: 'Enter a job or career portal URL and click "Launch Application Agent" to start.',
    pipelineStep: 1,
    logs: []
  });
});

app.post('/api/apply/start', async (req, res) => {
  const { jobUrl, companyName, jobTitle, mode } = req.body;
  if (!jobUrl) return res.status(400).json({ error: 'Job URL is required' });

  // Start execution in background so client gets instant response
  applicationOrchestrator.runApplication(
    jobUrl,
    companyName || '',
    jobTitle || '',
    mode || 'review'
  ).catch(err => {
    console.error('[Server] Background application failed:', err.message);
  });

  res.json({ success: true, message: 'Application process launched' });
});

app.post('/api/session/approve', (req, res) => {
  const approved = applicationOrchestrator.approveSubmission();
  res.json({ success: approved, message: approved ? 'Approved for final submission' : 'No pending review found' });
});

app.post('/api/session/resume-auth', (req, res) => {
  const resumed = applicationOrchestrator.resumeAuth();
  res.json({ success: resumed, message: resumed ? 'Resumed application execution' : 'Not waiting for authentication' });
});

app.post('/api/session/provide-auth-credentials', (req, res) => {
  const { email, password, action, rememberPassword } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  const handled = applicationOrchestrator.provideAuthCredentials({
    email,
    password,
    action: action || 'CREATE_ACCOUNT',
    rememberPassword: rememberPassword !== false
  });

  res.json({
    success: handled,
    message: handled ? 'Credentials submitted to active session' : 'Session not currently waiting for credentials'
  });
});

app.get('/api/credentials', (req, res) => {
  res.json(sessionStore.getCredentials());
});

app.post('/api/credentials', (req, res) => {
  const { accountEmail, defaultPassword, savePasswords } = req.body;
  const updated = sessionStore.saveCredentials({ accountEmail, defaultPassword, savePasswords });
  res.json({ success: true, credentials: updated });
});

// ==================== Autonomous Role Discovery Endpoints ====================

/**
 * Autonomous Job Radar: Discovers top recruiting companies in India for candidate role
 */
app.post('/api/jobs/discover', async (req, res) => {
  const { targetRole, location } = req.body;
  const profile = sessionStore.getProfile();
  const rawRole = targetRole || profile.preferences?.preferredRoles?.[0] || 'Software Engineer';
  const roleMeta = queryNormalizer.normalizeQuery(rawRole);
  const loc = location || profile.personal?.currentCity || 'India';
  const skills = [
    ...(profile.resume?.skills?.languages || []),
    ...(profile.resume?.skills?.tools || [])
  ];

  try {
    const companies = await jobFinder.discoverHiringPortals(roleMeta.corrected, loc, skills);
    res.json({
      success: true,
      queryUsed: roleMeta.corrected,
      hasTypoCorrection: roleMeta.hasCorrection,
      originalQuery: roleMeta.original,
      expandedRoles: queryNormalizer.getExpandedRoles(roleMeta.corrected),
      companies
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Deep scan of a specific company career portal URL
 */
app.post('/api/jobs/search-roles', async (req, res) => {
  const { careersUrl, rolePreference } = req.body;
  if (!careersUrl) return res.status(400).json({ error: 'Careers URL is required' });

  try {
    const profile = sessionStore.getProfile();
    const rawQuery = rolePreference || profile.preferences?.preferredRoles?.[0] || 'Software Engineer';
    const queryMeta = queryNormalizer.normalizeQuery(rawQuery);

    // Real interactive browser crawl of the company career page using corrected query
    const scrapedJobs = await browserController.scanCareerPortal(careersUrl, queryMeta.corrected);

    // Real match scoring using candidate's actual resume skills & semantic role taxonomy
    const scoredJobs = jobMatcher.matchRolesFromPage(
      scrapedJobs,
      { ...(profile.preferences || {}), preferredRoles: [queryMeta.corrected] },
      profile.resume?.skills || {}
    );

    res.json({
      success: true,
      count: scoredJobs.length,
      queryUsed: queryMeta.corrected,
      hasTypoCorrection: queryMeta.hasCorrection,
      originalQuery: queryMeta.original,
      expandedRoles: queryNormalizer.getExpandedRoles(queryMeta.corrected),
      jobs: scoredJobs
    });
  } catch (err) {
    console.error('[Server] Job scan error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 AI Job Search & Auto-Application Agent is running!`);
  console.log(`📍 Web Dashboard: http://localhost:${PORT}`);
  console.log(`🔑 Configured API Keys: ${apiPool.keys.length}`);
  console.log(`======================================================\n`);
});
