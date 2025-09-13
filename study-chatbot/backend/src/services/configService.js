const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class ConfigService {
  constructor() {
    this.config = this.loadConfiguration();
    this.sessions = new Map();
    this.validateAPIKeys();
  }

  /**
   * Load configuration from environment variables
   */
  loadConfiguration() {
    return {
      // Server configuration
      port: process.env.PORT || 5000,
      nodeEnv: process.env.NODE_ENV || 'development',
      
      // API Keys
      geminiApiKey: process.env.GEMINI_API_KEY,
      ibmGraniteApiKey: process.env.IBM_GRANITE_API_KEY,
      ibmGraniteUrl: process.env.IBM_GRANITE_URL,
      
      // File upload settings
      maxFileSize: this.parseFileSize(process.env.MAX_FILE_SIZE || '50MB'),
      allowedFileTypes: (process.env.ALLOWED_FILE_TYPES || 'pdf,doc,docx,txt').split(','),
      
      // Vector database
      vectorDbPath: process.env.VECTOR_DB_PATH || './data/vector_store.db',
      embeddingDimension: parseInt(process.env.EMBEDDING_DIMENSION) || 768,
      
      // Security
      jwtSecret: process.env.JWT_SECRET || 'default-secret-change-in-production',
      rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
      rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
      
      // AI Model configuration
      geminiModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
      geminiMaxTokens: parseInt(process.env.GEMINI_MAX_TOKENS) || 8192,
      ibmGraniteModel: process.env.IBM_GRANITE_MODEL || 'ibm/granite-3-8b-instruct',
      maxContextLength: parseInt(process.env.MAX_CONTEXT_LENGTH) || 4000,
      
      // PDF processing
      pdfChunkSize: parseInt(process.env.PDF_CHUNK_SIZE) || 1000,
      pdfOverlap: parseInt(process.env.PDF_OVERLAP) || 200,
      maxPdfPages: parseInt(process.env.MAX_PDF_PAGES) || 100
    };
  }

  /**
   * Validate API keys are present
   */
  validateAPIKeys() {
    const requiredKeys = ['geminiApiKey', 'ibmGraniteApiKey'];
    const missingKeys = requiredKeys.filter(key => !this.config[key] || this.config[key] === 'your_api_key_here');
    
    if (missingKeys.length > 0) {
      logger.warn(`Missing API keys: ${missingKeys.join(', ')}`);
      logger.warn('Please set the required API keys in your .env file');
    } else {
      logger.info('All required API keys are configured');
    }
  }

  /**
   * Parse file size string (e.g., "50MB") to bytes
   */
  parseFileSize(sizeStr) {
    const units = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024
    };
    
    const match = sizeStr.match(/^(\d+)\s*([A-Z]{1,2})$/i);
    if (!match) {
      return 50 * 1024 * 1024; // Default 50MB
    }
    
    const [, size, unit] = match;
    return parseInt(size) * (units[unit.toUpperCase()] || 1);
  }

  /**
   * Create new session
   */
  createSession(userId = null) {
    const sessionId = uuidv4();
    const session = {
      sessionId,
      userId,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      documentIds: [],
      settings: {
        defaultAnswerDepth: 'medium',
        language: 'en',
        theme: 'light'
      },
      stats: {
        documentsUploaded: 0,
        questionsAsked: 0,
        flashcardsGenerated: 0,
        quizzesGenerated: 0
      }
    };
    
    this.sessions.set(sessionId, session);
    logger.info(`Created new session: ${sessionId}`);
    
    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date().toISOString();
    }
    return session;
  }

  /**
   * Update session
   */
  updateSession(sessionId, updates) {
    const session = this.sessions.get(sessionId);
    if (session) {
      Object.assign(session, updates);
      session.lastActivity = new Date().toISOString();
      logger.info(`Updated session: ${sessionId}`);
    }
    return session;
  }

  /**
   * Delete session
   */
  deleteSession(sessionId) {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      logger.info(`Deleted session: ${sessionId}`);
    }
    return deleted;
  }

  /**
   * Add document to session
   */
  addDocumentToSession(sessionId, documentId, filename) {
    const session = this.getSession(sessionId);
    if (session) {
      session.documentIds.push({
        documentId,
        filename,
        uploadedAt: new Date().toISOString()
      });
      session.stats.documentsUploaded++;
      session.lastActivity = new Date().toISOString();
    }
    return session;
  }

  /**
   * Update session statistics
   */
  updateSessionStats(sessionId, statType, increment = 1) {
    const session = this.getSession(sessionId);
    if (session && session.stats.hasOwnProperty(statType)) {
      session.stats[statType] += increment;
      session.lastActivity = new Date().toISOString();
    }
    return session;
  }

  /**
   * Get session statistics
   */
  getSessionStats(sessionId) {
    const session = this.getSession(sessionId);
    return session ? session.stats : null;
  }

  /**
   * Clean up old sessions (older than 24 hours by default)
   */
  cleanupOldSessions(maxAgeHours = 24) {
    const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
    let cleanedCount = 0;
    
    for (const [sessionId, session] of this.sessions) {
      const lastActivity = new Date(session.lastActivity);
      if (lastActivity < cutoffTime) {
        this.sessions.delete(sessionId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} old sessions`);
    }
    
    return cleanedCount;
  }

  /**
   * Get configuration value
   */
  get(key) {
    return this.config[key];
  }

  /**
   * Set configuration value (runtime only)
   */
  set(key, value) {
    this.config[key] = value;
    logger.info(`Configuration updated: ${key} = ${value}`);
  }

  /**
   * Validate file upload
   */
  validateFileUpload(file) {
    const errors = [];
    
    // Check file size
    if (file.size > this.config.maxFileSize) {
      errors.push(`File size exceeds maximum allowed size of ${this.formatFileSize(this.config.maxFileSize)}`);
    }
    
    // Check file type
    const fileExtension = path.extname(file.originalname).toLowerCase().substring(1);
    if (!this.config.allowedFileTypes.includes(fileExtension)) {
      errors.push(`File type .${fileExtension} is not allowed. Allowed types: ${this.config.allowedFileTypes.join(', ')}`);
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${Math.round(size * 100) / 100} ${units[unitIndex]}`;
  }

  /**
   * Get system health information
   */
  getSystemHealth() {
    const memoryUsage = process.memoryUsage();
    
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        used: this.formatFileSize(memoryUsage.heapUsed),
        total: this.formatFileSize(memoryUsage.heapTotal),
        external: this.formatFileSize(memoryUsage.external),
        rss: this.formatFileSize(memoryUsage.rss)
      },
      sessions: {
        active: this.sessions.size,
        total: this.sessions.size
      },
      environment: this.config.nodeEnv,
      apiKeys: {
        gemini: !!this.config.geminiApiKey && this.config.geminiApiKey !== 'your_gemini_api_key_here',
        ibmGranite: !!this.config.ibmGraniteApiKey && this.config.ibmGraniteApiKey !== 'your_ibm_granite_api_key_here'
      }
    };
  }

  /**
   * Export session data for backup
   */
  exportSessionData(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) {
      return null;
    }
    
    return {
      ...session,
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import session data from backup
   */
  importSessionData(sessionData) {
    if (!sessionData.sessionId) {
      throw new Error('Invalid session data: missing sessionId');
    }
    
    this.sessions.set(sessionData.sessionId, {
      ...sessionData,
      importedAt: new Date().toISOString()
    });
    
    logger.info(`Imported session data: ${sessionData.sessionId}`);
    return sessionData.sessionId;
  }
}

module.exports = new ConfigService();