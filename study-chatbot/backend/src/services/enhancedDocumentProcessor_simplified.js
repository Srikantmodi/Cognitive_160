const fs = require('fs').promises;
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const tesseract = require('tesseract.js');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const natural = require('natural');
const compromise = require('compromise');
const sentiment = require('sentiment');
const keyword = require('keyword-extractor');
const { removeStopwords, eng } = require('stopword');
const logger = require('./logger');

class EnhancedDocumentProcessor {
    constructor() {
        this.supportedTypes = ['.pdf', '.docx', '.txt', '.md'];
        this.sentiment = sentiment;
        this.stemmer = natural.PorterStemmer;
        this.isInitialized = true;
    }

    async initialize() {
        // No initialization needed for simplified version
        this.isInitialized = true;
        logger.info('Enhanced Document Processor (simplified) initialized successfully');
    }

    async processDocument(filePath, filename) {
        try {
            const fileExtension = this.getFileExtension(filename);
            logger.info(`Processing document: ${filename} (${fileExtension})`);

            let rawText = '';
            let metadata = {
                filename,
                fileExtension,
                processedAt: new Date().toISOString(),
                processingMethod: 'text_extraction'
            };

            // Extract text based on file type
            switch (fileExtension) {
                case '.pdf':
                    const pdfResult = await this.processPDF(filePath);
                    rawText = pdfResult.text;
                    metadata = { ...metadata, ...pdfResult.metadata };
                    break;
                case '.docx':
                    const docxResult = await this.processDocx(filePath);
                    rawText = docxResult.text;
                    metadata = { ...metadata, ...docxResult.metadata };
                    break;
                case '.txt':
                case '.md':
                    rawText = await fs.readFile(filePath, 'utf8');
                    metadata.processingMethod = 'direct_text';
                    break;
                default:
                    throw new Error(`Unsupported file type: ${fileExtension}`);
            }

            if (!rawText.trim()) {
                throw new Error('No text content extracted from document');
            }

            // Enhanced document analysis
            const analysis = await this.analyzeDocument(rawText);
            metadata = { ...metadata, ...analysis };

            // Intelligent chunking
            const chunks = await this.intelligentChunking(rawText, metadata);

            // Extract document structure
            const structure = this.extractDocumentStructure(rawText);
            metadata.structure = structure;

            return {
                text: rawText,
                chunks,
                metadata,
                wordCount: rawText.split(/\s+/).length,
                characterCount: rawText.length,
                chunkCount: chunks.length
            };

        } catch (error) {
            logger.error(`Error processing document ${filename}:`, error);
            throw error;
        }
    }

    async processPDF(filePath) {
        try {
            const buffer = await fs.readFile(filePath);
            const data = await pdf(buffer);
            
            let extractedText = data.text;
            const metadata = {
                pageCount: data.numpages,
                pdfInfo: data.info || {},
                processingMethod: 'pdf_parse'
            };

            // Enhanced PDF processing: detect if OCR is needed
            const textDensity = extractedText.length / (data.numpages || 1);
            
            if (textDensity < 100) { // Likely scanned PDF
                logger.info('Low text density detected, attempting OCR...');
                try {
                    const ocrText = await this.performOCR(buffer);
                    if (ocrText && ocrText.length > extractedText.length) {
                        extractedText = ocrText;
                        metadata.processingMethod = 'ocr_enhanced';
                        metadata.ocrConfidence = this.calculateOCRConfidence(ocrText);
                    }
                } catch (ocrError) {
                    logger.warn('OCR processing failed, using extracted text:', ocrError.message);
                }
            }

            // Table detection (simplified)
            metadata.tablesDetected = this.detectTables(extractedText);
            metadata.hasImages = this.detectImages(extractedText);

            return {
                text: extractedText,
                metadata
            };

        } catch (error) {
            logger.error('PDF processing failed:', error);
            throw error;
        }
    }

    async processDocx(filePath) {
        try {
            const buffer = await fs.readFile(filePath);
            const result = await mammoth.extractRawText({ buffer });
            
            const metadata = {
                processingMethod: 'mammoth_docx',
                hasFormatting: result.messages && result.messages.length > 0,
                messages: result.messages
            };

            return {
                text: result.value,
                metadata
            };

        } catch (error) {
            logger.error('DOCX processing failed:', error);
            throw error;
        }
    }

