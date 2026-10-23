/**
 * Application Orchestrator & Dual-Mode Controller
 * Coordinates page navigation, career portal crawling, ATS detection,
 * Workday / ATS authentication gates, multi-step wizards, and user review verification.
 */

const { browserController } = require('./browser');
const { detectAts } = require('./atsDetector');
const { formFiller } = require('./formFiller');
const { sessionStore } = require('../state/sessionStore');
const { jobMatcher } = require('../ai/jobMatcher');
const { queryNormalizer } = require('../ai/queryNormalizer');

class ApplicationOrchestrator {
  constructor() {
    this.isPausedForReview = false;
    this.reviewPromiseResolve = null;
    this.isPausedForAuth = false;
    this.authPromiseResolve = null;
  }

  /**
   * Start executing application for a target URL
   */
  async runApplication(jobUrl, companyName = '', jobTitle = '', mode = 'review') {
    const session = sessionStore.createSession({
      companyName,
      jobTitle,
      jobUrl,
      mode
    });

    sessionStore.addSessionLog(`Starting application process for ${companyName || 'Target Company'}...`, 'info', 'NAVIGATE');
    sessionStore.setCurrentAction('Navigating to Career Portal', `Connecting to ${jobUrl}...`, 1);
    sessionStore.updateSession({ status: 'NAVIGATING' });

    try {
      // 1. Navigate to URL
      let page = await browserController.navigateTo(jobUrl);
      let currentUrl = (page && typeof page.url === 'function') ? page.url() : jobUrl;
      sessionStore.addSessionLog(`Successfully navigated to portal: ${currentUrl}`, 'success', 'NAVIGATE');
      sessionStore.setCurrentAction('Inspecting Page & Platform', `Page loaded: ${currentUrl.slice(0, 60)}...`, 1);

      // 2. Multi-Step Wizard & Application Flow Loop
      let step = 1;
      const maxSteps = 8;
      let hasCompleted = false;

      while (step <= maxSteps && !hasCompleted) {
        currentUrl = (page && typeof page.url === 'function') ? page.url() : jobUrl;
        const pageTitle = (page && typeof page.title === 'function') ? await page.title() : '';
        const ats = detectAts(currentUrl, pageTitle);
        sessionStore.updateSession({ atsType: ats.name, currentStep: step, status: 'ANALYZING' });

        // Check for CAPTCHA
        const isCaptcha = await browserController.checkForCaptcha();
        if (isCaptcha) {
          sessionStore.updateSession({ status: 'CAPTCHA_PAUSE' });
          sessionStore.setCurrentAction('CAPTCHA / Challenge Detected', 'Waiting for human verification in browser window...', 2);
          sessionStore.addSessionLog('⚠️ CAPTCHA / Cloudflare detected! Please solve it in the browser window. Waiting...', 'warn', 'ALERT');
          await this.waitForCaptchaResolution(page);
          sessionStore.addSessionLog('CAPTCHA resolved! Continuing auto-fill...', 'success', 'SUCCESS');
        }

        // Accept Cookies on ATS / Portal if present
        const cookieBtn = page.locator('[data-automation-id="legalNoticeAcceptButton"], button:has-text("Accept Cookies"), button:has-text("Accept All"), button:has-text("I Agree")').first();
        if (await cookieBtn.count() > 0 && await cookieBtn.isVisible().catch(() => false)) {
          sessionStore.addSessionLog('Accepted portal cookie policy.', 'info', 'INFO');
          await cookieBtn.click().catch(() => {});
          await page.waitForTimeout(1000);
        }

        // Wait for dynamic React / Workday hydration
        await page.waitForTimeout(2500);

        // Extract minified form fields
        let minified = await browserController.extractMinifiedForm();

        // Check if page has actual candidate profile fields (Name, Email, Phone, Resume, etc.)
        const candidateKeywords = ['name', 'first', 'last', 'email', 'phone', 'mobile', 'resume', 'cv', 'address', 'education', 'experience', 'github', 'linkedin'];
        const hasCandidateFields = minified.fields.some(f => {
          const l = (f.label || f.name || f.placeholder || '').toLowerCase();
          return candidateKeywords.some(kw => l.includes(kw));
        });

        // ==================== SMART CHECK 1: Search Directory Crawling & Fresher Matching ====================
        const isDirectory = currentUrl.includes('/search-jobs') ||
                            currentUrl.includes('/jobs?') ||
                            (await page.locator('a[href*="/job/"]').count() > 2);

        if (!hasCandidateFields && isDirectory && step === 1) {
          sessionStore.setCurrentAction('Crawling Career Portal Vacancies', 'Scanning job openings on directory for fresher roles...', 1);
          sessionStore.addSessionLog(`Detected career portal directory: "${currentUrl}". Crawling openings...`, 'info', 'SCAN');

          const profile = sessionStore.getProfile();
          const targetRole = jobTitle || profile.preferences?.preferredRoles?.[0] || 'Software Engineer';
          const scrapedJobs = await browserController.scanCareerPortal(currentUrl, targetRole);

          if (scrapedJobs.length > 0) {
            // Match against Shivam's profile preferences & resume skills
            const scored = jobMatcher.matchRolesFromPage(scrapedJobs, profile.preferences, profile.resume?.skills || {});
            const eligibleJobs = scored.filter(j => j.isEligible && j.isFresherFriendly);

            const selectedJob = eligibleJobs.length > 0 ? eligibleJobs[0] : scored[0];
            sessionStore.addSessionLog(`Scraped ${scrapedJobs.length} openings. Filtered out senior/lead positions.`, 'info', 'SCAN');
            sessionStore.addSessionLog(`Selected Top Opening: "${selectedJob.title}" (${selectedJob.matchScore}% Match). Navigating...`, 'success', 'NAVIGATE');
            sessionStore.setCurrentAction('Opening Best Matched Vacancy', `Opening "${selectedJob.title}" (${selectedJob.matchScore}% Match)...`, 1);

            await page.goto(selectedJob.url, { waitUntil: 'domcontentloaded', timeout: 40000 });
            await page.waitForTimeout(4000);
            continue;
          }
        }

        // ==================== SMART CHECK 2: Job Overview Page "Apply" Launch ====================
        const applyBtn = page.locator('a:has-text("Apply"), button:has-text("Apply"), [data-automation-id*="apply" i], a[href*="/apply" i]').first();
        if (!hasCandidateFields && await applyBtn.count() > 0 && await applyBtn.isVisible().catch(() => false)) {
          const btnText = (await applyBtn.innerText()).trim() || 'Apply';
          sessionStore.setCurrentAction('Launching Job Application Form', `Clicking "${btnText}" to enter ATS application...`, 2);
          sessionStore.addSessionLog(`Found "${btnText}" button on job overview page. Launching application form...`, 'info', 'NAVIGATE');

          const context = page.context();
          const [newPage] = await Promise.all([
            context.waitForEvent('page', { timeout: 6000 }).catch(() => null),
            applyBtn.click()
          ]);

          if (newPage) {
            page = newPage;
            browserController.page = newPage;
            await page.waitForLoadState('domcontentloaded');
          }

          // Allow Single Page Apps (Workday/Lever/Greenhouse) to load and hydrate
          await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
          await page.waitForTimeout(4000);
          continue;
        }

        // ==================== SMART CHECK 3: ATS / Workday Account Creation & Sign-In Gateway ====================
        const isAuthGate = await this.detectAuthGate(page);
        if (isAuthGate) {
          const profile = sessionStore.getProfile();
          sessionStore.addSessionLog('ATS Account Gateway detected (Sign In / Create Account required).', 'warn', 'ALERT');
          sessionStore.setCurrentAction('Workday Account Gateway: Authenticating', 'Handling account registration / sign-in...', 2);

          const authRes = await this.handleAccountGate(page, profile);
          if (authRes.requiresUserAction) {
            sessionStore.updateSession({ status: 'WAITING_FOR_AUTH' });
            sessionStore.setCurrentAction('🛑 Sign-In / Verification Required', 'Please complete sign-in or verify code in browser window.', 2);
            sessionStore.addSessionLog('🛑 AUTHENTICATION REQUIRED: Workday requires verification code or sign-in. Please solve in browser, then click "Continue".', 'warn', 'ALERT');
            await this.waitForAuthResolution(page);
            sessionStore.addSessionLog('Authentication verified! Continuing to application form...', 'success', 'SUCCESS');
          }

          await page.waitForTimeout(4000);
          continue;
        }

        // Re-extract minified form fields after navigation/auth
        minified = await browserController.extractMinifiedForm();

        // If page has no fields and no buttons, wait briefly for late hydration
        if (minified.fields.length === 0 && minified.buttons.length === 0) {
          sessionStore.addSessionLog('Waiting for application form elements to hydrate...', 'info', 'SCAN');
          await page.waitForTimeout(3500);
          minified = await browserController.extractMinifiedForm();
        }

        // ==================== APPLICATION FORM FILLING ====================
        if (minified.fields.length > 0) {
          sessionStore.updateSession({ status: 'FILLING' });
          sessionStore.setCurrentAction('Autofilling Application Form', `Populating candidate details & AI screener answers (Step ${step})...`, 3);
          const profile = sessionStore.getProfile();
          const filled = await formFiller.fillPageFields(page, minified, profile, {
            companyName: session.companyName,
            jobTitle: session.jobTitle
          });

          sessionStore.updateSession({
            fieldsFilled: [...session.fieldsFilled, ...filled]
          });
          sessionStore.addSessionLog(`Filled ${filled.length} fields on Step ${step}.`, 'success', 'AUTOFILL');
        }

        // Take a screenshot of current step
        sessionStore.setCurrentAction('Capturing Proof Screenshot', `Saving step ${step} preview for review...`, 3);
        const screenshot = await browserController.captureScreenshot(`step_${step}`);
        if (screenshot) {
          session.screenshots.push(screenshot.filename);
          sessionStore.addSessionLog(`Captured step ${step} proof snapshot: ${screenshot.filename}`, 'info', 'SNAPSHOT');
        }

        // Check buttons: Is it ready for Submit or Next?
        const submitBtn = minified.buttons.find(b => b.actionType === 'submit');
        const nextBtn = minified.buttons.find(b => b.actionType === 'next');
        const reviewBtn = minified.buttons.find(b => b.actionType === 'review');

        // Detect if we reached Review Stage (requires actual filled fields or explicit review button)
        const isAtFinalStage = Boolean(reviewBtn || (submitBtn && !nextBtn && session.fieldsFilled.length > 0));

        if (isAtFinalStage) {
          sessionStore.addSessionLog('Reached final application review stage!', 'info', 'VERIFY');

          const reviewData = {
            stepNumber: step,
            fieldsFilled: session.fieldsFilled,
            screenshotUrl: screenshot ? `/screenshots/${screenshot.filename}` : null,
            canAutoSubmit: Boolean(submitBtn)
          };
          sessionStore.updateSession({ reviewData });

          if (mode === 'review') {
            // VERIFY & REVIEW MODE: Pause and await user approval in UI
            sessionStore.updateSession({ status: 'WAITING_FOR_REVIEW' });
            sessionStore.setCurrentAction('🛑 Paused: Verification Required', 'Review filled fields and screenshot in dashboard, then click "Approve & Submit".', 4);
            sessionStore.addSessionLog('🛑 PAUSED FOR YOUR VERIFICATION: Please review filled fields and screenshot in dashboard, then click "Approve & Submit".', 'warn', 'VERIFY');
            
            await this.waitForUserApproval();

            sessionStore.addSessionLog('User approved! Proceeding to submit application...', 'success', 'SUCCESS');
          }

          // Submit the application
          if (submitBtn) {
            sessionStore.updateSession({ status: 'SUBMITTING' });
            sessionStore.setCurrentAction('Submitting Application', `Clicking submit button ("${submitBtn.text}")...`, 5);
            sessionStore.addSessionLog(`Clicking Submit button ("${submitBtn.text}")...`, 'agent', 'SUBMIT');
            try {
              await page.locator(submitBtn.selector).first().click({ timeout: 8000 });
              await page.waitForTimeout(4000);
            } catch (clickErr) {
              sessionStore.addSessionLog(`Notice on submit click: ${clickErr.message.split('\n')[0]}`, 'info', 'INFO');
            }

            // Final confirmation screenshot
            const finalShot = await browserController.captureScreenshot('submission_confirmation');
            sessionStore.updateSession({
              status: 'COMPLETED',
              confirmationReceipt: {
                timestamp: new Date().toISOString(),
                screenshotUrl: finalShot ? `/screenshots/${finalShot.filename}` : null
              }
            });
            sessionStore.setCurrentAction('Application Completed', 'Application submitted successfully with confirmation receipt.', 5);
            sessionStore.addSessionLog('🎉 Application submitted successfully!', 'success', 'SUCCESS');
          } else {
            sessionStore.updateSession({ status: 'COMPLETED' });
            sessionStore.setCurrentAction('Application Completed', 'Reached final stage. Ready for manual final confirmation if required.', 5);
            sessionStore.addSessionLog('Reached final page. Form ready for manual final click if needed.', 'success', 'SUCCESS');
          }

          hasCompleted = true;
          break;
        }

        // Multi-Step: Click Next button to advance to next step
        if (nextBtn) {
          sessionStore.setCurrentAction('Advancing to Next Step', `Clicking "${nextBtn.text}" button...`, 3);
          sessionStore.addSessionLog(`Proceeding to next step (clicking "${nextBtn.text}")...`, 'info', 'NAVIGATE');
          await page.locator(nextBtn.selector).first().click();
          await page.waitForTimeout(3500);
          step++;
        } else {
          // If 0 fields were filled and no next/submit button exists
          if (session.fieldsFilled.length === 0) {
            sessionStore.addSessionLog('⚠️ No fillable form fields found. The portal may require login or direct job posting URL.', 'warn', 'ALERT');
            sessionStore.setCurrentAction('Application Stalled', 'No input fields detected. Verify portal URL.', 4);
            sessionStore.updateSession({ status: 'WAITING_FOR_REVIEW' });
          } else {
            sessionStore.addSessionLog('Form filled. No further navigation buttons detected.', 'info', 'INFO');
            sessionStore.setCurrentAction('Form Filling Finished', 'Completed all detected form fields.', 5);
            sessionStore.updateSession({ status: 'COMPLETED' });
          }
          hasCompleted = true;
          break;
        }
      }

      return sessionStore.getActiveSession();
    } catch (err) {
      console.error('[Orchestrator] Error during application:', err);
      const friendlyErr = this.generateFriendlyError(err, jobUrl);
      sessionStore.setErrorDetails(friendlyErr);
      sessionStore.setCurrentAction(`❌ Error: ${friendlyErr.title}`, friendlyErr.message, 5);
      sessionStore.addSessionLog(`❌ Error: ${friendlyErr.title} - ${friendlyErr.message}`, 'error', 'ERROR', friendlyErr.suggestion);
      throw err;
    }
  }

