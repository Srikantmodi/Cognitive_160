const express = require('express');
const router = express.Router();
const logger = require('../services/logger');
const documentService = require('../services/documentService');

// Search endpoint using enhanced vector search
router.post('/', async (req, res) => {
  try {
    const { query, sessionId } = req.body;
    
    if (!query || !query.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    logger.info(`Search request: "${query}" for session: ${sessionId}`);

    // Check if session exists
    const hasSession = await documentService.hasSession(sessionId || 'demo-session');
    logger.info(`Session exists: ${hasSession}`);

    // Use the enhanced document service for semantic search
    const searchResults = await documentService.searchDocuments(query, sessionId || 'demo-session');
    
    logger.info(`Search completed. Results count: ${searchResults?.results?.length || 0}`);
    
    res.json({
      success: true,
      results: searchResults.results || [],
      query: query,
      sessionId: sessionId || 'demo-session',
      debug: {
        hasSession: hasSession,
        resultCount: searchResults?.results?.length || 0
      }
    });

  } catch (error) {
    logger.error('Search error:', error);
    res.status(500).json({
      success: false,
      message: 'Search failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Summarization endpoint using Granite model
router.post('/summarize', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    logger.info(`Summarization request for session: ${sessionId}`);

    // Use Granite model for summarization
    const summary = await documentService.generateSummary(sessionId, 'granite');
    
    res.json({
      success: true,
      summary: summary,
      sessionId: sessionId,
      model: 'granite'
    });

  } catch (error) {
    logger.error('Summarization error:', error);
    res.status(500).json({
      success: false,
      message: 'Summarization failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;