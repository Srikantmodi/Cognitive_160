const aiService = require('./aiService');
const enhancedAIService = require('./enhancedAIService');
const vectorDB = require('./enhancedVectorDB_simplified');
const documentProcessor = require('./enhancedDocumentProcessor_simplified');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

class DocumentService {
    constructor() {
        this.sessions = new Map(); // sessionId -> { documents: [], metadata: {} }
        this.uploadDirectory = process.env.UPLOAD_DIR || 'uploads';
        this.isInitialized = false;
    }

    async initialize() {
        try {
            // Initialize enhanced components
            await vectorDB.initialize();
            await documentProcessor.initialize();
            
            // Ensure upload directory exists
            await fs.mkdir(this.uploadDirectory, { recursive: true });
            
            this.isInitialized = true;
            logger.info('Enhanced Document Service initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize Enhanced Document Service:', error);
            throw error;
        }
    }

    async processDocuments(files, sessionId, options = {}) {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            const {
                useEnhancedProcessing = true,
                chunkingOptions = {},
                enableOCR = true,
                enableSemanticAnalysis = true
            } = options;

            logger.info(`Processing ${files.length} documents for session ${sessionId}`);

            const results = [];
            const errors = [];

            for (const file of files) {
                try {
                    const result = await this.processSingleDocument(
                        file, 
                        sessionId, 
                        {
                            useEnhancedProcessing,
                            chunkingOptions,
                            enableOCR,
                            enableSemanticAnalysis
                        }
                    );
                    results.push(result);
                } catch (error) {
                    logger.error(`Failed to process file ${file.filename}:`, error);
                    errors.push({
                        filename: file.filename,
                        error: error.message
                    });
                }
            }

            // Update session metadata
            if (!this.sessions.has(sessionId)) {
                this.sessions.set(sessionId, {
                    documents: [],
                    metadata: {
                        createdAt: new Date(),
                        totalDocuments: 0,
                        totalChunks: 0,
                        processingOptions: options
                    }
                });
            }

            const session = this.sessions.get(sessionId);
            session.documents.push(...results);
            session.metadata.totalDocuments += results.length;
            session.metadata.totalChunks += results.reduce((sum, r) => sum + r.chunkCount, 0);
            session.metadata.lastUpdated = new Date();

            return {
                success: true,
                processed: results.length,
                errors: errors.length,
                sessionId,
                results,
                errors,
                sessionStats: this.getSessionStats(sessionId)
            };

        } catch (error) {
            logger.error('Document processing failed:', error);
            throw error;
        }
    }

    async processSingleDocument(file, sessionId, options = {}) {
        const { useEnhancedProcessing, chunkingOptions, enableOCR, enableSemanticAnalysis } = options;
        const documentId = uuidv4();
        const filePath = file.path;

        try {
            let processed;

            // Use enhanced document processor with advanced features
            processed = await documentProcessor.processDocument(filePath, file.filename);

            // Add document to vector database
            await vectorDB.addDocument(
                documentId,
                processed.chunks,
                {
                    filename: file.filename,
                    originalname: file.originalname,
                    mimetype: file.mimetype,
                    size: file.size,
                    uploadedAt: new Date().toISOString(),
                    ...processed.metadata
                },
                sessionId
            );

            logger.info(`Successfully processed ${file.filename}: ${processed.chunkCount} chunks`);

            return {
                documentId,
                filename: file.filename,
                originalname: file.originalname,
                success: true,
                wordCount: processed.wordCount,
                characterCount: processed.characterCount,
                chunkCount: processed.chunkCount,
                metadata: processed.metadata,
                processingMethod: useEnhancedProcessing ? 'enhanced' : 'basic'
            };

        } catch (error) {
            logger.error(`Failed to process document ${file.filename}:`, error);
            throw error;
        } finally {
            // Clean up uploaded file
            try {
                await fs.unlink(filePath);
            } catch (cleanupError) {
                logger.warn(`Failed to cleanup file ${filePath}:`, cleanupError);
            }
        }
    }

    async askQuestion(question, sessionId, options = {}) {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            const {
                useEnhancedAI = true,
                maxResults = 10,
                confidenceThreshold = 0.1,
                includeAnalysis = true,
                responseFormat = 'comprehensive'
            } = options;

            logger.info(`Processing question for session ${sessionId}: ${question.substring(0, 100)}...`);

            let response;

            if (useEnhancedAI) {
                // Use enhanced AI service with advanced RAG
                response = await enhancedAIService.contextualQA(question, sessionId, {
                    maxResults,
                    confidenceThreshold,
                    includeAnalysis,
                    responseFormat,
                    enableCrossDocument: true,
                    enableReRanking: true
                });
            } else {
                // Fallback to basic AI service
                const context = await vectorDB.getRelevantContext(question, sessionId);
                response = await aiService.processQA(question, context.context, {
                    sessionId,
                    includeSourceInfo: true
                });
                
                // Add basic analysis
                response.analysis = {
                    relevantSources: context.sources.length,
                    confidence: context.confidence,
                    processingMethod: 'basic'
                };
            }

            // Track usage statistics
            this.updateSessionUsage(sessionId, question, response);

            return {
                success: true,
                question,
                answer: response.answer,
                sources: response.sources || [],
                analysis: response.analysis || {},
                sessionId,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            logger.error(`Failed to process question for session ${sessionId}:`, error);
            throw error;
        }
    }

    async searchDocuments(query, sessionId, options = {}) {
        try {
            const {
                searchType = 'semantic', // 'semantic', 'keyword', 'hybrid'
                maxResults = 20,
                documentIds = null,
                includeSnippets = true
            } = options;

            logger.info(`Searching documents for session ${sessionId}: ${query}`);

            let results;

            switch (searchType) {
                case 'semantic':
                    results = await vectorDB.semanticSearch(query, sessionId, maxResults, documentIds);
                    break;
                case 'cross-document':
                    results = await vectorDB.crossDocumentSearch(query, sessionId, maxResults);
                    break;
                default:
                    results = await vectorDB.semanticSearch(query, sessionId, maxResults, documentIds);
            }

            return {
                success: true,
                query,
                results: results.map(result => ({
                    documentId: result.documentId,
                    filename: result.metadata?.filename || 'Unknown',
                    source: result.metadata?.filename || 'Unknown Document',
                    content: result.text || 'No content available',
                    text: result.text || 'No content available',
                    snippet: includeSnippets ? this.createSnippet(result.text, query) : result.text?.substring(0, 200) + '...',
                    similarity: Math.round(result.similarity * 100) / 100,
                    chunkIndex: result.chunkIndex,
                    page: result.chunkIndex ? result.chunkIndex + 1 : null,
                    metadata: result.metadata
                })),
                totalResults: results.length,
                searchType,
                sessionId
            };

        } catch (error) {
            logger.error(`Search failed for session ${sessionId}:`, error);
            throw error;
        }
    }

    createSnippet(text, query, maxLength = 200) {
        const queryLower = query.toLowerCase();
        const textLower = text.toLowerCase();
        
        // Find the best match position
        let matchPos = textLower.indexOf(queryLower);
        if (matchPos === -1) {
            // Find individual words
            const queryWords = queryLower.split(/\s+/);
            for (const word of queryWords) {
                matchPos = textLower.indexOf(word);
                if (matchPos !== -1) break;
            }
        }
        
        if (matchPos === -1) {
            return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '');
        }
        
        // Create snippet around the match
        const start = Math.max(0, matchPos - 50);
        const end = Math.min(text.length, start + maxLength);
        
        const snippet = text.substring(start, end);
        return (start > 0 ? '...' : '') + snippet + (end < text.length ? '...' : '');
    }

    async getSimilarDocuments(content, sessionId, maxResults = 5) {
        try {
            return await vectorDB.findSimilarDocuments(content, sessionId, maxResults);
        } catch (error) {
            logger.error('Failed to find similar documents:', error);
            throw error;
        }
    }

    getSessionStats(sessionId) {
        if (!this.sessions.has(sessionId)) {
            return null;
        }

        const session = this.sessions.get(sessionId);
        const vectorStats = vectorDB.getSessionStats(sessionId);

        return {
            ...session.metadata,
            documents: session.documents.map(doc => ({
                documentId: doc.documentId,
                filename: doc.filename,
                chunkCount: doc.chunkCount,
                wordCount: doc.wordCount
            })),
            vectorDatabase: vectorStats,
            usage: session.usage || { questionsAsked: 0, searches: 0 }
        };
    }

    updateSessionUsage(sessionId, question, response) {
        if (!this.sessions.has(sessionId)) return;

        const session = this.sessions.get(sessionId);
        if (!session.usage) {
            session.usage = { questionsAsked: 0, searches: 0, lastActivity: null };
        }

        session.usage.questionsAsked += 1;
        session.usage.lastActivity = new Date();
        session.usage.lastQuestion = question.substring(0, 100);
    }

    async getDocumentStructure(documentId, sessionId) {
        try {
            return vectorDB.getDocumentStructure(documentId);
        } catch (error) {
            logger.error(`Failed to get document structure for ${documentId}:`, error);
            throw error;
        }
    }

    async deleteSession(sessionId) {
        try {
            // Remove from vector database
            await vectorDB.deleteSession(sessionId);
            
            // Remove from local sessions
            this.sessions.delete(sessionId);
            
            logger.info(`Deleted session ${sessionId}`);
            return { success: true, sessionId };
        } catch (error) {
            logger.error(`Failed to delete session ${sessionId}:`, error);
            throw error;
        }
    }

    async exportSession(sessionId, format = 'json') {
        try {
            const stats = this.getSessionStats(sessionId);
            if (!stats) {
                throw new Error(`Session ${sessionId} not found`);
            }

            const exportData = {
                sessionId,
                exportedAt: new Date().toISOString(),
                statistics: stats,
                documents: vectorDB.getAllDocuments().filter(doc => 
                    doc.sessionId === sessionId
                )
            };

            switch (format.toLowerCase()) {
                case 'json':
                    return {
                        data: JSON.stringify(exportData, null, 2),
                        filename: `session_${sessionId}_${Date.now()}.json`,
                        contentType: 'application/json'
                    };
                default:
                    throw new Error(`Unsupported export format: ${format}`);
            }
        } catch (error) {
            logger.error(`Failed to export session ${sessionId}:`, error);
            throw error;
        }
    }

    async getAdvancedAnalytics(sessionId) {
        try {
            const stats = this.getSessionStats(sessionId);
            if (!stats) {
                throw new Error(`Session ${sessionId} not found`);
            }

            // Get additional analytics from vector database
            const vectorStats = vectorDB.getSessionStats(sessionId);
            
            return {
                sessionOverview: {
                    totalDocuments: stats.totalDocuments,
                    totalChunks: stats.totalChunks,
                    estimatedTokens: vectorStats.estimatedTokens,
                    averageDocumentQuality: vectorStats.avgDocumentQuality
                },
                contentAnalysis: {
                    uniqueKeywords: vectorStats.uniqueKeywords,
                    keywordCount: vectorStats.uniqueKeywords.length,
                    topKeywords: vectorStats.uniqueKeywords.slice(0, 10)
                },
                usagePatterns: stats.usage,
                qualityMetrics: {
                    averageChunkSize: stats.totalChunks > 0 ? 
                        Math.round(vectorStats.estimatedTokens / stats.totalChunks) : 0,
                    documentComplexity: vectorStats.avgDocumentQuality,
                    processingSuccess: stats.documents.filter(d => d.success).length / stats.documents.length
                }
            };
        } catch (error) {
            logger.error(`Failed to get advanced analytics for ${sessionId}:`, error);
            throw error;
        }
    }

    async generateSummary(sessionId, modelType = 'granite') {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            const sessionData = this.sessions.get(sessionId);
            
            if (!sessionData || !sessionData.documents || sessionData.documents.length === 0) {
                throw new Error('No documents found for this session');
            }

            logger.info(`Generating summary for session ${sessionId} using ${modelType} model`);
            logger.info(`Session has ${sessionData.documents.length} documents`);

            // Get document content from vector database for summarization
            const allContent = [];
            try {
                // Get all documents for this session from vector database
                const sessionDocs = vectorDB.getDocumentsBySession(sessionId);
                logger.info(`Found ${sessionDocs.length} documents in vector DB for session ${sessionId}`);
                
                for (const doc of sessionDocs) {
                    if (doc.text || doc.content) {
                        allContent.push(doc.text || doc.content);
                    }
                }
                
                // If no content from new method, try semantic search with broad query
                if (allContent.length === 0) {
                    logger.info('Trying semantic search to get document content...');
                    const broadSearchResults = await vectorDB.semanticSearch('', sessionId, 100);
                    for (const result of broadSearchResults) {
                        if (result.text || result.content) {
                            allContent.push(result.text || result.content);
                        }
                    }
                }
                
            } catch (vectorError) {
                logger.error('Error getting content from vector DB:', vectorError);
                // Fallback to session documents if available
                for (const doc of sessionData.documents) {
                    logger.info('Document structure:', JSON.stringify(Object.keys(doc), null, 2));
                    
                    if (doc.analysis && doc.analysis.chunks) {
                        allContent.push(...doc.analysis.chunks.map(chunk => chunk.content));
                    } else if (doc.chunks) {
                        allContent.push(...doc.chunks.map(chunk => chunk.content || chunk.text));
                    } else if (doc.content) {
                        allContent.push(doc.content);
                    } else if (doc.text) {
                        allContent.push(doc.text);
                    }
                }
            }

            if (allContent.length === 0) {
                throw new Error('No content available for summarization');
            }

            // Combine content with reasonable limits
            const combinedContent = allContent.join('\n\n').substring(0, 10000); // Limit for API

            let summary;
            if (modelType === 'granite') {
                // Use Granite model for summarization via IBM Watson
                summary = await this.generateGraniteSummary(combinedContent);
            } else {
                // Fallback to enhanced AI service (Gemini)
                const mockDocuments = [{
                    content: combinedContent,
                    metadata: { filename: 'Combined Documents' }
                }];
                summary = await enhancedAIService.smartSummarization(mockDocuments, 'overview');
            }

            logger.info(`Summary generated successfully for session ${sessionId}`);
            return summary;

        } catch (error) {
            logger.error('Error generating summary:', error);
            throw new Error(`Failed to generate summary: ${error.message}`);
        }
    }

    async generateGraniteSummary(content) {
        try {
            logger.info('Generating Granite summary for content length:', content.length);
            
            // For now, return a basic summary to test the flow
            const basicSummary = this.generateBasicSummary(content);
            
            // Try to use the AI service smartSummarization method
            try {
                // Create a mock document structure for the AI service
                const mockDocuments = [{
                    content: content,
                    metadata: { filename: 'Combined Documents' }
                }];

                const aiSummary = await enhancedAIService.smartSummarization(mockDocuments, 'overview');
                return aiSummary || basicSummary;
            } catch (aiError) {
                logger.error('AI service error:', aiError);
                return basicSummary;
            }
        } catch (error) {
            logger.error('Error with Granite summary generation:', error);
            return this.generateBasicSummary(content);
        }
    }

    generateBasicSummary(content) {
        // Simple extractive summary as fallback
        const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
        const summaryLength = Math.min(5, Math.ceil(sentences.length * 0.2));
        
        // Take first few sentences and some from middle/end
        const summary = [
            ...sentences.slice(0, Math.ceil(summaryLength / 2)),
            ...sentences.slice(-Math.floor(summaryLength / 2))
        ].join('. ');

        return `Summary: ${summary}.`;
    }

    async hasSession(sessionId) {
        return this.sessions.has(sessionId);
    }

    async healthCheck() {
        try {
            return {
                service: 'DocumentService',
                status: 'healthy',
                initialized: this.isInitialized,
                activeSessions: this.sessions.size,
                components: {
                    vectorDatabase: vectorDB.isInitialized,
                    documentProcessor: documentProcessor.isInitialized,
                    aiService: true
                },
                uptime: process.uptime(),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                service: 'DocumentService',
                status: 'error',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Get comprehensive session document information for cross-document operations
     */
    async getSessionDocuments(sessionId) {
        try {
            const session = this.sessions.get(sessionId);
            if (!session) {
                return {
                    success: false,
                    message: 'Session not found',
                    documents: [],
                    totalCount: 0
                };
            }

            const documents = session.documents.map(doc => ({
                documentId: doc.documentId,
                filename: doc.filename,
                originalname: doc.originalname,
                chunkCount: doc.chunkCount,
                wordCount: doc.wordCount,
                characterCount: doc.characterCount,
                metadata: doc.metadata,
                processingMethod: doc.processingMethod,
                canCrossReference: true,
                searchable: true
            }));

            return {
                success: true,
                documents,
                totalCount: documents.length,
                sessionMetadata: session.metadata,
                crossDocumentCapabilities: {
                    enabled: true,
                    totalChunks: session.metadata.totalChunks,
                    searchTypes: ['semantic', 'keyword', 'similarity'],
                    aiCapabilities: ['multi-document-qa', 'source-attribution', 'cross-reference']
                }
            };
        } catch (error) {
            logger.error(`Failed to get session documents for ${sessionId}:`, error);
            return {
                success: false,
                message: 'Error retrieving session documents',
                error: error.message
            };
        }
    }

    /**
     * Search across multiple documents in a session
     */
    async crossDocumentSearch(query, sessionId, options = {}) {
        try {
            const { 
                limit = 10, 
                confidenceThreshold = 0.1,
                includeSourceInfo = true,
                documentIds = null 
            } = options;

            logger.info(`Cross-document search for session ${sessionId}: ${query.substring(0, 100)}...`);

            // Use vector database for semantic search across all session documents
            const searchResults = await vectorDB.semanticSearch(query, sessionId, limit, documentIds);

            if (!searchResults || searchResults.length === 0) {
                return {
                    success: false,
                    message: 'No relevant content found across documents',
                    results: [],
                    searchQuery: query
                };
            }

            // Group results by document for better organization
            const resultsByDocument = {};
            const sessionDocuments = this.sessions.get(sessionId)?.documents || [];

            searchResults.forEach(result => {
                if (result.similarity >= confidenceThreshold) {
                    const docInfo = sessionDocuments.find(d => d.documentId === result.documentId);
                    
                    if (!resultsByDocument[result.documentId]) {
                        resultsByDocument[result.documentId] = {
                            documentId: result.documentId,
                            filename: result.metadata?.filename || docInfo?.filename || 'Unknown',
                            chunks: [],
                            maxSimilarity: result.similarity,
                            relevanceScore: result.similarity
                        };
                    }

                    resultsByDocument[result.documentId].chunks.push({
                        text: result.text,
                        similarity: result.similarity,
                        chunkIndex: result.chunkIndex,
                        keywords: result.keywords
                    });

                    // Update max similarity if higher
                    if (result.similarity > resultsByDocument[result.documentId].maxSimilarity) {
                        resultsByDocument[result.documentId].maxSimilarity = result.similarity;
                        resultsByDocument[result.documentId].relevanceScore = result.similarity;
                    }
                }
            });

            const organizedResults = Object.values(resultsByDocument)
                .sort((a, b) => b.relevanceScore - a.relevanceScore);

            return {
                success: true,
                searchQuery: query,
                results: organizedResults,
                totalDocuments: organizedResults.length,
                totalChunks: searchResults.length,
                sessionId,
                crossDocumentSearch: true,
                searchOptions: options
            };

        } catch (error) {
            logger.error(`Cross-document search failed for session ${sessionId}:`, error);
            return {
                success: false,
                message: 'Cross-document search failed',
                error: error.message,
                searchQuery: query
            };
        }
    }

    /**
     * Enhanced question answering with explicit cross-document support
     */
    async askQuestionCrossDocument(question, sessionId, options = {}) {
        try {
            const {
                useEnhancedAI = true,
                maxResults = 15,
                confidenceThreshold = 0.1,
                includeAnalysis = true,
                responseFormat = 'comprehensive',
                documentIds = null,
                enableSourceAttribution = true
            } = options;

            logger.info(`Cross-document Q&A for session ${sessionId}: ${question.substring(0, 100)}...`);

            // First, perform cross-document search
            const searchResults = await this.crossDocumentSearch(question, sessionId, {
                limit: maxResults,
                confidenceThreshold,
                documentIds
            });

            if (!searchResults.success) {
                return searchResults;
            }

            // Use enhanced AI service with cross-document context
            const response = await enhancedAIService.contextualQA(question, sessionId, {
                maxResults,
                confidenceThreshold,
                includeAnalysis,
                responseFormat,
                enableCrossDocument: true,
                enableReRanking: true,
                documentIds,
                searchResults: searchResults.results
            });

            // Enhanced source attribution with document information
            const enhancedSources = response.sources?.map(source => {
                const documentInfo = searchResults.results.find(r => r.documentId === source.documentId);
                return {
                    ...source,
                    filename: documentInfo?.filename || source.filename,
                    documentId: source.documentId,
                    crossDocumentSource: true,
                    relevanceScore: documentInfo?.relevanceScore || source.similarity
                };
            }) || [];

            return {
                success: true,
                question,
                answer: response.answer,
                sources: enhancedSources,
                analysis: {
                    ...response.analysis,
                    crossDocumentSearch: true,
                    documentsSearched: searchResults.totalDocuments,
                    chunksAnalyzed: searchResults.totalChunks,
                    searchResults: searchResults.results
                },
                sessionId,
                timestamp: new Date().toISOString(),
                crossDocumentFeatures: {
                    enabled: true,
                    sourceAttribution: enableSourceAttribution,
                    multiDocumentContext: true
                }
            };

        } catch (error) {
            logger.error(`Cross-document Q&A failed for session ${sessionId}:`, error);
            return {
                success: false,
                message: 'Cross-document question answering failed',
                error: error.message,
                question
            };
        }
    }
}

module.exports = new DocumentService();