  /**
   * Detect if on an ATS Sign In / Create Account gate
   */
  async detectAuthGate(page) {
    if (!page) return false;
    return await page.evaluate(() => {
      const hasSignInContent = document.querySelector('[data-automation-id="signInContent"]') !== null;
      const hasCreateAccountBtn = document.querySelector('[data-automation-id="createAccountSubmitButton"]') !== null;
      const hasPasswordInput = document.querySelector('input[type="password"]') !== null;
      const bodyText = (document.body.innerText || '').toLowerCase();
      const hasCreateAccountHeading = bodyText.includes('create account') && bodyText.includes('password');
      return hasSignInContent || hasCreateAccountBtn || (hasPasswordInput && hasCreateAccountHeading);
    });
  }

  /**
   * Handle ATS / Workday Account Creation or Sign In
   */
  async handleAccountGate(page, profile) {
    const email = profile.personal?.email || 'svshivamshailendra@gmail.com';
    const password = profile.preferences?.workdayPassword || 'ShivamApply#2028';

    const createBtn = page.locator('[data-automation-id="createAccountSubmitButton"], button:has-text("Create Account")').first();
    const emailInput = page.locator('[data-automation-id="email"] input, input[data-automation-id="email"]').first();
    const passInput = page.locator('[data-automation-id="password"] input, input[data-automation-id="password"]').first();
    const verifyInput = page.locator('[data-automation-id="verifyPassword"] input, input[data-automation-id="verifyPassword"]').first();
    const termsCheck = page.locator('[data-automation-id="createAccountCheckbox"] input, input[data-automation-id="createAccountCheckbox"]').first();

    if (await createBtn.isVisible().catch(() => false) && await emailInput.isVisible().catch(() => false)) {
      sessionStore.addSessionLog(`Autofilling account registration with email: ${email}`, 'info', 'AUTOFILL');
      await emailInput.fill(email);
      await passInput.fill(password);
      if (await verifyInput.isVisible().catch(() => false)) {
        await verifyInput.fill(password);
      }
      if (await termsCheck.isVisible().catch(() => false)) {
        await termsCheck.check().catch(() => termsCheck.click());
      }

      await page.waitForTimeout(1000);
      sessionStore.addSessionLog('Submitting account registration to Workday...', 'info', 'AUTOFILL');
      await createBtn.click();
      await page.waitForTimeout(5000);

      // Check if account already exists
      const bodyText = await page.innerText('body').catch(() => '');
      if (bodyText.includes('already exists') || bodyText.includes('already have an account')) {
        sessionStore.addSessionLog('Account already registered for this email. Switching to Sign In...', 'info', 'INFO');
        const signInLink = page.locator('[data-automation-id="signInLink"], a:has-text("Sign In"), button:has-text("Sign In")').first();
        if (await signInLink.isVisible().catch(() => false)) {
          await signInLink.click();
          await page.waitForTimeout(2000);
          const loginEmail = page.locator('[data-automation-id="userName"] input, [data-automation-id="email"] input, input[type="text"]:not([name="website"])').first();
          const loginPass = page.locator('input[type="password"]').first();
          const signInBtn = page.locator('[data-automation-id="signInSubmitButton"], button:has-text("Sign In")').first();
          if (await loginEmail.isVisible().catch(() => false)) {
            await loginEmail.fill(email);
            await loginPass.fill(password);
            await signInBtn.click();
            await page.waitForTimeout(5000);
          }
        }
      }

      // Check if email verification code (OTP) or 2FA challenge is present
      const hasOtp = await page.evaluate(() => {
        const text = (document.body.innerText || '').toLowerCase();
        return text.includes('verification code') || text.includes('security code') || text.includes('enter the code') || text.includes('one-time passcode');
      });

      if (hasOtp) {
        return { requiresUserAction: true, reason: 'OTP_REQUIRED' };
      }

      // Check if successfully advanced past auth screen
      const isStillAuth = await this.detectAuthGate(page);
      if (isStillAuth) {
        return { requiresUserAction: true, reason: 'MANUAL_SIGNIN' };
      }

      return { success: true };
    }

    return { requiresUserAction: true, reason: 'AUTH_GATE' };
  }

