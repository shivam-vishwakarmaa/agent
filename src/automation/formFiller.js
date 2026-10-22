/**
 * Smart Form Filler & Dynamic Dropdown Handler
 * Automates text inputs, custom React/Workday dropdowns, radio/checkboxes, and resume file upload.
 */

const path = require('path');
const fs = require('fs');
const { screenerQnA } = require('../ai/screenerQnA');

class FormFiller {
  /**
   * Fill all extracted fields on the current page
   */
  async fillPageFields(page, minifiedForm, profile, jobContext = {}) {
    const fields = minifiedForm.fields;
    const filledSummary = [];
    const unmappedFields = [];

    // Step 1: Deterministic mapping for standard candidate contact & profile fields
    for (const field of fields) {
      if (field.currentValue && field.currentValue.trim().length > 0) {
        continue; // Already has a value
      }

      const standardVal = this.getStandardFieldValue(field, profile);
      if (standardVal !== null) {
        const success = await this.fillSingleField(page, field, standardVal);
        if (success) {
          filledSummary.push({
            label: field.label || field.name,
            value: standardVal,
            type: field.type,
            selector: field.selector
          });
        }
      } else if (field.type === 'file') {
        // Handle resume file attachment
        const resumePath = profile.resume?.filePath;
        if (resumePath && fs.existsSync(resumePath)) {
          try {
            await page.setInputFiles(field.selector, resumePath);
            filledSummary.push({
              label: field.label || 'Resume / CV Upload',
              value: path.basename(resumePath),
              type: 'file',
              selector: field.selector
            });
            console.log(`[FormFiller] Attached resume: ${resumePath}`);
          } catch (err) {
            console.warn(`[FormFiller] Failed to attach resume to ${field.selector}:`, err.message);
          }
        }
      } else {
        // Tricky custom screener or behavioral question
        unmappedFields.push(field);
      }
    }

    // Step 2: For unmapped/screener/multilingual questions, use ScreenerQnA
    if (unmappedFields.length > 0) {
      console.log(`[FormFiller] Answering ${unmappedFields.length} custom screener questions with AI...`);
      const aiAnswers = await screenerQnA.answerQuestions(unmappedFields, jobContext);

      for (const field of unmappedFields) {
        const answer = aiAnswers[field.index];
        if (answer) {
          const success = await this.fillSingleField(page, field, answer);
          if (success) {
            filledSummary.push({
              label: field.label || field.name,
              value: answer,
              type: field.type,
              selector: field.selector,
              isAiGenerated: true
            });
          }
        }
      }
    }

    return filledSummary;
  }

  /**
   * Deterministic mapping for standard fields (0 tokens, 100% accurate)
   */
  getStandardFieldValue(field, profile) {
    const text = (field.label || field.name || field.placeholder || '').toLowerCase();
    const p = profile.personal || {};

    // First Name
    if (text.includes('first name') || text === 'firstname' || text === 'first_name' || text.includes('given name')) {
      return p.firstName || p.fullName.split(' ')[0] || '';
    }

    // Last Name
    if (text.includes('last name') || text === 'lastname' || text === 'last_name' || text.includes('family name') || text.includes('surname')) {
      return p.lastName || p.fullName.split(' ').slice(1).join(' ') || '';
    }

    // Full Name
    if (text.includes('full name') || text === 'name' || text === 'candidate_name') {
      return p.fullName || `${p.firstName} ${p.lastName}`.trim();
    }

    // Email
    if (text.includes('email') || field.type === 'email') {
      return p.email || '';
    }

    // Phone
    if (text.includes('phone') || text.includes('mobile') || text.includes('contact number') || field.type === 'tel') {
      return p.phone || '';
    }

    // LinkedIn
    if (text.includes('linkedin')) {
      return p.linkedinUrl || '';
    }

    // GitHub
    if (text.includes('github')) {
      return p.githubUrl || '';
    }

    // Portfolio / Website
    if (text.includes('portfolio') || text.includes('website') || text.includes('personal url')) {
      return p.portfolioUrl || p.githubUrl || '';
    }

    // City / Location
    if (text.includes('city') || text.includes('current location')) {
      return p.currentCity || '';
    }

    // Postal Code / Pin Code
    if (text.includes('postal') || text.includes('zip') || text.includes('pin code')) {
      return p.postalCode || '';
    }

    // Address
    if (text.includes('address') && !text.includes('email')) {
      return p.addressLine || p.currentCity || '';
    }

    // State / Province
    if (text.includes('state') || text.includes('province')) {
      return p.state || '';
    }

    // Date of birth
    if (text.includes('birth') || text.includes('dob')) {
      return p.dateOfBirth || '';
    }

    return null;
  }

  /**
   * Safe typing / clicking / selecting based on field type
   */
  async fillSingleField(page, field, value) {
    if (!value) return false;
    const strVal = String(value).trim();

    try {
      const locator = page.locator(field.selector).first();
      const count = await locator.count();
      if (count === 0) return false;

      // Handle standard text, email, tel, number, date
      if (['text', 'email', 'tel', 'number', 'date', 'password'].includes(field.type)) {
        await locator.scrollIntoViewIfNeeded();
        await locator.fill('');
        await locator.fill(strVal);
        return true;
      }

      // Handle textarea
      if (field.tag === 'textarea') {
        await locator.scrollIntoViewIfNeeded();
        await locator.fill('');
        await locator.fill(strVal);
        return true;
      }

      // Handle native <select>
      if (field.tag === 'select') {
        await locator.scrollIntoViewIfNeeded();
        // Try selecting by label, then value, then index
        try {
          await locator.selectOption({ label: strVal });
          return true;
        } catch {
          try {
            await locator.selectOption({ value: strVal });
            return true;
          } catch {
            // Find closest match in options
            const options = field.options || [];
            const best = options.find(o => o.text.toLowerCase().includes(strVal.toLowerCase()));
            if (best) {
              await locator.selectOption({ value: best.value });
              return true;
            }
          }
        }
      }

      // Handle custom React/Vue/Workday Combobox Dropdown
      if (field.type === 'custom-select' || field.tag === 'custom-select') {
        await locator.scrollIntoViewIfNeeded();
        await locator.click();
        await page.waitForTimeout(500);

        // Try typing the target value to filter
        await page.keyboard.type(strVal, { delay: 50 });
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
        return true;
      }

      // Handle radio button
      if (field.type === 'radio') {
        await locator.check();
        return true;
      }

      // Handle checkbox
      if (field.type === 'checkbox') {
        const isTrue = ['true', 'yes', '1'].includes(strVal.toLowerCase());
        if (isTrue) await locator.check();
        return true;
      }

      return false;
    } catch (err) {
      console.warn(`[FormFiller] Error filling ${field.selector}:`, err.message);
      return false;
    }
  }
}

const formFiller = new FormFiller();
module.exports = { formFiller, FormFiller };
