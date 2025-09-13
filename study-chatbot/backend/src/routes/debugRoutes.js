const express = require('express');
const documentService = require('../services/documentService');
const logger = require('../services/logger');

const router = express.Router();

// Debug endpoint to check sessions
router.get('/sessions', async (req, res) => {
  try {
    await documentService.initialize();
    const sessions = Array.from(documentService.sessions.keys());
    const sessionData = {};
    
    for (const sessionId of sessions) {
      const session = documentService.sessions.get(sessionId);
      sessionData[sessionId] = {
        documentsCount: session.documents?.length || 0,
        documentIds: session.documents?.map(doc => doc.documentId) || [],
        createdAt: session.createdAt
      };
    }
    
    // Also check vector DB sessions
    const vectorSessions = Array.from(documentService.vectorDB.sessionDocuments.entries());
    
    res.json({
      success: true,
      sessionsCount: sessions.length,
      sessions: sessionData,
      vectorSessions: vectorSessions
    });
  } catch (error) {
    logger.error('Debug sessions error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;