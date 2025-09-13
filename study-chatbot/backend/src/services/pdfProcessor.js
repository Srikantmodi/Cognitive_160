const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const { GoogleGenerativeAIEmbeddings } = require('@langchain/google-genai');
const { FaissStore } = require('@langchain/community/vectorstores/faiss');
const { Document } = require('langchain/document');
const logger = require('./logger');
const { v4: uuidv4 } = require('uuid');

class PDFProcessor {
  constructor() {
    this.embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GEMINI_API_KEY,
      model: "embedding-001",
    });
    
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: parseInt(process.env.PDF_CHUNK_SIZE) || 1000,
      chunkOverlap: parseInt(process.env.PDF_OVERLAP) || 200,
      separators: ['\n\n', '\n', '. ', '! ', '? ', ' ', ''],
    });

    this.vectorStores = new Map(); // Store vector databases per session/user
    this.documentMetadata = new Map(); // Store document metadata
  }

  /**
   * Extract text from PDF buffer
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @param {string} filename - Original filename
   * @returns {Object} - Extracted text and metadata
   */
  async extractTextFromPDF(pdfBuffer, filename) {
    try {
      logger.info(`Starting PDF text extraction for: ${filename}`);
      
      const pdfData = await pdfParse(pdfBuffer, {
        max: parseInt(process.env.MAX_PDF_PAGES) || 100,
      });

      const extractedData = {
        text: pdfData.text,
        numPages: pdfData.numpages,
        info: pdfData.info,
        metadata: {
          filename,
          extractedAt: new Date().toISOString(),
          wordCount: pdfData.text.split(/\s+/).length,
          characterCount: pdfData.text.length,
        }
      };

      logger.info(`PDF extraction completed for: ${filename}`, {
        pages: pdfData.numpages,
        wordCount: extractedData.metadata.wordCount
      });

      return extractedData;
    } catch (error) {
      logger.error(`Error extracting text from PDF: ${filename}`, error);
      throw new Error(`Failed to extract text from PDF: ${error.message}`);
    }
  }

  /**
   * Process PDF and create document chunks
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @param {string} filename - Original filename
   * @param {string} sessionId - Session identifier
   * @returns {Object} - Processing result with document ID and chunks
   */
  async processPDF(pdfBuffer, filename, sessionId) {
    try {
      const documentId = uuidv4();
      
      // Extract text from PDF
      const extractedData = await this.extractTextFromPDF(pdfBuffer, filename);
      
      // Create document chunks
      const documents = await this.createDocumentChunks(
        extractedData.text, 
        filename, 
        documentId,
        extractedData.metadata
      );

      // Store document metadata
      this.documentMetadata.set(documentId, {
        ...extractedData.metadata,
        documentId,
        sessionId,
        numChunks: documents.length,
        processedAt: new Date().toISOString()
      });

      // Add to vector store
      await this.addToVectorStore(documents, sessionId);

      logger.info(`PDF processing completed for: ${filename}`, {
        documentId,
        chunks: documents.length
      });

      return {
        documentId,
        filename,
        numChunks: documents.length,
        numPages: extractedData.numPages,
        wordCount: extractedData.metadata.wordCount,
        success: true
      };

    } catch (error) {
      logger.error(`Error processing PDF: ${filename}`, error);
      throw error;
    }
  }

  /**
   * Create document chunks from text
   * @param {string} text - Extracted text
   * @param {string} filename - Original filename
   * @param {string} documentId - Document identifier
   * @param {Object} metadata - Document metadata
   * @returns {Array} - Array of Document objects
   */
  async createDocumentChunks(text, filename, documentId, metadata) {
    try {
      const chunks = await this.textSplitter.splitText(text);
      
      const documents = chunks.map((chunk, index) => {
        return new Document({
          pageContent: chunk,
          metadata: {
            filename,
            documentId,
            chunkIndex: index,
            chunkId: `${documentId}_chunk_${index}`,
            source: filename,
            ...metadata
          }
        });
      });

      return documents;
    } catch (error) {
      logger.error(`Error creating document chunks for: ${filename}`, error);
      throw new Error(`Failed to create document chunks: ${error.message}`);
    }
  }

  /**
   * Add documents to vector store
   * @param {Array} documents - Array of Document objects
   * @param {string} sessionId - Session identifier
   */
  async addToVectorStore(documents, sessionId) {
    try {
      if (!this.vectorStores.has(sessionId)) {
        // Create new vector store for session
        const vectorStore = await FaissStore.fromDocuments(documents, this.embeddings);
        this.vectorStores.set(sessionId, vectorStore);
        logger.info(`Created new vector store for session: ${sessionId}`);
      } else {
        // Add to existing vector store
        const vectorStore = this.vectorStores.get(sessionId);
        await vectorStore.addDocuments(documents);
        logger.info(`Added documents to existing vector store for session: ${sessionId}`);
      }
    } catch (error) {
      logger.error(`Error adding documents to vector store for session: ${sessionId}`, error);
      throw new Error(`Failed to add documents to vector store: ${error.message}`);
    }
  }

  /**
   * Perform semantic search
   * @param {string} query - Search query
   * @param {string} sessionId - Session identifier
   * @param {number} k - Number of results to return
   * @returns {Array} - Search results with relevance scores
   */
  async semanticSearch(query, sessionId, k = 5) {
    try {
      const vectorStore = this.vectorStores.get(sessionId);
      if (!vectorStore) {
        throw new Error('No documents found for this session. Please upload PDFs first.');
      }

      const results = await vectorStore.similaritySearchWithScore(query, k);
      
      return results.map(([doc, score]) => ({
        content: doc.pageContent,
        metadata: doc.metadata,
        relevanceScore: score,
        citation: {
          filename: doc.metadata.filename,
          chunkIndex: doc.metadata.chunkIndex,
          documentId: doc.metadata.documentId
        }
      }));

    } catch (error) {
      logger.error(`Error performing semantic search for session: ${sessionId}`, error);
      throw error;
    }
  }

  /**
   * Get relevant context for a query across all documents in session
   * @param {string} query - Query text
   * @param {string} sessionId - Session identifier
   * @param {number} maxChunks - Maximum chunks to return
   * @returns {Object} - Context with sources and metadata
   */
  async getRelevantContext(query, sessionId, maxChunks = 10) {
    try {
      const searchResults = await this.semanticSearch(query, sessionId, maxChunks);
      
      const context = searchResults.map(result => result.content).join('\n\n');
      const sources = searchResults.map(result => ({
        filename: result.citation.filename,
        chunkIndex: result.citation.chunkIndex,
        relevanceScore: result.relevanceScore,
        documentId: result.citation.documentId
      }));

      // Group sources by document
      const documentSources = sources.reduce((acc, source) => {
        if (!acc[source.documentId]) {
          acc[source.documentId] = {
            filename: source.filename,
            chunks: [],
            avgRelevanceScore: 0
          };
        }
        acc[source.documentId].chunks.push({
          chunkIndex: source.chunkIndex,
          relevanceScore: source.relevanceScore
        });
        return acc;
      }, {});

      // Calculate average relevance scores
      Object.keys(documentSources).forEach(docId => {
        const doc = documentSources[docId];
        doc.avgRelevanceScore = doc.chunks.reduce((sum, chunk) => sum + chunk.relevanceScore, 0) / doc.chunks.length;
      });

      return {
        context,
        sources: documentSources,
        totalChunks: searchResults.length,
        query
      };

    } catch (error) {
      logger.error(`Error getting relevant context for session: ${sessionId}`, error);
      throw error;
    }
  }

  /**
   * Get document metadata for a session
   * @param {string} sessionId - Session identifier
   * @returns {Array} - Array of document metadata
   */
  getSessionDocuments(sessionId) {
    const sessionDocs = Array.from(this.documentMetadata.values())
      .filter(doc => doc.sessionId === sessionId);
    
    return sessionDocs;
  }

  /**
   * Delete session data
   * @param {string} sessionId - Session identifier
   */
  async deleteSession(sessionId) {
    try {
      // Remove vector store
      if (this.vectorStores.has(sessionId)) {
        this.vectorStores.delete(sessionId);
      }

      // Remove document metadata
      Array.from(this.documentMetadata.entries())
        .filter(([_, doc]) => doc.sessionId === sessionId)
        .forEach(([docId, _]) => this.documentMetadata.delete(docId));

      logger.info(`Deleted session data for: ${sessionId}`);
    } catch (error) {
      logger.error(`Error deleting session: ${sessionId}`, error);
      throw error;
    }
  }

  /**
   * Save vector store to disk
   * @param {string} sessionId - Session identifier
   * @param {string} savePath - Path to save the vector store
   */
  async saveVectorStore(sessionId, savePath) {
    try {
      const vectorStore = this.vectorStores.get(sessionId);
      if (!vectorStore) {
        throw new Error('No vector store found for session');
      }

      const fullPath = path.join(savePath, `vectorstore_${sessionId}`);
      await vectorStore.save(fullPath);
      
      logger.info(`Vector store saved for session: ${sessionId} at ${fullPath}`);
      return fullPath;
    } catch (error) {
      logger.error(`Error saving vector store for session: ${sessionId}`, error);
      throw error;
    }
  }

  /**
   * Load vector store from disk
   * @param {string} sessionId - Session identifier
   * @param {string} loadPath - Path to load the vector store from
   */
  async loadVectorStore(sessionId, loadPath) {
    try {
      const vectorStore = await FaissStore.load(loadPath, this.embeddings);
      this.vectorStores.set(sessionId, vectorStore);
      
      logger.info(`Vector store loaded for session: ${sessionId} from ${loadPath}`);
      return true;
    } catch (error) {
      logger.error(`Error loading vector store for session: ${sessionId}`, error);
      throw error;
    }
  }
}

module.exports = new PDFProcessor();