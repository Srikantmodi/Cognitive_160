const sharp = require('sharp');
const tesseract = require('tesseract.js');
const logger = require('./logger');
const aiService = require('./aiService');
const pdfProcessor = require('./simplePdfProcessor');

class AdvancedFeaturesService {
  constructor() {
    this.annotations = new Map(); // sessionId -> annotations
    this.highlights = new Map(); // sessionId -> highlights
    this.citations = new Map(); // citationId -> citation data
  }

  /**
   * Extract text from images using OCR
   * @param {Buffer} imageBuffer - Image buffer
   * @param {string} language - OCR language (default: 'eng')
   * @returns {Object} - Extracted text and confidence
   */
  async extractTextFromImage(imageBuffer, language = 'eng') {
    try {
      logger.info('Starting OCR text extraction from image');
      
      const { data: { text, confidence } } = await tesseract.recognize(
        imageBuffer,
        language,
        {
          logger: m => logger.debug(`OCR: ${m.status} - ${m.progress}`)
        }
      );

      return {
        text: text.trim(),
        confidence,
        language,
        extractedAt: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error in OCR text extraction:', error);
      throw new Error(`OCR extraction failed: ${error.message}`);
    }
  }

  /**
   * Analyze table or chart structure
   * @param {Buffer} imageBuffer - Image buffer containing table/chart
   * @param {string} context - Additional context about the image
   * @returns {Object} - Analysis results
   */
  async analyzeTableChart(imageBuffer, context = '') {
    try {
      // First extract text using OCR
      const ocrResult = await this.extractTextFromImage(imageBuffer);
      
      // Enhance image for better analysis
      const enhancedImage = await this.enhanceImageForAnalysis(imageBuffer);
      
      // Use AI to analyze the extracted text and identify structure
      const analysisPrompt = `
        Analyze the following text extracted from a table or chart image:
        
        OCR Text:
        ${ocrResult.text}
        
        Context: ${context}
        
        Please provide:
        1. Type of visualization (table, bar chart, line graph, pie chart, etc.)
        2. Key data points and values
        3. Column/row headers if it's a table
        4. Trends or patterns in the data
        5. Main insights from the data
        6. Structured data extraction in JSON format
        
        Format your response as JSON with the following structure:
        {
          "type": "table|chart|graph",
          "title": "extracted title if any",
          "headers": ["header1", "header2"],
          "data": [{"column1": "value1", "column2": "value2"}],
          "insights": ["insight1", "insight2"],
          "trends": ["trend1", "trend2"],
          "summary": "overall summary"
        }
      `;

      const analysis = await aiService.geminiModel.invoke([
        { role: 'user', content: analysisPrompt }
      ]);

      let parsedAnalysis;
      try {
        parsedAnalysis = JSON.parse(analysis.content);
      } catch (parseError) {
        // Fallback if JSON parsing fails
        parsedAnalysis = {
          type: 'unknown',
          title: 'Analysis Result',
          raw_text: ocrResult.text,
          analysis: analysis.content,
          insights: [],
          summary: analysis.content
        };
      }

      return {
        ...parsedAnalysis,
        ocrConfidence: ocrResult.confidence,
        extractedText: ocrResult.text,
        processedAt: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error analyzing table/chart:', error);
      throw new Error(`Table/chart analysis failed: ${error.message}`);
    }
  }

  /**
   * Enhance image for better OCR and analysis
   * @param {Buffer} imageBuffer - Original image buffer
   * @returns {Buffer} - Enhanced image buffer
   */
  async enhanceImageForAnalysis(imageBuffer) {
    try {
      return await sharp(imageBuffer)
        .resize(null, 1200, { 
          withoutEnlargement: true,
          kernel: sharp.kernel.lanczos3 
        })
        .normalize()
        .sharpen({ sigma: 1.5 })
        .png()
        .toBuffer();
    } catch (error) {
      logger.error('Error enhancing image:', error);
      return imageBuffer; // Return original if enhancement fails
    }
  }

  /**
   * Generate citations for search results
   * @param {Array} searchResults - Search results with metadata
   * @param {string} query - Original query
   * @returns {Object} - Citation information
   */
  generateCitations(searchResults, query) {
    const citations = searchResults.map((result, index) => {
      const citationId = `cite_${Date.now()}_${index}`;
      
      const citation = {
        id: citationId,
        text: result.content,
        source: {
          filename: result.filename || result.metadata?.filename || result.source || 'Unknown Document',
          documentId: result.documentId || result.metadata?.documentId || 'unknown',
          chunkIndex: result.chunkIndex || result.metadata?.chunkIndex || 0,
          page: result.page || result.metadata?.page || 'N/A'
        },
        relevanceScore: result.relevance || result.score || result.similarity || 0,
        query: query,
        createdAt: new Date().toISOString()
      };

      this.citations.set(citationId, citation);
      return citation;
    });

    return {
      query,
      totalCitations: citations.length,
      citations,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Create highlight annotation
   * @param {string} sessionId - Session identifier
   * @param {string} text - Highlighted text
   * @param {Object} position - Position information
   * @param {Object} documentInfo - Document information
   * @returns {Object} - Highlight annotation
   */
  async createHighlight(sessionId, text, position, documentInfo) {
    try {
      const highlightId = `highlight_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const highlight = {
        id: highlightId,
        sessionId,
        text,
        position,
        documentInfo,
        createdAt: new Date().toISOString(),
        explanation: null // Will be filled when requested
      };

      // Store highlight
      if (!this.highlights.has(sessionId)) {
        this.highlights.set(sessionId, []);
      }
      this.highlights.get(sessionId).push(highlight);

      logger.info(`Created highlight: ${highlightId} for session: ${sessionId}`);
      return highlight;

    } catch (error) {
      logger.error('Error creating highlight:', error);
      throw error;
    }
  }

  /**
   * Generate explanation for highlighted text
   * @param {string} highlightId - Highlight identifier
   * @param {string} sessionId - Session identifier
   * @param {string} depth - Explanation depth
   * @returns {Object} - Explanation result
   */
  async explainHighlight(highlightId, sessionId, depth = 'medium') {
    try {
      // Find the highlight
      const sessionHighlights = this.highlights.get(sessionId) || [];
      const highlight = sessionHighlights.find(h => h.id === highlightId);
      
      if (!highlight) {
        throw new Error('Highlight not found');
      }

      // Get relevant context for the highlighted text
      const contextData = await pdfProcessor.getRelevantContext(
        highlight.text, 
        sessionId, 
        2000
      );

      // Generate explanation
      const explanation = await aiService.answerQuestion(
        `Explain this highlighted text in detail: "${highlight.text}"`,
        contextData.context,
        depth,
        contextData.sources
      );

      // Update highlight with explanation
      highlight.explanation = {
        ...explanation,
        depth,
        explainedAt: new Date().toISOString()
      };

      return highlight.explanation;

    } catch (error) {
      logger.error('Error explaining highlight:', error);
      throw error;
    }
  }

  /**
   * Create annotation for document content
   * @param {string} sessionId - Session identifier
   * @param {Object} annotationData - Annotation data
   * @returns {Object} - Created annotation
   */
  async createAnnotation(sessionId, annotationData) {
    try {
      const annotationId = `annotation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const annotation = {
        id: annotationId,
        sessionId,
        ...annotationData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Store annotation
      if (!this.annotations.has(sessionId)) {
        this.annotations.set(sessionId, []);
      }
      this.annotations.get(sessionId).push(annotation);

      logger.info(`Created annotation: ${annotationId} for session: ${sessionId}`);
      return annotation;

    } catch (error) {
      logger.error('Error creating annotation:', error);
      throw error;
    }
  }

  /**
   * Get all highlights for a session
   * @param {string} sessionId - Session identifier
   * @returns {Array} - Array of highlights
   */
  getSessionHighlights(sessionId) {
    return this.highlights.get(sessionId) || [];
  }

  /**
   * Get all annotations for a session
   * @param {string} sessionId - Session identifier
   * @returns {Array} - Array of annotations
   */
  getSessionAnnotations(sessionId) {
    return this.annotations.get(sessionId) || [];
  }

  /**
   * Delete highlight
   * @param {string} highlightId - Highlight identifier
   * @param {string} sessionId - Session identifier
   * @returns {boolean} - Success status
   */
  deleteHighlight(highlightId, sessionId) {
    const sessionHighlights = this.highlights.get(sessionId) || [];
    const index = sessionHighlights.findIndex(h => h.id === highlightId);
    
    if (index !== -1) {
      sessionHighlights.splice(index, 1);
      logger.info(`Deleted highlight: ${highlightId}`);
      return true;
    }
    
    return false;
  }

  /**
   * Update annotation
   * @param {string} annotationId - Annotation identifier
   * @param {string} sessionId - Session identifier
   * @param {Object} updates - Updates to apply
   * @returns {Object} - Updated annotation
   */
  updateAnnotation(annotationId, sessionId, updates) {
    const sessionAnnotations = this.annotations.get(sessionId) || [];
    const annotation = sessionAnnotations.find(a => a.id === annotationId);
    
    if (annotation) {
      Object.assign(annotation, updates, {
        updatedAt: new Date().toISOString()
      });
      logger.info(`Updated annotation: ${annotationId}`);
    }
    
    return annotation;
  }

  /**
   * Get citation by ID
   * @param {string} citationId - Citation identifier
   * @returns {Object} - Citation data
   */
  getCitation(citationId) {
    return this.citations.get(citationId);
  }

  /**
   * Format citations for display
   * @param {Array} citationIds - Array of citation IDs
   * @param {string} format - Citation format (apa, mla, chicago)
   * @returns {Array} - Formatted citations
   */
  formatCitations(citationIds, format = 'apa') {
    const formatters = {
      apa: (citation) => {
        const date = new Date(citation.createdAt).getFullYear();
        return `${citation.source.filename} (${date}). Retrieved from document page ${citation.source.page}.`;
      },
      mla: (citation) => {
        return `"${citation.source.filename}." Document, page ${citation.source.page}.`;
      },
      chicago: (citation) => {
        const date = new Date(citation.createdAt).toLocaleDateString();
        return `${citation.source.filename}, accessed ${date}, page ${citation.source.page}.`;
      }
    };

    const formatter = formatters[format] || formatters.apa;
    
    return citationIds
      .map(id => this.getCitation(id))
      .filter(citation => citation)
      .map(citation => ({
        id: citation.id,
        formatted: formatter(citation),
        source: citation.source,
        relevanceScore: citation.relevanceScore
      }));
  }

  /**
   * Clean up session data
   * @param {string} sessionId - Session identifier
   */
  cleanupSession(sessionId) {
    this.highlights.delete(sessionId);
    this.annotations.delete(sessionId);
    
    // Remove citations for this session
    for (const [citationId, citation] of this.citations) {
      // Note: We'd need to track session in citations for proper cleanup
      // For now, we'll keep citations as they might be referenced later
    }
    
    logger.info(`Cleaned up advanced features data for session: ${sessionId}`);
  }

  /**
   * Export session data for backup
   * @param {string} sessionId - Session identifier
   * @returns {Object} - Exported data
   */
  exportSessionData(sessionId) {
    return {
      sessionId,
      highlights: this.getSessionHighlights(sessionId),
      annotations: this.getSessionAnnotations(sessionId),
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import session data from backup
   * @param {Object} sessionData - Session data to import
   */
  importSessionData(sessionData) {
    const { sessionId, highlights, annotations } = sessionData;
    
    if (highlights && highlights.length > 0) {
      this.highlights.set(sessionId, highlights);
    }
    
    if (annotations && annotations.length > 0) {
      this.annotations.set(sessionId, annotations);
    }
    
    logger.info(`Imported advanced features data for session: ${sessionId}`);
  }
}

module.exports = new AdvancedFeaturesService();