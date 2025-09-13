const tf = require('@tensorflow/tfjs-node');
const use = require('@tensorflow-models/universal-sentence-encoder');
const HNSWLib = require('hnswlib-node');
const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

class AdvancedVectorDatabase {
    constructor() {
        this.model = null;
        this.index = null;
        this.documents = new Map();
        this.embeddings = new Map();
        this.sessionDocuments = new Map(); // sessionId -> documentIds[]
        this.isInitialized = false;
        this.dimension = 512; // USE model dimension
        this.maxElements = 10000;
        this.currentElements = 0;
    }

    async initialize() {
        if (this.isInitialized) return;
        
        try {
            logger.info('Initializing Universal Sentence Encoder...');
            this.model = await use.load();
            
            // Initialize HNSW index for fast similarity search
            this.index = new HNSWLib.HierarchicalNSW('cosine', this.dimension);
            this.index.initIndex(this.maxElements);
            this.index.setEfConstruction(200);
            
            this.isInitialized = true;
            logger.info('Advanced Vector Database initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize vector database:', error);
            // Fallback to simple similarity if advanced fails
            this.isInitialized = false;
        }
    }

    async addDocument(documentId, chunks, metadata, sessionId) {
        if (!this.isInitialized) {
            // Fallback to simple storage
            return this.addDocumentSimple(documentId, chunks, metadata, sessionId);
        }

        try {
            const chunkTexts = chunks.map(chunk => 
                typeof chunk === 'string' ? chunk : chunk.text
            );
            
            const embeddings = await this.createEmbeddings(chunkTexts);
            const docData = {
                id: documentId,
                chunks: chunkTexts,
                metadata,
                embeddings,
                addedAt: new Date(),
                sessionId
            };

            this.documents.set(documentId, docData);

            // Add to session tracking
            if (!this.sessionDocuments.has(sessionId)) {
                this.sessionDocuments.set(sessionId, []);
            }
            this.sessionDocuments.get(sessionId).push(documentId);

            // Add embeddings to HNSW index
            chunkTexts.forEach((chunk, index) => {
                if (this.currentElements >= this.maxElements) {
                    logger.warn('Vector database capacity reached');
                    return;
                }
                
                const chunkId = `${documentId}_${index}`;
                this.index.addPoint(embeddings[index], this.currentElements);
                this.embeddings.set(chunkId, {
                    documentId,
                    chunkIndex: index,
                    text: chunk,
                    embedding: embeddings[index],
                    metadata,
                    globalIndex: this.currentElements
                });
                this.currentElements++;
            });

            logger.info(`Added document ${documentId} with ${chunkTexts.length} chunks to vector database`);
            return true;
        } catch (error) {
            logger.error(`Failed to add document ${documentId}:`, error);
            // Fallback to simple storage
            return this.addDocumentSimple(documentId, chunks, metadata, sessionId);
        }
    }

    addDocumentSimple(documentId, chunks, metadata, sessionId) {
        const chunkTexts = chunks.map(chunk => 
            typeof chunk === 'string' ? chunk : chunk.text
        );
        
        const docData = {
            id: documentId,
            chunks: chunkTexts,
            metadata,
            addedAt: new Date(),
            sessionId
        };

        this.documents.set(documentId, docData);

        if (!this.sessionDocuments.has(sessionId)) {
            this.sessionDocuments.set(sessionId, []);
        }
        this.sessionDocuments.get(sessionId).push(documentId);

        logger.info(`Added document ${documentId} (simple mode) with ${chunkTexts.length} chunks`);
        return true;
    }

    async createEmbeddings(texts) {
        if (!this.model) throw new Error('Model not initialized');
        
        try {
            const embeddings = await this.model.embed(texts);
            return embeddings.arraySync();
        } catch (error) {
            logger.error('Failed to create embeddings:', error);
            throw error;
        }
    }

