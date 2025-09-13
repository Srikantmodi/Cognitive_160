const express = require('express');
const aiService = require('../services/aiService');
const pdfProcessor = require('../services/simplePdfProcessor');
const configService = require('../services/configService');
const logger = require('../services/logger');

const router = express.Router();

/**
 * @route POST /api/pdf/summarize
 * @desc Generate summary using IBM Granite model
 * @access Public
 */
router.post('/summarize', async (req, res) => {
  try {
    const { 
      sessionId, 
      documentIds = null,
      summaryType = 'comprehensive',
      topic = null 
    } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    let content = '';
    let sources = [];

    if (topic) {
      // Summarize content related to a specific topic
      const contextData = await pdfProcessor.getRelevantContext(topic, sessionId, 6000);
      content = contextData.context;
      sources = contextData.sources;
    } else if (documentIds && documentIds.length > 0) {
      // Summarize specific documents
      const searchResults = await pdfProcessor.searchInDocuments(
        'main content key points important information', 
        documentIds, 
        sessionId, 
        50
      );
      content = searchResults.map(r => r.content).join('\n\n');
      sources = searchResults.map(r => r.metadata);
    } else {
      // Summarize all documents in session
      const contextData = await pdfProcessor.getRelevantContext(
        'main content overview key points', 
        sessionId, 
        6000
      );
      content = contextData.context;
      sources = contextData.sources;
    }

    if (!content || content.trim() === '') {
      return res.status(404).json({
        success: false,
        message: 'No content available for summarization. Please upload PDF documents first.'
      });
    }

    // Generate summary using IBM Granite
    const summary = await aiService.generateSummary(
      content, 
      summaryType, 
      sources[0]?.filename || 'Multiple Documents'
    );

    res.status(200).json({
      success: true,
      summary: summary.summary,
      summaryType,
      sources,
      model: summary.model,
      timestamp: summary.timestamp,
      sessionId
    });

  } catch (error) {
    logger.error('Error in PDF summarize endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate summary',
      error: error.message
    });
  }
});

/**
 * @route POST /api/pdf/extract-sections
 * @desc Extract specific sections from PDFs
 * @access Public
 */
router.post('/extract-sections', async (req, res) => {
  try {
    const { 
      sessionId, 
      sectionNames, 
      documentIds = null 
    } = req.body;
    
    if (!sessionId || !sectionNames || !Array.isArray(sectionNames)) {
      return res.status(400).json({
        success: false,
        message: 'Session ID and section names array are required'
      });
    }

    const extractedSections = {};
    
    // Extract each requested section
    for (const sectionName of sectionNames) {
      try {
        let searchResults;
        
        if (documentIds && documentIds.length > 0) {
          searchResults = await pdfProcessor.searchInDocuments(
            sectionName, 
            documentIds, 
            sessionId, 
            10
          );
        } else {
          searchResults = await pdfProcessor.similaritySearch(
            sectionName, 
            sessionId, 
            10
          );
        }

        extractedSections[sectionName] = {
          content: searchResults.map(r => r.content).join('\n\n'),
          sources: searchResults.map(r => ({
            filename: r.metadata.filename,
            chunkIndex: r.metadata.chunkIndex,
            relevance: r.relevance || r.score
          })),
          matchCount: searchResults.length
        };
        
      } catch (error) {
        logger.warn(`Error extracting section ${sectionName}:`, error);
        extractedSections[sectionName] = {
          content: '',
          sources: [],
          matchCount: 0,
          error: error.message
        };
      }
    }

    res.status(200).json({
      success: true,
      sections: extractedSections,
      requestedSections: sectionNames,
      sessionId
    });

  } catch (error) {
    logger.error('Error in PDF extract sections endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to extract sections',
      error: error.message
    });
  }
});

/**
 * @route GET /api/pdf/documents/:sessionId
 * @desc Get list of documents in session with metadata
 * @access Public
 */
router.get('/documents/:sessionId', async (req, res) => {
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
      sessionId,
      documents: session.documentIds || [],
      stats: {
        totalDocuments: (session.documentIds || []).length,
        documentsUploaded: session.stats.documentsUploaded,
        vectorStore: vectorStats
      }
    });

  } catch (error) {
    logger.error('Error getting PDF documents:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve documents',
      error: error.message
    });
  }
});

