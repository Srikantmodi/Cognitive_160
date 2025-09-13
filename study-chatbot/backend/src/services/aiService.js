const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const logger = require('./logger');

class AIService {
  constructor() {
    // Initialize Gemini model
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.geminiModel = this.genAI.getGenerativeModel({ 
      model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: parseInt(process.env.GEMINI_MAX_TOKENS) || 8192,
      }
    });

    // IBM Granite configuration
    this.graniteConfig = {
      url: process.env.IBM_GRANITE_URL,
      apiKey: process.env.IBM_GRANITE_API_KEY,
      model: process.env.IBM_GRANITE_MODEL || "ibm/granite-3-8b-instruct"
    };

    this.initializePromptTemplates();
  }

  initializePromptTemplates() {
    // Q&A Template
    this.qaTemplate = `You are a helpful AI study assistant. Use the following context from uploaded documents to answer the question. 
      Always provide specific citations and references to the source documents.

Context:
{context}

Question: {question}

Answer Depth: {depth} (short/medium/detailed)

Instructions:
- Base your answer primarily on the provided context
- Include specific citations with document names and relevant sections
- If the context doesn't contain enough information, state this clearly
- Adjust the detail level based on the requested depth
- For detailed answers, provide step-by-step explanations when applicable

Answer:`;

    // Flashcard Template
    this.flashcardTemplate = `Create educational flashcards from the following content. Generate {count} flashcards with clear questions and comprehensive answers.

Content:
{content}

Source: {source}

Instructions:
- Create concise, focused questions
- Provide detailed answers that aid learning
- Include key concepts, definitions, and important facts
- Make questions progressively challenging
- Reference the source document for each flashcard

Generate {count} flashcards in JSON format:
[
  {
    "question": "...",
    "answer": "...",
    "difficulty": "easy|medium|hard",
    "source": "...",
    "tags": ["tag1", "tag2"]
  }
]`;

    // Quiz Template
    this.quizTemplate = `Generate a quiz with {count} questions based on the following content. Include a mix of multiple choice, true/false, and short answer questions.

Content:
{content}

Source: {source}

Instructions:
- Create questions that test comprehension and critical thinking
- Include correct answers and explanations
- Vary question difficulty levels
- Reference specific parts of the source material

Generate quiz in JSON format:
{
  "title": "Quiz Title",
  "source": "...",
  "questions": [
    {
      "type": "multiple_choice|true_false|short_answer",
      "question": "...",
      "options": ["A", "B", "C", "D"], // for multiple choice only
      "correct_answer": "...",
      "explanation": "...",
      "difficulty": "easy|medium|hard",
      "reference": "..."
    }
  ]
}`;

    // Concept Map Template
    this.conceptMapTemplate = `Create a concept map from the following content, identifying key concepts and their relationships.

Content:
{content}

Source: {source}

Instructions:
- Identify main concepts and sub-concepts
- Show relationships between concepts
- Create a hierarchical structure
- Include brief descriptions for each concept

Generate concept map in JSON format:
{
  "title": "Concept Map Title",
  "source": "...",
  "concepts": [
    {
      "id": "unique_id",
      "name": "Concept Name",
      "description": "Brief description",
      "level": 0, // hierarchy level
      "connections": ["id1", "id2"], // connected concept IDs
      "position": {"x": 0, "y": 0} // for visualization
    }
  ],
  "relationships": [
    {
      "from": "concept_id",
      "to": "concept_id",
      "type": "is-a|part-of|relates-to|causes|requires",
      "description": "relationship description"
    }
  ]
}`;

    // Step-by-step explanation template
    this.stepByStepTemplate = `Provide a detailed step-by-step explanation for the following topic or problem from the context.

Context:
{context}

Topic/Problem: {topic}

Instructions:
- Break down complex concepts into manageable steps
- Explain the reasoning behind each step
- Use examples where helpful
- Include any formulas, equations, or key principles
- Reference the source material for each step

Provide explanation in JSON format:
{
  "topic": "...",
  "steps": [
    {
      "step_number": 1,
      "title": "Step Title",
      "explanation": "Detailed explanation",
      "example": "Optional example",
      "key_points": ["point1", "point2"],
      "reference": "source reference"
    }
  ],
  "summary": "Overall summary",
  "related_concepts": ["concept1", "concept2"]
}`;
  }

  // Helper method to replace template variables
  formatTemplate(template, variables) {
    let formatted = template;
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{${key}}`;
      formatted = formatted.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
    }
    return formatted;
  }

  /**
   * Answer questions using Gemini with context
   */
  async answerQuestion(question, context, depth = 'medium', sources = []) {
    try {
      const prompt = this.formatTemplate(this.qaTemplate, {
        context: context,
        question: question,
        depth: depth
      });

      const fullPrompt = `You are an expert study assistant helping students understand their documents.\n\n${prompt}`;
      
      const result = await this.geminiModel.generateContent(fullPrompt);
      const response = await result.response;

      return {
        answer: response.text(),
        sources: sources,
        model: 'gemini',
        depth: depth,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error in answerQuestion:', error);
      throw new Error(`Failed to generate answer: ${error.message}`);
    }
  }

  /**
   * Generate summary using IBM Granite
   */
  async generateSummary(content, summaryType = 'comprehensive', source = '') {
    try {
      const prompt = this.createSummaryPrompt(content, summaryType, source);
      
      const response = await this.callIBMGranite(prompt);
      
      return {
        summary: response,
        type: summaryType,
        source: source,
        model: 'ibm-granite',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error in generateSummary:', error);
      throw new Error(`Failed to generate summary: ${error.message}`);
    }
  }

  /**
   * Create flashcards using Gemini
   */
  async generateFlashcards(content, count = 5, source = '') {
    try {
      const prompt = this.formatTemplate(this.flashcardTemplate, {
        content: content,
        count: count,
        source: source
      });

      const fullPrompt = `You are an expert at creating educational flashcards that enhance learning and retention.\n\n${prompt}`;
      
      const result = await this.geminiModel.generateContent(fullPrompt);
      const response = await result.response;
      
      // Parse JSON response
      let flashcards;
      try {
        flashcards = JSON.parse(response.text());
      } catch (parseError) {
        // Fallback if JSON parsing fails
        flashcards = [{
          question: "Sample Question",
          answer: response.text(),
          difficulty: "medium",
          source: source,
          tags: ["generated"]
        }];
      }
      
      return {
        flashcards: flashcards,
        count: flashcards.length,
        source: source,
        model: 'gemini',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error in generateFlashcards:', error);
      throw new Error(`Failed to generate flashcards: ${error.message}`);
    }
  }

  /**
   * Generate quiz using Gemini
   */
  async generateQuiz(content, count = 5, source = '') {
    try {
      const prompt = this.formatTemplate(this.quizTemplate, {
        content: content,
        count: count,
        source: source
      });

      const fullPrompt = `You are an expert at creating educational assessments and quizzes.\n\n${prompt}`;
      
      const result = await this.geminiModel.generateContent(fullPrompt);
      const response = await result.response;

      // Parse JSON response
      let quiz;
      try {
        quiz = JSON.parse(response.text());
      } catch (parseError) {
        // Fallback structure if JSON parsing fails
        quiz = {
          title: "Generated Quiz",
          source: source,
          questions: [{
            type: "short_answer",
            question: "What are the main points covered in this content?",
            correct_answer: "Based on the provided content",
            explanation: response.text(),
            difficulty: "medium"
          }]
        };
      }
      
      return {
        ...quiz,
        model: 'gemini',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error in generateQuiz:', error);
      throw new Error(`Failed to generate quiz: ${error.message}`);
    }
  }

  /**
   * Generate concept map using Gemini
   */
  async generateConceptMap(content, source = '') {
    try {
      const prompt = this.formatTemplate(this.conceptMapTemplate, {
        content: content,
        source: source
      });

      const fullPrompt = `You are an expert at creating educational concept maps and knowledge visualization.\n\n${prompt}`;
      
      const result = await this.geminiModel.generateContent(fullPrompt);
      const response = await result.response;

      // Parse JSON response
      let conceptMap;
      try {
        conceptMap = JSON.parse(response.text());
      } catch (parseError) {
        // Fallback structure if JSON parsing fails
        conceptMap = {
          title: "Generated Concept Map",
          source: source,
          concepts: [
            {
              id: "main_concept",
              name: "Main Concept",
              description: response.text().substring(0, 200),
              level: 0,
              connections: [],
              position: {x: 0, y: 0}
            }
          ],
          relationships: []
        };
      }
      
      return {
        ...conceptMap,
        model: 'gemini',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error in generateConceptMap:', error);
      throw new Error(`Failed to generate concept map: ${error.message}`);
    }
  }

  /**
   * Generate step-by-step explanation using Gemini
   */
  async generateStepByStepExplanation(context, topic) {
    try {
      const prompt = this.formatTemplate(this.stepByStepTemplate, {
        context: context,
        topic: topic
      });

      const fullPrompt = `You are an expert tutor specializing in breaking down complex topics into clear, understandable steps.\n\n${prompt}`;
      
      const result = await this.geminiModel.generateContent(fullPrompt);
      const response = await result.response;

      // Parse JSON response
      let explanation;
      try {
        explanation = JSON.parse(response.text());
      } catch (parseError) {
        // Fallback structure if JSON parsing fails
        explanation = {
          topic: topic,
          steps: [
            {
              step_number: 1,
              title: "Understanding " + topic,
              explanation: response.text(),
              key_points: ["Main concept explanation"],
              reference: "Generated explanation"
            }
          ],
          summary: response.text().substring(0, 200) + "...",
          related_concepts: []
        };
      }
      
      return {
        ...explanation,
        model: 'gemini',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error in generateStepByStepExplanation:', error);
      throw new Error(`Failed to generate step-by-step explanation: ${error.message}`);
    }
  }

  /**
   * Call IBM Granite API
   */
  async callIBMGranite(prompt, maxTokens = 2048) {
    try {
      const requestBody = {
        model_id: this.graniteConfig.model,
        input: prompt,
        parameters: {
          max_new_tokens: maxTokens,
          temperature: 0.3,
          top_p: 0.9,
          repetition_penalty: 1.1
        }
      };

      const response = await axios.post(this.graniteConfig.url, requestBody, {
        headers: {
          'Authorization': `Bearer ${this.graniteConfig.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      if (response.data && response.data.results && response.data.results[0]) {
        return response.data.results[0].generated_text.trim();
      } else {
        throw new Error('Invalid response format from IBM Granite API');
      }

    } catch (error) {
      logger.error('Error calling IBM Granite API:', error);
      throw new Error(`IBM Granite API call failed: ${error.message}`);
    }
  }

  /**
   * Create summary prompt for IBM Granite
   */
  createSummaryPrompt(content, summaryType, source) {
    const prompts = {
      brief: `Provide a brief summary (2-3 sentences) of the following content from ${source}:\n\n${content}\n\nSummary:`,
      
      comprehensive: `Create a comprehensive summary of the following content from ${source}. Include main points, key concepts, and important details:\n\n${content}\n\nComprehensive Summary:`,
      
      bullet_points: `Summarize the following content from ${source} in bullet points, highlighting the most important information:\n\n${content}\n\nBullet Point Summary:`,
      
      abstract: `Create an academic abstract-style summary of the following content from ${source}:\n\n${content}\n\nAbstract:`,
      
      chapter: `Summarize this chapter or section from ${source}, including main themes, key arguments, and conclusions:\n\n${content}\n\nChapter Summary:`
    };

    return prompts[summaryType] || prompts.comprehensive;
  }

  /**
   * Extract insights from tables and charts (using Gemini's vision capabilities)
   */
  async analyzeTableOrChart(imageData, context = '') {
    try {
      const prompt = `Analyze the following table, chart, or graph. Extract key insights, data points, and explain what the visualization shows. ${context ? `Context: ${context}` : ''}`;

      // Note: This would need to be implemented with Gemini Vision API
      // For now, return a placeholder response
      return {
        analysis: "Table/Chart analysis feature requires Gemini Vision API integration",
        insights: [],
        data_points: [],
        model: 'gemini-vision',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error in analyzeTableOrChart:', error);
      throw new Error(`Failed to analyze table/chart: ${error.message}`);
    }
  }
}

module.exports = new AIService();