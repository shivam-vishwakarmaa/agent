/**
 * Multi-API Key Failover Pool & Rate-Limit Manager
 * Automatically handles multiple Google Gemini API keys.
 * If Key 1 hits a 429 (Resource Exhausted / Rate Limit), it marks Key 1 on a cooldown
 * and immediately fails over to Key 2 with zero lost context and zero downtime.
 */

const { GoogleGenAI } = require('@google/genai');

class ApiKeyPool {
  constructor(initialKeys = []) {
    this.keys = [];
    this.defaultModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    this.currentIndex = 0;
    
    // Load from environment if available
    const envKeys = (process.env.GEMINI_API_KEYS || '')
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);

    const allKeys = [...new Set([...envKeys, ...initialKeys])];
    allKeys.forEach(key => this.addKey(key));
  }

  addKey(key) {
    if (!key || typeof key !== 'string') return;
    const cleanKey = key.trim();
    if (this.keys.some(k => k.key === cleanKey)) return;

    this.keys.push({
      id: `key_${this.keys.length + 1}`,
      key: cleanKey,
      masked: `${cleanKey.substring(0, 6)}...${cleanKey.slice(-4)}`,
      status: 'active', // 'active' | 'cooldown' | 'error'
      cooldownUntil: 0,
      successCount: 0,
      failCount: 0,
      lastError: null,
      lastUsedAt: 0
    });
  }

  removeKey(keyOrId) {
    this.keys = this.keys.filter(k => k.key !== keyOrId && k.id !== keyOrId);
  }

  getStatus() {
    const now = Date.now();
    return this.keys.map(k => {
      // Check if cooldown has expired
      const isCooldown = k.status === 'cooldown' && k.cooldownUntil > now;
      const currentStatus = isCooldown ? 'cooldown' : (k.status === 'cooldown' ? 'active' : k.status);
      return {
        id: k.id,
        masked: k.masked,
        status: currentStatus,
        remainingCooldownSec: isCooldown ? Math.ceil((k.cooldownUntil - now) / 1000) : 0,
        successCount: k.successCount,
        failCount: k.failCount,
        lastError: k.lastError
      };
    });
  }

  getNextAvailableKey() {
    const now = Date.now();
    const activeKeys = this.keys.filter(k => {
      if (k.status === 'cooldown' && k.cooldownUntil <= now) {
        k.status = 'active'; // Cooldown finished
        k.lastError = null;
      }
      return k.status === 'active';
    });

    if (activeKeys.length === 0) {
      // If all keys are in cooldown, find the one that expires the soonest
      const soonest = [...this.keys].sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0];
      return soonest || null;
    }

    // Round-robin selection among active keys
    this.currentIndex = (this.currentIndex + 1) % activeKeys.length;
    return activeKeys[this.currentIndex];
  }

  /**
   * Execute a Gemini prompt with automatic failover across keys
   */
  async generateContent({ prompt, systemInstruction = '', responseSchema = null, model = null }) {
    if (this.keys.length === 0) {
      throw new Error('No Gemini API keys configured. Please add at least one API key in settings.');
    }

    const targetModel = model || this.defaultModel;
    let attempts = 0;
    const maxAttempts = Math.max(this.keys.length * 2, 3);
    const errorsEncountered = [];

    while (attempts < maxAttempts) {
      attempts++;
      const keyObj = this.getNextAvailableKey();
      
      if (!keyObj) {
        throw new Error('All API keys are currently in cooldown or unavailable. Please wait a moment or add another key.');
      }

      const now = Date.now();
      if (keyObj.status === 'cooldown' && keyObj.cooldownUntil > now) {
        const waitTimeMs = Math.min(keyObj.cooldownUntil - now, 5000);
        console.warn(`[API Pool] All keys busy. Waiting ${Math.ceil(waitTimeMs / 1000)}s for key ${keyObj.id}...`);
        await new Promise(r => setTimeout(r, waitTimeMs));
      }

      keyObj.lastUsedAt = Date.now();

      try {
        const ai = new GoogleGenAI({ apiKey: keyObj.key });
        const config = {};
        if (systemInstruction) {
          config.systemInstruction = systemInstruction;
        }
        if (responseSchema) {
          config.responseMimeType = 'application/json';
          config.responseSchema = responseSchema;
        }

        const response = await ai.models.generateContent({
          model: targetModel,
          contents: prompt,
          config
        });

        keyObj.status = 'active';
        keyObj.successCount++;
        keyObj.lastError = null;

        const text = response.text || '';
        return {
          text,
          keyUsed: keyObj.id,
          model: targetModel
        };

      } catch (err) {
        const errMsg = err.message || String(err);
        keyObj.failCount++;
        keyObj.lastError = errMsg;
        errorsEncountered.push(`Key ${keyObj.id}: ${errMsg}`);

        const isRateLimit = errMsg.includes('429') || 
                            errMsg.includes('RESOURCE_EXHAUSTED') || 
                            errMsg.includes('Quota exceeded') ||
                            errMsg.includes('rate limit');

        if (isRateLimit) {
          console.warn(`[API Pool] Rate limit (429) hit on ${keyObj.id}. Putting on 60s cooldown and rotating to next key...`);
          keyObj.status = 'cooldown';
          keyObj.cooldownUntil = Date.now() + 60 * 1000; // 60s cooldown
        } else if (errMsg.includes('API_KEY_INVALID') || errMsg.includes('403') || errMsg.includes('key not valid')) {
          console.error(`[API Pool] Invalid API key on ${keyObj.id}. Marking as error.`);
          keyObj.status = 'error';
        } else {
          // Other transient error, brief 10s cooldown
          console.warn(`[API Pool] Error on ${keyObj.id}: ${errMsg}. Retrying with next key...`);
          keyObj.status = 'cooldown';
          keyObj.cooldownUntil = Date.now() + 10 * 1000;
        }
      }
    }

    throw new Error(`Failed to generate content after failover attempts:\n${errorsEncountered.join('\n')}`);
  }
}

// Singleton instance
const apiPool = new ApiKeyPool();

module.exports = { apiPool, ApiKeyPool };
