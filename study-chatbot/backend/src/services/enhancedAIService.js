const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const vectorDB = require('./enhancedVectorDB_simplified');
const sentiment = require('sentiment');
const logger = require('./logger');

class EnhancedAIService {
    constructor() {
        this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.geminiModel = this.gemini.getGenerativeModel({ 
            model: process.env.GEMINI_MODEL || 'gemini-pro' 
        });
        this.contextWindow = parseInt(process.env.MAX_CONTEXT_LENGTH) || 4000;
        this.sentimentAnalyzer = new sentiment();
    }

    async contextualQA(question, sessionId, options = {}) {
        try {
            logger.info(`Processing contextual Q&A for session ${sessionId}: ${question.substring(0, 100)}...`);
            
            // Debug: Check what sessions have documents
            logger.info(`Available sessions with documents: ${JSON.stringify(Array.from(vectorDB.sessionDocuments.keys()))}`);
            if (sessionId && vectorDB.sessionDocuments.has(sessionId)) {
                const sessionDocs = vectorDB.sessionDocuments.get(sessionId);
                logger.info(`Session ${sessionId} has documents: ${sessionDocs.length} docs`);
            } else {
                logger.info(`Session ${sessionId} has no documents or doesn't exist`);
            }

            // Step 1: Enhanced semantic search for relevant context
            let searchResults = await vectorDB.semanticSearch(question, sessionId, 15);
            logger.info(`Semantic search returned ${searchResults.length} results for session ${sessionId}`);
            
            if (searchResults.length === 0) {
                // Try searching across all sessions if session-specific search failed
                logger.info(`No results for session ${sessionId}, trying global search across all sessions`);
                const globalResults = await vectorDB.semanticSearch(question, null, 15);
                logger.info(`Global search found ${globalResults.length} results`);
                
                if (globalResults.length === 0) {
                    // Check if there are ANY documents at all
                    const allDocs = vectorDB.getAllDocuments();
                    logger.info(`Total documents in system: ${allDocs.length}`);
                    
                    return {
                        answer: "I don't have enough information in the uploaded documents to answer this question. Please upload relevant documents first.",
                        confidence: 0,
                        sources: [],
                        suggestions: this.generateSearchSuggestions(question)
                    };
                } else {
                    // Use global results 
                    logger.info(`Using ${globalResults.length} results from global search`);
                    searchResults = globalResults;
                }
            }

            // Step 2: Re-rank and select best context using multiple factors
            const rankedContext = await this.rerankContext(question, searchResults);
            const contextText = this.buildContextWindow(rankedContext, options);
            
            // Step 3: Generate answer with enhanced prompting
            const enhancedPrompt = this.createEnhancedPrompt(question, contextText, options);
            const response = await this.geminiModel.generateContent(enhancedPrompt);
            
            // Step 4: Post-process and add citations
            const answer = response.response.text();
            const citations = this.generateCitations(rankedContext, answer);
            const confidence = this.calculateConfidence(searchResults, answer, question);
            
            return {
                answer,
                confidence,
                sources: citations,
                relatedTopics: await this.extractRelatedTopics(contextText, question),
                context: rankedContext.slice(0, 3).map(ctx => ({
                    text: ctx.text.substring(0, 200) + '...',
                    document: ctx.metadata?.filename || 'Unknown',
                    similarity: Math.round(ctx.similarity * 100) / 100,
                    relevance: ctx.rerankScore ? Math.round(ctx.rerankScore * 100) / 100 : null
                })),
                searchResults: searchResults.length,
                processingTime: Date.now()
            };
        } catch (error) {
            logger.error('Contextual QA failed:', error);
            throw new Error(`Failed to process question: ${error.message}`);
        }
    }

