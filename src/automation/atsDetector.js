/**
 * ATS Platform Detector
 * Identifies the application tracking system (Greenhouse, Lever, Workday, Rakuten, Ashby, etc.)
 */

function detectAts(url, pageTitle = '', domSnippet = '') {
  const lowerUrl = (url || '').toLowerCase();
  const lowerTitle = (pageTitle || '').toLowerCase();
  const lowerDom = (domSnippet || '').toLowerCase();

  if (lowerUrl.includes('greenhouse.io') || lowerDom.includes('id="application_form"') || lowerDom.includes('data-qa="job-application"')) {
    return { type: 'greenhouse', name: 'Greenhouse ATS', isSinglePage: true };
  }
  if (lowerUrl.includes('lever.co') || lowerDom.includes('class="application-form"')) {
    return { type: 'lever', name: 'Lever', isSinglePage: true };
  }
  if (lowerUrl.includes('myworkdayjobs.com') || lowerUrl.includes('workday') || lowerDom.includes('data-automation-id="workday"')) {
    return { type: 'workday', name: 'Workday Enterprise', isSinglePage: false, isWizard: true };
  }
  if (lowerUrl.includes('ashbyhq.com') || lowerDom.includes('ashby')) {
    return { type: 'ashby', name: 'Ashby HQ', isSinglePage: true };
  }
  if (lowerUrl.includes('smartrecruiters.com') || lowerDom.includes('smartrecruiters')) {
    return { type: 'smartrecruiters', name: 'SmartRecruiters', isSinglePage: false };
  }
  if (lowerUrl.includes('rakuten') || lowerTitle.includes('rakuten') || lowerDom.includes('rakuten')) {
    return { type: 'rakuten', name: 'Rakuten Career Portal', isSinglePage: false, isMultilingual: true, isHeavyQuestionnaire: true };
  }
  if (lowerUrl.includes('taleo.net') || lowerDom.includes('taleo')) {
    return { type: 'taleo', name: 'Oracle Taleo', isSinglePage: false, isWizard: true };
  }

  return { type: 'generic', name: 'Custom Career Portal', isSinglePage: false };
}

module.exports = { detectAts };
