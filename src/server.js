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

// ==================== Profile Endpoints ====================

app.get('/api/profile', (req, res) => {
  res.json(sessionStore.getProfile());
});

app.post('/api/profile', (req, res) => {
  const updated = sessionStore.saveProfile(req.body);
  res.json({ success: true, profile: updated });
});

app.post('/api/resume/upload', upload.single('resume'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No resume PDF uploaded' });
  }

  try {
    const filePath = req.file.path;
    const parsed = await resumeParser.parsePdf(filePath);

    const currentProfile = sessionStore.getProfile();
    const updatedProfile = {
      ...currentProfile,
      personal: {
        ...currentProfile.personal,
        fullName: parsed.personal?.fullName || currentProfile.personal.fullName,
        firstName: parsed.personal?.firstName || currentProfile.personal.firstName,
        lastName: parsed.personal?.lastName || currentProfile.personal.lastName,
        email: parsed.personal?.email || currentProfile.personal.email,
        phone: parsed.personal?.phone || currentProfile.personal.phone,
        linkedinUrl: parsed.personal?.linkedinUrl || currentProfile.personal.linkedinUrl,
        githubUrl: parsed.personal?.githubUrl || currentProfile.personal.githubUrl,
        portfolioUrl: parsed.personal?.portfolioUrl || currentProfile.personal.portfolioUrl
      },
      resume: {
        fileName: req.file.originalname,
        filePath,
        rawText: parsed.rawText,
        summary: parsed.summary,
        education: parsed.education,
        experience: parsed.experience,
        projects: parsed.projects,
        skills: parsed.skills,
        certifications: parsed.certifications
      }
    };

    sessionStore.saveProfile(updatedProfile);
    res.json({ success: true, profile: updatedProfile });
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
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'API key is required' });
  apiPool.addKey(key);
  res.json({ success: true, keys: apiPool.getStatus() });
});

app.delete('/api/keys/:id', (req, res) => {
  apiPool.removeKey(req.params.id);
  res.json({ success: true, keys: apiPool.getStatus() });
});

// ==================== Application Session Endpoints ====================

app.get('/api/session/active', (req, res) => {
  const session = sessionStore.getActiveSession();
  res.json(session || { status: 'IDLE', logs: [] });
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

// ==================== Role Discovery Endpoint ====================

app.post('/api/jobs/search-roles', async (req, res) => {
  const { careersUrl, rolePreference } = req.body;
  if (!careersUrl) return res.status(400).json({ error: 'Careers URL is required' });

  try {
    await browserController.navigateTo(careersUrl);
    const minified = await browserController.extractMinifiedForm();
    const profile = sessionStore.getProfile();

    const jobs = await jobMatcher.extractOpenRolesFromHtml(
      careersUrl,
      minified.pageTextSnippet,
      rolePreference || profile.preferences.preferredRoles[0]
    );

    const scoredJobs = await jobMatcher.matchRolesFromPage(jobs, profile.preferences);
    res.json({ success: true, jobs: scoredJobs });
  } catch (err) {
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
