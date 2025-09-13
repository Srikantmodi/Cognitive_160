const express = require('express');
const documentService = require('../services/documentService');
const chatHistoryService = require('../services/chatHistoryService');
const logger = require('../services/logger');

const router = express.Router();

// Simple debug endpoint
router.get('/status', async (req, res) => {
  try {
    await documentService.initialize();
    await chatHistoryService.initialize();
    
    const documentSessions = Array.from(documentService.sessions.keys());
    const chatSessions = Array.from(chatHistoryService.chatSessions.keys());
    const vectorSessions = Array.from(documentService.vectorDB.sessionDocuments.entries());
    const totalDocuments = documentService.vectorDB.getAllDocuments().length;
    
    res.json({
      success: true,
      documentSessions,
      chatSessions,
      vectorSessions,
      totalDocuments,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;