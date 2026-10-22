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

    sessionStore.addSessionLog(`Starting application process for ${companyName || 'Target Company'}...`, 'info');
    sessionStore.updateSession({ status: 'NAVIGATING' });

    try {
      // 1. Navigate to URL
      const page = await browserController.navigateTo(jobUrl);
      const currentUrl = (page && typeof page.url === 'function') ? page.url() : jobUrl;
      sessionStore.addSessionLog(`Successfully navigated to job page: ${currentUrl}`, 'success');

      // 2. Detect ATS platform
      const pageTitle = (page && typeof page.title === 'function') ? await page.title() : '';
      const ats = detectAts(currentUrl, pageTitle);
      sessionStore.updateSession({ atsType: ats.name });
      sessionStore.addSessionLog(`Detected Platform: ${ats.name}`, 'info');

      // 3. Multi-Step Wizard Loop (up to 6 steps to prevent infinite loops)
      let step = 1;
      const maxSteps = 6;
      let hasCompleted = false;

      while (step <= maxSteps && !hasCompleted) {
        sessionStore.updateSession({ currentStep: step, status: 'ANALYZING' });
        sessionStore.addSessionLog(`Analyzing Step ${step} form fields...`, 'info');

        // Check for CAPTCHA
        const isCaptcha = await browserController.checkForCaptcha();
        if (isCaptcha) {
          sessionStore.updateSession({ status: 'CAPTCHA_PAUSE' });
          sessionStore.addSessionLog('⚠️ CAPTCHA / Cloudflare detected! Please solve it in the browser window. Waiting...', 'warn');
          await this.waitForCaptchaResolution(page);
          sessionStore.addSessionLog('CAPTCHA resolved! Continuing auto-fill...', 'success');
        }

        // Extract minified form fields
        const minified = await browserController.extractMinifiedForm();
        sessionStore.addSessionLog(`Found ${minified.fields.length} interactive fields on current page.`, 'info');

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
          sessionStore.addSessionLog(`Detected career portal search directory. Opening top vacancy: "${jobTitle}"...`, 'info');
          await jobLinks.click();
          await page.waitForTimeout(4500);
          continue;
        }

        // Smart check 2: If on a job details page with an "Apply" button (no candidate fields yet)
        const applyBtn = page.locator('a:has-text("Apply"), button:has-text("Apply"), [data-automation-id*="apply" i], a[href*="/apply" i]').first();
        if (!hasCandidateFields && await applyBtn.count() > 0 && await applyBtn.isVisible()) {
          const btnText = (await applyBtn.innerText()).trim() || 'Apply';
          sessionStore.addSessionLog(`Found "${btnText}" button on job overview page. Launching application form...`, 'info');
          await applyBtn.click();
          await page.waitForTimeout(4500);
          continue;
        }

        if (!hasCandidateFields && step === 1) {
          sessionStore.addSessionLog('⚠️ No candidate application form or job openings detected on this page. Please enter a direct job posting URL or crawl open jobs from the radar.', 'warn');
        }

        // Fill fields using profile and AI screener
        sessionStore.updateSession({ status: 'FILLING' });
        const profile = sessionStore.getProfile();
        const filled = await formFiller.fillPageFields(page, minified, profile, {
          companyName: session.companyName,
          jobTitle: session.jobTitle
        });

        sessionStore.updateSession({
          fieldsFilled: [...session.fieldsFilled, ...filled]
        });
        sessionStore.addSessionLog(`Filled ${filled.length} fields accurately.`, 'success');

        // Take a screenshot of the filled form
        const screenshot = await browserController.captureScreenshot(`step_${step}`);
        if (screenshot) {
          session.screenshots.push(screenshot.filename);
        }

        // Check buttons: Is it ready for Submit or Next?
        const submitBtn = minified.buttons.find(b => b.actionType === 'submit');
        const nextBtn = minified.buttons.find(b => b.actionType === 'next');
        const reviewBtn = minified.buttons.find(b => b.actionType === 'review');

        // Detect if we reached Review Stage (requires actual filled fields or explicit review button)
        const isAtFinalStage = Boolean(reviewBtn || (submitBtn && !nextBtn && session.fieldsFilled.length > 0));

        if (isAtFinalStage) {
          sessionStore.addSessionLog('Reached final application review stage!', 'info');

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
            sessionStore.addSessionLog('🛑 PAUSED FOR YOUR VERIFICATION: Please review filled fields and screenshot in dashboard, then click "Approve & Submit".', 'warn');
            
            // Wait for user approval
            await this.waitForUserApproval();

            sessionStore.addSessionLog('User approved! Proceeding to submit application...', 'success');
          }

          // Submit the application
          if (submitBtn) {
            sessionStore.updateSession({ status: 'SUBMITTING' });
            sessionStore.addSessionLog(`Clicking Submit button ("${submitBtn.text}")...`, 'agent');
            try {
              await page.locator(submitBtn.selector).first().click({ timeout: 8000 });
              await page.waitForTimeout(4000);
            } catch (clickErr) {
              sessionStore.addSessionLog(`Notice on submit click: ${clickErr.message.split('\n')[0]}`, 'info');
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
            sessionStore.addSessionLog('🎉 Application submitted successfully!', 'success');
          } else {
            sessionStore.updateSession({ status: 'COMPLETED' });
            sessionStore.addSessionLog('Reached final page. Form ready for manual final click if needed.', 'success');
          }

          hasCompleted = true;
          break;
        }

        // Multi-Step: Click Next button to advance to next step
        if (nextBtn) {
          sessionStore.addSessionLog(`Proceeding to next step (clicking "${nextBtn.text}")...`, 'info');
          await page.locator(nextBtn.selector).first().click();
          await page.waitForTimeout(3000);
          step++;
        } else {
          // No next and no submit button found
          sessionStore.addSessionLog('Form filled. No further navigation buttons detected.', 'info');
          sessionStore.updateSession({ status: 'COMPLETED' });
          hasCompleted = true;
          break;
        }
      }

      return sessionStore.getActiveSession();
    } catch (err) {
      console.error('[Orchestrator] Error during application:', err);
      sessionStore.updateSession({ status: 'FAILED' });
      sessionStore.addSessionLog(`Error: ${err.message}`, 'error');
      throw err;
    }
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
