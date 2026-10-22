/**
 * Multilingual & Grounded Screener Q&A Answering Engine
 * Handles complex question forms (Rakuten, Workday, etc.), automatically translates
 * foreign language questions, and generates strictly grounded, anti-hallucination answers.
 */

const { apiPool } = require('../config/apiPool');
const { sessionStore } = require('../state/sessionStore');

class ScreenerQnA {
  /**
   * Answer a batch of screener/custom form questions in a single token-efficient LLM call
   */
  async answerQuestions(questions, jobContext = {}) {
    if (!questions || questions.length === 0) return {};

    const profile = sessionStore.getProfile();
    const results = {};
    const questionsNeedingAi = [];

    // Step 1: Check existing answer history or deterministic fallbacks first (0 tokens!)
    for (const q of questions) {
      const qText = q.label || q.name || '';
      const cached = sessionStore.getExistingAnswer(qText);
      if (cached) {
        results[q.index] = cached;
        continue;
      }

      // Check standard deterministic matchers (sponsorship, notice period, fresher role, relocation)
      const deterministicAnswer = this.checkDeterministicFallback(q, profile);
      if (deterministicAnswer !== null) {
        results[q.index] = deterministicAnswer;
        sessionStore.saveAnswerHistory(qText, deterministicAnswer);
        continue;
      }

      questionsNeedingAi.push(q);
    }

    if (questionsNeedingAi.length === 0) {
      return results;
    }

    // Step 2: Use Gemini with structured context for the remaining complex/multilingual questions
    const aiAnswers = await this.generateAiAnswers(questionsNeedingAi, profile, jobContext);
    
    // Merge AI answers and cache them
    for (const [idx, ans] of Object.entries(aiAnswers)) {
      results[idx] = ans;
      const matchingQ = questionsNeedingAi.find(q => String(q.index) === String(idx));
      if (matchingQ) {
        sessionStore.saveAnswerHistory(matchingQ.label || matchingQ.name, ans);
      }
    }

    return results;
  }

  /**
   * Deterministic zero-token rules for standard questions
   */
  checkDeterministicFallback(field, profile) {
    const text = (field.label || field.name || '').toLowerCase();
    const prefs = profile.preferences || {};
    const personal = profile.personal || {};

    // Notice period
    if (text.includes('notice period') || text.includes('how soon can you start') || text.includes('earliest start date')) {
      if (field.options && field.options.length > 0) {
        const immediate = field.options.find(o => o.text.toLowerCase().includes('immediate') || o.text.includes('0'));
        if (immediate) return immediate.value || immediate.text;
      }
      return prefs.noticePeriodDays === 0 ? 'Immediate / 0 days' : `${prefs.noticePeriodDays} days`;
    }

    // Work authorization / Sponsorship
    if (text.includes('sponsorship') || text.includes('authorized to work') || text.includes('visa')) {
      const requires = prefs.requiresSponsorship;
      if (field.options && field.options.length > 0) {
        if (text.includes('require sponsorship') || text.includes('will you now or in the future require')) {
          const opt = field.options.find(o => o.text.toLowerCase() === (requires ? 'yes' : 'no'));
          if (opt) return opt.value || opt.text;
        } else if (text.includes('authorized to work')) {
          const opt = field.options.find(o => o.text.toLowerCase() === 'yes');
          if (opt) return opt.value || opt.text;
        }
      }
      return requires ? 'Yes' : 'No';
    }

    // Willing to relocate
    if (text.includes('relocate') || text.includes('willing to move')) {
      if (field.options && field.options.length > 0) {
        const yesOpt = field.options.find(o => o.text.toLowerCase() === 'yes');
        if (yesOpt) return yesOpt.value || yesOpt.text;
      }
      return prefs.willingToRelocate ? 'Yes' : 'No';
    }

    // Date of Birth
    if (text.includes('birth') || text.includes('dob') || text.includes('date of birth')) {
      return personal.dateOfBirth || '';
    }

    // Gender
    if (text.includes('gender')) {
      if (field.options && field.options.length > 0) {
        const match = field.options.find(o => o.text.toLowerCase().includes(personal.gender?.toLowerCase() || 'decline') || o.text.toLowerCase().includes('not to say'));
        if (match) return match.value || match.text;
      }
      return personal.gender || 'Prefer not to say';
    }

    return null;
  }

  /**
   * Gemini Multilingual & Anti-Hallucination Question Answering
   */
  async generateAiAnswers(questions, profile, jobContext) {
    const compactProfile = {
      fullName: profile.personal.fullName,
      education: profile.education || profile.resume.education,
      experience: profile.experience || profile.resume.experience,
      skills: profile.skills || profile.resume.skills,
      projects: profile.projects || profile.resume.projects,
      experienceLevel: profile.preferences.experienceLevel,
      willingToRelocate: profile.preferences.willingToRelocate
    };

    const formattedQuestions = questions.map(q => {
      let desc = `ID: ${q.index}\nQuestion: "${q.label || q.name}"\nType: ${q.type}`;
      if (q.options && q.options.length > 0) {
        desc += `\nAllowed Options: ${JSON.stringify(q.options.map(o => o.text))}`;
      }
      return desc;
    }).join('\n---\n');

    const prompt = `You are an elite, truthful candidate application assistant.
Answer the following job application questions for target company "${jobContext.companyName || 'the employer'}" and role "${jobContext.jobTitle || 'Target Role'}".

CANDIDATE FACTS & RESUME:
${JSON.stringify(compactProfile, null, 2)}

INSTRUCTIONS:
1. MULTILINGUAL SUPPORT: If any question is in Japanese (e.g., 志望動機 / 職歴 / 自己PR), German, or another language, interpret it accurately and answer in natural, professional Japanese/target language or English as appropriate for that field.
2. TRUTHFUL & GROUNDED: Never invent fake past companies or degrees. Highlight the candidate's actual projects, languages, and skills from the facts provided.
3. FOR DROPDOWNS/OPTIONS: If "Allowed Options" are provided, your answer MUST EXACTLY match one of the allowed option strings.
4. Output valid JSON in the format:
{
  "answers": [
    { "id": 1, "answer": "Exact answer text" },
    { "id": 2, "answer": "Exact answer text" }
  ]
}

QUESTIONS TO ANSWER:
${formattedQuestions}`;

    const systemInstruction = 'You are an intelligent, multilingual job application assistant. Generate grounded, concise, professional answers in valid JSON format.';

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
      const outputMap = {};
      (parsed.answers || []).forEach(item => {
        outputMap[item.id] = item.answer;
      });
      return outputMap;
    } catch (err) {
      console.error('[ScreenerQnA] Error generating AI answers:', err.message);
      return {};
    }
  }
}

const screenerQnA = new ScreenerQnA();
module.exports = { screenerQnA, ScreenerQnA };