    async performOCR(buffer, options = {}) {
        try {
            // Convert PDF pages to images using sharp (simplified approach)
            logger.info('Starting OCR processing...');
            
            const { data: { text, confidence } } = await tesseract.recognize(buffer, 'eng', {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        logger.info(`OCR Progress: ${Math.round(m.progress * 100)}%`);
                    }
                },
                ...options
            });

            return {
                text,
                confidence: Math.round(confidence || 0),
                method: 'tesseract'
            };

        } catch (error) {
            logger.error('OCR processing failed:', error);
            return null;
        }
    }

    calculateOCRConfidence(text) {
        // Simple confidence calculation based on text quality
        const words = text.split(/\s+/);
        const validWords = words.filter(word => 
            word.length > 1 && 
            /^[a-zA-Z0-9\-'.,!?]+$/.test(word)
        );
        
        return Math.round((validWords.length / words.length) * 100);
    }

    detectTables(text) {
        // Simple table detection patterns
        const tablePatterns = [
            /\|[\s\S]*?\|/g, // Markdown tables
            /\t[\w\s]*\t/g,  // Tab-separated
            /^\s*[\w\s]+\s+[\w\s]+\s+[\w\s]+/gm, // Space-separated columns
        ];

        let tableCount = 0;
        tablePatterns.forEach(pattern => {
            const matches = text.match(pattern);
            if (matches) tableCount += matches.length;
        });

        return {
            count: tableCount,
            hasTabularData: tableCount > 0,
            confidence: tableCount > 3 ? 'high' : tableCount > 0 ? 'medium' : 'low'
        };
    }

    detectImages(text) {
        // Simple image detection in text
        const imagePatterns = [
            /\[image\]/gi,
            /\[figure\]/gi,
            /\[chart\]/gi,
            /\[diagram\]/gi,
            /see figure/gi,
            /see image/gi
        ];

        return imagePatterns.some(pattern => pattern.test(text));
    }

    async analyzeDocument(text) {
        try {
            const analysis = {
                // Basic statistics
                wordCount: text.split(/\s+/).length,
                characterCount: text.length,
                paragraphCount: text.split(/\n\s*\n/).length,
                sentenceCount: text.split(/[.!?]+/).filter(s => s.trim()).length,

                // Language and complexity analysis
                language: this.detectLanguage(text),
                readabilityScore: this.calculateReadability(text),
                complexity: this.analyzeComplexity(text),

                // Content analysis
                keywords: this.extractKeywords(text),
                entities: this.extractEntities(text),
                sentiment: this.analyzeSentiment(text),
                topics: this.extractTopics(text),

                // Document type detection
                documentType: this.classifyDocumentType(text),
                
                // Structure analysis
                hasHeadings: this.detectHeadings(text),
                hasBulletPoints: this.detectBulletPoints(text),
                hasNumberedLists: this.detectNumberedLists(text)
            };

            return analysis;

        } catch (error) {
            logger.error('Document analysis failed:', error);
            return {
                wordCount: text.split(/\s+/).length,
                characterCount: text.length,
                error: error.message
            };
        }
    }

    detectLanguage(text) {
        // Simple language detection using character patterns
        const sample = text.substring(0, 1000).toLowerCase();
        
        // English indicators
        const englishWords = ['the', 'and', 'to', 'of', 'a', 'in', 'is', 'it', 'that', 'for'];
        const englishCount = englishWords.reduce((count, word) => 
            count + (sample.split(word).length - 1), 0
        );
        
        return {
            detected: 'en', // Default to English for now
            confidence: Math.min(englishCount / 20, 1.0)
        };
    }

    calculateReadability(text) {
        const words = text.split(/\s+/).length;
        const sentences = text.split(/[.!?]+/).filter(s => s.trim()).length;
        const syllables = this.countSyllables(text);
        
        // Flesch Reading Ease Score (simplified)
        if (sentences === 0 || words === 0) return 50;
        
        const avgSentenceLength = words / sentences;
        const avgSyllablesPerWord = syllables / words;
        
        const fleschScore = 206.835 - (1.015 * avgSentenceLength) - (84.6 * avgSyllablesPerWord);
        
        return {
            fleschScore: Math.round(Math.max(0, Math.min(100, fleschScore))),
            avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
            avgSyllablesPerWord: Math.round(avgSyllablesPerWord * 100) / 100,
            difficulty: fleschScore > 80 ? 'easy' : fleschScore > 50 ? 'medium' : 'hard'
        };
    }

    countSyllables(text) {
        // Simple syllable counting
        const words = text.toLowerCase().match(/[a-z]+/g) || [];
        return words.reduce((total, word) => {
            const syllables = word.match(/[aeiouy]+/g) || [];
            return total + Math.max(1, syllables.length);
        }, 0);
    }

    analyzeComplexity(text) {
        const words = text.split(/\s+/);
        const uniqueWords = new Set(words.map(w => w.toLowerCase()));
        const longWords = words.filter(word => word.length > 6).length;
        
        return {
            lexicalDiversity: Math.round((uniqueWords.size / words.length) * 100) / 100,
            avgWordLength: Math.round((words.reduce((sum, word) => sum + word.length, 0) / words.length) * 10) / 10,
            longWordsPercentage: Math.round((longWords / words.length) * 100),
            vocabularyRichness: uniqueWords.size > words.length * 0.6 ? 'high' : 
                               uniqueWords.size > words.length * 0.4 ? 'medium' : 'low'
        };
    }

    extractKeywords(text) {
        try {
            const extracted = keyword.extract(text, {
                language: 'english',
                remove_digits: false,
                return_changed_case: true,
                remove_duplicates: true
            });
            
            return extracted.slice(0, 20);
        } catch (error) {
            return this.fallbackKeywordExtraction(text);
        }
    }

    fallbackKeywordExtraction(text) {
        const words = text.toLowerCase().match(/[a-z]+/g) || [];
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
            .slice(0, 20)
            .map(([word]) => word);
    }

    extractEntities(text) {
        try {
            const doc = compromise(text);
            
            return {
                people: doc.people().out('array').slice(0, 10),
                places: doc.places().out('array').slice(0, 10),
                organizations: doc.organizations().out('array').slice(0, 10),
                dates: doc.dates().out('array').slice(0, 10),
                numbers: doc.values().out('array').slice(0, 10)
            };
        } catch (error) {
            logger.warn('Entity extraction failed:', error);
            return { people: [], places: [], organizations: [], dates: [], numbers: [] };
        }
    }

    analyzeSentiment(text) {
        try {
            const result = this.sentiment(text);
            
            return {
                score: result.score,
                comparative: Math.round(result.comparative * 1000) / 1000,
                positive: result.positive,
                negative: result.negative,
                classification: result.score > 2 ? 'positive' : 
                               result.score < -2 ? 'negative' : 'neutral'
            };
        } catch (error) {
            logger.warn('Sentiment analysis failed:', error);
            return { score: 0, comparative: 0, classification: 'neutral' };
        }
    }

    extractTopics(text) {
        try {
            const doc = compromise(text);
            const nouns = doc.nouns().out('array');
            const adjectives = doc.adjectives().out('array');
            
            // Combine nouns and adjectives for topic modeling
            const terms = [...nouns, ...adjectives]
                .filter(term => term.length > 3)
                .map(term => term.toLowerCase());
            
            const termFreq = {};
            terms.forEach(term => {
                termFreq[term] = (termFreq[term] || 0) + 1;
            });
            
            return Object.entries(termFreq)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 10)
                .map(([term, freq]) => ({ term, frequency: freq }));
                
        } catch (error) {
            logger.warn('Topic extraction failed:', error);
            return [];
        }
    }

    classifyDocumentType(text) {
        const indicators = {
            academic: ['abstract', 'methodology', 'conclusion', 'references', 'hypothesis'],
            technical: ['algorithm', 'implementation', 'system', 'framework', 'architecture'],
            legal: ['whereas', 'hereby', 'pursuant', 'agreement', 'contract'],
            medical: ['patient', 'diagnosis', 'treatment', 'medical', 'clinical'],
            business: ['strategy', 'revenue', 'market', 'analysis', 'performance']
        };
        
        const textLower = text.toLowerCase();
        const scores = {};
        
        Object.entries(indicators).forEach(([type, terms]) => {
            scores[type] = terms.reduce((score, term) => 
                score + (textLower.split(term).length - 1), 0
            );
        });
        
        const maxType = Object.entries(scores).reduce((max, [type, score]) => 
            score > max.score ? { type, score } : max, { type: 'general', score: 0 }
        );
        
        return {
            primary: maxType.type,
            confidence: Math.min(maxType.score / 10, 1.0),
            scores
        };
    }

    detectHeadings(text) {
        const headingPatterns = [
            /^#{1,6}\s+.+$/gm,      // Markdown headings
            /^[A-Z][A-Z\s]+$/gm,    // ALL CAPS lines
            /^\d+\.\s+[A-Z].+$/gm,  // Numbered headings
            /^[A-Z][^.!?]*$/gm      // Title case lines
        ];
        
        return headingPatterns.some(pattern => pattern.test(text));
    }

    detectBulletPoints(text) {
        const bulletPatterns = [
            /^\s*[-*+•]\s+/gm,
            /^\s*\d+\)\s+/gm
        ];
        
        return bulletPatterns.some(pattern => pattern.test(text));
    }

    detectNumberedLists(text) {
        return /^\s*\d+\.\s+/gm.test(text);
    }

    extractDocumentStructure(text) {
        const lines = text.split('\n');
        const structure = {
            sections: [],
            headings: [],
            lists: [],
            totalLines: lines.length
        };

        lines.forEach((line, index) => {
            const trimmed = line.trim();
            if (!trimmed) return;

            // Detect headings
            if (/^#{1,6}\s+/.test(trimmed) || /^[A-Z][A-Z\s]+$/.test(trimmed)) {
                structure.headings.push({
                    text: trimmed,
                    lineNumber: index + 1,
                    level: this.getHeadingLevel(trimmed)
                });
            }

            // Detect lists
            if (/^\s*[-*+•]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
                structure.lists.push({
                    text: trimmed,
                    lineNumber: index + 1,
                    type: /^\s*\d+/.test(line) ? 'ordered' : 'unordered'
                });
            }
        });

        return structure;
    }

    getHeadingLevel(text) {
        if (/^#{6}/.test(text)) return 6;
        if (/^#{5}/.test(text)) return 5;
        if (/^#{4}/.test(text)) return 4;
        if (/^#{3}/.test(text)) return 3;
        if (/^#{2}/.test(text)) return 2;
        if (/^#{1}/.test(text)) return 1;
        if (/^[A-Z][A-Z\s]+$/.test(text)) return 1;
        return 2;
    }

    async intelligentChunking(text, metadata, options = {}) {
        const {
            maxChunkSize = 1000,
            minChunkSize = 200,
            overlapSize = 100,
            respectSentences = true,
            respectParagraphs = true
        } = options;

        try {
            let chunks = [];

            if (respectParagraphs) {
                // First try paragraph-based chunking
                const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
                chunks = this.chunkByParagraphs(paragraphs, maxChunkSize, minChunkSize, overlapSize);
            } else if (respectSentences) {
                // Sentence-based chunking
                const sentences = this.splitIntoSentences(text);
                chunks = this.chunkBySentences(sentences, maxChunkSize, minChunkSize, overlapSize);
            } else {
                // Simple word-based chunking
                chunks = this.chunkByWords(text, maxChunkSize, overlapSize);
            }

            // Enhance chunks with metadata
            return chunks.map((chunk, index) => ({
                text: chunk.trim(),
                index,
                wordCount: chunk.split(/\s+/).length,
                characterCount: chunk.length,
                startPosition: text.indexOf(chunk),
                confidence: this.calculateChunkQuality(chunk, metadata)
            }));

        } catch (error) {
            logger.error('Intelligent chunking failed, falling back to simple chunking:', error);
            return this.simpleChunking(text, maxChunkSize, overlapSize);
        }
    }

    chunkByParagraphs(paragraphs, maxChunkSize, minChunkSize, overlapSize) {
        const chunks = [];
        let currentChunk = '';
        let overlap = '';

        for (const paragraph of paragraphs) {
            const paragraphLength = paragraph.length;
            
            if (currentChunk.length + paragraphLength <= maxChunkSize) {
                currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
            } else {
                if (currentChunk.length >= minChunkSize) {
                    chunks.push(overlap + currentChunk);
                    overlap = this.createOverlap(currentChunk, overlapSize);
                }
                currentChunk = paragraph;
            }
        }

        if (currentChunk.trim()) {
            chunks.push(overlap + currentChunk);
        }

        return chunks;
    }

    chunkBySentences(sentences, maxChunkSize, minChunkSize, overlapSize) {
        const chunks = [];
        let currentChunk = '';
        let overlap = '';

        for (const sentence of sentences) {
            const sentenceLength = sentence.length;
            
            if (currentChunk.length + sentenceLength <= maxChunkSize) {
                currentChunk += (currentChunk ? ' ' : '') + sentence;
            } else {
                if (currentChunk.length >= minChunkSize) {
                    chunks.push(overlap + currentChunk);
                    overlap = this.createOverlap(currentChunk, overlapSize);
                }
                currentChunk = sentence;
            }
        }

        if (currentChunk.trim()) {
            chunks.push(overlap + currentChunk);
        }

        return chunks;
    }

    chunkByWords(text, maxChunkSize, overlapSize) {
        const words = text.split(/\s+/);
        const chunks = [];
        const wordsPerChunk = Math.floor(maxChunkSize / 6); // Rough estimate: 6 chars per word
        const overlapWords = Math.floor(overlapSize / 6);

        for (let i = 0; i < words.length; i += wordsPerChunk - overlapWords) {
            const chunk = words.slice(i, i + wordsPerChunk).join(' ');
            chunks.push(chunk);
        }

        return chunks;
    }

    splitIntoSentences(text) {
        // Enhanced sentence splitting
        return text.split(/[.!?]+/)
            .map(s => s.trim())
            .filter(s => s.length > 10); // Filter out very short fragments
    }

    createOverlap(chunk, overlapSize) {
        if (chunk.length <= overlapSize) return chunk + ' ';
        
        // Try to create overlap at sentence boundary
        const sentences = this.splitIntoSentences(chunk);
        let overlap = '';
        
        for (let i = sentences.length - 1; i >= 0; i--) {
            const candidate = sentences.slice(i).join('. ') + '. ';
            if (candidate.length <= overlapSize) {
                overlap = candidate;
                break;
            }
        }
        
        return overlap || chunk.slice(-overlapSize) + ' ';
    }

    calculateChunkQuality(chunk, metadata) {
        let quality = 0.5; // Base quality
        
        // Prefer chunks with complete sentences
        if (/[.!?]$/.test(chunk.trim())) {
            quality += 0.2;
        }
        
        // Prefer chunks with good length
        const wordCount = chunk.split(/\s+/).length;
        if (wordCount >= 50 && wordCount <= 200) {
            quality += 0.1;
        }
        
        // Prefer chunks with keywords from document
        if (metadata.keywords) {
            const chunkLower = chunk.toLowerCase();
            const keywordMatches = metadata.keywords.filter(keyword => 
                chunkLower.includes(keyword.toLowerCase())
            ).length;
            quality += Math.min(keywordMatches / 10, 0.2);
        }
        
        return Math.min(quality, 1.0);
    }

    simpleChunking(text, maxChunkSize, overlapSize) {
        const chunks = [];
        const words = text.split(/\s+/);
        const wordsPerChunk = Math.floor(maxChunkSize / 6);
        const overlapWords = Math.floor(overlapSize / 6);

        for (let i = 0; i < words.length; i += wordsPerChunk - overlapWords) {
            const chunkWords = words.slice(i, i + wordsPerChunk);
            const chunk = chunkWords.join(' ');
            
            chunks.push({
                text: chunk,
                index: chunks.length,
                wordCount: chunkWords.length,
                characterCount: chunk.length,
                startPosition: i,
                confidence: 0.5
            });
        }

        return chunks;
    }

    getFileExtension(filename) {
        return filename.toLowerCase().substring(filename.lastIndexOf('.'));
    }

    getSupportedTypes() {
        return [...this.supportedTypes];
    }
}

module.exports = new EnhancedDocumentProcessor();