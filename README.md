# NexusApply AI 🚀
### Autonomous Job Search & Auto-Application Agent with Multi-API Key Failover

NexusApply AI is an intelligent, token-minimized job application assistant engineered to solve the most painful limitations of existing job bots:
- **Zero API Downtime (Multi-Key Pool)**: Rotates across multiple free Google Gemini API keys with automatic failover upon HTTP 429 rate limits.
- **Persistent Decoupled Context**: Session context, candidate knowledge base, and answer history live in an independent local state store so no progress or context is ever lost during key rotation or multi-step forms.
- **Multilingual & Complex Form Handling (e.g. Rakuten, Workday)**: Auto-translates foreign-language questionnaires (such as Japanese 志望動機 / 職歴) and generates culturally nuanced, strictly grounded responses.
- **Anti-Hallucination Grounding**: Form answers are strictly anchored to facts extracted from your uploaded resume and preset preferences.
- **Dual Execution Modes**:
  - 🛡️ **Review & Verify Mode (Default)**: Fills everything, navigates to the final submission screen, and presents a complete verification report with filled answers and a live screenshot for one-click manual approval.
  - ⚡ **Full Auto-Pilot Mode**: Hands-off end-to-end execution that completes and submits applications automatically.
- **Token Minification**: Strips heavy HTML/CSS down to raw interactive inputs (~500 tokens per form step instead of 50,000+ tokens).
- **Stealth Browser Automation**: Playwright-powered Chromium instance with human-like interactions, native resume file uploading, and dynamic React/Vue/Workday combobox dropdown support.

---

## 🛠️ Tech Stack & Architecture

- **Runtime**: Node.js (v18+)
- **Browser Engine**: Playwright (Chromium with stealth overrides)
- **AI Engine**: Google Gemini API via Multi-API Key Pool (`@google/genai`)
- **Document Parsing**: `pdf-parse` (high-accuracy text & structure extraction)
- **Server**: Express.js REST API & static dashboard controller
- **UI Dashboard**: Modern Glassmorphic Web Dashboard (Vanilla CSS & Vanilla JS, no build step required)

---

## 📦 Quick Start

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/shivam-vishwakarmaa/agent.git
cd agent
npm install
npx playwright install chromium
```

### 2. Configure Environment (Optional)
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
You can configure your free Google Gemini API keys in `.env` (comma-separated):
```env
GEMINI_API_KEYS=AIzaSyA123...,AIzaSyB456...
PORT=3000
HEADLESS=false
```
*(Note: You can also add or manage API keys directly from the Web Dashboard UI at any time!)*

### 3. Launch the Agent Dashboard
```bash
npm start
```
Open your browser and navigate to:
```
http://localhost:3000
```

---

## 📋 How to Use

1. **Upload Resume**:
   - Go to the **Resume & Knowledge** tab and drag & drop your resume PDF.
   - The agent automatically parses your education, skills, projects, and contact info into a structured knowledge base.
2. **Review Personal Fallbacks**:
   - In the **Profile & Fallbacks** tab, verify or set your Date of Birth, Notice Period (e.g. Immediate), Work Authorization, and Experience Level (e.g. "Fresher").
3. **Add Gemini Keys**:
   - In the **API Key Failover Pool** tab, paste 1 or more free Gemini API keys from [Google AI Studio](https://aistudio.google.com/app/apikey).
4. **Run Application**:
   - In the **Target Application** console, paste any company job posting URL (e.g., Rakuten, Greenhouse, Lever, Workday).
   - Select your mode:
     - **Review & Verify**: Inspect all filled answers & screenshot on the final step before approving submission.
     - **Full Auto-Pilot**: Direct submission.
   - Click **Launch Application Agent** and watch the live execution in real time!
5. **Discover Fresher Roles**:
   - Use the **Fresher Role Matcher** tab to paste a company's general career portal URL and discover ranked entry-level/fresher roles.

---

## 🔒 Privacy & Local Storage
- Resumes and session logs are saved locally in the `data/` directory.
- No resume data or API credentials are sent to third parties other than the Google Gemini API endpoints for question answering.
