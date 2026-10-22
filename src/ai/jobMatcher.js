/**
 * Job & Role Matcher (Fresher & Target Role Filtering)
 * Scans career portals, extracts open job listings, and pinpoints exact roles
 * matching the candidate's experience level (Fresher, Junior, Graduate) and preferred titles.
 */

const { apiPool } = require('../config/apiPool');

class JobMatcher {
  /**
   * Filter and rank job listings from page text/links for fresher or target roles
   */
  async matchRolesFromPage(jobListings, preferences, resumeSkills = []) {
    if (!jobListings || jobListings.length === 0) return [];

    const isFresherTarget = (preferences.experienceLevel || '').toLowerCase().includes('fresher') ||
                            (preferences.experienceLevel || '').includes('0-1');
    const preferredRoles = (preferences.preferredRoles || ['Software Engineer']).map(r => r.toLowerCase());

    const seniorKeywords = ['senior', 'sr.', 'lead', 'principal', 'staff', 'manager', 'director', 'vp', 'head of', 'architect'];
    const fresherKeywords = ['fresher', 'graduate', 'entry', 'junior', 'jr.', 'associate', 'trainee', 'intern', 'early career', 'new grad'];

    const scoredJobs = jobListings.map(job => {
      const titleLower = (job.title || '').toLowerCase();
      let score = 50; // base score

      // Check senior exclusions
      const isSenior = seniorKeywords.some(kw => titleLower.includes(kw));
      if (isFresherTarget && isSenior) {
        return { ...job, matchScore: 10, isEligible: false, reason: 'Requires senior/management experience' };
      }

      // Check fresher keywords bonus
      const hasFresherTag = fresherKeywords.some(kw => titleLower.includes(kw));
      if (hasFresherTag) {
        score += 30;
      }

      // Check title match against preferred roles
      const matchesPreferred = preferredRoles.some(pref => {
        const words = pref.split(' ');
        return words.every(w => titleLower.includes(w)) || titleLower.includes(pref);
      });

      if (matchesPreferred) {
        score += 25;
      }

      // Cap at 99%
      score = Math.min(score, 99);

      return {
        ...job,
        matchScore: score,
        isEligible: score >= 60,
        isFresherFriendly: hasFresherTag || !isSenior
      };
    });

    // Sort descending by match score
    return scoredJobs.sort((a, b) => b.matchScore - a.matchScore);
  }

  /**
   * AI-powered career page scanner: finds job links on a company careers homepage
   */
  async extractOpenRolesFromHtml(pageUrl, pageContent, targetRole = 'Software Engineer') {
    const prompt = `You are a career portal parser.
We are on the company careers page at "${pageUrl}".
Extract up to 10 open job positions, especially looking for entry-level, graduate, fresher, or junior roles matching "${targetRole}".

PAGE TEXT SNIPPET:
"""
${pageContent.substring(0, 10000)}
"""

OUTPUT FORMAT:
Return valid JSON ONLY:
{
  "jobs": [
    {
      "title": "Exact Job Title",
      "location": "City, Country or Remote",
      "url": "Direct link to job if visible, or null",
      "experienceLevel": "Fresher / Junior / Mid / Senior",
      "isFresherFriendly": true
    }
  ]
}`;

    const systemInstruction = 'You are a career portal extractor. Return ONLY valid JSON.';

    try {
      const response = await apiPool.generateContent({
        prompt,
        systemInstruction
      });

      let cleanText = response.text.trim();
      if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      }

      const parsed = JSON.parse(cleanText);
      return parsed.jobs || [];
    } catch (err) {
      console.warn('[JobMatcher] AI job extraction fallback:', err.message);
      return [];
    }
  }
}

const jobMatcher = new JobMatcher();
module.exports = { jobMatcher, JobMatcher };
