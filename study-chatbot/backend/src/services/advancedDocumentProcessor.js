const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const tesseract = require('node-tesseract-ocr');
const sharp = require('sharp');
const pdf2pic = require('pdf2pic');
const { PDFDocument } = require('pdf-lib');
const natural = require('natural');
const compromise = require('compromise');
const franc = require('franc');
const logger = require('./logger');

class AdvancedDocumentProcessor {
    constructor() {
        this.chunkSize = parseInt(process.env.PDF_CHUNK_SIZE) || 1000;
        this.overlap = parseInt(process.env.PDF_OVERLAP) || 200;
        this.tokenizer = new natural.WordTokenizer();
        this.tempDir = path.join(__dirname, '../../temp');
        this.initTempDir();
    }

    async initTempDir() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true });
        } catch (error) {
            logger.warn('Failed to create temp directory:', error.message);
        }
    }

    async processDocument(filePath, options = {}) {
        try {
            const fileExtension = path.extname(filePath).toLowerCase();
            let extractedContent;

            logger.info(`Processing document: ${filePath} (${fileExtension})`);

            switch (fileExtension) {
                case '.pdf':
                    extractedContent = await this.processPDF(filePath, options);
                    break;
                case '.docx':
                case '.doc':
                    extractedContent = await this.processWord(filePath);
                    break;
                case '.txt':
                    extractedContent = await this.processText(filePath);
                    break;
                default:
                    throw new Error(`Unsupported file type: ${fileExtension}`);
            }

            return this.enhanceContent(extractedContent, options);
        } catch (error) {
            logger.error('Document processing failed:', error);
            throw error;
        }
    }

    async processPDF(filePath, options) {
        const buffer = await fs.readFile(filePath);
        
        try {
            const pdfData = await pdfParse(buffer);
            
            const content = {
                text: pdfData.text,
                pages: [],
                tables: [],
                images: [],
                metadata: pdfData.info || {},
                pageCount: pdfData.numpages
            };

            // Enhanced processing for images and tables if requested
            if (options.extractImages || options.extractTables) {
                try {
                    await this.processAdvancedPDFFeatures(buffer, content, options);
                } catch (advancedError) {
                    logger.warn('Advanced PDF processing failed, continuing with basic extraction:', advancedError.message);
                }
            }

            return content;
        } catch (error) {
            logger.error('PDF parsing failed:', error);
            throw new Error(`Failed to parse PDF: ${error.message}`);
        }
    }

    async processAdvancedPDFFeatures(pdfBuffer, content, options) {
        try {
            // Convert PDF pages to images for OCR
            const convert = pdf2pic.fromBuffer(pdfBuffer, {
                density: 200, // Lower density for faster processing
                saveFilename: "page",
                savePath: this.tempDir,
                format: "png",
                width: 1240,
                height: 1754
            });

            const maxPages = Math.min(content.pageCount, 10); // Limit to 10 pages for performance
            
            for (let i = 1; i <= maxPages; i++) {
                try {
                    const pageResult = await convert(i, { responseType: "buffer" });
                    
                    if (options.extractTables) {
                        const tables = await this.extractTablesFromImage(pageResult.buffer, i);
                        content.tables.push(...tables);
                    }
                    
                    if (options.extractImages) {
                        const imageAnalysis = await this.analyzeImage(pageResult.buffer, i);
                        if (imageAnalysis && !imageAnalysis.error) {
                            content.images.push(imageAnalysis);
                        }
                    }
                } catch (pageError) {
                    logger.warn(`Failed to process page ${i}:`, pageError.message);
                }
            }
        } catch (error) {
            logger.error('Advanced PDF features processing failed:', error);
            throw error;
        }
    }

    async processWord(filePath) {
        try {
            const buffer = await fs.readFile(filePath);
            const result = await mammoth.extractRawText({ buffer });
            
            return {
                text: result.value,
                pages: [{ text: result.value, number: 1 }],
                tables: [],
                images: [],
                metadata: { format: 'docx' },
                pageCount: 1
            };
        } catch (error) {
            throw new Error(`Failed to process Word document: ${error.message}`);
        }
    }

    async processText(filePath) {
        try {
            const text = await fs.readFile(filePath, 'utf8');
            
            return {
                text,
                pages: [{ text, number: 1 }],
                tables: [],
                images: [],
                metadata: { format: 'txt' },
                pageCount: 1
            };
        } catch (error) {
            throw new Error(`Failed to process text file: ${error.message}`);
        }
    }

    async extractTablesFromImage(imageBuffer, pageNumber) {
        try {
            // Use OCR to extract text with table-optimized settings
            const ocrResult = await tesseract.recognize(imageBuffer, {
                lang: "eng",
                oem: 1,
                psm: 6, // Assume uniform block of text
            });

            const tables = this.detectTableStructures(ocrResult, pageNumber);
            return tables;
        } catch (error) {
            logger.warn(`Table extraction failed for page ${pageNumber}:`, error.message);
            return [];
        }
    }

    detectTableStructures(text, pageNumber) {
        const lines = text.split('\n').filter(line => line.trim());
        const tables = [];
        let currentTable = [];
        let inTable = false;
        const minColumns = 2;
        const minRows = 2;

        for (const line of lines) {
            // Split by multiple spaces or tabs to detect columns
            const cells = line.split(/\s{3,}|\t+/).filter(cell => cell.trim());
            
            if (cells.length >= minColumns) {
                if (!inTable) {
                    inTable = true;
                    currentTable = [];
                }
                currentTable.push(cells);
            } else {
                if (inTable && currentTable.length >= minRows) {
                    tables.push({
                        type: 'table',
                        page: pageNumber,
                        rows: currentTable.length,
                        cols: Math.max(...currentTable.map(row => row.length)),
                        data: currentTable,
                        text: currentTable.map(row => row.join(' | ')).join('\n'),
                        confidence: this.calculateTableConfidence(currentTable)
                    });
                }
                inTable = false;
                currentTable = [];
            }
        }

        // Handle table at end of text
        if (inTable && currentTable.length >= minRows) {
            tables.push({
                type: 'table',
                page: pageNumber,
                rows: currentTable.length,
                cols: Math.max(...currentTable.map(row => row.length)),
                data: currentTable,
                text: currentTable.map(row => row.join(' | ')).join('\n'),
                confidence: this.calculateTableConfidence(currentTable)
            });
        }

        return tables.filter(table => table.confidence > 0.6); // Only return high-confidence tables
    }

    calculateTableConfidence(tableData) {
        let score = 0;
        
        // Check for consistent column count
        const columnCounts = tableData.map(row => row.length);
        const avgCols = columnCounts.reduce((a, b) => a + b, 0) / columnCounts.length;
        const colConsistency = columnCounts.filter(count => Math.abs(count - avgCols) <= 1).length / columnCounts.length;
        score += colConsistency * 0.4;
        
        // Check for numeric data (common in tables)
        const numericCells = tableData.flat().filter(cell => /\d/.test(cell)).length;
        const totalCells = tableData.flat().length;
        score += (numericCells / totalCells) * 0.3;
        
        // Check for table headers (first row different from others)
        if (tableData.length > 1) {
            const firstRowStyle = tableData[0].every(cell => /^[A-Z]/.test(cell.trim()));
            if (firstRowStyle) score += 0.3;
        }
        
        return Math.min(score, 1.0);
    }

    async analyzeImage(imageBuffer, pageNumber) {
        try {
            // Get image metadata
            const metadata = await sharp(imageBuffer).metadata();
            
            // Skip very small images (likely not content)
            if (metadata.width < 100 || metadata.height < 100) {
                return null;
            }
            
            // Extract text from image using OCR (with timeout)
            const ocrPromise = tesseract.recognize(imageBuffer, {
                lang: "eng",
                oem: 1,
                psm: 3
            });
            
            const timeout = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('OCR timeout')), 10000)
            );
            
            let ocrText = '';
            try {
                ocrText = await Promise.race([ocrPromise, timeout]);
            } catch (ocrError) {
                logger.warn(`OCR failed for page ${pageNumber}:`, ocrError.message);
                ocrText = '';
            }

            const analysis = {
                page: pageNumber,
                dimensions: { width: metadata.width, height: metadata.height },
                format: metadata.format,
                hasText: ocrText.trim().length > 10,
                extractedText: ocrText.substring(0, 500), // Limit text length
                contentType: this.classifyImageContent(ocrText),
                confidence: this.calculateImageConfidence(ocrText, metadata)
            };

            return analysis;
        } catch (error) {
            logger.warn(`Image analysis failed for page ${pageNumber}:`, error.message);
            return { page: pageNumber, error: error.message };
        }
    }

    classifyImageContent(text) {
        const lowerText = text.toLowerCase();
        
        if (lowerText.includes('figure') || lowerText.includes('chart') || lowerText.includes('graph')) {
            return 'chart';
        } else if (lowerText.includes('table') || /\d+[\s]*\|[\s]*\d+/.test(text)) {
            return 'table';
        } else if (lowerText.includes('equation') || /[=+\-*/^()x∑∫]/.test(text)) {
            return 'equation';
        } else if (text.trim().length > 50) {
            return 'text_image';
        } else if (/\d{2,}/.test(text)) {
            return 'data_visualization';
        } else {
            return 'diagram';
        }
    }

    calculateImageConfidence(text, metadata) {
        let confidence = 0.5; // Base confidence
        
        // More text generally means higher confidence in extraction
        if (text.length > 100) confidence += 0.3;
        else if (text.length > 50) confidence += 0.2;
        else if (text.length > 20) confidence += 0.1;
        
        // Larger images generally have better OCR results
        const area = metadata.width * metadata.height;
        if (area > 500000) confidence += 0.2;
        else if (area > 200000) confidence += 0.1;
        
        return Math.min(confidence, 1.0);
    }

    enhanceContent(content, options) {
        try {
            // Enhance text with NLP analysis
            const doc = compromise(content.text);
            
            const enhanced = {
                ...content,
                structure: this.analyzeDocumentStructure(content.text),
                entities: this.extractEntities(doc),
                topics: this.extractTopics(doc),
                chunks: this.createIntelligentChunks(content.text),
                language: this.detectLanguage(content.text),
                readabilityScore: this.calculateReadabilityScore(content.text),
                keyPhrases: this.extractKeyPhrases(doc),
                statistics: this.calculateTextStatistics(content.text),
                processedAt: new Date().toISOString()
            };

            return enhanced;
        } catch (error) {
            logger.error('Content enhancement failed:', error);
            // Return basic content if enhancement fails
            return {
                ...content,
                chunks: this.createBasicChunks(content.text),
                language: 'unknown',
                processedAt: new Date().toISOString()
            };
        }
    }

    analyzeDocumentStructure(text) {
        const lines = text.split('\n').filter(line => line.trim());
        const structure = {
            headings: [],
            sections: [],
            paragraphs: lines.length,
            estimatedReadingTime: Math.ceil(this.tokenizer.tokenize(text).length / 250) // 250 WPM average
        };

        // Detect headings and sections
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            
            // Enhanced heading detection
            if (this.isHeading(trimmed)) {
                structure.headings.push({
                    text: trimmed,
                    line: index,
                    level: this.determineHeadingLevel(trimmed),
                    type: this.classifyHeading(trimmed)
                });
            }
        });

        // Create sections based on headings
        structure.sections = this.createSections(structure.headings, lines);

        return structure;
    }

    isHeading(text) {
        // Multiple heading detection patterns
        const patterns = [
            /^(chapter|section|part)\s+\d+/i,
            /^\d+\.\d*\s+/,
            /^[A-Z][^.!?]*$/,
            /^[A-Z\s]{10,}$/,
            /^\d+\s+[A-Z]/,
            /^(introduction|conclusion|summary|overview|abstract)/i
        ];
        
        return patterns.some(pattern => pattern.test(text)) && 
               text.length < 100 && 
               text.length > 3;
    }

    determineHeadingLevel(text) {
        if (/^chapter/i.test(text)) return 1;
        if (/^(part|section)/i.test(text)) return 2;
        if (/^\d+\.\s/.test(text)) return 2;
        if (/^\d+\.\d+\s/.test(text)) return 3;
        if (/^\d+\.\d+\.\d+\s/.test(text)) return 4;
        if (/^[A-Z\s]{10,}$/.test(text)) return 1;
        return 3;
    }

    classifyHeading(text) {
        const lower = text.toLowerCase();
        if (lower.includes('introduction')) return 'introduction';
        if (lower.includes('conclusion')) return 'conclusion';
        if (lower.includes('summary')) return 'summary';
        if (lower.includes('chapter')) return 'chapter';
        if (lower.includes('section')) return 'section';
        return 'heading';
    }

    createSections(headings, lines) {
        const sections = [];
        
        for (let i = 0; i < headings.length; i++) {
            const heading = headings[i];
            const nextHeading = headings[i + 1];
            
            const startLine = heading.line;
            const endLine = nextHeading ? nextHeading.line : lines.length;
            
            const sectionText = lines.slice(startLine + 1, endLine).join('\n');
            
            sections.push({
                title: heading.text,
                level: heading.level,
                type: heading.type,
                content: sectionText,
                wordCount: this.tokenizer.tokenize(sectionText).length,
                startLine,
                endLine
            });
        }
        
        return sections;
    }

    extractEntities(doc) {
        try {
            return {
                people: doc.people().out('array').slice(0, 20),
                places: doc.places().out('array').slice(0, 20),
                organizations: doc.organizations().out('array').slice(0, 20),
                dates: doc.dates().out('array').slice(0, 10)
            };
        } catch (error) {
            return { people: [], places: [], organizations: [], dates: [] };
        }
    }

    extractTopics(doc) {
        try {
            return doc.topics().out('array').slice(0, 15);
        } catch (error) {
            return [];
        }
    }

    createIntelligentChunks(text) {
        try {
            const doc = compromise(text);
            const sentences = doc.sentences().out('array');
            const chunks = [];
            let currentChunk = '';
            let currentTokens = 0;

            for (const sentence of sentences) {
                const sentenceTokens = this.tokenizer.tokenize(sentence).length;
                
                if (currentTokens + sentenceTokens > this.chunkSize && currentChunk) {
                    chunks.push(this.createChunkObject(currentChunk, currentTokens));
                    
                    // Add overlap
                    const overlapSentences = compromise(currentChunk).sentences().out('array').slice(-2);
                    currentChunk = overlapSentences.join(' ') + ' ';
                    currentTokens = this.tokenizer.tokenize(currentChunk).length;
                }
                
                currentChunk += sentence + ' ';
                currentTokens += sentenceTokens;
            }

            if (currentChunk.trim()) {
                chunks.push(this.createChunkObject(currentChunk, currentTokens));
            }

            return chunks;
        } catch (error) {
            logger.warn('Intelligent chunking failed, using basic chunking:', error.message);
            return this.createBasicChunks(text);
        }
    }

    createBasicChunks(text) {
        const chunks = [];
        const words = text.split(/\s+/);
        let currentChunk = [];
        
        for (const word of words) {
            currentChunk.push(word);
            
            if (currentChunk.length >= this.chunkSize / 4) { // Rough word count
                const chunkText = currentChunk.join(' ');
                chunks.push({
                    text: chunkText,
                    tokens: this.tokenizer.tokenize(chunkText).length,
                    words: currentChunk.length,
                    type: 'basic'
                });
                
                // Add overlap
                currentChunk = currentChunk.slice(-Math.floor(this.overlap / 4));
            }
        }
        
        if (currentChunk.length > 0) {
            const chunkText = currentChunk.join(' ');
            chunks.push({
                text: chunkText,
                tokens: this.tokenizer.tokenize(chunkText).length,
                words: currentChunk.length,
                type: 'basic'
            });
        }
        
        return chunks;
    }

    createChunkObject(text, tokens) {
        const trimmed = text.trim();
        return {
            text: trimmed,
            tokens: tokens || this.tokenizer.tokenize(trimmed).length,
            sentences: trimmed.split(/[.!?]+/).length - 1,
            words: this.tokenizer.tokenize(trimmed).length,
            type: 'intelligent'
        };
    }

    detectLanguage(text) {
        try {
            const detected = franc(text);
            return detected === 'und' ? 'en' : detected; // Default to English if undetermined
        } catch (error) {
            return 'en';
        }
    }

    calculateReadabilityScore(text) {
        try {
            const sentences = text.split(/[.!?]+/).filter(s => s.trim()).length;
            const words = this.tokenizer.tokenize(text).length;
            
            if (sentences === 0 || words === 0) return 50; // Default score
            
            // Rough syllable estimation
            const syllables = words * 1.5;
            
            // Flesch Reading Ease Score
            const score = 206.835 - (1.015 * (words / sentences)) - (84.6 * (syllables / words));
            return Math.max(0, Math.min(100, score));
        } catch (error) {
            return 50; // Default readable score
        }
    }

    extractKeyPhrases(doc) {
        try {
            const nouns = doc.nouns().out('array');
            const adjectives = doc.adjectives().out('array');
            const verbs = doc.verbs().out('array');
            
            // Combine and filter phrases
            const allPhrases = [...nouns, ...adjectives, ...verbs];
            return [...new Set(allPhrases)]
                .filter(phrase => phrase.length > 3 && phrase.length < 30)
                .slice(0, 25);
        } catch (error) {
            return [];
        }
    }

    calculateTextStatistics(text) {
        const words = this.tokenizer.tokenize(text);
        const sentences = text.split(/[.!?]+/).filter(s => s.trim());
        const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
        
        return {
            characters: text.length,
            words: words.length,
            sentences: sentences.length,
            paragraphs: paragraphs.length,
            averageWordsPerSentence: sentences.length > 0 ? Math.round(words.length / sentences.length) : 0,
            averageSentencesPerParagraph: paragraphs.length > 0 ? Math.round(sentences.length / paragraphs.length) : 0
        };
    }

    // Cleanup method to remove temporary files
    async cleanup() {
        try {
            const files = await fs.readdir(this.tempDir);
            for (const file of files) {
                if (file.startsWith('page') && file.endsWith('.png')) {
                    await fs.unlink(path.join(this.tempDir, file));
                }
            }
        } catch (error) {
            logger.warn('Cleanup failed:', error.message);
        }
    }
}

module.exports = new AdvancedDocumentProcessor();