/**
 * Multi-API Key Failover Pool & Rate-Limit Manager
 * Supports single and BATCH key input (paste multiple keys together).
 * Automatically persists keys to data/keys.json so you never lose them on restart.
 * If Key 1 hits a 429 (Resource Exhausted / Rate Limit), it marks Key 1 on a cooldown
 * and immediately fails over to Key 2 with zero lost context and zero downtime.
 */

const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

const KEYS_FILE = path.join(__dirname, '../../data/keys.json');

class ApiKeyPool {
  constructor(initialKeys = []) {
    this.keys = [];
    this.defaultModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    this.currentIndex = 0;
    
    // Load persisted keys from data/keys.json
    const persistedKeys = this.loadPersistedKeys();

    // Load from environment if available
    const envKeys = (process.env.GEMINI_API_KEYS || '')
      .split(/[\n,;]+/)
      .map(k => k.trim())
      .filter(Boolean);

    const allKeys = [...new Set([...persistedKeys, ...envKeys, ...initialKeys])];
    allKeys.forEach(key => this.addKey(key, false));
  }

  loadPersistedKeys() {
    try {
      if (fs.existsSync(KEYS_FILE)) {
        const raw = fs.readFileSync(KEYS_FILE, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (e) {}
    return [];
  }

  savePersistedKeys() {
    try {
      const dataDir = path.dirname(KEYS_FILE);
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const activeRawKeys = this.keys.map(k => k.key);
      fs.writeFileSync(KEYS_FILE, JSON.stringify(activeRawKeys, null, 2), 'utf-8');
    } catch (e) {
      console.error('[ApiKeyPool] Failed to persist keys:', e.message);
    }
  }

  /**
   * Add a single key
   */
  addKey(key, persist = true) {
    if (!key || typeof key !== 'string') return null;
    const cleanKey = key.trim();
    if (cleanKey.length < 10) return null;
    if (this.keys.some(k => k.key === cleanKey)) return null;

    const newKeyObj = {
      id: `key_${this.keys.length + 1}`,
      key: cleanKey,
      masked: `${cleanKey.substring(0, 6)}...${cleanKey.slice(-4)}`,
      status: 'active',
      cooldownUntil: 0,
      successCount: 0,
      failCount: 0,
      lastError: null,
      lastUsedAt: 0
    };

    this.keys.push(newKeyObj);
    if (persist) this.savePersistedKeys();
    return newKeyObj;
  }

  /**
   * Add multiple keys at once (accepts comma, newline, or array)
   */
  addBatchKeys(input) {
    if (!input) return [];
    let keysToAdd = [];
    if (Array.isArray(input)) {
      keysToAdd = input;
    } else if (typeof input === 'string') {
      // Split by commas, newlines, semicolons, or spaces
      keysToAdd = input.split(/[\n,;\s]+/).map(k => k.trim()).filter(Boolean);
    }

    const added = [];
    keysToAdd.forEach(k => {
      const res = this.addKey(k, false);
      if (res) added.push(res);
    });

    if (added.length > 0) {
      this.savePersistedKeys();
    }
    return added;
  }

  removeKey(keyOrId) {
    this.keys = this.keys.filter(k => k.key !== keyOrId && k.id !== keyOrId);
    this.savePersistedKeys();
  }

  getStatus() {
    const now = Date.now();
    return this.keys.map(k => {
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
        k.status = 'active';
        k.lastError = null;
      }
      return k.status === 'active';
    });

    if (activeKeys.length === 0) {
      const soonest = [...this.keys].sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0];
      return soonest || null;
    }

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
          keyObj.cooldownUntil = Date.now() + 60 * 1000;
        } else if (errMsg.includes('API_KEY_INVALID') || errMsg.includes('403') || errMsg.includes('key not valid')) {
          console.error(`[API Pool] Invalid API key on ${keyObj.id}. Marking as error.`);
          keyObj.status = 'error';
        } else {
          console.warn(`[API Pool] Error on ${keyObj.id}: ${errMsg}. Retrying with next key...`);
          keyObj.status = 'cooldown';
          keyObj.cooldownUntil = Date.now() + 10 * 1000;
        }
      }
    }

    throw new Error(`Failed to generate content after failover attempts:\n${errorsEncountered.join('\n')}`);
  }
}

const apiPool = new ApiKeyPool();
module.exports = { apiPool, ApiKeyPool };
