const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const documentService = require('../services/documentService');
const configService = require('../services/configService');
const chatHistoryService = require('../services/chatHistoryService');
const logger = require('../services/logger');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: configService.get('maxFileSize'),
    files: 10 // Maximum 10 files per upload
  },
  fileFilter: (req, file, cb) => {
    const validation = configService.validateFileUpload(file);
    if (validation.valid) {
      cb(null, true);
    } else {
      cb(new Error(validation.errors.join(', ')), false);
    }
  }
});

/**
 * @route POST /api/upload
 * @desc General upload endpoint for any document type
 * @access Public
 */
router.post('/', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { sessionId = 'demo-session' } = req.body;
    const file = req.file;
    
    // Process the document using the document service
    const result = await documentService.processDocuments([file], sessionId, {
      useEnhancedProcessing: true,
      enableOCR: true,
      enableSemanticAnalysis: true
    });

    // Save file to history
    try {
      await chatHistoryService.initialize();
      chatHistoryService.addFileToHistory(sessionId, {
        filename: file.filename,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        path: file.path,
        processingResult: result.results?.[0] || {},
        status: 'processed'
      });
    } catch (historyError) {
      logger.warn('Failed to save file history:', historyError);
    }

    res.json({
      success: true,
      message: 'File uploaded and processed successfully',
      result: result,
      sessionId: sessionId
    });

  } catch (error) {
    logger.error('Error in general upload endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Upload failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * @route POST /api/upload/pdf
 * @desc Upload and process PDF files
 * @access Public
 */
router.post('/pdf', upload.array('pdfs', 10), async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    const results = [];
    const errors = [];

    // Use enhanced document service for processing
    const processingResult = await documentService.processDocuments(
      req.files.map(file => ({
        path: file.path,
        filename: file.filename,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size
      })),
      sessionId,
      {
        useEnhancedProcessing: true,
        enableOCR: true,
        enableSemanticAnalysis: true,
        chunkingOptions: {
          maxChunkSize: 1000,
          respectSentences: true,
          respectParagraphs: true
        }
      }
    );

    // Update session stats
    configService.updateSessionStats(sessionId, 'documentsUploaded');

    return res.status(200).json({
      success: true,
      message: `Enhanced processing completed: ${processingResult.processed} files processed successfully`,
      ...processingResult
    });

    // Return results
    const response = {
      success: true,
      message: `Processed ${results.length} files successfully`,
      results,
      sessionId
    };

    if (errors.length > 0) {
      response.errors = errors;
      response.message += `, ${errors.length} files failed`;
    }

    res.status(200).json(response);

  } catch (error) {
    logger.error('Error in PDF upload endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process uploaded files',
      error: error.message
    });
  }
});

/**
 * @route POST /api/upload/image
 * @desc Upload and analyze image files (charts/tables)
 * @access Public
 */
router.post('/image', upload.array('images', 5), async (req, res) => {
  try {
    const { sessionId, context } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No images uploaded'
      });
    }

    const advancedFeatures = require('../services/advancedFeatures');
    const results = [];

    for (const file of req.files) {
      try {
        const imageBuffer = fs.readFileSync(file.path);
        
        // Analyze image
        const analysis = await advancedFeatures.analyzeTableChart(
          imageBuffer, 
          context || ''
        );

        results.push({
          filename: file.originalname,
          analysis
        });

        // Clean up uploaded file
        fs.unlinkSync(file.path);
        
      } catch (error) {
        logger.error(`Error analyzing image ${file.originalname}:`, error);
        // Clean up file on error
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }

    res.status(200).json({
      success: true,
      message: `Analyzed ${results.length} images`,
      results,
      sessionId
    });

  } catch (error) {
    logger.error('Error in image upload endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze uploaded images',
      error: error.message
    });
  }
});

/**
 * @route GET /api/upload/session/:sessionId
 * @desc Get uploaded documents for a session
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

        const vectorStats = documentService.getSessionStats(sessionId);
    res.status(200).json({
      success: true,
      sessionId,
      documents: session.documentIds || [],
      stats: {
        documentsUploaded: session.stats.documentsUploaded,
        vectorStore: vectorStats
      }
    });

  } catch (error) {
    logger.error('Error getting session documents:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve session documents',
      error: error.message
    });
  }
});

/**
 * @route DELETE /api/upload/document/:documentId
 * @desc Delete a specific document
 * @access Public
 */
router.delete('/document/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    // Remove document from session
    const session = configService.getSession(sessionId);
    if (session && session.documentIds) {
      session.documentIds = session.documentIds.filter(
        doc => doc.documentId !== documentId
      );
    }

    // Note: Vector store cleanup would need additional implementation
    // For now, we'll just update the session
    
    res.status(200).json({
      success: true,
      message: 'Document deleted successfully',
      documentId
    });

  } catch (error) {
    logger.error('Error deleting document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete document',
      error: error.message
    });
  }
});

module.exports = router;