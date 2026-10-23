/**
 * Application Orchestrator & Dual-Mode Controller
 * Coordinates page navigation, multi-step wizards, CAPTCHA pausing,
 * and the dual Review vs. Auto-Submit execution flow.
 */

const { browserController } = require('./browser');
const { detectAts } = require('./atsDetector');
const { formFiller } = require('./formFiller');
const { sessionStore } = require('../state/sessionStore');

class ApplicationOrchestrator {
  constructor() {
    this.isPausedForReview = false;
    this.reviewPromiseResolve = null;
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
      const page = await browserController.navigateTo(jobUrl);
      const currentUrl = (page && typeof page.url === 'function') ? page.url() : jobUrl;
      sessionStore.addSessionLog(`Successfully navigated to job page: ${currentUrl}`, 'success', 'NAVIGATE');
      sessionStore.setCurrentAction('Inspecting Page & Platform', `Page loaded: ${currentUrl.slice(0, 60)}...`, 1);

      // 2. Detect ATS platform
      const pageTitle = (page && typeof page.title === 'function') ? await page.title() : '';
      const ats = detectAts(currentUrl, pageTitle);
      sessionStore.updateSession({ atsType: ats.name });
      sessionStore.addSessionLog(`Detected Platform: ${ats.name}`, 'info', 'SCAN');
      sessionStore.setCurrentAction('Analyzing ATS Platform', `Identified ${ats.name}. Inspecting DOM form elements...`, 2);

      // 3. Multi-Step Wizard Loop (up to 6 steps to prevent infinite loops)
      let step = 1;
      const maxSteps = 6;
      let hasCompleted = false;

      while (step <= maxSteps && !hasCompleted) {
        sessionStore.updateSession({ currentStep: step, status: 'ANALYZING' });
        sessionStore.setCurrentAction(`Analyzing Form Fields (Step ${step})`, `Inspecting DOM for interactive input controls...`, 2);
        sessionStore.addSessionLog(`Analyzing Step ${step} form fields...`, 'info', 'SCAN');

        // Check for CAPTCHA
        const isCaptcha = await browserController.checkForCaptcha();
        if (isCaptcha) {
          sessionStore.updateSession({ status: 'CAPTCHA_PAUSE' });
          sessionStore.setCurrentAction('CAPTCHA / Challenge Detected', 'Waiting for human verification in browser window...', 2);
          sessionStore.addSessionLog('⚠️ CAPTCHA / Cloudflare detected! Please solve it in the browser window. Waiting...', 'warn', 'ALERT');
          await this.waitForCaptchaResolution(page);
          sessionStore.addSessionLog('CAPTCHA resolved! Continuing auto-fill...', 'success', 'SUCCESS');
        }

        // Extract minified form fields
        const minified = await browserController.extractMinifiedForm();
        sessionStore.addSessionLog(`Found ${minified.fields.length} interactive fields on current page.`, 'info', 'SCAN');

        // Check if current page has actual candidate profile fields (Name, Email, Phone, Resume, etc.)
        const candidateKeywords = ['name', 'first', 'last', 'email', 'phone', 'mobile', 'resume', 'cv', 'address', 'education', 'experience', 'github', 'linkedin'];
        const hasCandidateFields = minified.fields.some(f => {
          const l = (f.label || f.name || f.placeholder || '').toLowerCase();
          return candidateKeywords.some(kw => l.includes(kw));
        });

        // Smart check 1: If on a search/directory page (no candidate fields, but has job openings links)
        const jobLinks = page.locator('a[href*="/job/"], a[href*="/opening/"], a[href*="/careers/jobdetails"], a[href*="/position/"]').first();
        if (!hasCandidateFields && await jobLinks.count() > 0 && await jobLinks.isVisible()) {
          const rawJobText = (await jobLinks.innerText()).trim();
          const jobTitle = rawJobText.split('\n')[0] || 'Top Matched Role';
          sessionStore.setCurrentAction('Opening Top Job Vacancy', `Found opening: "${jobTitle}". Opening application...`, 2);
          sessionStore.addSessionLog(`Detected career portal search directory. Opening top vacancy: "${jobTitle}"...`, 'info', 'NAVIGATE');
          await jobLinks.click();
          await page.waitForTimeout(4500);
          continue;
        }

        // Smart check 2: If on a job details page with an "Apply" button (no candidate fields yet)
        const applyBtn = page.locator('a:has-text("Apply"), button:has-text("Apply"), [data-automation-id*="apply" i], a[href*="/apply" i]').first();
        if (!hasCandidateFields && await applyBtn.count() > 0 && await applyBtn.isVisible()) {
          const btnText = (await applyBtn.innerText()).trim() || 'Apply';
          sessionStore.setCurrentAction('Launching Application Form', `Clicking "${btnText}" to enter application form...`, 2);
          sessionStore.addSessionLog(`Found "${btnText}" button on job overview page. Launching application form...`, 'info', 'NAVIGATE');
          await applyBtn.click();
          await page.waitForTimeout(4500);
          continue;
        }

        if (!hasCandidateFields && step === 1) {
          sessionStore.addSessionLog('⚠️ No candidate application form or job openings detected on this page. Please enter a direct job posting URL or crawl open jobs from the radar.', 'warn', 'ALERT');
        }

        // Fill fields using profile and AI screener
        sessionStore.updateSession({ status: 'FILLING' });
        sessionStore.setCurrentAction('Autofilling Application Form', `Populating candidate information & AI screener answers (Step ${step})...`, 3);
        const profile = sessionStore.getProfile();
        const filled = await formFiller.fillPageFields(page, minified, profile, {
          companyName: session.companyName,
          jobTitle: session.jobTitle
        });

        sessionStore.updateSession({
          fieldsFilled: [...session.fieldsFilled, ...filled]
        });
        sessionStore.addSessionLog(`Filled ${filled.length} fields accurately.`, 'success', 'AUTOFILL');

        // Take a screenshot of the filled form
        sessionStore.setCurrentAction('Capturing Proof Screenshot', 'Saving visual verification snapshot...', 3);
        const screenshot = await browserController.captureScreenshot(`step_${step}`);
        if (screenshot) {
          session.screenshots.push(screenshot.filename);
          sessionStore.addSessionLog(`Captured proof snapshot: ${screenshot.filename}`, 'info', 'SNAPSHOT');
        }

        // Check buttons: Is it ready for Submit or Next?
        const submitBtn = minified.buttons.find(b => b.actionType === 'submit');
        const nextBtn = minified.buttons.find(b => b.actionType === 'next');
        const reviewBtn = minified.buttons.find(b => b.actionType === 'review');

        // Detect if we reached Review Stage (requires actual filled fields or explicit review button)
        const isAtFinalStage = Boolean(reviewBtn || (submitBtn && !nextBtn && session.fieldsFilled.length > 0));

        if (isAtFinalStage) {
          sessionStore.addSessionLog('Reached final application review stage!', 'info', 'VERIFY');

          // Prepare Review Data for the user dashboard
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
            
            // Wait for user approval
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
          await page.waitForTimeout(3000);
          step++;
        } else {
          // No next and no submit button found
          sessionStore.addSessionLog('Form filled. No further navigation buttons detected.', 'info', 'INFO');
          sessionStore.setCurrentAction('Form Filling Finished', 'Completed all detected form fields.', 5);
          sessionStore.updateSession({ status: 'COMPLETED' });
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
}

const applicationOrchestrator = new ApplicationOrchestrator();
module.exports = { applicationOrchestrator, ApplicationOrchestrator };