/**
 * @route POST /api/pdf/analyze-structure
 * @desc Analyze document structure and extract headings/sections
 * @access Public
 */
router.post('/analyze-structure', async (req, res) => {
  try {
    const { sessionId, documentIds = null } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    // Search for structural elements
    const structureQueries = [
      'chapter section heading title',
      'introduction conclusion summary',
      'table of contents index',
      'figure table chart diagram'
    ];

    const structureAnalysis = {};

    for (const query of structureQueries) {
      try {
        let searchResults;
        
        if (documentIds && documentIds.length > 0) {
          searchResults = await pdfProcessor.searchInDocuments(
            query, 
            documentIds, 
            sessionId, 
            15
          );
        } else {
          searchResults = await pdfProcessor.similaritySearch(
            query, 
            sessionId, 
            15
          );
        }

        const queryType = query.replace(/\s+/g, '_');
        structureAnalysis[queryType] = searchResults.map(result => ({
          content: result.content.substring(0, 200) + '...', // Preview
          filename: result.metadata.filename,
          chunkIndex: result.metadata.chunkIndex,
          relevance: result.relevance || result.score
        }));
        
      } catch (error) {
        logger.warn(`Error analyzing structure for ${query}:`, error);
      }
    }

    // Use AI to identify document structure
    const allContent = Object.values(structureAnalysis)
      .flat()
      .map(item => item.content)
      .join('\n\n');

    let aiAnalysis = null;
    if (allContent.trim()) {
      try {
        const structurePrompt = `
          Analyze the following document content and identify the structure:
          
          ${allContent}
          
          Please provide:
          1. Document type (academic paper, textbook, report, etc.)
          2. Main sections identified
          3. Hierarchical structure if any
          4. Key topics covered
          
          Format as JSON:
          {
            "documentType": "...",
            "mainSections": ["section1", "section2"],
            "structure": {
              "hasChapters": true/false,
              "hasSubsections": true/false,
              "hasReferences": true/false
            },
            "keyTopics": ["topic1", "topic2"]
          }
        `;

        const response = await aiService.geminiModel.invoke([
          { role: 'user', content: structurePrompt }
        ]);

        try {
          aiAnalysis = JSON.parse(response.content);
        } catch (parseError) {
          aiAnalysis = {
            documentType: 'unknown',
            analysis: response.content
          };
        }
      } catch (aiError) {
        logger.warn('Error in AI structure analysis:', aiError);
      }
    }

    res.status(200).json({
      success: true,
      structureAnalysis,
      aiAnalysis,
      sessionId
    });

  } catch (error) {
    logger.error('Error analyzing document structure:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze document structure',
      error: error.message
    });
  }
});

/**
 * @route POST /api/pdf/find-similar
 * @desc Find similar content across documents
 * @access Public
 */
router.post('/find-similar', async (req, res) => {
  try {
    const { sessionId, content, maxResults = 5 } = req.body;
    
    if (!sessionId || !content) {
      return res.status(400).json({
        success: false,
        message: 'Session ID and content are required'
      });
    }

    const similarDocuments = await pdfProcessor.findSimilarDocuments(
      content, 
      sessionId, 
      maxResults
    );

    res.status(200).json({
      success: true,
      query: content,
      similarDocuments,
      count: similarDocuments.length,
      sessionId
    });

  } catch (error) {
    logger.error('Error finding similar content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to find similar content',
      error: error.message
    });
  }
});

/**
 * @route DELETE /api/pdf/session/:sessionId
 * @desc Delete all PDF data for a session
 * @access Public
 */
router.delete('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Delete vector store data
    await pdfProcessor.deleteSession(sessionId);
    
    // Update session
    const session = configService.getSession(sessionId);
    if (session) {
      session.documentIds = [];
      session.stats.documentsUploaded = 0;
    }

    res.status(200).json({
      success: true,
      message: 'All PDF data deleted for session',
      sessionId
    });

  } catch (error) {
    logger.error('Error deleting PDF session data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete PDF data',
      error: error.message
    });
  }
});

module.exports = router;