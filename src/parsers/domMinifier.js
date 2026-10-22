/**
 * Token-Optimized DOM Minifier
 * Strips 99% of raw HTML (scripts, svgs, styles, navs, footers) and extracts
 * ONLY interactive form elements, labels, options, and validations.
 * Reduces token consumption from 50,000+ tokens to < 500 tokens!
 */

class DomMinifier {
  /**
   * Script to be executed inside browser page context via Playwright page.evaluate()
   */
  static getExtractionScript() {
    return () => {
      const fields = [];
      const buttons = [];

      // Helper to find label text for any element
      function findLabel(el) {
        if (!el) return '';
        // 1. Direct aria-label or placeholder
        if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
        if (el.placeholder) return el.placeholder.trim();

        // 2. Label with 'for' attribute matching id
        if (el.id) {
          const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (labelEl && labelEl.innerText.trim()) return labelEl.innerText.trim();
        }

        // 3. Closest wrapping label or form-group container
        const parentLabel = el.closest('label');
        if (parentLabel && parentLabel.innerText.trim()) {
          return parentLabel.innerText.replace(el.innerText || '', '').trim();
        }

        // 4. Closest field container label
        const container = el.closest('.form-group, .field, [class*="form-item"], [class*="Field"], [data-automation-id]');
        if (container) {
          const labelInside = container.querySelector('label, [class*="label"], [class*="Label"]');
          if (labelInside && labelInside.innerText.trim()) return labelInside.innerText.trim();
        }

        // 5. Preceding sibling label or text
        let prev = el.previousElementSibling;
        while (prev) {
          if (prev.tagName.toLowerCase() === 'label' || prev.getAttribute('class')?.includes('label')) {
            return prev.innerText.trim();
          }
          prev = prev.previousElementSibling;
        }

        return el.name || el.id || '';
      }

      // Helper to clean label text (remove asterisks, required indicators, trim)
      function cleanText(txt) {
        return (txt || '').replace(/\s+/g, ' ').replace(/\*$/, '').trim();
      }

      // Helper to generate a unique, resilient CSS selector
      function getUniqueSelector(el) {
        if (el.id) return `#${CSS.escape(el.id)}`;
        if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
        if (el.getAttribute('data-automation-id')) return `[data-automation-id="${CSS.escape(el.getAttribute('data-automation-id'))}"]`;
        if (el.getAttribute('data-qa')) return `[data-qa="${CSS.escape(el.getAttribute('data-qa'))}"]`;
        
        // Generate hierarchical selector
        const path = [];
        let cur = el;
        while (cur && cur !== document.body && cur !== document.documentElement) {
          let sel = cur.tagName.toLowerCase();
          if (cur.className && typeof cur.className === 'string') {
            const firstClass = cur.className.trim().split(/\s+/)[0];
            if (firstClass && !firstClass.includes(':')) sel += `.${CSS.escape(firstClass)}`;
          }
          path.unshift(sel);
          cur = cur.parentElement;
        }
        return path.join(' > ');
      }

      // 1. Process all standard inputs and textareas
      const inputElements = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'));
      
      inputElements.forEach((el, idx) => {
        // Skip invisible elements
        const style = window.getComputedStyle(el);
        if (style.display === 'none' && el.type !== 'file') return;
        if (style.visibility === 'hidden') return;

        // Skip facet search filters (checkboxes in filter sidebars, category filters, etc.)
        const isFilterElement = Boolean(
          el.closest('.filter-section, #filters, .filters, .facet-search, .search-filters, [data-qa*="filter"], [id*="filter"]')
        );
        if (isFilterElement) return;

        const type = (el.type || el.tagName.toLowerCase()).toLowerCase();
        const rawLabel = findLabel(el);
        const label = cleanText(rawLabel);
        const isRequired = el.required || el.getAttribute('aria-required') === 'true' || rawLabel.includes('*');

        // Extract options if it's a select element
        let options = [];
        if (el.tagName.toLowerCase() === 'select') {
          options = Array.from(el.options)
            .map(opt => ({ text: opt.text.trim(), value: opt.value }))
            .filter(opt => opt.text && opt.value !== '');
        }

        fields.push({
          index: idx,
          tag: el.tagName.toLowerCase(),
          type,
          id: el.id || '',
          name: el.name || '',
          label,
          placeholder: el.placeholder || '',
          required: isRequired,
          currentValue: el.value || '',
          options,
          selector: getUniqueSelector(el)
        });
      });

      // 2. Process Custom React/Workday/Vue Combobox Dropdowns
      const customDropdowns = Array.from(document.querySelectorAll('[role="combobox"], [role="listbox"], [data-automation-id*="dropdown"], .select2-container'));
      customDropdowns.forEach((el, idx) => {
        // Skip facet filters
        if (el.closest('.filter-section, #filters, .filters, .facet-search, .search-filters, [data-qa*="filter"]')) return;

        const rawLabel = findLabel(el);
        const label = cleanText(rawLabel);
        fields.push({
          index: fields.length + idx,
          tag: 'custom-select',
          type: 'custom-select',
          id: el.id || '',
          name: el.getAttribute('data-automation-id') || '',
          label: label || 'Custom Dropdown',
          placeholder: el.getAttribute('placeholder') || '',
          required: el.getAttribute('aria-required') === 'true' || rawLabel.includes('*'),
          currentValue: el.innerText.trim(),
          options: [],
          selector: getUniqueSelector(el)
        });
      });

      // 3. Process Navigation & Action Buttons (Submit, Next, Review, Apply)
      const actionElements = Array.from(document.querySelectorAll('button, input[type="submit"], a[role="button"], a.btn, a[class*="apply"], [data-automation-id*="bottom-navigation-next-button"]'));
      actionElements.forEach((el) => {
        // Skip invisible buttons
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || el.offsetParent === null) return;
        if (el.disabled || el.getAttribute('aria-hidden') === 'true') return;

        // Skip search filter buttons (e.g. #filter-apply-handler)
        const isFilterBtn = Boolean(
          el.id.toLowerCase().includes('filter') ||
          (el.className && typeof el.className === 'string' && el.className.toLowerCase().includes('filter')) ||
          el.closest('.filter-section, #filters, .filters, .facet-search, .search-filters, [id*="filter"]')
        );
        if (isFilterBtn) return;

        const text = (el.innerText || el.value || '').trim().toLowerCase();
        if (!text) return;

        let actionType = 'other';
        // Classify Submit (final application submit) vs Apply (launching form from job overview)
        if (text.includes('submit application') || text === 'submit' || text.includes('send application') || text.includes('finish') || text.includes('confirm application')) {
          actionType = 'submit';
        } else if (text.includes('next') || text.includes('continue') || text.includes('save and continue') || text.includes('proceed')) {
          actionType = 'next';
        } else if (text.includes('review') || text.includes('verify')) {
          actionType = 'review';
        } else if (text.includes('apply now') || text === 'apply' || text.includes('apply manually') || text.includes('easy apply') || text.includes('apply with')) {
          actionType = 'apply';
        }

        if (actionType !== 'other') {
          buttons.push({
            actionType,
            text: el.innerText || el.value,
            selector: getUniqueSelector(el)
          });
        }
      });

      // Detect if page has validation errors
      const errorElements = Array.from(document.querySelectorAll('.error, [class*="error-message"], [role="alert"], [data-automation-id*="error"]'));
      const errors = errorElements.map(e => e.innerText.trim()).filter(Boolean);

      return {
        url: window.location.href,
        title: document.title,
        fields,
        buttons,
        errors,
        pageTextSnippet: document.body.innerText.substring(0, 1500)
      };
    };
  }

  /**
   * Produce a compact summary for the LLM (only ~300-500 tokens)
   */
  static formatForPrompt(minifiedForm) {
    const simplifiedFields = minifiedForm.fields.map(f => {
      let desc = `[#${f.index}] ${f.label || f.name || 'Field'} (${f.type}${f.required ? ', REQUIRED' : ''})`;
      if (f.options && f.options.length > 0) {
        desc += ` Options: [${f.options.slice(0, 15).map(o => `"${o.text}"`).join(', ')}${f.options.length > 15 ? ', ...' : ''}]`;
      }
      return desc;
    });

    return {
      title: minifiedForm.title,
      fieldCount: minifiedForm.fields.length,
      fieldList: simplifiedFields.join('\n'),
      buttons: minifiedForm.buttons.map(b => `${b.actionType.toUpperCase()}: "${b.text}"`).join(' | ')
    };
  }
}

module.exports = { DomMinifier };
