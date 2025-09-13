const stringSimilarity = require('string-similarity');
const natural = require('natural');
const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');
const { removeStopwords, eng } = require('stopword');
const keyword = require('keyword-extractor');

class EnhancedVectorDatabase {
    constructor() {
        this.documents = new Map();
        this.embeddings = new Map();
        this.sessionDocuments = new Map(); // sessionId -> documentIds[]
        this.tfidf = new natural.TfIdf();
        this.wordVectors = new Map(); // Simple word frequency vectors
        this.isInitialized = true; // No async initialization needed
        this.stemmer = natural.PorterStemmer;
    }

    async initialize() {
        // No initialization needed for this simplified version
        this.isInitialized = true;
        logger.info('Enhanced Vector Database (simplified) initialized successfully');
    }

    async addDocument(documentId, chunks, metadata, sessionId) {
        try {
            const chunkTexts = chunks.map(chunk => 
                typeof chunk === 'string' ? chunk : chunk.text
            );
            
            // Create enhanced embeddings using multiple techniques
            const embeddings = await this.createEnhancedEmbeddings(chunkTexts);
            
            const docData = {
                id: documentId,
                chunks: chunkTexts,
                metadata,
                embeddings,
                addedAt: new Date(),
                sessionId,
                keywords: this.extractDocumentKeywords(chunkTexts.join(' ')),
                statistics: this.calculateDocumentStatistics(chunkTexts)
            };

            this.documents.set(documentId, docData);

            // Add to session tracking
            if (!this.sessionDocuments.has(sessionId)) {
                this.sessionDocuments.set(sessionId, []);
            }
            this.sessionDocuments.get(sessionId).push(documentId);

            // Add to TF-IDF for enhanced searching
            chunkTexts.forEach((chunk, index) => {
                this.tfidf.addDocument(chunk);
                
                const chunkId = `${documentId}_${index}`;
                this.embeddings.set(chunkId, {
                    documentId,
                    chunkIndex: index,
                    text: chunk,
                    embedding: embeddings[index],
                    metadata,
                    keywords: this.extractChunkKeywords(chunk),
                    vectors: this.createWordVectors(chunk)
                });
            });

            logger.info(`Added document ${documentId} with ${chunkTexts.length} chunks to enhanced vector database`);
            return true;
        } catch (error) {
            logger.error(`Failed to add document ${documentId}:`, error);
            throw error;
        }
    }

    async createEnhancedEmbeddings(texts) {
        // Create multi-dimensional embeddings using various techniques
        return texts.map(text => this.createTextEmbedding(text));
    }

    createTextEmbedding(text) {
        const cleaned = this.preprocessText(text);
        const words = cleaned.split(/\s+/).filter(word => word.length > 2);
        
        // Create multiple embedding dimensions
        return {
            tfidf: this.createTfidfVector(text),
            wordFreq: this.createWordFrequencyVector(words),
            semantic: this.createSemanticVector(text),
            keywords: this.extractChunkKeywords(text),
            length: text.length,
            wordCount: words.length,
            avgWordLength: words.reduce((sum, word) => sum + word.length, 0) / words.length || 0
        };
    }

    preprocessText(text) {
        return text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    createTfidfVector(text) {
        const words = this.preprocessText(text).split(/\s+/);
        const stemmed = words.map(word => this.stemmer.stem(word));
        const cleaned = removeStopwords(stemmed, eng);
        
        const wordCounts = {};
        cleaned.forEach(word => {
            wordCounts[word] = (wordCounts[word] || 0) + 1;
        });
        
        return wordCounts;
    }

    createWordFrequencyVector(words) {
        const freq = {};
        const cleaned = removeStopwords(words, eng);
        
        cleaned.forEach(word => {
            const stemmed = this.stemmer.stem(word.toLowerCase());
            freq[stemmed] = (freq[stemmed] || 0) + 1;
        });
        
        return freq;
    }

    createSemanticVector(text) {
        // Simple semantic analysis using word patterns and context
        const features = {
            hasQuestions: /\?/.test(text),
            hasNumbers: /\d+/.test(text),
            hasDefinitions: /is|are|means|refers to|defined as/.test(text.toLowerCase()),
            hasExamples: /example|such as|for instance|including/.test(text.toLowerCase()),
            hasComparisons: /compare|contrast|versus|different|similar/.test(text.toLowerCase()),
            hasProcess: /step|process|method|procedure|algorithm/.test(text.toLowerCase()),
            hasCausal: /because|since|due to|caused by|result/.test(text.toLowerCase()),
            sentiment: this.calculateSimpleSentiment(text)
        };
        
        return features;
    }

    calculateSimpleSentiment(text) {
        const positive = ['good', 'great', 'excellent', 'effective', 'successful', 'important', 'significant'];
        const negative = ['bad', 'poor', 'failed', 'problem', 'issue', 'difficult', 'challenge'];
        
        const words = text.toLowerCase().split(/\s+/);
        let score = 0;
        
        words.forEach(word => {
            if (positive.includes(word)) score += 1;
            if (negative.includes(word)) score -= 1;
        });
        
        return score;
    }

    extractChunkKeywords(text) {
        try {
            const extraction_result = keyword.extract(text, {
                language: 'english',
                remove_digits: false,
                return_changed_case: true,
                remove_duplicates: true
            });
            return extraction_result.slice(0, 10);
        } catch (error) {
            return this.fallbackKeywordExtraction(text);
        }
    }

    extractDocumentKeywords(text) {
        return this.extractChunkKeywords(text).slice(0, 20);
    }

    fallbackKeywordExtraction(text) {
        const words = this.preprocessText(text).split(/\s+/);
        const cleaned = removeStopwords(words, eng);
        const stemmed = cleaned.map(word => this.stemmer.stem(word));
        
        const wordFreq = {};
        stemmed.forEach(word => {
            if (word.length > 3) {
                wordFreq[word] = (wordFreq[word] || 0) + 1;
            }
        });
        
        return Object.entries(wordFreq)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)
            .map(([word]) => word);
    }

