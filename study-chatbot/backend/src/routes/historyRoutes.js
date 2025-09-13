const express = require('express');
const router = express.Router();
const chatHistoryService = require('../services/chatHistoryService');
const logger = require('../utils/logger');

/**
 * Get all chat sessions
 * GET /api/history/sessions
 */
router.get('/sessions', async (req, res) => {
    try {
        await chatHistoryService.initialize();
        const sessions = chatHistoryService.getAllSessions();
        
        res.json({
            success: true,
            sessions,
            count: sessions.length
        });
    } catch (error) {
        logger.error('Failed to retrieve chat sessions:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve chat sessions',
            details: error.message
        });
    }
});

/**
 * Create a new chat session
 * POST /api/history/sessions
 */
router.post('/sessions', async (req, res) => {
    try {
        await chatHistoryService.initialize();
        const { title, sessionId } = req.body;
        
        const session = chatHistoryService.createSession(title, sessionId);
        
        res.json({
            success: true,
            session,
            sessionId: session.id
        });
    } catch (error) {
        logger.error('Failed to create chat session:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create chat session',
            details: error.message
        });
    }
});

/**
 * Get chat history for a specific session
 * GET /api/history/sessions/:sessionId/messages
 */
router.get('/sessions/:sessionId/messages', async (req, res) => {
    try {
        await chatHistoryService.initialize();
        const { sessionId } = req.params;
        const { limit, offset } = req.query;
        
        let messages = chatHistoryService.getChatHistory(sessionId);
        
        // Apply pagination if requested
        if (limit || offset) {
            const limitNum = parseInt(limit) || 50;
            const offsetNum = parseInt(offset) || 0;
            messages = messages.slice(offsetNum, offsetNum + limitNum);
        }
        
        const session = chatHistoryService.getSession(sessionId);
        
        res.json({
            success: true,
            sessionId,
            session,
            messages,
            count: messages.length,
            total: chatHistoryService.getChatHistory(sessionId).length
        });
    } catch (error) {
        logger.error(`Failed to retrieve chat history for session ${req.params.sessionId}:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve chat history',
            details: error.message
        });
    }
});

/**
 * Update session title
 * PUT /api/history/sessions/:sessionId
 */
router.put('/sessions/:sessionId', async (req, res) => {
    try {
        await chatHistoryService.initialize();
        const { sessionId } = req.params;
        const { title } = req.body;
        
        const session = chatHistoryService.updateSessionTitle(sessionId, title);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }
        
        res.json({
            success: true,
            session
        });
    } catch (error) {
        logger.error(`Failed to update session ${req.params.sessionId}:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to update session',
            details: error.message
        });
    }
});

/**
 * Delete a chat session
 * DELETE /api/history/sessions/:sessionId
 */
router.delete('/sessions/:sessionId', async (req, res) => {
    try {
        await chatHistoryService.initialize();
        const { sessionId } = req.params;
        
        const deleted = chatHistoryService.deleteSession(sessionId);
        
        if (!deleted) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }
        
        res.json({
            success: true,
            message: 'Session deleted successfully'
        });
    } catch (error) {
        logger.error(`Failed to delete session ${req.params.sessionId}:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete session',
            details: error.message
        });
    }
});

/**
 * Get file history for a session
 * GET /api/history/sessions/:sessionId/files
 */
router.get('/sessions/:sessionId/files', async (req, res) => {
    try {
        await chatHistoryService.initialize();
        const { sessionId } = req.params;
        
        const files = chatHistoryService.getFileHistory(sessionId);
        
        res.json({
            success: true,
            sessionId,
            files,
            count: files.length
        });
    } catch (error) {
        logger.error(`Failed to retrieve file history for session ${req.params.sessionId}:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve file history',
            details: error.message
        });
    }
});

/**
 * Get all files across all sessions
 * GET /api/history/files
 */
router.get('/files', async (req, res) => {
    try {
        await chatHistoryService.initialize();
        const files = chatHistoryService.getAllFiles();
        
        res.json({
            success: true,
            files,
            count: files.length
        });
    } catch (error) {
        logger.error('Failed to retrieve all files:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve files',
            details: error.message
        });
    }
});

/**
 * Search chat history
 * GET /api/history/search?q=query&sessionId=optional
 */
router.get('/search', async (req, res) => {
    try {
        await chatHistoryService.initialize();
        const { q: query, sessionId } = req.query;
        
        if (!query || query.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Search query is required'
            });
        }
        
        const results = chatHistoryService.searchChatHistory(query, sessionId);
        
        res.json({
            success: true,
            query,
            sessionId: sessionId || 'all',
            results,
            count: results.length
        });
    } catch (error) {
        logger.error('Failed to search chat history:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to search chat history',
            details: error.message
        });
    }
});

/**
 * Get session statistics
 * GET /api/history/sessions/:sessionId/stats
 */
router.get('/sessions/:sessionId/stats', async (req, res) => {
    try {
        await chatHistoryService.initialize();
        const { sessionId } = req.params;
        
        const stats = chatHistoryService.getSessionStats(sessionId);
        
        res.json({
            success: true,
            sessionId,
            stats
        });
    } catch (error) {
        logger.error(`Failed to retrieve stats for session ${req.params.sessionId}:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve session stats',
            details: error.message
        });
    }
});

module.exports = router;