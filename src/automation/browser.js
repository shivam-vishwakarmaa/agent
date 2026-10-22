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
   * Deeply scans a career portal: searches keywords, scrolls, and extracts actual job listings & links from the DOM
   */
  async scanCareerPortal(careersUrl, roleQuery = '') {
    await this.init();
    console.log(`[Browser] Scanning career portal: ${careersUrl} for "${roleQuery}"`);
    await this.page.goto(careersUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await this.page.waitForTimeout(3000);

    // Step 1: Look for search input and search for the role query if provided
    if (roleQuery && roleQuery.trim().length > 0) {
      try {
        const searchInput = this.page.locator('input[type="search"], input[name*="search" i], input[name*="keyword" i], input[name*="query" i], input[placeholder*="search" i], input[placeholder*="job" i], input[placeholder*="role" i], input[placeholder*="title" i], [aria-label*="search" i]').first();
        if (await searchInput.count() > 0) {
          console.log(`[Browser] Found career search bar. Typing "${roleQuery}"...`);
          await searchInput.click();
          await searchInput.fill('');
          await searchInput.fill(roleQuery);
          await this.page.keyboard.press('Enter');
          await this.page.waitForTimeout(3500);
        }
      } catch (e) {
        console.log('[Browser] No active search bar found or search error, proceeding with page scan...');
      }
    }

    // Step 2: Scroll down to trigger lazy loading and dynamic list rendering
    try {
      for (let i = 0; i < 3; i++) {
        await this.page.evaluate(() => window.scrollBy(0, 800));
        await this.page.waitForTimeout(800);
      }
    } catch (e) {}

    // Step 3: Extract actual job cards, links, titles, and locations from DOM
    const extractedJobs = await this.page.evaluate(() => {
      const results = [];
      const seenUrls = new Set();

      // Priority 1: Elements with job link patterns
      const jobLinkPatterns = [
        '/job/', '/jobs/', '/position/', '/positions/', '/opening/', '/openings/',
        '/careers/', 'gh_jid=', 'lever.co/', 'greenhouse.io/', 'myworkdayjobs.com/',
        'ashbyhq.com/', 'smartrecruiters.com/'
      ];

      const allLinks = Array.from(document.querySelectorAll('a[href]'));

      for (const a of allLinks) {
        const href = a.href;
        const text = (a.innerText || a.textContent || '').trim().replace(/\s+/g, ' ');

        // Skip empty, short, or obvious navigation links
        if (!text || text.length < 3 || text.length > 120) continue;
        if (seenUrls.has(href)) continue;

        const isJobUrl = jobLinkPatterns.some(pat => href.toLowerCase().includes(pat));
        const isJobClass = (a.className || '').toLowerCase().includes('job') || 
                           (a.getAttribute('data-automation-id') || '').toLowerCase().includes('job') ||
                           (a.getAttribute('data-qa') || '').toLowerCase().includes('job');

        if (isJobUrl || isJobClass) {
          // Find closest container for location or department
          const container = a.closest('li, tr, [class*="card"], [class*="item"], [class*="row"]') || a;
          let location = '';
          const locEl = container.querySelector('[class*="location"], [class*="Location"], [data-automation-id*="location"]');
          if (locEl) {
            location = locEl.innerText.trim();
          }

          seenUrls.add(href);
          results.push({
            title: text,
            url: href,
            location: location || '',
            snippet: container.innerText.substring(0, 300).replace(/\s+/g, ' ').trim()
          });
        }
      }

      // Priority 2: Standard job listing table or cards if no direct job links found
      if (results.length === 0) {
        const jobCards = Array.from(document.querySelectorAll('[data-qa="job"], [data-automation-id*="job"], [class*="job-listing"], [class*="job-tile"], [class*="career-item"], .opening'));
        for (const card of jobCards) {
          const titleEl = card.querySelector('h1, h2, h3, h4, a, [class*="title"]') || card;
          const linkEl = card.querySelector('a[href]') || (card.tagName.toLowerCase() === 'a' ? card : null);
          const title = titleEl.innerText.trim().replace(/\s+/g, ' ');
          const href = linkEl ? linkEl.href : window.location.href;

          if (title && !seenUrls.has(href)) {
            seenUrls.add(href);
            results.push({
              title,
              url: href,
              location: card.querySelector('[class*="location"]')?.innerText.trim() || '',
              snippet: card.innerText.substring(0, 300).replace(/\s+/g, ' ').trim()
            });
          }
        }
      }

      return results.slice(0, 25);
    });

    console.log(`[Browser] Extracted ${extractedJobs.length} real job openings from DOM.`);
    return extractedJobs;
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
