const { FaissStore } = require('@langchain/community/vectorstores/faiss');
const { GoogleGenerativeAIEmbeddings } = require('@langchain/google-genai');
const { Document } = require('langchain/document');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class VectorDatabaseService {
  constructor() {
    this.embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GEMINI_API_KEY,
      model: "embedding-001",
    });
    
    this.vectorStores = new Map(); // sessionId -> vectorStore
    this.documentIndex = new Map(); // documentId -> metadata
    this.sessionDocuments = new Map(); // sessionId -> Set(documentIds)
    
    this.dataDir = process.env.VECTOR_DB_PATH || './data';
    this.ensureDataDirectory();
  }

  ensureDataDirectory() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * Create or get vector store for session
   * @param {string} sessionId - Session identifier
   * @returns {FaissStore} - Vector store instance
   */
  async getOrCreateVectorStore(sessionId) {
    if (!this.vectorStores.has(sessionId)) {
      // Try to load existing vector store
      const storePath = path.join(this.dataDir, `vectorstore_${sessionId}`);
      
      try {
        if (fs.existsSync(storePath)) {
          const vectorStore = await FaissStore.load(storePath, this.embeddings);
          this.vectorStores.set(sessionId, vectorStore);
          logger.info(`Loaded existing vector store for session: ${sessionId}`);
        } else {
          // Create empty vector store with a dummy document
          const dummyDoc = new Document({
            pageContent: "initialization",
            metadata: { type: "init", sessionId }
          });
          const vectorStore = await FaissStore.fromDocuments([dummyDoc], this.embeddings);
          this.vectorStores.set(sessionId, vectorStore);
          logger.info(`Created new vector store for session: ${sessionId}`);
        }
      } catch (error) {
        logger.error(`Error loading/creating vector store for session ${sessionId}:`, error);
        // Fallback to creating new vector store
        const dummyDoc = new Document({
          pageContent: "initialization",
          metadata: { type: "init", sessionId }
        });
        const vectorStore = await FaissStore.fromDocuments([dummyDoc], this.embeddings);
        this.vectorStores.set(sessionId, vectorStore);
      }
    }
    
    return this.vectorStores.get(sessionId);
  }

  /**
   * Add documents to vector store
   * @param {Array} documents - Array of Document objects
   * @param {string} sessionId - Session identifier
   * @param {string} documentId - Document identifier
   */
  async addDocuments(documents, sessionId, documentId) {
    try {
      const vectorStore = await this.getOrCreateVectorStore(sessionId);
      
      // Filter out initialization documents before adding new ones
      const validDocuments = documents.filter(doc => doc.metadata.type !== 'init');
      
      if (validDocuments.length > 0) {
        await vectorStore.addDocuments(validDocuments);
        
        // Update document tracking
        if (!this.sessionDocuments.has(sessionId)) {
          this.sessionDocuments.set(sessionId, new Set());
        }
        this.sessionDocuments.get(sessionId).add(documentId);
        
        // Store document metadata
        this.documentIndex.set(documentId, {
          sessionId,
          documentCount: validDocuments.length,
          addedAt: new Date().toISOString()
        });
        
        logger.info(`Added ${validDocuments.length} documents to vector store for session: ${sessionId}`);
      }
      
    } catch (error) {
      logger.error(`Error adding documents to vector store:`, error);
      throw new Error(`Failed to add documents: ${error.message}`);
    }
  }

  /**
   * Perform similarity search
   * @param {string} query - Search query
   * @param {string} sessionId - Session identifier
   * @param {number} k - Number of results
   * @param {Object} filter - Metadata filter
   * @returns {Array} - Search results with scores
   */
  async similaritySearch(query, sessionId, k = 5, filter = {}) {
    try {
      const vectorStore = await this.getOrCreateVectorStore(sessionId);
      
      // Perform similarity search with score
      const results = await vectorStore.similaritySearchWithScore(query, k, filter);
      
      // Filter out initialization documents
      const filteredResults = results.filter(([doc, score]) => doc.metadata.type !== 'init');
      
      return filteredResults.map(([doc, score]) => ({
        document: doc,
        score: score,
        content: doc.pageContent,
        metadata: doc.metadata,
        relevance: 1 - score // Convert distance to similarity score
      }));
      
    } catch (error) {
      logger.error(`Error performing similarity search:`, error);
      throw new Error(`Similarity search failed: ${error.message}`);
    }
  }

  /**
   * Search within specific documents
   * @param {string} query - Search query
   * @param {Array} documentIds - Array of document IDs to search within
   * @param {string} sessionId - Session identifier
   * @param {number} k - Number of results
   * @returns {Array} - Search results
   */
  async searchInDocuments(query, documentIds, sessionId, k = 5) {
    const filter = {
      documentId: documentIds
    };
    
    return await this.similaritySearch(query, sessionId, k, filter);
  }

  /**
   * Cross-document search with relevance ranking
   * @param {string} query - Search query
   * @param {string} sessionId - Session identifier
   * @param {number} k - Number of results
   * @returns {Object} - Organized search results by document
   */
  async crossDocumentSearch(query, sessionId, k = 10) {
    try {
      const results = await this.similaritySearch(query, sessionId, k);
      
      // Group results by document
      const documentGroups = {};
      
      results.forEach(result => {
        const docId = result.metadata.documentId;
        if (!documentGroups[docId]) {
          documentGroups[docId] = {
            documentId: docId,
            filename: result.metadata.filename,
            chunks: [],
            avgRelevance: 0,
            maxRelevance: 0
          };
        }
        
        documentGroups[docId].chunks.push({
          content: result.content,
          chunkIndex: result.metadata.chunkIndex,
          relevance: result.relevance,
          metadata: result.metadata
        });
        
        // Update relevance scores
        documentGroups[docId].maxRelevance = Math.max(
          documentGroups[docId].maxRelevance, 
          result.relevance
        );
      });
      
      // Calculate average relevance for each document
      Object.keys(documentGroups).forEach(docId => {
        const doc = documentGroups[docId];
        doc.avgRelevance = doc.chunks.reduce((sum, chunk) => sum + chunk.relevance, 0) / doc.chunks.length;
        
        // Sort chunks by relevance
        doc.chunks.sort((a, b) => b.relevance - a.relevance);
      });
      
      // Sort documents by max relevance
      const sortedDocuments = Object.values(documentGroups)
        .sort((a, b) => b.maxRelevance - a.maxRelevance);
      
      return {
        query,
        totalDocuments: sortedDocuments.length,
        documents: sortedDocuments,
        searchTimestamp: new Date().toISOString()
      };
      
    } catch (error) {
      logger.error(`Error in cross-document search:`, error);
      throw new Error(`Cross-document search failed: ${error.message}`);
    }
  }

  /**
   * Get relevant context for AI processing
   * @param {string} query - Query text
   * @param {string} sessionId - Session identifier
   * @param {number} maxTokens - Maximum context tokens
   * @returns {Object} - Context with metadata
   */
  async getRelevantContext(query, sessionId, maxTokens = 4000) {
    try {
      const results = await this.crossDocumentSearch(query, sessionId, 15);
      
      let contextText = '';
      let tokenCount = 0;
      const sources = [];
      
      // Estimate tokens (rough approximation: 1 token ≈ 4 characters)
      const estimateTokens = (text) => Math.ceil(text.length / 4);
      
      for (const document of results.documents) {
        for (const chunk of document.chunks) {
          const chunkTokens = estimateTokens(chunk.content);
          
          if (tokenCount + chunkTokens > maxTokens) {
            break;
          }
          
          contextText += `\n[${document.filename} - Chunk ${chunk.chunkIndex}]\n${chunk.content}\n`;
          tokenCount += chunkTokens;
          
          sources.push({
            filename: document.filename,
            documentId: document.documentId,
            chunkIndex: chunk.chunkIndex,
            relevance: chunk.relevance
          });
        }
        
        if (tokenCount >= maxTokens * 0.9) break; // Leave some buffer
      }
      
      return {
        context: contextText.trim(),
        sources,
        tokenCount: tokenCount,
        query,
        documentsUsed: results.totalDocuments
      };
      
    } catch (error) {
      logger.error(`Error getting relevant context:`, error);
      throw new Error(`Failed to get relevant context: ${error.message}`);
    }
  }

  /**
   * Save vector store to disk
   * @param {string} sessionId - Session identifier
   */
  async saveVectorStore(sessionId) {
    try {
      const vectorStore = this.vectorStores.get(sessionId);
      if (!vectorStore) {
        throw new Error('No vector store found for session');
      }
      
      const storePath = path.join(this.dataDir, `vectorstore_${sessionId}`);
      await vectorStore.save(storePath);
      
      logger.info(`Vector store saved for session: ${sessionId}`);
      return storePath;
      
    } catch (error) {
      logger.error(`Error saving vector store:`, error);
      throw error;
    }
  }

  /**
   * Delete session data
   * @param {string} sessionId - Session identifier
   */
  async deleteSession(sessionId) {
    try {
      // Remove from memory
      this.vectorStores.delete(sessionId);
      
      // Remove document tracking
      if (this.sessionDocuments.has(sessionId)) {
        const documentIds = this.sessionDocuments.get(sessionId);
        documentIds.forEach(docId => this.documentIndex.delete(docId));
        this.sessionDocuments.delete(sessionId);
      }
      
      // Remove from disk
      const storePath = path.join(this.dataDir, `vectorstore_${sessionId}`);
      if (fs.existsSync(storePath)) {
        fs.rmSync(storePath, { recursive: true });
      }
      
      logger.info(`Session data deleted: ${sessionId}`);
      
    } catch (error) {
      logger.error(`Error deleting session:`, error);
      throw error;
    }
  }

  /**
   * Get session statistics
   * @param {string} sessionId - Session identifier
   * @returns {Object} - Session statistics
   */
  getSessionStats(sessionId) {
    const documents = this.sessionDocuments.get(sessionId) || new Set();
    
    return {
      sessionId,
      documentCount: documents.size,
      hasVectorStore: this.vectorStores.has(sessionId),
      documents: Array.from(documents).map(docId => {
        const metadata = this.documentIndex.get(docId);
        return {
          documentId: docId,
          ...metadata
        };
      })
    };
  }

  /**
   * Find similar documents based on content
   * @param {string} content - Content to find similar documents for
   * @param {string} sessionId - Session identifier
   * @param {number} k - Number of similar documents
   * @returns {Array} - Similar documents
   */
  async findSimilarDocuments(content, sessionId, k = 3) {
    try {
      const results = await this.similaritySearch(content, sessionId, k * 3);
      
      // Group by document and get best match per document
      const documentMatches = {};
      
      results.forEach(result => {
        const docId = result.metadata.documentId;
        if (!documentMatches[docId] || result.relevance > documentMatches[docId].relevance) {
          documentMatches[docId] = {
            documentId: docId,
            filename: result.metadata.filename,
            bestMatch: result.content,
            relevance: result.relevance,
            chunkIndex: result.metadata.chunkIndex
          };
        }
      });
      
      return Object.values(documentMatches)
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, k);
        
    } catch (error) {
      logger.error(`Error finding similar documents:`, error);
      throw error;
    }
  }
}

module.exports = new VectorDatabaseService();