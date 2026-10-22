/**
 * Autonomous AI Job Discovery Engine (India & Global IT Portals)
 * Automatically discovers active hiring companies and fresh graduate openings in India
 * without requiring the user to manually find and paste career links.
 */

const { apiPool } = require('../config/apiPool');

class JobFinder {
  constructor() {
    // Verified high-volume fresher recruiting career portals in India
    this.verifiedIndiaPortals = [
      {
        company: 'Accenture India',
        careersUrl: 'https://www.accenture.com/in-en/careers/jobsearch',
        typicalFresherRole: 'Associate Software Engineer (ASE) / Application Development Associate',
        locations: 'Pune, Bengaluru, Hyderabad, Mumbai, Gurugram, Chennai',
        experienceRequired: 'Fresher (0 - 11 months)',
        hiringStatus: 'Actively Hiring',
        tags: ['IT Services', 'Top Recruiter', 'Fresher Friendly']
      },
      {
        company: 'Rakuten',
        careersUrl: 'https://japan-job-en.rakuten.careers/search-jobs/Software/31066/1',
        typicalFresherRole: 'Associate Software Engineer / Junior Backend Engineer',
        locations: 'Bengaluru, Pune, Remote, Global',
        experienceRequired: '0 - 1 YOE',
        hiringStatus: 'Actively Hiring',
        tags: ['Product Company', 'Tech Giant', 'High Pay']
      },
      {
        company: 'Cognizant (CTS)',
        careersUrl: 'https://careers.cognizant.com/global/en/c/it-software-engineering-jobs',
        typicalFresherRole: 'Programmer Analyst Trainee (PAT) / GenC Developer',
        locations: 'Pune, Chennai, Bengaluru, Kolkata, Coimbatore',
        experienceRequired: 'Fresher (2024 - 2028 batch)',
        hiringStatus: 'Campus & Off-Campus Active',
        tags: ['IT Services', 'Fresher Cohort']
      },
      {
        company: 'Razorpay',
        careersUrl: 'https://razorpay.com/careers/',
        typicalFresherRole: 'Software Development Engineer - 1 (SDE 1)',
        locations: 'Bengaluru, Remote',
        experienceRequired: '0 - 1 YOE',
        hiringStatus: 'Actively Hiring',
        tags: ['Fintech', 'Product / Startup', 'Top Engineering']
      },
      {
        company: 'Capgemini India',
        careersUrl: 'https://www.capgemini.com/in-en/careers/join-us/',
        typicalFresherRole: 'Software Analyst / Associate Software Engineer',
        locations: 'Pune, Mumbai, Bengaluru, Hyderabad',
        experienceRequired: 'Fresher (0 - 1 YOE)',
        hiringStatus: 'Active Openings',
        tags: ['Global Consulting', 'Enterprise']
      },
      {
        company: 'Persistent Systems',
        careersUrl: 'https://careers.persistent.com/',
        typicalFresherRole: 'Software Engineer - Trainee',
        locations: 'Pune, Hyderabad, Bengaluru, Goa',
        experienceRequired: 'Fresher / 0-1 YOE',
        hiringStatus: 'Actively Recruiting',
        tags: ['Product Engineering', 'Pune HQ']
      },
      {
        company: 'Tata Consultancy Services (TCS)',
        careersUrl: 'https://www.tcs.com/careers/india',
        typicalFresherRole: 'TCS Digital / Ninja Engineer',
        locations: 'Pan India',
        experienceRequired: 'Fresher (B.Tech / IT)',
        hiringStatus: 'National Qualifier Test (NQT)',
        tags: ['MNC', 'Mass Hiring']
      },
      {
        company: 'Swiggy',
        careersUrl: 'https://careers.swiggy.in/',
        typicalFresherRole: 'Software Development Engineer 1 (Backend/FullStack)',
        locations: 'Bengaluru, Remote',
        experienceRequired: '0 - 2 YOE',
        hiringStatus: 'Engineering Openings',
        tags: ['Unicorn', 'High Scale']
      },
      {
        company: 'Josh Technology Group',
        careersUrl: 'https://www.joshtechnologygroup.com/careers/',
        typicalFresherRole: 'Software Development Engineer (Backend / Systems)',
        locations: 'Gurugram, Pune, Remote',
        experienceRequired: 'Fresher / Early Career',
        hiringStatus: 'Actively Hiring',
        tags: ['High Compensation', 'Algorithms / Systems']
      },
      {
        company: 'Zoho Corporation',
        careersUrl: 'https://www.zoho.com/careers/',
        typicalFresherRole: 'Software Developer / Product Engineer',
        locations: 'Chennai, Salem, Tirunelveli, Remote',
        experienceRequired: 'Fresher friendly (no cutoff)',
        hiringStatus: 'Continuous Evaluation',
        tags: ['Bootstrapped Product', 'SaaS']
      }
    ];
  }

  /**
   * Discovers fresh hiring companies and roles tailored to candidate's skills and location
   */
  async discoverHiringPortals(targetRole = 'Software Engineer', location = 'India', candidateSkills = []) {
    // If Gemini API is available, ask Gemini to retrieve real-time hiring companies
    if (apiPool.keys.length > 0) {
      try {
        const prompt = `You are a tech recruitment intelligence specialist for India.
Candidate Profile:
- Role Target: "${targetRole}"
- Experience: Fresher / Entry-Level (0-1 YOE)
- Candidate Skills: ${candidateSkills.slice(0, 8).join(', ') || 'Go, Python, Java, React, SQL, Docker'}
- Location: "${location}"

Generate a list of 10 real companies in India (mix of top IT recruiters, fintechs, and product tech companies) that actively hire Freshers and Junior Software Engineers right now.
For each company, provide:
1. Exact Company Name
2. Official Career Portal URL
3. Typical entry-level / fresher job title
4. Main locations in India
5. Hiring tags (e.g. "Product", "Fintech", "IT Services", "High Pay")

OUTPUT FORMAT (Return valid JSON only):
{
  "companies": [
    {
      "company": "Company Name",
      "careersUrl": "https://careers.company.com",
      "typicalFresherRole": "Associate Software Engineer",
      "locations": "Bengaluru, Pune, Remote",
      "experienceRequired": "Fresher (0-1 YOE)",
      "hiringStatus": "Actively Hiring",
      "tags": ["Product", "Fresher Friendly"]
    }
  ]
}`;

        const systemInstruction = 'You are a career portal discovery engine. Return ONLY valid JSON.';
        const response = await apiPool.generateContent({ prompt, systemInstruction });

        let cleanText = response.text.trim();
        if (cleanText.startsWith('```')) {
          cleanText = cleanText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
        }

        const parsed = JSON.parse(cleanText);
        if (parsed.companies && parsed.companies.length > 0) {
          return parsed.companies;
        }
      } catch (err) {
        console.warn('[JobFinder] AI discovery fallback to verified India portals list:', err.message);
      }
    }

    // Default verified high-yield portals list
    return this.verifiedIndiaPortals;
  }
}

const jobFinder = new JobFinder();
module.exports = { jobFinder, JobFinder };
