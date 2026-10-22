/**
 * High-Precision Resume Extractor & Structured Profile Engine
 * Extracts raw text from PDF and structures it into a verified, anti-hallucination JSON profile.
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

    // Step 1: Deterministic regex extraction for high-confidence contact data
    const contactData = this.extractContactHeuristics(rawText);

    // Step 2: Use Gemini to accurately structure education, experience, skills, and projects
    const structuredData = await this.structureWithAi(rawText);

    // Merge deterministic contact data with AI structured data
    const merged = {
      ...structuredData,
      personal: {
        ...structuredData.personal,
        email: contactData.email || structuredData.personal?.email || '',
        phone: contactData.phone || structuredData.personal?.phone || '',
        linkedinUrl: contactData.linkedinUrl || structuredData.personal?.linkedinUrl || '',
        githubUrl: contactData.githubUrl || structuredData.personal?.githubUrl || '',
        portfolioUrl: contactData.portfolioUrl || structuredData.personal?.portfolioUrl || ''
      },
      rawText: rawText.substring(0, 8000) // Keep preview
    };

    return merged;
  }

  /**
   * High-accuracy deterministic regex extractors
   */
  extractContactHeuristics(text) {
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const phoneMatch = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+?91[-.\s]?\d{10}/);
    const linkedinMatch = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/i);
    const githubMatch = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[a-zA-Z0-9_-]+/i);
    const portfolioMatch = text.match(/(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9_-]+\.(?:dev|me|io|in|com)\b/i);

    return {
      email: emailMatch ? emailMatch[0].trim() : '',
      phone: phoneMatch ? phoneMatch[0].trim() : '',
      linkedinUrl: linkedinMatch ? (linkedinMatch[0].startsWith('http') ? linkedinMatch[0] : `https://${linkedinMatch[0]}`) : '',
      githubUrl: githubMatch ? (githubMatch[0].startsWith('http') ? githubMatch[0] : `https://${githubMatch[0]}`) : '',
      portfolioUrl: portfolioMatch && !portfolioMatch[0].includes('linkedin') && !portfolioMatch[0].includes('github') 
        ? (portfolioMatch[0].startsWith('http') ? portfolioMatch[0] : `https://${portfolioMatch[0]}`) 
        : ''
    };
  }

  /**
   * Structure raw resume text into JSON using Gemini
   */
  async structureWithAi(rawText) {
    const prompt = `You are a resume parsing specialist. Analyze this resume text and output ONLY valid JSON matching the exact schema below.

RESUME TEXT:
"""
${rawText.substring(0, 10000)}
"""

OUTPUT SCHEMA:
{
  "personal": {
    "fullName": "Candidate full name",
    "firstName": "First name",
    "lastName": "Last name",
    "email": "Candidate email",
    "phone": "Phone number",
    "currentCity": "City",
    "state": "State/Province",
    "country": "Country",
    "postalCode": "Pin or Postal code if mentioned"
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
      // Strip ```json and ``` if present
      if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      }

      return JSON.parse(cleanText);
    } catch (err) {
      console.warn('[ResumeParser] AI structuring fallback to basic heuristic parser:', err.message);
      // Fallback if AI call failed (e.g. no keys set yet)
      const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
      const name = lines[0] || 'Applicant';
      const nameParts = name.split(' ');
      return {
        personal: {
          fullName: name,
          firstName: nameParts[0] || name,
          lastName: nameParts.slice(1).join(' ') || ''
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