    createWordVectors(text) {
        const words = this.preprocessText(text).split(/\s+/);
        const vector = {};
        
        words.forEach(word => {
            if (word.length > 2) {
                const stemmed = this.stemmer.stem(word);
                vector[stemmed] = (vector[stemmed] || 0) + 1;
            }
        });
        
        return vector;
    }

    calculateDocumentStatistics(chunks) {
        const totalText = chunks.join(' ');
        const words = totalText.split(/\s+/);
        const sentences = totalText.split(/[.!?]+/).filter(s => s.trim());
        
        return {
            totalChunks: chunks.length,
            totalWords: words.length,
            totalSentences: sentences.length,
            avgWordsPerChunk: Math.round(words.length / chunks.length),
            avgSentencesPerChunk: Math.round(sentences.length / chunks.length),
            complexity: this.calculateComplexity(totalText)
        };
    }

    calculateComplexity(text) {
        const words = text.split(/\s+/);
        const avgWordLength = words.reduce((sum, word) => sum + word.length, 0) / words.length;
        const uniqueWords = new Set(words.map(w => w.toLowerCase())).size;
        const lexicalDiversity = uniqueWords / words.length;
        
        return {
            avgWordLength: Math.round(avgWordLength * 100) / 100,
            lexicalDiversity: Math.round(lexicalDiversity * 100) / 100,
            readabilityScore: Math.max(0, Math.min(100, (100 - avgWordLength * 5) + (lexicalDiversity * 30)))
        };
    }

