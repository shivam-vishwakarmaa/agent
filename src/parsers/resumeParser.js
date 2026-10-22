/**
 * High-Precision Resume Extractor & Structured Profile Engine
 * Extracts raw text from PDF and structures it into a verified, anti-hallucination JSON profile.
 * Automatically extracts LinkedIn, GitHub, Portfolio, Email, Phone, Education, Experience & Skills.
 */

const fs = require('fs');
const pdfParse = require('pdf-parse');
const { apiPool } = require('../config/apiPool');

class ResumeParser {
  /**
   * Parse PDF file from disk and return structured profile
   */
  async parsePdf(pdfPath) {
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`Resume file not found at: ${pdfPath}`);
    }

    const dataBuffer = fs.readFileSync(pdfPath);
    const pdfData = await pdfParse(dataBuffer);
    const rawText = pdfData.text || '';

    if (rawText.trim().length === 0) {
      throw new Error('PDF appears to be scanned or contains no extractable text.');
    }

    // Step 1: Deep deterministic regex extraction for contact data & online profiles
    const contactData = this.extractContactHeuristics(rawText);

    // Step 2: Use Gemini to accurately extract education, experience, skills, projects AND online profile links
    const structuredData = await this.structureWithAi(rawText);

    // Merge deterministic contact data with AI structured data (prefer most specific)
    const personal = {
      fullName: structuredData.personal?.fullName || contactData.fullName || '',
      firstName: structuredData.personal?.firstName || '',
      lastName: structuredData.personal?.lastName || '',
      email: contactData.email || structuredData.personal?.email || '',
      phone: contactData.phone || structuredData.personal?.phone || '',
      linkedinUrl: contactData.linkedinUrl || structuredData.personal?.linkedinUrl || '',
      githubUrl: contactData.githubUrl || structuredData.personal?.githubUrl || '',
      portfolioUrl: contactData.portfolioUrl || structuredData.personal?.portfolioUrl || '',
      currentCity: structuredData.personal?.currentCity || '',
      state: structuredData.personal?.state || '',
      country: structuredData.personal?.country || 'India',
      postalCode: structuredData.personal?.postalCode || ''
    };

    // If firstName or lastName missing, derive from fullName
    if (!personal.firstName && personal.fullName) {
      const parts = personal.fullName.split(' ');
      personal.firstName = parts[0] || '';
      personal.lastName = parts.slice(1).join(' ') || '';
    }

    const merged = {
      personal,
      summary: structuredData.summary || '',
      education: structuredData.education || [],
      experience: structuredData.experience || [],
      projects: structuredData.projects || [],
      skills: structuredData.skills || { languages: [], frameworks: [], databases: [], tools: [] },
      certifications: structuredData.certifications || [],
      rawText: rawText.substring(0, 8000)
    };

    return merged;
  }

  /**
   * High-accuracy deterministic regex extractors for links, email, and phone
   */
  extractContactHeuristics(text) {
    // Email regex
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

    // Phone regex (International and standard formats)
    const phoneMatch = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+?91[-.\s]?[6-9]\d{9}|\b[6-9]\d{9}\b/);

    // GitHub regex - handles github.com/user, www.github.com/user, git/user, github: user
    let githubUrl = '';
    const githubDirectMatch = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_-]+)/i);
    const githubTagMatch = text.match(/github(?:\.com)?[\s/:]+([a-zA-Z0-9_-]+)/i);
    if (githubDirectMatch) {
      const user = githubDirectMatch[1];
      githubUrl = `https://github.com/${user}`;
    } else if (githubTagMatch && !['com', 'http', 'https', 'profile', 'link'].includes(githubTagMatch[1].toLowerCase())) {
      githubUrl = `https://github.com/${githubTagMatch[1]}`;
    }

    // LinkedIn regex - handles linkedin.com/in/user, www.linkedin.com/in/user, linkedin: user
    let linkedinUrl = '';
    const linkedinDirectMatch = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in|profile)\/([a-zA-Z0-9_%-]+)/i);
    const linkedinTagMatch = text.match(/linkedin(?:\.com)?[\s/:]+(?:in\/)?([a-zA-Z0-9_%-]+)/i);
    if (linkedinDirectMatch) {
      const slug = linkedinDirectMatch[1];
      linkedinUrl = `https://linkedin.com/in/${slug}`;
    } else if (linkedinTagMatch && !['com', 'http', 'https', 'profile', 'link'].includes(linkedinTagMatch[1].toLowerCase())) {
      linkedinUrl = `https://linkedin.com/in/${linkedinTagMatch[1]}`;
    }

    // Portfolio / Personal website regex (excluding linkedin and github)
    let portfolioUrl = '';
    const portfolioMatches = text.match(/(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9_-]+\.(?:dev|me|io|tech|site|online|app|netlify\.app|vercel\.app)\b/gi);
    if (portfolioMatches && portfolioMatches.length > 0) {
      const valid = portfolioMatches.find(u => !u.includes('github') && !u.includes('linkedin'));
      if (valid) {
        portfolioUrl = valid.startsWith('http') ? valid : `https://${valid}`;
      }
    }

    return {
      email: emailMatch ? emailMatch[0].trim() : '',
      phone: phoneMatch ? phoneMatch[0].trim() : '',
      linkedinUrl,
      githubUrl,
      portfolioUrl
    };
  }

  /**
   * Structure raw resume text into JSON using Gemini
   */
  async structureWithAi(rawText) {
    const prompt = `You are a resume parsing specialist.
Analyze this resume text and extract all candidate information, including contact info, social links, education, experience, skills, and projects.
Be thorough and extract GitHub, LinkedIn, and personal portfolio URLs if mentioned anywhere in the resume.

RESUME TEXT:
"""
${rawText.substring(0, 10000)}
"""

OUTPUT SCHEMA (Return valid JSON only):
{
  "personal": {
    "fullName": "Candidate full name",
    "firstName": "First name",
    "lastName": "Last name",
    "email": "Candidate email",
    "phone": "Phone number",
    "linkedinUrl": "Full LinkedIn URL (e.g. https://linkedin.com/in/username)",
    "githubUrl": "Full GitHub URL (e.g. https://github.com/username)",
    "portfolioUrl": "Portfolio or website URL if present",
    "currentCity": "City",
    "state": "State/Province",
    "country": "Country",
    "postalCode": "Postal code"
  },
  "summary": "Professional 2-3 sentence summary",
  "education": [
    {
      "institution": "College or University name",
      "degree": "Degree name (e.g. B.Tech in Computer Science)",
      "fieldOfStudy": "Major/Field",
      "startDate": "YYYY or Month YYYY",
      "endDate": "YYYY or Month YYYY or Present",
      "gradeOrCgpa": "e.g. 8.5/10 or 3.8/4.0"
    }
  ],
  "experience": [
    {
      "company": "Company Name",
      "role": "Job or Intern Title",
      "startDate": "Month YYYY",
      "endDate": "Month YYYY or Present",
      "isCurrent": false,
      "location": "City, Country",
      "highlights": ["Key achievement 1", "Key achievement 2"]
    }
  ],
  "projects": [
    {
      "title": "Project Title",
      "techStack": ["React", "Node.js", "Python"],
      "description": "Brief description of the project and impact",
      "liveUrl": "URL if present",
      "githubUrl": "Repo URL if present"
    }
  ],
  "skills": {
    "languages": ["JavaScript", "Python", "C++"],
    "frameworks": ["React", "Express", "Node.js"],
    "databases": ["MongoDB", "PostgreSQL"],
    "tools": ["Git", "Docker", "VS Code"]
  },
  "certifications": ["Certification name 1", "Certification name 2"]
}

Return ONLY clean, raw JSON. Do not include markdown codeblocks or explanations.`;

    const systemInstruction = 'You are a precise JSON extractor. Output valid, parseable JSON strictly without markdown fences or extraneous text.';

    try {
      const response = await apiPool.generateContent({
        prompt,
        systemInstruction
      });

      let cleanText = response.text.trim();
      if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      }

      return JSON.parse(cleanText);
    } catch (err) {
      console.warn('[ResumeParser] AI structuring fallback to basic heuristic parser:', err.message);
      const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
      const name = lines[0] || 'Applicant';
      const nameParts = name.split(' ');
      return {
        personal: {
          fullName: name,
          firstName: nameParts[0] || name,
          lastName: nameParts.slice(1).join(' ') || '',
          email: '',
          phone: '',
          linkedinUrl: '',
          githubUrl: '',
          portfolioUrl: '',
          currentCity: '',
          state: '',
          country: 'India',
          postalCode: ''
        },
        summary: lines.slice(1, 4).join(' '),
        education: [],
        experience: [],
        projects: [],
        skills: { languages: [], frameworks: [], databases: [], tools: [] },
        certifications: []
      };
    }
  }
}

const resumeParser = new ResumeParser();
module.exports = { resumeParser, ResumeParser };
