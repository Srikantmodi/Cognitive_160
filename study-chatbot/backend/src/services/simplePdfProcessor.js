const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('./logger');
const { v4: uuidv4 } = require('uuid');

class SimplePDFProcessor {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.documents = new Map(); // Store document chunks
    this.sessionDocuments = new Map(); // sessionId -> Set(documentIds)
    this.documentMetadata = new Map(); // documentId -> metadata
  }

  /**
   * Extract text from PDF buffer or text file
   */
  async extractTextFromPDF(pdfBuffer, filename) {
    try {
      logger.info(`Starting text extraction for: ${filename}`);
      
      const fileExtension = filename.split('.').pop().toLowerCase();
      
      if (fileExtension === 'txt') {
        // Handle text files
        const text = pdfBuffer.toString('utf8');
        
        const extractedData = {
          text: text,
          numPages: 1,
          info: { title: filename },
          metadata: {
            filename,
            extractedAt: new Date().toISOString(),
            wordCount: text.split(/\s+/).length,
            characterCount: text.length,
          }
        };

        logger.info(`Text extraction completed for: ${filename}`, {
          wordCount: extractedData.metadata.wordCount
        });

        return extractedData;
      } else {
        // Handle PDF files
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
      }
    } catch (error) {
      logger.error(`Error extracting text from file: ${filename}`, error);
      throw new Error(`Failed to extract text from file: ${error.message}`);
    }
  }

  /**
   * Split text into chunks
   */
  splitTextIntoChunks(text, chunkSize = 1000, overlap = 200) {
    const chunks = [];
    const sentences = text.split(/[.!?]+/).filter(s => s.trim());
    
    let currentChunk = '';
    let currentLength = 0;
    
    for (const sentence of sentences) {
      const sentenceLength = sentence.length;
      
      if (currentLength + sentenceLength > chunkSize && currentChunk) {
        chunks.push(currentChunk.trim());
        
        // Keep some overlap
        const words = currentChunk.split(' ');
        const overlapWords = words.slice(-Math.floor(overlap / 10));
        currentChunk = overlapWords.join(' ') + ' ' + sentence;
        currentLength = currentChunk.length;
      } else {
        currentChunk += sentence + '. ';
        currentLength += sentenceLength + 2;
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }

  /**
   * Process PDF and create document chunks
   */
  async processPDF(pdfBuffer, filename, sessionId) {
    try {
      const documentId = uuidv4();
      
      // Extract text from PDF
      const extractedData = await this.extractTextFromPDF(pdfBuffer, filename);
      
      // Split into chunks
      const textChunks = this.splitTextIntoChunks(
        extractedData.text,
        parseInt(process.env.PDF_CHUNK_SIZE) || 1000,
        parseInt(process.env.PDF_OVERLAP) || 200
      );

      // Store document chunks
      const documentChunks = textChunks.map((chunk, index) => ({
        id: `${documentId}_chunk_${index}`,
        documentId,
        chunkIndex: index,
        content: chunk,
        filename,
        sessionId,
        metadata: {
          ...extractedData.metadata,
          chunkIndex: index,
          chunkId: `${documentId}_chunk_${index}`
        }
      }));

      this.documents.set(documentId, documentChunks);

      // Store document metadata
      this.documentMetadata.set(documentId, {
        ...extractedData.metadata,
        documentId,
        sessionId,
        numChunks: documentChunks.length,
        processedAt: new Date().toISOString()
      });

      // Add to session
      if (!this.sessionDocuments.has(sessionId)) {
        this.sessionDocuments.set(sessionId, new Set());
      }
      this.sessionDocuments.get(sessionId).add(documentId);

      logger.info(`PDF processing completed for: ${filename}`, {
        documentId,
        chunks: documentChunks.length
      });

      return {
        documentId,
        filename,
        numChunks: documentChunks.length,
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
   * Simple similarity search using text matching
   */
  async semanticSearch(query, sessionId, k = 5) {
    try {
      const sessionDocs = this.sessionDocuments.get(sessionId);
      if (!sessionDocs) {
        throw new Error('No documents found for this session.');
      }

      const allChunks = [];
      
      // Collect all chunks from session documents
      for (const documentId of sessionDocs) {
        const docChunks = this.documents.get(documentId) || [];
        allChunks.push(...docChunks);
      }

      if (allChunks.length === 0) {
        return [];
      }

      // Simple text similarity scoring
      const queryLower = query.toLowerCase();
      const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
      
      const scoredChunks = allChunks.map(chunk => {
        const contentLower = chunk.content.toLowerCase();
        let score = 0;
        
        // Count word matches
        for (const word of queryWords) {
          const matches = (contentLower.match(new RegExp(word, 'g')) || []).length;
          score += matches;
        }
        
        // Boost score for exact phrase matches
        if (contentLower.includes(queryLower)) {
          score += 10;
        }
        
        return {
          chunk,
          score,
          relevance: score / Math.max(queryWords.length, 1)
        };
      });

      // Sort by score and return top k
      const results = scoredChunks
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map(item => ({
          content: item.chunk.content,
          metadata: item.chunk.metadata,
          relevance: item.relevance,
          score: item.score
        }));

      return results;

    } catch (error) {
      logger.error(`Error performing semantic search for session: ${sessionId}`, error);
      throw error;
    }
  }

  /**
   * Get relevant context for a query
   */
  async getRelevantContext(query, sessionId, maxTokens = 4000) {
    try {
      const searchResults = await this.semanticSearch(query, sessionId, 15);
      
      let contextText = '';
      let tokenCount = 0;
      const sources = [];
      
      // Estimate tokens (rough approximation: 1 token ≈ 4 characters)
      const estimateTokens = (text) => Math.ceil(text.length / 4);
      
      for (const result of searchResults) {
        const chunkTokens = estimateTokens(result.content);
        
        if (tokenCount + chunkTokens > maxTokens) {
          break;
        }
        
        contextText += `\n[${result.metadata.filename} - Chunk ${result.metadata.chunkIndex}]\n${result.content}\n`;
        tokenCount += chunkTokens;
        
        sources.push({
          filename: result.metadata.filename,
          documentId: result.metadata.documentId,
          chunkIndex: result.metadata.chunkIndex,
          relevance: result.relevance
        });
      }
      
      return {
        context: contextText.trim(),
        sources,
        tokenCount: tokenCount,
        query,
        documentsUsed: sources.length
      };
      
    } catch (error) {
      logger.error(`Error getting relevant context:`, error);
      throw new Error(`Failed to get relevant context: ${error.message}`);
    }
  }

  /**
   * Search within specific documents
   */
  async searchInDocuments(query, documentIds, sessionId, k = 5) {
    try {
      const allChunks = [];
      
      for (const documentId of documentIds) {
        const docChunks = this.documents.get(documentId) || [];
        allChunks.push(...docChunks.filter(chunk => chunk.sessionId === sessionId));
      }

      const queryLower = query.toLowerCase();
      const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
      
      const scoredChunks = allChunks.map(chunk => {
        const contentLower = chunk.content.toLowerCase();
        let score = 0;
        
        for (const word of queryWords) {
          const matches = (contentLower.match(new RegExp(word, 'g')) || []).length;
          score += matches;
        }
        
        if (contentLower.includes(queryLower)) {
          score += 10;
        }
        
        return {
          content: chunk.content,
          metadata: chunk.metadata,
          score,
          relevance: score / Math.max(queryWords.length, 1)
        };
      });

      return scoredChunks
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);

    } catch (error) {
      logger.error('Error searching in documents:', error);
      throw error;
    }
  }

  /**
   * Get session documents
   */
  getSessionDocuments(sessionId) {
    const sessionDocs = Array.from(this.documentMetadata.values())
      .filter(doc => doc.sessionId === sessionId);
    
    return sessionDocs;
  }

  /**
   * Delete session data
   */
  async deleteSession(sessionId) {
    try {
      const sessionDocs = this.sessionDocuments.get(sessionId);
      if (sessionDocs) {
        for (const documentId of sessionDocs) {
          this.documents.delete(documentId);
          this.documentMetadata.delete(documentId);
        }
        this.sessionDocuments.delete(sessionId);
      }

      logger.info(`Deleted session data for: ${sessionId}`);
    } catch (error) {
      logger.error(`Error deleting session: ${sessionId}`, error);
      throw error;
    }
  }

  /**
   * Get session statistics
   */
  getSessionStats(sessionId) {
    const documents = this.sessionDocuments.get(sessionId) || new Set();
    
    return {
      sessionId,
      documentCount: documents.size,
      documents: Array.from(documents).map(docId => {
        const metadata = this.documentMetadata.get(docId);
        return {
          documentId: docId,
          ...metadata
        };
      })
    };
  }

  /**
   * Cross-document search
   */
  async crossDocumentSearch(query, sessionId, k = 10) {
    try {
      const results = await this.semanticSearch(query, sessionId, k);
      
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
        
        documentGroups[docId].maxRelevance = Math.max(
          documentGroups[docId].maxRelevance, 
          result.relevance
        );
      });
      
      // Calculate average relevance for each document
      Object.keys(documentGroups).forEach(docId => {
        const doc = documentGroups[docId];
        doc.avgRelevance = doc.chunks.reduce((sum, chunk) => sum + chunk.relevance, 0) / doc.chunks.length;
        doc.chunks.sort((a, b) => b.relevance - a.relevance);
      });
      
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
   * Find similar documents
   */
  async findSimilarDocuments(content, sessionId, k = 3) {
    try {
      const results = await this.semanticSearch(content, sessionId, k * 3);
      
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

module.exports = new SimplePDFProcessor();