    async semanticSearch(query, sessionId = null, limit = 10, documentIds = null) {
        try {
            const queryEmbedding = this.createTextEmbedding(query);
            const results = [];
            
            // Get documents to search
            let embeddingsToSearch = Array.from(this.embeddings.values());
            
            if (sessionId && this.sessionDocuments.has(sessionId)) {
                const sessionDocs = this.sessionDocuments.get(sessionId);
                embeddingsToSearch = embeddingsToSearch.filter(emb => 
                    sessionDocs.includes(emb.documentId)
                );
            }

            if (documentIds) {
                embeddingsToSearch = embeddingsToSearch.filter(emb => 
                    documentIds.includes(emb.documentId)
                );
            }

            // Calculate enhanced similarity scores
            embeddingsToSearch.forEach(embedding => {
                const similarity = this.calculateEnhancedSimilarity(queryEmbedding, embedding.embedding);
                
                if (similarity > 0.1) { // Threshold for relevance
                    results.push({
                        ...embedding,
                        similarity: similarity,
                        score: similarity
                    });
                }
            });

            return results
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, limit);

        } catch (error) {
            logger.error('Enhanced semantic search failed:', error);
            return this.fallbackTextSearch(query, sessionId, limit, documentIds);
        }
    }

    calculateEnhancedSimilarity(queryEmb, docEmb) {
        let totalSimilarity = 0;
        let weights = 0;
        
        // 1. TF-IDF similarity
        const tfidfSim = this.calculateTfidfSimilarity(queryEmb.tfidf, docEmb.tfidf);
        totalSimilarity += tfidfSim * 0.4;
        weights += 0.4;
        
        // 2. Word frequency similarity
        const wordFreqSim = this.calculateVectorSimilarity(queryEmb.wordFreq, docEmb.wordFreq);
        totalSimilarity += wordFreqSim * 0.3;
        weights += 0.3;
        
        // 3. Keyword overlap
        const keywordSim = this.calculateKeywordSimilarity(queryEmb.keywords, docEmb.keywords);
        totalSimilarity += keywordSim * 0.2;
        weights += 0.2;
        
        // 4. Semantic features
        const semanticSim = this.calculateSemanticSimilarity(queryEmb.semantic, docEmb.semantic);
        totalSimilarity += semanticSim * 0.1;
        weights += 0.1;
        
        return weights > 0 ? totalSimilarity / weights : 0;
    }

    calculateTfidfSimilarity(vec1, vec2) {
        const keys1 = Object.keys(vec1);
        const keys2 = Object.keys(vec2);
        const intersection = keys1.filter(key => keys2.includes(key));
        
        if (intersection.length === 0) return 0;
        
        let dotProduct = 0;
        let norm1 = 0;
        let norm2 = 0;
        
        const allKeys = [...new Set([...keys1, ...keys2])];
        
        allKeys.forEach(key => {
            const val1 = vec1[key] || 0;
            const val2 = vec2[key] || 0;
            
            dotProduct += val1 * val2;
            norm1 += val1 * val1;
            norm2 += val2 * val2;
        });
        
        if (norm1 === 0 || norm2 === 0) return 0;
        
        return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
    }

    calculateVectorSimilarity(vec1, vec2) {
        return this.calculateTfidfSimilarity(vec1, vec2); // Same calculation
    }

    calculateKeywordSimilarity(keywords1, keywords2) {
        if (!keywords1.length || !keywords2.length) return 0;
        
        const set1 = new Set(keywords1.map(k => k.toLowerCase()));
        const set2 = new Set(keywords2.map(k => k.toLowerCase()));
        
        const intersection = [...set1].filter(k => set2.has(k));
        const union = new Set([...set1, ...set2]);
        
        return intersection.length / union.size; // Jaccard similarity
    }

    calculateSemanticSimilarity(sem1, sem2) {
        let matches = 0;
        let total = 0;
        
        Object.keys(sem1).forEach(feature => {
            if (typeof sem1[feature] === 'boolean' && typeof sem2[feature] === 'boolean') {
                total += 1;
                if (sem1[feature] === sem2[feature]) matches += 1;
            }
        });
        
        // Add sentiment similarity
        if (typeof sem1.sentiment === 'number' && typeof sem2.sentiment === 'number') {
            const sentimentSim = 1 - Math.abs(sem1.sentiment - sem2.sentiment) / 10;
            return total > 0 ? ((matches / total) + sentimentSim) / 2 : sentimentSim;
        }
        
        return total > 0 ? matches / total : 0;
    }

    fallbackTextSearch(query, sessionId = null, limit = 10, documentIds = null) {
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

                // Word matches with TF-IDF weighting
                const matchingWords = queryWords.filter(word => chunkLower.includes(word));
                score += (matchingWords.length / queryWords.length) * 0.6;

                // String similarity
                const stringSim = stringSimilarity.compareTwoStrings(queryLower, chunkLower);
                score += stringSim * 0.3;

                // Boost for multiple word matches
                if (matchingWords.length > 1) {
                    score += 0.2;
                }

                if (score > 0.1) {
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
        const results = await this.semanticSearch(query, sessionId, limit * 2);
        
        // Group by document and rank cross-document relevance
        const documentGroups = {};
        results.forEach(result => {
            if (!documentGroups[result.documentId]) {
                documentGroups[result.documentId] = [];
            }
            documentGroups[result.documentId].push(result);
        });

        // Calculate enhanced document-level relevance scores
        const crossDocResults = Object.entries(documentGroups).map(([docId, chunks]) => {
            const avgSimilarity = chunks.reduce((sum, chunk) => sum + chunk.similarity, 0) / chunks.length;
            const maxSimilarity = Math.max(...chunks.map(c => c.similarity));
            const chunkCount = chunks.length;
            
            // Enhanced scoring with document statistics
            const docData = this.documents.get(docId);
            const qualityBonus = docData ? this.calculateDocumentQuality(docData) : 0;
            
            return {
                documentId: docId,
                chunks: chunks.sort((a, b) => b.similarity - a.similarity),
                avgSimilarity,
                maxSimilarity,
                chunkCount,
                qualityBonus,
                relevanceScore: (avgSimilarity * 0.4) + (maxSimilarity * 0.4) + 
                               (Math.log(chunkCount + 1) * 0.1) + (qualityBonus * 0.1)
            };
        });

        return crossDocResults.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, limit);
    }

    calculateDocumentQuality(docData) {
        const stats = docData.statistics;
        let quality = 0.5; // Base quality
        
        // Prefer documents with good structure
        if (stats.avgWordsPerChunk > 50 && stats.avgWordsPerChunk < 200) {
            quality += 0.2;
        }
        
        // Prefer documents with reasonable complexity
        if (stats.complexity.readabilityScore > 40) {
            quality += 0.2;
        }
        
        // Prefer recent documents
        const daysSinceAdded = (Date.now() - new Date(docData.addedAt)) / (1000 * 60 * 60 * 24);
        if (daysSinceAdded < 7) {
            quality += 0.1;
        }
        
        return Math.min(quality, 1.0);
    }

    async searchInDocuments(query, documentIds, sessionId, limit = 10) {
        return this.semanticSearch(query, sessionId, limit, documentIds);
    }

    async getRelevantContext(query, sessionId, maxTokens = 4000) {
        const results = await this.semanticSearch(query, sessionId, 20);
        
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
                similarity: Math.round(result.similarity * 100) / 100,
                snippet: result.text.substring(0, 150) + '...',
                keywords: result.keywords?.slice(0, 5) || []
            });
        }

        return {
            context: contextText.trim(),
            sources: sources.slice(0, 10),
            totalResults: results.length,
            confidence: this.calculateContextConfidence(results)
        };
    }

    calculateContextConfidence(results) {
        if (results.length === 0) return 0;
        
        const avgSimilarity = results.reduce((sum, r) => sum + r.similarity, 0) / results.length;
        const topSimilarity = results[0]?.similarity || 0;
        const resultsCount = Math.min(results.length / 10, 1);
        
        return Math.min((avgSimilarity * 0.5) + (topSimilarity * 0.3) + (resultsCount * 0.2), 1.0);
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
                    avgSimilarity: 0,
                    topSimilarity: 0
                };
            }
            docSimilarities[result.documentId].similarities.push(result.similarity);
        });

        // Calculate average and top similarities
        const similarDocs = Object.values(docSimilarities).map(doc => {
            doc.avgSimilarity = doc.similarities.reduce((a, b) => a + b, 0) / doc.similarities.length;
            doc.topSimilarity = Math.max(...doc.similarities);
            doc.relevanceScore = (doc.avgSimilarity * 0.6) + (doc.topSimilarity * 0.4);
            return doc;
        });

        return similarDocs
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
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

        const allKeywords = documents.flatMap(doc => doc.keywords || []);
        const uniqueKeywords = [...new Set(allKeywords)];

        return {
            documentCount: documents.length,
            chunkCount: totalChunks,
            estimatedTokens: totalTokens,
            uniqueKeywords: uniqueKeywords.slice(0, 20),
            lastUpdated: documents.length > 0 ? 
                Math.max(...documents.map(doc => new Date(doc.addedAt).getTime())) : null,
            avgDocumentQuality: documents.length > 0 ? 
                documents.reduce((sum, doc) => sum + this.calculateDocumentQuality(doc), 0) / documents.length : 0
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

    getDocumentsBySession(sessionId) {
        const sessionDocs = this.sessionDocuments.get(sessionId) || [];
        const documents = [];
        
        for (const docId of sessionDocs) {
            const docData = this.documents.get(docId);
            if (docData && docData.chunks) {
                // Convert each chunk text to a proper document object
                for (const chunkText of docData.chunks) {
                    documents.push({
                        content: chunkText,
                        text: chunkText,
                        documentId: docId,
                        metadata: docData.metadata,
                        sessionId: docData.sessionId
                    });
                }
            }
        }
        
        return documents;
    }

    async saveIndex(filePath) {
        try {
            const data = {
                documents: Array.from(this.documents.entries()),
                embeddings: Array.from(this.embeddings.entries()),
                sessionDocuments: Array.from(this.sessionDocuments.entries()),
                savedAt: new Date().toISOString()
            };
            
            const dir = path.dirname(filePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(filePath, JSON.stringify(data, null, 2));
            
            logger.info(`Enhanced vector index saved to ${filePath}`);
        } catch (error) {
            logger.error('Failed to save enhanced vector index:', error);
        }
    }

    async loadIndex(filePath) {
        try {
            const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
            
            this.documents = new Map(data.documents);
            this.embeddings = new Map(data.embeddings);
            this.sessionDocuments = new Map(data.sessionDocuments);
            
            // Rebuild TF-IDF
            this.tfidf = new natural.TfIdf();
            this.documents.forEach(doc => {
                doc.chunks.forEach(chunk => {
                    this.tfidf.addDocument(chunk);
                });
            });
            
            logger.info(`Enhanced vector index loaded from ${filePath}`);
        } catch (error) {
            logger.error('Failed to load enhanced vector index:', error);
        }
    }
}

module.exports = new EnhancedVectorDatabase();