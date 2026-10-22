/**
 * Job & Role Matcher (Deep DOM & Resume Skill Matching Engine)
 * Ranks real scraped job openings against the candidate's actual resume skills,
 * preferred roles, and experience level (Fresher / Entry-Level).
 */

class JobMatcher {
  /**
   * Filter and rank real scraped jobs against candidate profile & resume skills
   */
  matchRolesFromPage(jobListings, preferences = {}, resumeSkills = {}) {
    if (!jobListings || jobListings.length === 0) return [];

    const isFresherTarget = (preferences.experienceLevel || '').toLowerCase().includes('fresher') ||
                            (preferences.experienceLevel || '').includes('0-1');
    const preferredRoles = (preferences.preferredRoles || ['Software Engineer', 'Developer']).map(r => r.toLowerCase());

    // Extract all candidate skills from resume
    const candidateSkills = [
      ...(resumeSkills.languages || []),
      ...(resumeSkills.frameworks || []),
      ...(resumeSkills.databases || []),
      ...(resumeSkills.tools || [])
    ].map(s => s.toLowerCase().trim()).filter(Boolean);

    const seniorKeywords = ['senior', 'sr.', 'lead', 'principal', 'staff', 'manager', 'director', 'vp', 'head of', 'architect', '5+ years', '8+ years', '10+ years'];
    const fresherKeywords = ['fresher', 'graduate', 'entry', 'junior', 'jr.', 'associate', 'trainee', 'intern', 'early career', 'new grad', '0-1 years', '0-2 years', 'campus'];

    const scoredJobs = jobListings.map(job => {
      const titleLower = (job.title || '').toLowerCase();
      const snippetLower = (job.snippet || '').toLowerCase();
      const combinedText = `${titleLower} ${snippetLower}`;

      let score = 35; // base score for being an open job at target company
      const matchReasons = [];

      // 1. Check senior exclusions
      const isSenior = seniorKeywords.some(kw => combinedText.includes(kw));
      if (isFresherTarget && isSenior) {
        return {
          ...job,
          matchScore: 15,
          isEligible: false,
          isFresherFriendly: false,
          matchedSkills: [],
          reason: 'Excluded: Requires senior or leadership experience (not fresher-friendly).'
        };
      }

      // 2. Check fresher keywords bonus
      const hasFresherTag = fresherKeywords.some(kw => combinedText.includes(kw));
      if (hasFresherTag) {
        score += 30;
        matchReasons.push('Explicitly tagged as Fresher / Entry-Level');
      }

      // 3. Check title match against candidate's preferred roles
      const matchesPreferred = preferredRoles.some(pref => {
        const words = pref.split(' ');
        return words.every(w => titleLower.includes(w)) || titleLower.includes(pref);
      });

      if (matchesPreferred) {
        score += 25;
        matchReasons.push('Direct match with your preferred role');
      }

      // 4. Compare against candidate's actual resume skills
      const matchedSkillsFound = [];
      for (const skill of candidateSkills) {
        if (skill.length >= 2 && combinedText.includes(skill)) {
          matchedSkillsFound.push(skill);
        }
      }

      if (matchedSkillsFound.length > 0) {
        const skillBonus = Math.min(matchedSkillsFound.length * 6, 25);
        score += skillBonus;
        matchReasons.push(`Matches ${matchedSkillsFound.length} of your skills: [${matchedSkillsFound.slice(0, 4).join(', ')}]`);
      }

      // Cap at 98%
      score = Math.min(score, 98);

      return {
        ...job,
        matchScore: score,
        isEligible: score >= 55,
        isFresherFriendly: hasFresherTag || !isSenior,
        matchedSkills: matchedSkillsFound,
        reason: matchReasons.length > 0 ? matchReasons.join('. ') : 'Potential entry-level position matching general tech stack.'
      };
    });

    // Sort descending by match score
    return scoredJobs.sort((a, b) => b.matchScore - a.matchScore);
  }
}

const jobMatcher = new JobMatcher();
module.exports = { jobMatcher, JobMatcher };