    async rerankContext(question, searchResults) {
        const questionWords = question.toLowerCase().split(/\s+/).filter(word => word.length > 2);
        const questionSentiment = this.sentimentAnalyzer.analyze(question);
        
        return searchResults.map(result => {
            let score = result.similarity || result.score || 0;
            
            // Factor 1: Keyword matching boost
            const textWords = result.text.toLowerCase();
            const exactMatches = questionWords.filter(word => textWords.includes(word)).length;
            const keywordBoost = (exactMatches / questionWords.length) * 0.25;
            score += keywordBoost;
            
            // Factor 2: Text length and quality
            const lengthFactor = Math.min(result.text.length / 1000, 0.15);
            score += lengthFactor;
            
            // Factor 3: Question type analysis
            const questionType = this.analyzeQuestionType(question);
            const contentMatch = this.assessContentMatch(result.text, questionType);
            score += contentMatch * 0.2;
            
            // Factor 4: Sentence completeness
            const completeness = this.assessSentenceCompleteness(result.text);
            score += completeness * 0.1;
            
            // Factor 5: Recency (if available)
            if (result.metadata?.addedAt) {
                const recencyBoost = this.calculateRecencyBoost(result.metadata.addedAt);
                score += recencyBoost;
            }
            
            return { 
                ...result, 
                rerankScore: Math.min(score, 1.0),
                factors: {
                    originalSimilarity: result.similarity || result.score,
                    keywordBoost,
                    lengthFactor,
                    contentMatch,
                    completeness
                }
            };
        }).sort((a, b) => b.rerankScore - a.rerankScore);
    }

    analyzeQuestionType(question) {
        const lower = question.toLowerCase();
        
        if (lower.startsWith('what')) return 'definition';
        if (lower.startsWith('how')) return 'process';
        if (lower.startsWith('why')) return 'reasoning';
        if (lower.startsWith('when')) return 'temporal';
        if (lower.startsWith('where')) return 'location';
        if (lower.startsWith('who')) return 'person';
        if (lower.includes('explain') || lower.includes('describe')) return 'explanation';
        if (lower.includes('compare') || lower.includes('difference')) return 'comparison';
        if (lower.includes('example') || lower.includes('instance')) return 'example';
        if (lower.includes('list') || lower.includes('enumerate')) return 'list';
        
        return 'general';
    }

    assessContentMatch(text, questionType) {
        const lower = text.toLowerCase();
        
        switch (questionType) {
            case 'definition':
                return lower.includes('is') || lower.includes('refers to') || lower.includes('means') ? 0.3 : 0;
            case 'process':
                return lower.includes('step') || lower.includes('process') || lower.includes('method') ? 0.3 : 0;
            case 'reasoning':
                return lower.includes('because') || lower.includes('due to') || lower.includes('reason') ? 0.3 : 0;
            case 'comparison':
                return lower.includes('difference') || lower.includes('similar') || lower.includes('compare') ? 0.3 : 0;
            case 'example':
                return lower.includes('example') || lower.includes('instance') || lower.includes('such as') ? 0.3 : 0;
            case 'list':
                return /\d+\.|\*|-|•/.test(text) ? 0.3 : 0;
            default:
                return 0.1;
        }
    }

    assessSentenceCompleteness(text) {
        const sentences = text.split(/[.!?]+/).filter(s => s.trim());
        const completeSentences = sentences.filter(s => s.trim().length > 10).length;
        return Math.min(completeSentences / sentences.length, 1.0) * 0.2;
    }

    calculateRecencyBoost(addedAt) {
        try {
            const daysSinceAdded = (Date.now() - new Date(addedAt)) / (1000 * 60 * 60 * 24);
            return Math.max(0, (30 - daysSinceAdded) / 30) * 0.05; // Boost for newer content
        } catch {
            return 0;
        }
    }

    buildContextWindow(rankedContext, options) {
        let contextText = '';
        let tokenCount = 0;
        const maxTokens = Math.floor(this.contextWindow * 0.7); // Reserve space for question and response
        const includeMetadata = options.includeMetadata !== false;
        
        for (const ctx of rankedContext) {
            const ctxTokens = this.estimateTokens(ctx.text);
            if (tokenCount + ctxTokens > maxTokens) break;
            
            if (includeMetadata) {
                const docName = ctx.metadata?.filename || 'Document';
                const confidence = ctx.rerankScore ? ` (relevance: ${Math.round(ctx.rerankScore * 100)}%)` : '';
                contextText += `\n--- Source: ${docName}${confidence} ---\n`;
            }
            
            contextText += ctx.text + '\n\n';
            tokenCount += ctxTokens;
        }
        
        return contextText.trim();
    }

