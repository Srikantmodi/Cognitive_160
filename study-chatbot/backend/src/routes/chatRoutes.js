const express = require('express');
const documentService = require('../services/documentService');
const aiService = require('../services/aiService');
const pdfProcessor = require('../services/simplePdfProcessor');
const configService = require('../services/configService');
const advancedFeatures = require('../services/advancedFeatures');
const chatHistoryService = require('../services/chatHistoryService');
const logger = require('../services/logger');

const router = express.Router();

/**
 * @route POST /api/chat/ask
 * @desc Ask a question and get AI-powered answer
 * @access Public
 */
router.post('/ask', async (req, res) => {
  try {
    const { 
      sessionId, 
      question, 
      depth = 'medium', 
      documentIds = null,
      includeSteps = false 
    } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    if (!question || question.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Question is required'
      });
    }

    // Use enhanced document service for Q&A
    const result = await documentService.askQuestion(question, sessionId, {
      useEnhancedAI: true,
      maxResults: documentIds ? 10 : 15,
      confidenceThreshold: 0.1,
      includeAnalysis: true,
      responseFormat: depth === 'detailed' ? 'comprehensive' : 'standard',
      documentIds: documentIds && documentIds.length > 0 ? documentIds : null
    });

    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: 'No relevant content found. Please upload documents first.'
      });
    }

    // Generate enhanced citations
    const citations = advancedFeatures.generateCitations(result.sources, question);

    // Update session stats
    configService.updateSessionStats(sessionId, 'questionsAsked');

    let stepByStepExplanation = null;
    if (includeSteps) {
      try {
        const learningFeatures = require('../services/learningFeatures');
        stepByStepExplanation = await learningFeatures.generateStepByStepExplanation(
          sessionId, 
          question, 
          { depth }
        );
      } catch (stepError) {
        logger.warn('Could not generate step-by-step explanation:', stepError);
      }
    }

    const response = {
      success: true,
      question,
      answer: result.answer,
      depth,
      citations: citations.citations,
      sources: result.sources,
      analysis: result.analysis,
      timestamp: result.timestamp,
      sessionId,
      enhancedProcessing: true
    };

    if (stepByStepExplanation) {
      response.stepByStepExplanation = stepByStepExplanation;
    }

    // Save chat history
    try {
      await chatHistoryService.initialize();
      
      // Save user message
      chatHistoryService.addMessage(sessionId, {
        type: 'user',
        content: question,
        timestamp: new Date().toISOString()
      });
      
      // Save assistant response
      chatHistoryService.addMessage(sessionId, {
        type: 'assistant',
        content: result.answer,
        sources: result.sources,
        citations: citations.citations,
        timestamp: result.timestamp
      });
      
    } catch (historyError) {
      logger.warn('Failed to save chat history:', historyError);
    }

    res.status(200).json(response);

  } catch (error) {
    logger.error('Error in chat ask endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process question',
      error: error.message
    });
  }
});

/**
 * @route POST /api/chat/search
 * @desc Perform semantic search across documents
 * @access Public
 */
router.post('/search', async (req, res) => {
  try {
    const { 
      sessionId, 
      query, 
      documentIds = null,
      maxResults = 10,
      crossDocument = true 
    } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    if (!query || query.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    // Use enhanced document service for searching
    const searchType = crossDocument ? 'cross-document' : 'semantic';
    const results = await documentService.searchDocuments(query, sessionId, {
      searchType,
      maxResults,
      documentIds: documentIds && documentIds.length > 0 ? documentIds : null,
      includeSnippets: true
    });

    // Generate citations for search results
    const citations = advancedFeatures.generateCitations(
      Array.isArray(results.documents) ? results.documents : results.results || [],
      query
    );

    res.status(200).json({
      success: true,
      query,
      ...results,
      citations: citations.citations,
      sessionId
    });

  } catch (error) {
    logger.error('Error in chat search endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to perform search',
      error: error.message
    });
  }
});

/**
 * @route POST /api/chat/highlight
 * @desc Create highlight annotation
 * @access Public
 */
router.post('/highlight', async (req, res) => {
  try {
    const { sessionId, text, position, documentInfo } = req.body;
    
    if (!sessionId || !text) {
      return res.status(400).json({
        success: false,
        message: 'Session ID and text are required'
      });
    }

    const highlight = await advancedFeatures.createHighlight(
      sessionId, 
      text, 
      position, 
      documentInfo
    );

    res.status(201).json({
      success: true,
      message: 'Highlight created successfully',
      highlight,
      sessionId
    });

  } catch (error) {
    logger.error('Error creating highlight:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create highlight',
      error: error.message
    });
  }
});

/**
 * @route POST /api/chat/highlight/:highlightId/explain
 * @desc Get explanation for highlighted text
 * @access Public
 */
router.post('/highlight/:highlightId/explain', async (req, res) => {
  try {
    const { highlightId } = req.params;
    const { sessionId, depth = 'medium' } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    const explanation = await advancedFeatures.explainHighlight(
      highlightId, 
      sessionId, 
      depth
    );

    res.status(200).json({
      success: true,
      explanation,
      highlightId,
      sessionId
    });

  } catch (error) {
    logger.error('Error explaining highlight:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to explain highlight',
      error: error.message
    });
  }
});

/**
 * @route GET /api/chat/highlights/:sessionId
 * @desc Get all highlights for a session
 * @access Public
 */
router.get('/highlights/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const highlights = advancedFeatures.getSessionHighlights(sessionId);
    
    res.status(200).json({
      success: true,
      highlights,
      count: highlights.length,
      sessionId
    });

  } catch (error) {
    logger.error('Error getting highlights:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve highlights',
      error: error.message
    });
  }
});

/**
 * @route DELETE /api/chat/highlight/:highlightId
 * @desc Delete a highlight
 * @access Public
 */
router.delete('/highlight/:highlightId', async (req, res) => {
  try {
    const { highlightId } = req.params;
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    const success = advancedFeatures.deleteHighlight(highlightId, sessionId);
    
    if (success) {
      res.status(200).json({
        success: true,
        message: 'Highlight deleted successfully',
        highlightId
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Highlight not found'
      });
    }

  } catch (error) {
    logger.error('Error deleting highlight:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete highlight',
      error: error.message
    });
  }
});

/**
 * @route POST /api/chat/session
 * @desc Create a new chat session
 * @access Public
 */
router.post('/session', async (req, res) => {
  try {
    const { userId = null } = req.body;
    
    const session = configService.createSession(userId);
    
    res.status(201).json({
      success: true,
      message: 'Session created successfully',
      session
    });

  } catch (error) {
    logger.error('Error creating session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create session',
      error: error.message
    });
  }
});

/**
 * @route GET /api/chat/session/:sessionId
 * @desc Get session information
 * @access Public
 */
router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = configService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    const vectorStats = pdfProcessor.getSessionStats(sessionId);
    
    res.status(200).json({
      success: true,
      session: {
        ...session,
        vectorStore: vectorStats
      }
    });

  } catch (error) {
    logger.error('Error getting session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve session',
      error: error.message
    });
  }
});

module.exports = router;