  /**
   * Pause execution and wait for user to sign in or verify OTP in browser
   */
  waitForAuthResolution(page) {
    this.isPausedForAuth = true;
    return new Promise(resolve => {
      this.authPromiseResolve = resolve;

      // Automatically resolve if page navigates past the auth screen
      const poll = setInterval(async () => {
        try {
          const isStillAuth = await this.detectAuthGate(page);
          if (!isStillAuth) {
            clearInterval(poll);
            this.resumeAuth();
          }
        } catch (e) {
          clearInterval(poll);
        }
      }, 2500);
    });
  }

  resumeAuth() {
    if (this.isPausedForAuth && this.authPromiseResolve) {
      this.isPausedForAuth = false;
      this.authPromiseResolve(true);
      this.authPromiseResolve = null;
      return true;
    }
    return false;
  }

  /**
   * Pause execution and wait for user to click "Approve & Submit" in UI
   */
  waitForUserApproval() {
    this.isPausedForReview = true;
    return new Promise(resolve => {
      this.reviewPromiseResolve = resolve;
    });
  }

  approveSubmission() {
    if (this.isPausedForReview && this.reviewPromiseResolve) {
      this.isPausedForReview = false;
      this.reviewPromiseResolve(true);
      this.reviewPromiseResolve = null;
      return true;
    }
    return false;
  }

