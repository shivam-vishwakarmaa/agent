/**
 * AI Query Normalizer & Semantic Role Taxonomy Engine
 * 1. Corrects typos and misspellings in tech job queries (e.g. "softwaer enginer" -> "software engineer")
 * 2. Semantically expands broad roles (e.g. "software engineer" -> frontend, backend, full stack, SDE, platform, etc.)
 * 3. Provides Levenshtein-based fuzzy string matching for resilient keyword comparison
 */

class QueryNormalizer {
  constructor() {
    // Canonical tech keywords dictionary for typo auto-correction
    this.canonicalDictionary = [
      'software', 'engineer', 'developer', 'engineering', 'development',
      'frontend', 'backend', 'fullstack', 'associate', 'trainee',
      'intern', 'internship', 'analyst', 'systems', 'platform',
      'devops', 'cloud', 'data', 'machine', 'learning',
      'application', 'programmer', 'architect', 'infrastructure',
      'python', 'java', 'golang', 'javascript', 'typescript',
      'react', 'angular', 'node', 'docker', 'kubernetes',
      'database', 'sql', 'nosql', 'golang', 'fresher', 'graduate'
    ];

    // Common misspelling mapping for instant lookup
    this.commonTypos = {
      'softwaer': 'software',
      'softwere': 'software',
      'sftware': 'software',
      'sofftware': 'software',
      'softwar': 'software',
      'enginer': 'engineer',
      'engneer': 'engineer',
      'enginner': 'engineer',
      'enigneer': 'engineer',
      'engnr': 'engineer',
      'devloper': 'developer',
      'devlopr': 'developer',
      'develepor': 'developer',
      'developr': 'developer',
      'fontend': 'frontend',
      'fronend': 'frontend',
      'front-end': 'frontend',
      'bakend': 'backend',
      'backnd': 'backend',
      'back-end': 'backend',
      'fulstack': 'fullstack',
      'fullstck': 'fullstack',
      'full-stack': 'fullstack',
      'pytn': 'python',
      'pythn': 'python',
      'jva': 'java',
      'javascrip': 'javascript',
      'typescrip': 'typescript',
      'asociate': 'associate',
      'asocciate': 'associate',
      'tranee': 'trainee',
      'trainie': 'trainee',
      'dockr': 'docker',
      'kubernets': 'kubernetes'
    };

    // Semantic Role Taxonomy: Maps broad categories to sub-roles, aliases & tech titles
    this.roleTaxonomy = {
      'software engineer': [
        'software engineer', 'software developer', 'sde', 'sde 1', 'sde-1', 'sde i',
        'associate software engineer', 'application developer', 'application development associate',
        'backend engineer', 'backend developer', 'junior backend engineer',
        'frontend engineer', 'frontend developer', 'ui engineer', 'ui developer', 'web developer',
        'full stack developer', 'fullstack engineer', 'full stack engineer',
        'platform engineer', 'systems engineer', 'systems software engineer',
        'programmer analyst trainee', 'pat', 'genc developer', 'graduate engineer trainee', 'get',
        'cloud engineer', 'devops engineer', 'site reliability engineer', 'sre',
        'junior software engineer', 'entry level software engineer', 'fresher engineer'
      ],
      'developer': [
        'developer', 'software developer', 'web developer', 'backend developer',
        'frontend developer', 'full stack developer', 'mobile developer',
        'application developer', 'python developer', 'java developer', 'golang developer'
      ],
      'data engineer': [
        'data engineer', 'associate data engineer', 'big data engineer',
        'data platform engineer', 'etl developer', 'data analyst'
      ],
      'devops engineer': [
        'devops engineer', 'cloud engineer', 'infrastructure engineer',
        'site reliability engineer', 'sre', 'platform engineer'
      ]
    };
  }

