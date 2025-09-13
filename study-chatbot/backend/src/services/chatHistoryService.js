const logger = require('../utils/logger');

class ChatHistoryService {
    constructor() {
        // In-memory storage for chat history (in production, use a proper database)
        this.chatSessions = new Map(); // sessionId -> session data
        this.chatHistory = new Map(); // sessionId -> array of messages
        this.fileHistory = new Map(); // sessionId -> array of uploaded files
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return;
        
        logger.info('Initializing Chat History Service...');
        this.isInitialized = true;
        logger.info('Chat History Service initialized successfully');
    }

    /**
     * Create a new chat session
     */
    createSession(title = null, sessionId = null) {
        const id = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const session = {
            id: id,
            title: title || 'New Chat',
            createdAt: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            messageCount: 0
        };

        this.chatSessions.set(id, session);
        this.chatHistory.set(id, []);
        this.fileHistory.set(id, []);

        logger.info(`Created new chat session: ${id}`);
        return session;
    }

    /**
     * Add a message to chat history
     */
    addMessage(sessionId, message) {
        if (!this.chatHistory.has(sessionId)) {
            this.createSession();
        }

        const timestamp = new Date().toISOString();
        const messageWithTimestamp = {
            ...message,
            id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp
        };

        this.chatHistory.get(sessionId).push(messageWithTimestamp);
        
        // Update session metadata
        const session = this.chatSessions.get(sessionId);
        if (session) {
            session.lastActivity = timestamp;
            session.messageCount = this.chatHistory.get(sessionId).length;
            
            // Auto-generate title from first user message
            if (!session.title || session.title === 'New Chat') {
                if (message.type === 'user' && message.content) {
                    session.title = message.content.substring(0, 50) + (message.content.length > 50 ? '...' : '');
                }
            }
        }

        logger.info(`Added message to session ${sessionId}: ${message.type}`);
        return messageWithTimestamp;
    }

    /**
     * Get chat history for a session
     */
    getChatHistory(sessionId) {
        return this.chatHistory.get(sessionId) || [];
    }

    /**
     * Get all chat sessions
     */
    getAllSessions() {
        const sessions = Array.from(this.chatSessions.values())
            .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
        
        return sessions;
    }

    /**
     * Get session by ID
     */
    getSession(sessionId) {
        return this.chatSessions.get(sessionId);
    }

    /**
     * Delete a session and its history
     */
    deleteSession(sessionId) {
        const deleted = this.chatSessions.delete(sessionId);
        this.chatHistory.delete(sessionId);
        this.fileHistory.delete(sessionId);
        
        if (deleted) {
            logger.info(`Deleted session: ${sessionId}`);
        }
        
        return deleted;
    }

    /**
     * Add uploaded file to history
     */
    addFileToHistory(sessionId, fileData) {
        if (!this.fileHistory.has(sessionId)) {
            this.fileHistory.set(sessionId, []);
        }

        const fileRecord = {
            ...fileData,
            id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            uploadedAt: new Date().toISOString()
        };

        this.fileHistory.get(sessionId).push(fileRecord);
        
        // Update session activity
        const session = this.chatSessions.get(sessionId);
        if (session) {
            session.lastActivity = fileRecord.uploadedAt;
        }

        logger.info(`Added file to session ${sessionId}: ${fileData.filename}`);
        return fileRecord;
    }

    /**
     * Get file history for a session
     */
    getFileHistory(sessionId) {
        return this.fileHistory.get(sessionId) || [];
    }

    /**
     * Get all files across all sessions
     */
    getAllFiles() {
        const allFiles = [];
        for (const [sessionId, files] of this.fileHistory.entries()) {
            const session = this.chatSessions.get(sessionId);
            const filesWithSession = files.map(file => ({
                ...file,
                sessionId,
                sessionTitle: session?.title || 'Unknown Session'
            }));
            allFiles.push(...filesWithSession);
        }
        
        return allFiles.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    }

    /**
     * Update session title
     */
    updateSessionTitle(sessionId, title) {
        const session = this.chatSessions.get(sessionId);
        if (session) {
            session.title = title;
            session.lastActivity = new Date().toISOString();
            logger.info(`Updated session title: ${sessionId} -> ${title}`);
            return session;
        }
        return null;
    }

    /**
     * Search chat history
     */
    searchChatHistory(query, sessionId = null) {
        const results = [];
        const searchLower = query.toLowerCase();

        const sessionsToSearch = sessionId ? [sessionId] : Array.from(this.chatHistory.keys());

        for (const sid of sessionsToSearch) {
            const messages = this.chatHistory.get(sid) || [];
            const session = this.chatSessions.get(sid);
            
            for (const message of messages) {
                if (message.content && message.content.toLowerCase().includes(searchLower)) {
                    results.push({
                        ...message,
                        sessionId: sid,
                        sessionTitle: session?.title || 'Unknown Session'
                    });
                }
            }
        }

        return results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    /**
     * Get session statistics
     */
    getSessionStats(sessionId) {
        const messages = this.chatHistory.get(sessionId) || [];
        const files = this.fileHistory.get(sessionId) || [];
        const session = this.chatSessions.get(sessionId);

        return {
            messageCount: messages.length,
            fileCount: files.length,
            userMessages: messages.filter(m => m.type === 'user').length,
            assistantMessages: messages.filter(m => m.type === 'assistant').length,
            createdAt: session?.createdAt,
            lastActivity: session?.lastActivity
        };
    }
}

// Create and export singleton instance
const chatHistoryService = new ChatHistoryService();
module.exports = chatHistoryService;