const express = require('express');
const documentService = require('../services/documentService');
const logger = require('../services/logger');

const router = express.Router();

/**
 * @route GET /api/analytics/session/:sessionId
 * @desc Get comprehensive analytics for a session
 * @access Public
 */
router.get('/session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID is required'
            });
        }

        const analytics = await documentService.getAdvancedAnalytics(sessionId);
        
        res.status(200).json({
            success: true,
            sessionId,
            analytics,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error(`Error getting analytics for session ${req.params.sessionId}:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to get session analytics',
            error: error.message
        });
    }
});

/**
 * @route GET /api/analytics/session/:sessionId/stats
 * @desc Get basic session statistics
 * @access Public
 */
router.get('/session/:sessionId/stats', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        const stats = documentService.getSessionStats(sessionId);
        
        if (!stats) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        res.status(200).json({
            success: true,
            sessionId,
            stats,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error(`Error getting stats for session ${req.params.sessionId}:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to get session statistics',
            error: error.message
        });
    }
});

/**
 * @route POST /api/analytics/search/similar
 * @desc Find similar documents to provided content
 * @access Public
 */
router.post('/search/similar', async (req, res) => {
    try {
        const { sessionId, content, maxResults = 5 } = req.body;
        
        if (!sessionId || !content) {
            return res.status(400).json({
                success: false,
                message: 'Session ID and content are required'
            });
        }

        const similarDocuments = await documentService.getSimilarDocuments(
            content,
            sessionId,
            maxResults
        );

        res.status(200).json({
            success: true,
            query: content.substring(0, 100),
            similarDocuments,
            sessionId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Error finding similar documents:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to find similar documents',
            error: error.message
        });
    }
});

/**
 * @route GET /api/analytics/document/:documentId/structure
 * @desc Get detailed document structure and metadata
 * @access Public
 */
router.get('/document/:documentId/structure', async (req, res) => {
    try {
        const { documentId } = req.params;
        const { sessionId } = req.query;
        
        if (!documentId || !sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Document ID and session ID are required'
            });
        }

        const structure = await documentService.getDocumentStructure(documentId, sessionId);
        
        if (!structure) {
            return res.status(404).json({
                success: false,
                message: 'Document not found'
            });
        }

        res.status(200).json({
            success: true,
            documentId,
            structure,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error(`Error getting document structure for ${req.params.documentId}:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to get document structure',
            error: error.message
        });
    }
});

/**
 * @route POST /api/analytics/session/:sessionId/export
 * @desc Export session data and analytics
 * @access Public
 */
router.post('/session/:sessionId/export', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { format = 'json' } = req.body;
        
        const exportResult = await documentService.exportSession(sessionId, format);
        
        res.setHeader('Content-Type', exportResult.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
        res.status(200).send(exportResult.data);

    } catch (error) {
        logger.error(`Error exporting session ${req.params.sessionId}:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to export session data',
            error: error.message
        });
    }
});

/**
 * @route DELETE /api/analytics/session/:sessionId
 * @desc Delete session and all associated data
 * @access Public
 */
router.delete('/session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        const result = await documentService.deleteSession(sessionId);
        
        res.status(200).json({
            success: true,
            message: `Session ${sessionId} deleted successfully`,
            ...result,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error(`Error deleting session ${req.params.sessionId}:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete session',
            error: error.message
        });
    }
});

/**
 * @route GET /api/analytics/health
 * @desc Get system health and component status
 * @access Public
 */
router.get('/health', async (req, res) => {
    try {
        const health = await documentService.healthCheck();
        
        const statusCode = health.status === 'healthy' ? 200 : 503;
        
        res.status(statusCode).json({
            success: health.status === 'healthy',
            ...health
        });

    } catch (error) {
        logger.error('Error checking system health:', error);
        res.status(503).json({
            success: false,
            service: 'DocumentService',
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = router;