    createEnhancedPrompt(question, context, options) {
        const answerDepth = options.depth || options.answerDepth || 'medium';
        const includeExamples = options.includeExamples || false;
        const focusArea = options.focusArea;
        const audienceLevel = options.audienceLevel || 'general';
        
        let depthInstructions = this.getDepthInstructions(answerDepth);
        let audienceInstructions = this.getAudienceInstructions(audienceLevel);
        let focusInstructions = focusArea ? `Pay special attention to aspects related to: ${focusArea}.` : '';
        
        const promptTemplate = `You are an advanced AI study assistant with expertise in analyzing academic and educational documents. Your role is to provide accurate, helpful answers based strictly on the provided context from uploaded documents.

CONTEXT FROM UPLOADED DOCUMENTS:
${context}

QUESTION: ${question}

INSTRUCTIONS:
${depthInstructions}
${audienceInstructions}
${focusInstructions}
- Base your answer STRICTLY on the provided context above
- If the context doesn't contain enough information, clearly state what's missing
- Cite specific parts of the documents when making claims
- Use clear, educational language appropriate for learning
${includeExamples ? '- Include relevant examples from the documents when applicable' : ''}
- If you find contradictions between sources, acknowledge them
- Highlight key concepts that are important for understanding the topic
- Structure your answer logically with clear explanations
- If the question cannot be fully answered from the context, explain what additional information would be needed

ANSWER:`;

        return promptTemplate;
    }

    getDepthInstructions(depth) {
        switch (depth) {
            case 'short':
                return 'Provide a concise, direct answer in 1-2 sentences focusing on the most essential information.';
            case 'detailed':
                return 'Provide a comprehensive, detailed explanation with thorough analysis, examples, and implications. Explore the topic in depth.';
            case 'comprehensive':
                return 'Provide an exhaustive analysis covering all aspects found in the documents, with detailed explanations, multiple examples, and connections to related concepts.';
            default:
                return 'Provide a clear, informative answer with key details and explanations that aid understanding.';
        }
    }

    getAudienceInstructions(level) {
        switch (level) {
            case 'beginner':
                return 'Use simple language and explain technical terms. Assume the reader is new to this topic.';
            case 'intermediate':
                return 'Use appropriate technical terminology but explain complex concepts clearly.';
            case 'advanced':
                return 'Use technical language appropriate for someone with background knowledge in the field.';
            case 'expert':
                return 'Use advanced terminology and assume deep familiarity with the subject matter.';
            default:
                return 'Use clear, accessible language that can be understood by most readers.';
        }
    }

    generateCitations(contexts, answer) {
        const citations = [];
        const answerLower = answer.toLowerCase();
        
        contexts.forEach((ctx, index) => {
            // Look for text overlap between context and answer
            const contextSentences = ctx.text.match(/[^.!?]*[.!?]/g) || [];
            
            contextSentences.forEach(sentence => {
                const sentenceWords = sentence.toLowerCase().split(/\s+/).filter(word => word.length > 3);
                const matchingWords = sentenceWords.filter(word => answerLower.includes(word));
                
                // If significant overlap found, create citation
                if (matchingWords.length >= 3 || (matchingWords.length >= 2 && sentence.length < 100)) {
                    citations.push({
                        id: `cite_${citations.length + 1}`,
                        document: ctx.metadata?.filename || 'Unknown Document',
                        text: sentence.trim(),
                        page: ctx.metadata?.page || 'Unknown',
                        similarity: ctx.similarity || ctx.score || 0,
                        relevance: ctx.rerankScore || 0,
                        matchScore: matchingWords.length / sentenceWords.length
                    });
                }
            });
        });
        
        // Remove duplicates and sort by relevance
        const uniqueCitations = [...new Map(citations.map(c => [c.text, c])).values()]
            .sort((a, b) => (b.relevance + b.matchScore) - (a.relevance + a.matchScore))
            .slice(0, 5);
            
        return uniqueCitations;
    }