  /**
   * Calculate Levenshtein edit distance between two strings
   */
  levenshtein(a, b) {
    const an = a.length;
    const bn = b.length;
    if (an === 0) return bn;
    if (bn === 0) return an;

    const matrix = [];
    for (let i = 0; i <= bn; i++) matrix[i] = [i];
    for (let j = 0; j <= an; j++) matrix[0][j] = j;

    for (let i = 1; i <= bn; i++) {
      for (let j = 1; j <= an; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }
    return matrix[bn][an];
  }

  /**
   * Find closest correct word if word has a typo
   */
  correctWord(word) {
    const w = word.toLowerCase().trim();
    if (this.commonTypos[w]) return this.commonTypos[w];
    if (this.canonicalDictionary.includes(w)) return w;
    if (w.length < 4) return w; // don't auto-correct tiny words or acronyms like "go", "c", "aws"

    let bestMatch = w;
    let minDistance = Infinity;

    for (const dictWord of this.canonicalDictionary) {
      const dist = this.levenshtein(w, dictWord);
      // Allow max distance of 1 for 4-5 chars, max 2 for 6+ chars
      const threshold = dictWord.length > 5 ? 2 : 1;
      if (dist <= threshold && dist < minDistance) {
        minDistance = dist;
        bestMatch = dictWord;
      }
    }

    return bestMatch;
  }

  /**
   * Corrects typos in full queries: "softwaer enginer" -> "software engineer"
   */
  normalizeQuery(query) {
    if (!query || typeof query !== 'string') return '';
    const words = query.trim().split(/\s+/);
    const correctedWords = words.map(w => this.correctWord(w));
    const normalized = correctedWords.join(' ');
    
    return {
      original: query,
      corrected: normalized,
      hasCorrection: normalized.toLowerCase() !== query.toLowerCase()
    };
  }

  /**
   * Check if a job title matches a query or its semantic taxonomy
   * e.g. query "Software Engineer" matches "Frontend Engineer", "Junior Backend Developer", "SDE 1", etc.
   */
  isSemanticMatch(jobTitle, targetQuery) {
    if (!jobTitle || !targetQuery) return false;
    const titleLower = jobTitle.toLowerCase();
    const queryLower = targetQuery.toLowerCase();

    // 1. Exact or substring match
    if (titleLower.includes(queryLower)) return true;

    // 2. Corrected query match
    const { corrected } = this.normalizeQuery(queryLower);
    if (titleLower.includes(corrected)) return true;

    // 3. Check Taxonomy: If target is "Software Engineer" or "Developer", check all sub-roles
    for (const [category, subRoles] of Object.entries(this.roleTaxonomy)) {
      const isTargetInCategory = queryLower.includes(category) || 
                                 corrected.includes(category) ||
                                 subRoles.some(r => queryLower.includes(r) || corrected.includes(r));

      if (isTargetInCategory) {
        // Check if job title matches ANY sub-role in this category
        const matchedSubRole = subRoles.some(subRole => titleLower.includes(subRole));
        if (matchedSubRole) {
          return true;
        }
      }
    }

    // 4. Fuzzy token matching (matches if 75% of key tokens match with edit distance <= 1)
    const queryTokens = corrected.split(/\s+/).filter(t => t.length > 2);
    const titleTokens = titleLower.split(/[\s\-_/\\,]+/).filter(t => t.length > 2);

    let tokenMatches = 0;
    for (const qToken of queryTokens) {
      const found = titleTokens.some(tToken => {
        if (tToken === qToken) return true;
        if (Math.abs(tToken.length - qToken.length) <= 1 && this.levenshtein(tToken, qToken) <= 1) return true;
        return false;
      });
      if (found) tokenMatches++;
    }

    return tokenMatches > 0 && (tokenMatches / queryTokens.length >= 0.7);
  }

  /**
   * Returns list of all sub-roles for a query
   * e.g. "Software Engineer" returns Frontend, Backend, Full Stack, SDE, Platform, etc.
   */
  getExpandedRoles(targetQuery) {
    const { corrected } = this.normalizeQuery(targetQuery || 'Software Engineer');
    const q = corrected.toLowerCase();

    for (const [category, subRoles] of Object.entries(this.roleTaxonomy)) {
      if (q.includes(category) || subRoles.some(r => q.includes(r))) {
        return subRoles;
      }
    }

    return [corrected];
  }
}

const queryNormalizer = new QueryNormalizer();
module.exports = { queryNormalizer, QueryNormalizer };