  /**
   * Wait for user to solve CAPTCHA in browser window
   */
  async waitForCaptchaResolution(page) {
    let resolved = false;
    let attempts = 0;
    while (!resolved && attempts < 60) {
      await page.waitForTimeout(2000);
      const isCaptchaStillThere = await browserController.checkForCaptcha();
      if (!isCaptchaStillThere) {
        resolved = true;
        break;
      }
      attempts++;
    }
  }

  generateFriendlyError(err, jobUrl) {
    const rawMsg = err.message || String(err);
    let title = 'Application Process Interrupted';
    let message = rawMsg.split('\n')[0];
    let suggestion = 'Please verify the job URL or select an active hiring company from the radar.';
    let code = 'EXECUTION_ERROR';

    if (rawMsg.includes('ERR_NAME_NOT_RESOLVED')) {
      title = 'Career Portal URL Unreachable (DNS Error)';
      message = `Cannot resolve the domain for "${jobUrl}". The link may be broken, expired, or blocked in your region.`;
      suggestion = 'Check the URL for typos, or browse active hiring companies in the Autonomous Job Discovery Radar.';
      code = 'DNS_UNRESOLVED';
    } else if (rawMsg.includes('Timeout') && rawMsg.includes('click')) {
      title = 'Form Element Timeout';
      message = 'The agent waited for a submit/next button, but the page layout changed or a required field was not satisfied.';
      suggestion = 'Use "Review & Verify" mode so you can view the live state, or enter a direct application form link.';
      code = 'ELEMENT_TIMEOUT';
    } else if (rawMsg.includes('No Gemini API keys')) {
      title = 'Gemini API Key Required';
      message = 'No active API key in pool to answer screener questions with AI.';
      suggestion = 'Open the "API Key Failover Pool" tab and paste your Gemini API key.';
      code = 'MISSING_API_KEY';
    } else if (rawMsg.includes('CAPTCHA')) {
      title = 'CAPTCHA Challenge Timeout';
      message = 'Cloudflare or reCAPTCHA verification was presented on the website and needed to be solved.';
      suggestion = 'Keep the browser window in view and solve any bot tests when prompted.';
      code = 'CAPTCHA_BLOCKED';
    } else if (rawMsg.includes('net::ERR_CONNECTION_REFUSED') || rawMsg.includes('net::ERR_TIMED_OUT')) {
      title = 'Target Website Not Responding';
      message = 'The employer website took too long to respond or refused the connection.';
      suggestion = 'Open the link in your regular browser to verify if the company website is online.';
      code = 'CONNECTION_TIMEOUT';
    }

    return {
      title,
      message,
      suggestion,
      code,
      technicalDetails: rawMsg
    };
  }
}

const applicationOrchestrator = new ApplicationOrchestrator();
module.exports = { applicationOrchestrator, ApplicationOrchestrator };