    async extractRelatedTopics(context, question) {
        try {
            const prompt = `Based on this context and the question asked, identify 5-7 related topics or concepts that a student should explore to deepen their understanding:

QUESTION: ${question}

CONTEXT:
${context.substring(0, 1500)}

Provide related topics as a simple list, one per line, focusing on concepts that would help someone learn more about this subject area.`;

            const response = await this.geminiModel.generateContent(prompt);
            const topics = response.response.text()
                .split('\n')
                .map(line => line.replace(/^[-*•\d.)\s]+/, '').trim())
                .filter(line => line && line.length > 3 && line.length < 100)
                .slice(0, 7);
                
            return topics;
        } catch (error) {
            logger.warn('Related topics extraction failed:', error.message);
            return this.extractTopicsFromKeywords(context, question);
        }
    }

    extractTopicsFromKeywords(context, question) {
        // Fallback method using simple keyword extraction
        const words = (context + ' ' + question).toLowerCase()
            .split(/\s+/)
            .filter(word => word.length > 4)
            .filter(word => !/^(this|that|with|from|they|have|been|were|will|would|could|should)$/.test(word));
            
        const wordFreq = {};
        words.forEach(word => {
            wordFreq[word] = (wordFreq[word] || 0) + 1;
        });
        
        return Object.entries(wordFreq)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));
    }

    calculateConfidence(searchResults, answer, question) {
        if (searchResults.length === 0) return 0;
        
        let confidence = 0;
        
        // Factor 1: Average similarity of search results
        const avgSimilarity = searchResults.reduce((sum, r) => sum + (r.similarity || r.score || 0), 0) / searchResults.length;
        confidence += avgSimilarity * 0.4;
        
        // Factor 2: Answer specificity
        const answerLength = answer.length;
        const specificityBonus = Math.min(answerLength / 300, 0.2);
        confidence += specificityBonus;
        
        // Factor 3: Presence of specific information
        const hasSpecificInfo = /\d+|%|\$|specific|exactly|according to|research shows|studies indicate/i.test(answer);
        confidence += hasSpecificInfo ? 0.2 : 0;
        
        // Factor 4: Answer completeness (doesn't start with "I don't" or similar)
        const isComplete = !/^(i don't|i cannot|sorry|unfortunately|there is not enough)/i.test(answer);
        confidence += isComplete ? 0.1 : -0.3;
        
        // Factor 5: Number of sources
        const sourceBonus = Math.min(searchResults.length / 10, 0.1);
        confidence += sourceBonus;
        
        return Math.max(0, Math.min(confidence, 1.0));
    }

    async crossDocumentAnalysis(query, sessionId, options = {}) {
        try {
            const crossResults = await vectorDB.crossDocumentSearch(query, sessionId, 30);
            
            if (crossResults.length < 2) {
                return {
                    analysis: "Not enough documents found to perform meaningful cross-document analysis. Please upload at least 2 documents on related topics.",
                    comparisons: [],
                    synthesis: "",
                    documentCount: crossResults.length
                };
            }

            const prompt = this.createCrossDocumentPrompt(query, crossResults, options);
            const response = await this.geminiModel.generateContent(prompt);
            
            return {
                analysis: response.response.text(),
                documents: crossResults.slice(0, 5).map(doc => ({
                    id: doc.documentId,
                    relevance: Math.round(doc.relevanceScore * 100) / 100,
                    keyChunks: doc.chunks.slice(0, 3).map(chunk => ({
                        text: chunk.text.substring(0, 200) + '...',
                        similarity: Math.round(chunk.similarity * 100) / 100
                    })),
                    metadata: doc.chunks[0]?.metadata
                })),
                query,
                totalDocuments: crossResults.length,
                processingTime: Date.now()
            };
        } catch (error) {
            logger.error('Cross-document analysis failed:', error);
            throw new Error(`Cross-document analysis failed: ${error.message}`);
        }
    }

    createCrossDocumentPrompt(query, crossResults, options) {
        const analysisType = options.analysisType || 'comprehensive';
        const maxDocs = Math.min(crossResults.length, 5);
        
        let documentsText = '';
        for (let i = 0; i < maxDocs; i++) {
            const doc = crossResults[i];
            const topChunks = doc.chunks.slice(0, 2);
            documentsText += `\n--- DOCUMENT ${i + 1}: ${doc.chunks[0]?.metadata?.filename || 'Unknown'} ---\n`;
            documentsText += topChunks.map(chunk => chunk.text).join('\n\n');
            documentsText += '\n';
        }

        return `Analyze and compare information across these ${maxDocs} different documents regarding: "${query}"

${documentsText}

Please provide a ${analysisType} analysis that includes:

1. **Key Similarities**: What common themes, concepts, or information appear across the documents?

2. **Important Differences**: What contradictions, different perspectives, or unique information does each document provide?

3. **Synthesis**: How can the information from all documents be combined to provide a comprehensive understanding of the topic?

4. **Source Evaluation**: Which documents provide the most detailed, reliable, or comprehensive coverage of the topic?

5. **Gaps and Limitations**: What important aspects of the topic are missing or inadequately covered across all documents?

Structure your response clearly with these sections, and cite specific documents when making comparisons.`;
    }

    async smartSummarization(documentIds, summaryType = 'overview', options = {}) {
        try {
            if (!Array.isArray(documentIds)) {
                documentIds = [documentIds];
            }

            const documents = documentIds.map(id => vectorDB.getDocumentStructure(id)).filter(Boolean);
            
            if (documents.length === 0) {
                throw new Error('No valid documents found for summarization');
            }

            // Use IBM Granite for summarization as specified
            const summary = await this.callIBMGranite(documents, summaryType, options);
            return summary;
        } catch (error) {
            logger.error('Smart summarization failed:', error);
            throw new Error(`Summarization failed: ${error.message}`);
        }
    }

    async callIBMGranite(documents, summaryType, options) {
        try {
            const combinedContent = this.prepareSummaryContent(documents, summaryType, options);
            const prompt = this.createSummaryPrompt(combinedContent, summaryType, options);
            
            const requestBody = {
                input: prompt,
                parameters: {
                    max_new_tokens: this.getSummaryLength(options.maxLength || 'medium'),
                    temperature: 0.3,
                    top_p: 0.9,
                    repetition_penalty: 1.1
                }
            };

            const response = await axios.post(process.env.IBM_GRANITE_URL, requestBody, {
                headers: {
                    'Authorization': `Bearer ${process.env.IBM_GRANITE_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 30000
            });

            const generatedText = response.data.generated_text || 
                                response.data.results?.[0]?.generated_text ||
                                response.data.choices?.[0]?.text;

            if (!generatedText) {
                throw new Error('No generated text received from IBM Granite API');
            }

            return {
                summary: generatedText.trim(),
                type: summaryType,
                documentIds: documents.map(doc => doc.id),
                metadata: {
                    documentsCount: documents.length,
                    totalTokens: this.estimateTokens(combinedContent),
                    summaryTokens: this.estimateTokens(generatedText),
                    compressionRatio: Math.round((this.estimateTokens(generatedText) / this.estimateTokens(combinedContent)) * 100) / 100,
                    generatedBy: 'IBM Granite',
                    generatedAt: new Date().toISOString()
                }
            };
        } catch (error) {
            logger.error('IBM Granite API call failed:', error);
            
            // Fallback to Gemini if IBM Granite fails
            logger.info('Falling back to Gemini for summarization');
            return await this.geminiSummarizationFallback(documents, summaryType, options);
        }
    }

    prepareSummaryContent(documents, summaryType, options) {
        let content = '';
        const maxTokensPerDoc = Math.floor(3000 / documents.length); // Distribute available context
        
        documents.forEach((doc, index) => {
            content += `\n--- DOCUMENT ${index + 1}: ${doc.metadata?.filename || 'Unknown'} ---\n`;
            
            let docContent = '';
            let tokenCount = 0;
            
            for (const chunk of doc.chunks) {
                const chunkText = typeof chunk === 'string' ? chunk : chunk.text;
                const chunkTokens = this.estimateTokens(chunkText);
                
                if (tokenCount + chunkTokens > maxTokensPerDoc) break;
                
                docContent += chunkText + '\n\n';
                tokenCount += chunkTokens;
            }
            
            content += docContent;
        });
        
        return content;
    }

    createSummaryPrompt(content, summaryType, options) {
        const focusArea = options.focusArea;
        const includeKeyPoints = options.includeKeyPoints !== false;
        
        let instructions = '';
        switch (summaryType) {
            case 'chapter':
                instructions = 'Create a chapter summary that captures the main concepts, key learning points, and important details that students should remember.';
                break;
            case 'overview':
                instructions = 'Provide a high-level overview that covers the main topics and gives readers a clear understanding of what the documents contain.';
                break;
            case 'detailed':
                instructions = 'Create a detailed summary that preserves important information, examples, and explanations while being more concise than the original.';
                break;
            case 'executive':
                instructions = 'Provide an executive summary focusing on key findings, conclusions, and actionable insights.';
                break;
            default:
                instructions = 'Create a balanced summary that covers the main points and important details.';
        }

        return `Please create a ${summaryType} summary of the following content:

${content}

INSTRUCTIONS:
${instructions}
${focusArea ? `Focus particularly on: ${focusArea}` : ''}
${includeKeyPoints ? 'Include key points that are essential for understanding the material.' : ''}
- Maintain accuracy and preserve important factual information
- Use clear, concise language
- Organize information logically
- Highlight the most significant concepts and findings

SUMMARY:`;
    }

    getSummaryLength(lengthOption) {
        switch (lengthOption) {
            case 'short': return 150;
            case 'medium': return 300;
            case 'long': return 500;
            case 'detailed': return 800;
            default: return 300;
        }
    }

    async geminiSummarizationFallback(documents, summaryType, options) {
        try {
            const content = this.prepareSummaryContent(documents, summaryType, options);
            const prompt = this.createSummaryPrompt(content, summaryType, options);
            
            const response = await this.geminiModel.generateContent(prompt);
            
            return {
                summary: response.response.text(),
                type: summaryType,
                documentIds: documents.map(doc => doc.id),
                metadata: {
                    documentsCount: documents.length,
                    generatedBy: 'Google Gemini (Fallback)',
                    generatedAt: new Date().toISOString(),
                    note: 'Generated using Gemini due to IBM Granite unavailability'
                }
            };
        } catch (error) {
            throw new Error(`Both IBM Granite and Gemini summarization failed: ${error.message}`);
        }
    }

    generateSearchSuggestions(question) {
        const suggestions = [
            "Try uploading relevant PDF documents or text files first",
            "Make sure your question relates to the content in your uploaded documents",
            "Use specific keywords from your documents in your questions",
            "Consider breaking complex questions into simpler parts"
        ];
        
        // Add question-specific suggestions
        if (question.length < 10) {
            suggestions.unshift("Try asking a more detailed question");
        }
        
        return suggestions.slice(0, 3);
    }

    estimateTokens(text) {
        // Rough token estimation (1 token ≈ 4 characters for English)
        return Math.ceil((text?.length || 0) / 4);
    }

    // Advanced question answering with step-by-step explanation
    async stepByStepExplanation(question, sessionId, options = {}) {
        try {
            const contextData = await vectorDB.getRelevantContext(question, sessionId, 3000);
            
            if (!contextData.context) {
                return {
                    error: "No relevant content found for step-by-step explanation",
                    suggestion: "Upload documents containing the topic you want explained"
                };
            }

            const prompt = `Provide a step-by-step explanation for this question based on the given context:

QUESTION: ${question}

CONTEXT:
${contextData.context}

Please break down the explanation into clear, numbered steps that build upon each other. Each step should:
1. Be easy to understand
2. Connect logically to the next step
3. Include relevant details from the context
4. Use examples when available

STEP-BY-STEP EXPLANATION:`;

            const response = await this.geminiModel.generateContent(prompt);
            
            return {
                explanation: response.response.text(),
                sources: contextData.sources,
                question: question,
                type: 'step-by-step'
            };
        } catch (error) {
            logger.error('Step-by-step explanation failed:', error);
            throw error;
        }
    }
}

module.exports = new EnhancedAIService();