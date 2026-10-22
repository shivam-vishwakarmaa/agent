/**
 * Stealth Playwright Browser Controller
 * Bypasses bot detection, manages persistent sessions, handles dynamic single-page apps,
 * and provides screenshot capture and CAPTCHA detection.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { DomMinifier } = require('../parsers/domMinifier');

class BrowserController {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isHeadless = process.env.HEADLESS === 'true';
    this.screenshotsDir = path.join(__dirname, '../../screenshots');
    this.userDataDir = path.join(__dirname, '../../data/browser_profile');
    this.ensureDirs();
  }

  ensureDirs() {
    if (!fs.existsSync(this.screenshotsDir)) fs.mkdirSync(this.screenshotsDir, { recursive: true });
    if (!fs.existsSync(this.userDataDir)) fs.mkdirSync(this.userDataDir, { recursive: true });
  }

  setHeadless(val) {
    this.isHeadless = Boolean(val);
  }

  /**
   * Initialize or reuse browser instance
   */
  async init() {
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    console.log(`[Browser] Launching browser (headless: ${this.isHeadless})...`);
    this.context = await chromium.launchPersistentContext(this.userDataDir, {
      headless: this.isHeadless,
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-size=1440,900'
      ]
    });

    // Stealth script injection to hide automation signatures
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
    
    // Set realistic timeouts
    this.page.setDefaultTimeout(30000);
    this.page.setDefaultNavigationTimeout(45000);

    return this.page;
  }

  /**
   * Navigate to target job URL
   */
  async navigateTo(url) {
    await this.init();
    console.log(`[Browser] Navigating to: ${url}`);
    
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      // Allow dynamic single page applications (React/Vue/Workday) to render
      await this.page.waitForTimeout(3000);
      return true;
    } catch (err) {
      console.error(`[Browser] Navigation error: ${err.message}`);
      throw err;
    }
  }

  /**
   * Detect if CAPTCHA or Cloudflare protection is active
   */
  async checkForCaptcha() {
    if (!this.page) return false;
    return await this.page.evaluate(() => {
      const hasCloudflare = document.title.includes('Just a moment...') || 
                            document.querySelector('#challenge-stage') !== null ||
                            document.body.innerText.includes('Verify you are human');
      const hasRecaptcha = document.querySelector('iframe[src*="recaptcha"], .g-recaptcha, iframe[src*="hcaptcha"]') !== null;
      return hasCloudflare || hasRecaptcha;
    });
  }

  /**
   * Extract minified interactive form elements
   */
  async extractMinifiedForm() {
    if (!this.page) throw new Error('Browser is not open');
    const extractFn = DomMinifier.getExtractionScript();
    const result = await this.page.evaluate(extractFn);
    return result;
  }

  /**
   * Capture a full-page or viewport screenshot for verification report
   */
  async captureScreenshot(filenamePrefix = 'form_step') {
    if (!this.page) return null;
    const filename = `${filenamePrefix}_${Date.now()}.png`;
    const filepath = path.join(this.screenshotsDir, filename);
    await this.page.screenshot({ path: filepath, fullPage: false });
    return { filename, filepath };
  }

  /**
   * Close browser
   */
  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page = null;
      this.browser = null;
    }
  }
}

const browserController = new BrowserController();
module.exports = { browserController, BrowserController };