    async semanticSearch(query, sessionId = null, limit = 10, documentIds = null) {
        if (!this.isInitialized) {
            return this.simpleTextSearch(query, sessionId, limit, documentIds);
        }

        try {
            const queryEmbedding = await this.createEmbeddings([query]);
            const searchResults = this.index.searchKnn(queryEmbedding[0], Math.min(limit * 3, 50));

            let results = searchResults.neighbors.map((globalIndex) => {
                // Find the chunk data by global index
                const chunkData = Array.from(this.embeddings.values()).find(
                    embedding => embedding.globalIndex === globalIndex
                );
                
                if (!chunkData) return null;

                const distance = searchResults.distances[searchResults.neighbors.indexOf(globalIndex)];
                return {
                    ...chunkData,
                    similarity: 1 - distance, // Convert distance to similarity
                    score: 1 - distance
                };
            }).filter(result => result !== null);

            // Filter by session
            if (sessionId) {
                const sessionDocs = this.sessionDocuments.get(sessionId) || [];
                results = results.filter(result => 
                    sessionDocs.includes(result.documentId)
                );
            }

            // Filter by specific documents
            if (documentIds) {
                results = results.filter(result => 
                    documentIds.includes(result.documentId)
                );
            }

            return results
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, limit);

        } catch (error) {
            logger.error('Semantic search failed:', error);
            return this.simpleTextSearch(query, sessionId, limit, documentIds);
        }
    }

    simpleTextSearch(query, sessionId = null, limit = 10, documentIds = null) {
        const queryLower = query.toLowerCase();
        const queryWords = queryLower.split(/\s+/).filter(word => word.length > 2);
        let results = [];

        // Get documents to search
        let documentsToSearch = Array.from(this.documents.values());
        
        if (sessionId && this.sessionDocuments.has(sessionId)) {
            const sessionDocs = this.sessionDocuments.get(sessionId);
            documentsToSearch = documentsToSearch.filter(doc => 
                sessionDocs.includes(doc.id)
            );
        }

        if (documentIds) {
            documentsToSearch = documentsToSearch.filter(doc => 
                documentIds.includes(doc.id)
            );
        }

        documentsToSearch.forEach(doc => {
            doc.chunks.forEach((chunk, index) => {
                const chunkLower = chunk.toLowerCase();
                let score = 0;

                // Exact phrase match
                if (chunkLower.includes(queryLower)) {
                    score += 0.8;
                }

                // Word matches
                const matchingWords = queryWords.filter(word => 
                    chunkLower.includes(word)
                );
                score += (matchingWords.length / queryWords.length) * 0.5;

                // Boost for multiple word matches
                if (matchingWords.length > 1) {
                    score += 0.2;
                }

                if (score > 0) {
                    results.push({
                        documentId: doc.id,
                        chunkIndex: index,
                        text: chunk,
                        metadata: doc.metadata,
                        similarity: Math.min(score, 1.0),
                        score: Math.min(score, 1.0)
                    });
                }
            });
        });

        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    async crossDocumentSearch(query, sessionId, limit = 20) {
        const results = await this.semanticSearch(query, sessionId, limit);
        
        // Group by document and rank cross-document relevance
        const documentGroups = {};
        results.forEach(result => {
            if (!documentGroups[result.documentId]) {
                documentGroups[result.documentId] = [];
            }
            documentGroups[result.documentId].push(result);
        });

        // Calculate document-level relevance scores
        const crossDocResults = Object.entries(documentGroups).map(([docId, chunks]) => {
            const avgSimilarity = chunks.reduce((sum, chunk) => sum + chunk.similarity, 0) / chunks.length;
            const maxSimilarity = Math.max(...chunks.map(c => c.similarity));
            const chunkCount = chunks.length;
            
            return {
                documentId: docId,
                chunks: chunks.sort((a, b) => b.similarity - a.similarity),
                avgSimilarity,
                maxSimilarity,
                chunkCount,
                relevanceScore: (avgSimilarity * 0.4) + (maxSimilarity * 0.6) + (Math.log(chunkCount + 1) * 0.1)
            };
        });

        return crossDocResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
    }

    async searchInDocuments(query, documentIds, sessionId, limit = 10) {
        return this.semanticSearch(query, sessionId, limit, documentIds);
    }

    async getRelevantContext(query, sessionId, maxTokens = 4000) {
        const results = await this.semanticSearch(query, sessionId, 15);
        
        if (results.length === 0) {
            return {
                context: '',
                sources: [],
                error: 'No documents found for this session'
            };
        }

        let contextText = '';
        let tokenCount = 0;
        const sources = [];
        const estimatedTokensPerChar = 0.25; // Rough estimation

        for (const result of results) {
            const textTokens = result.text.length * estimatedTokensPerChar;
            if (tokenCount + textTokens > maxTokens) break;
            
            contextText += result.text + '\n\n';
            tokenCount += textTokens;
            
            sources.push({
                documentId: result.documentId,
                filename: result.metadata?.filename || 'Unknown',
                similarity: result.similarity,
                snippet: result.text.substring(0, 100) + '...'
            });
        }

        return {
            context: contextText.trim(),
            sources: sources.slice(0, 10),
            totalResults: results.length
        };
    }

    async findSimilarDocuments(content, sessionId, maxResults = 5) {
        const results = await this.semanticSearch(content, sessionId, maxResults * 3);
        
        // Group by document and calculate document similarity
        const docSimilarities = {};
        results.forEach(result => {
            if (!docSimilarities[result.documentId]) {
                docSimilarities[result.documentId] = {
                    documentId: result.documentId,
                    metadata: result.metadata,
                    similarities: [],
                    avgSimilarity: 0
                };
            }
            docSimilarities[result.documentId].similarities.push(result.similarity);
        });

        // Calculate average similarities
        const similarDocs = Object.values(docSimilarities).map(doc => {
            doc.avgSimilarity = doc.similarities.reduce((a, b) => a + b, 0) / doc.similarities.length;
            return doc;
        });

        return similarDocs
            .sort((a, b) => b.avgSimilarity - a.avgSimilarity)
            .slice(0, maxResults);
    }

    getDocumentStructure(documentId) {
        return this.documents.get(documentId);
    }

    getSessionStats(sessionId) {
        const sessionDocs = this.sessionDocuments.get(sessionId) || [];
        const documents = sessionDocs.map(docId => this.documents.get(docId)).filter(Boolean);
        
        const totalChunks = documents.reduce((sum, doc) => sum + doc.chunks.length, 0);
        const totalTokens = documents.reduce((sum, doc) => 
            sum + doc.chunks.reduce((chunkSum, chunk) => 
                chunkSum + Math.ceil(chunk.length * 0.25), 0
            ), 0
        );

        return {
            documentCount: documents.length,
            chunkCount: totalChunks,
            estimatedTokens: totalTokens,
            lastUpdated: documents.length > 0 ? 
                Math.max(...documents.map(doc => new Date(doc.addedAt).getTime())) : null
        };
    }

    async deleteSession(sessionId) {
        const sessionDocs = this.sessionDocuments.get(sessionId) || [];
        
        // Remove documents
        sessionDocs.forEach(docId => {
            this.documents.delete(docId);
            
            // Remove embeddings for this document
            Array.from(this.embeddings.keys()).forEach(key => {
                if (key.startsWith(docId + '_')) {
                    this.embeddings.delete(key);
                }
            });
        });

        // Remove session tracking
        this.sessionDocuments.delete(sessionId);
        
        logger.info(`Deleted session ${sessionId} with ${sessionDocs.length} documents`);
    }

    getAllDocuments() {
        return Array.from(this.documents.values());
    }

    async saveIndex(filePath) {
        if (!this.isInitialized || !this.index) return;
        
        try {
            const dir = path.dirname(filePath);
            await fs.mkdir(dir, { recursive: true });
            this.index.writeIndexSync(filePath);
            logger.info(`Vector index saved to ${filePath}`);
        } catch (error) {
            logger.error('Failed to save vector index:', error);
        }
    }

    async loadIndex(filePath) {
        if (!this.isInitialized || !this.index) return;
        
        try {
            this.index.readIndexSync(filePath);
            logger.info(`Vector index loaded from ${filePath}`);
        } catch (error) {
            logger.error('Failed to load vector index:', error);
        }
    }
}

module.exports = new AdvancedVectorDatabase();