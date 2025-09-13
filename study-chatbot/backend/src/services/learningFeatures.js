const aiService = require('./aiService');
const pdfProcessor = require('./simplePdfProcessor');
const logger = require('./logger');
const { v4: uuidv4 } = require('uuid');

class LearningFeaturesService {
  constructor() {
    this.flashcards = new Map(); // sessionId -> flashcards
    this.quizzes = new Map(); // sessionId -> quizzes
    this.conceptMaps = new Map(); // sessionId -> concept maps
    this.studyPlans = new Map(); // sessionId -> study plans
    this.learningProgress = new Map(); // sessionId -> progress tracking
  }

  /**
   * Generate flashcards from document content
   * @param {string} sessionId - Session identifier
   * @param {Object} options - Generation options
   * @returns {Object} - Generated flashcards
   */
  async generateFlashcards(sessionId, options = {}) {
    try {
      const {
        documentIds = null,
        topic = null,
        count = 10,
        difficulty = 'mixed',
        format = 'standard'
      } = options;

      let content = '';
      let sources = [];

      if (topic) {
        // Generate flashcards based on topic
        const contextData = await pdfProcessor.getRelevantContext(topic, sessionId, 3000);
        content = contextData.context;
        sources = contextData.sources;
      } else if (documentIds) {
        // Generate from specific documents
        const searchResults = await pdfProcessor.searchInDocuments(
          'key concepts important information definitions', 
          documentIds, 
          sessionId, 
          count * 2
        );
        content = searchResults.map(r => r.content).join('\n\n');
        sources = searchResults.map(r => r.metadata);
      } else {
        // Generate from all session documents
        const contextData = await pdfProcessor.getRelevantContext(
          'important concepts key definitions main ideas', 
          sessionId, 
          3000
        );
        content = contextData.context;
        sources = contextData.sources;
      }

      if (!content.trim()) {
        throw new Error('No content available for flashcard generation');
      }

      // Generate flashcards using AI
      const flashcardsResult = await aiService.generateFlashcards(content, count, sources[0]?.filename || 'Multiple Documents');
      
      const flashcardSet = {
        id: uuidv4(),
        sessionId,
        ...flashcardsResult,
        options,
        createdAt: new Date().toISOString(),
        studyStats: {
          timesStudied: 0,
          correctAnswers: 0,
          incorrectAnswers: 0,
          lastStudied: null
        }
      };

      // Store flashcards
      if (!this.flashcards.has(sessionId)) {
        this.flashcards.set(sessionId, []);
      }
      this.flashcards.get(sessionId).push(flashcardSet);

      logger.info(`Generated ${flashcardSet.count} flashcards for session: ${sessionId}`);
      return flashcardSet;

    } catch (error) {
      logger.error('Error generating flashcards:', error);
      throw error;
    }
  }

  /**
   * Generate quiz from document content
   * @param {string} sessionId - Session identifier
   * @param {Object} options - Quiz options
   * @returns {Object} - Generated quiz
   */
  async generateQuiz(sessionId, options = {}) {
    try {
      const {
        documentIds = null,
        topic = null,
        questionCount = 10,
        difficulty = 'mixed',
        questionTypes = ['multiple_choice', 'true_false', 'short_answer'],
        timeLimit = null
      } = options;

      let content = '';
      let sources = [];

      if (topic) {
        const contextData = await pdfProcessor.getRelevantContext(topic, sessionId, 4000);
        content = contextData.context;
        sources = contextData.sources;
      } else if (documentIds) {
        const searchResults = await pdfProcessor.searchInDocuments(
          'main concepts important facts key information', 
          documentIds, 
          sessionId, 
          questionCount * 3
        );
        content = searchResults.map(r => r.content).join('\n\n');
        sources = searchResults.map(r => r.metadata);
      } else {
        const contextData = await pdfProcessor.getRelevantContext(
          'key concepts main ideas important facts', 
          sessionId, 
          4000
        );
        content = contextData.context;
        sources = contextData.sources;
      }

      if (!content.trim()) {
        throw new Error('No content available for quiz generation');
      }

      // Generate quiz using AI
      const quizResult = await aiService.generateQuiz(content, questionCount, sources[0]?.filename || 'Multiple Documents');
      
      const quiz = {
        id: uuidv4(),
        sessionId,
        ...quizResult,
        options,
        createdAt: new Date().toISOString(),
        attempts: [],
        stats: {
          totalAttempts: 0,
          averageScore: 0,
          bestScore: 0,
          lastAttempt: null
        }
      };

      // Store quiz
      if (!this.quizzes.has(sessionId)) {
        this.quizzes.set(sessionId, []);
      }
      this.quizzes.get(sessionId).push(quiz);

      logger.info(`Generated quiz with ${questionCount} questions for session: ${sessionId}`);
      return quiz;

    } catch (error) {
      logger.error('Error generating quiz:', error);
      throw error;
    }
  }

  /**
   * Submit quiz attempt
   * @param {string} sessionId - Session identifier
   * @param {string} quizId - Quiz identifier
   * @param {Array} answers - User answers
   * @returns {Object} - Quiz results
   */
  async submitQuizAttempt(sessionId, quizId, answers) {
    try {
      const sessionQuizzes = this.quizzes.get(sessionId) || [];
      const quiz = sessionQuizzes.find(q => q.id === quizId);
      
      if (!quiz) {
        throw new Error('Quiz not found');
      }

      // Grade the quiz
      let correctAnswers = 0;
      const gradedQuestions = quiz.questions.map((question, index) => {
        const userAnswer = answers[index];
        const isCorrect = this.isAnswerCorrect(question, userAnswer);
        
        if (isCorrect) {
          correctAnswers++;
        }

        return {
          ...question,
          userAnswer,
          isCorrect,
          feedback: isCorrect ? 'Correct!' : `Incorrect. ${question.explanation}`
        };
      });

      const score = Math.round((correctAnswers / quiz.questions.length) * 100);
      
      const attempt = {
        id: uuidv4(),
        attemptNumber: quiz.stats.totalAttempts + 1,
        answers,
        gradedQuestions,
        score,
        correctAnswers,
        totalQuestions: quiz.questions.length,
        timeSpent: null, // Could be tracked by frontend
        submittedAt: new Date().toISOString()
      };

      // Update quiz stats
      quiz.attempts.push(attempt);
      quiz.stats.totalAttempts++;
      quiz.stats.averageScore = Math.round(
        quiz.attempts.reduce((sum, att) => sum + att.score, 0) / quiz.attempts.length
      );
      quiz.stats.bestScore = Math.max(quiz.stats.bestScore, score);
      quiz.stats.lastAttempt = new Date().toISOString();

      logger.info(`Quiz attempt submitted: ${quizId}, Score: ${score}%`);
      return attempt;

    } catch (error) {
      logger.error('Error submitting quiz attempt:', error);
      throw error;
    }
  }

  /**
   * Check if an answer is correct
   * @param {Object} question - Quiz question
   * @param {string} userAnswer - User's answer
   * @returns {boolean} - Whether answer is correct
   */
  isAnswerCorrect(question, userAnswer) {
    if (!userAnswer) return false;
    
    switch (question.type) {
      case 'multiple_choice':
        return userAnswer.toLowerCase() === question.correct_answer.toLowerCase();
      case 'true_false':
        return userAnswer.toLowerCase() === question.correct_answer.toLowerCase();
      case 'short_answer':
        // For short answers, we'll use a more flexible comparison
        const correctLower = question.correct_answer.toLowerCase().trim();
        const userLower = userAnswer.toLowerCase().trim();
        
        // Exact match or contains key terms
        return correctLower === userLower || 
               correctLower.includes(userLower) || 
               userLower.includes(correctLower);
      default:
        return false;
    }
  }

  /**
   * Generate concept map from document content
   * @param {string} sessionId - Session identifier
   * @param {Object} options - Concept map options
   * @returns {Object} - Generated concept map
   */
  async generateConceptMap(sessionId, options = {}) {
    try {
      const {
        documentIds = null,
        topic = null,
        maxConcepts = 20,
        depth = 'comprehensive'
      } = options;

      let content = '';
      let sources = [];

      if (topic) {
        const contextData = await pdfProcessor.getRelevantContext(topic, sessionId, 4000);
        content = contextData.context;
        sources = contextData.sources;
      } else if (documentIds) {
        const searchResults = await pdfProcessor.searchInDocuments(
          'concepts relationships main ideas key terms', 
          documentIds, 
          sessionId, 
          maxConcepts
        );
        content = searchResults.map(r => r.content).join('\n\n');
        sources = searchResults.map(r => r.metadata);
      } else {
        const contextData = await pdfProcessor.getRelevantContext(
          'key concepts relationships main ideas', 
          sessionId, 
          4000
        );
        content = contextData.context;
        sources = contextData.sources;
      }

      if (!content.trim()) {
        throw new Error('No content available for concept map generation');
      }

      // Generate concept map using AI
      const conceptMapResult = await aiService.generateConceptMap(content, sources[0]?.filename || 'Multiple Documents');
      
      const conceptMap = {
        id: uuidv4(),
        sessionId,
        ...conceptMapResult,
        options,
        createdAt: new Date().toISOString(),
        viewCount: 0,
        lastViewed: null
      };

      // Store concept map
      if (!this.conceptMaps.has(sessionId)) {
        this.conceptMaps.set(sessionId, []);
      }
      this.conceptMaps.get(sessionId).push(conceptMap);

      logger.info(`Generated concept map with ${conceptMap.concepts?.length || 0} concepts for session: ${sessionId}`);
      return conceptMap;

    } catch (error) {
      logger.error('Error generating concept map:', error);
      throw error;
    }
  }

  /**
   * Generate step-by-step explanation
   * @param {string} sessionId - Session identifier
   * @param {string} topic - Topic to explain
   * @param {Object} options - Explanation options
   * @returns {Object} - Step-by-step explanation
   */
  async generateStepByStepExplanation(sessionId, topic, options = {}) {
    try {
      const { depth = 'detailed', includeExamples = true } = options;

      // Get relevant context
      const contextData = await pdfProcessor.getRelevantContext(topic, sessionId, 3000);
      
      if (!contextData.context.trim()) {
        throw new Error('No relevant content found for this topic');
      }

      // Generate explanation using AI
      const explanation = await aiService.generateStepByStepExplanation(contextData.context, topic);
      
      const stepByStepGuide = {
        id: uuidv4(),
        sessionId,
        topic,
        ...explanation,
        options,
        sources: contextData.sources,
        createdAt: new Date().toISOString(),
        viewCount: 0,
        lastViewed: null
      };

      logger.info(`Generated step-by-step explanation for topic: ${topic}`);
      return stepByStepGuide;

    } catch (error) {
      logger.error('Error generating step-by-step explanation:', error);
      throw error;
    }
  }

  /**
   * Create personalized study plan
   * @param {string} sessionId - Session identifier
   * @param {Object} preferences - User study preferences
   * @returns {Object} - Study plan
   */
  async createStudyPlan(sessionId, preferences = {}) {
    try {
      const {
        studyDuration = 30, // minutes per session
        difficulty = 'progressive',
        focusAreas = [],
        studyFrequency = 'daily'
      } = preferences;

      // Get session documents and progress
      const sessionStats = pdfProcessor.getSessionStats(sessionId);
      const learningProgress = this.getLearningProgress(sessionId);
      
      // Analyze content to create study plan
      const contextData = await pdfProcessor.getRelevantContext(
        focusAreas.length > 0 ? focusAreas.join(' ') : 'main concepts key topics',
        sessionId,
        2000
      );

      const studyPlanPrompt = `
        Create a personalized study plan based on the following information:
        
        Study Duration: ${studyDuration} minutes per session
        Difficulty Level: ${difficulty}
        Focus Areas: ${focusAreas.join(', ') || 'General'}
        Study Frequency: ${studyFrequency}
        
        Available Content:
        ${contextData.context}
        
        Learning Progress:
        - Flashcards studied: ${learningProgress.flashcardsStudied}
        - Quizzes taken: ${learningProgress.quizzesTaken}
        - Average quiz score: ${learningProgress.averageQuizScore}%
        
        Create a structured study plan with:
        1. Weekly schedule
        2. Daily learning objectives
        3. Recommended study methods for each topic
        4. Progress milestones
        5. Review schedules
        
        Format as JSON with this structure:
        {
          "title": "Personalized Study Plan",
          "duration": "${studyDuration} minutes per session",
          "frequency": "${studyFrequency}",
          "weeks": [
            {
              "week": 1,
              "objective": "Week objective",
              "days": [
                {
                  "day": 1,
                  "topics": ["topic1", "topic2"],
                  "activities": ["activity1", "activity2"],
                  "duration": 30,
                  "resources": ["resource1"]
                }
              ]
            }
          ],
          "milestones": [
            {
              "week": 1,
              "description": "Complete basic concepts",
              "criteria": "Score 80% on practice quiz"
            }
          ]
        }
      `;

      const planResult = await aiService.geminiModel.invoke([
        { role: 'user', content: studyPlanPrompt }
      ]);

      let studyPlan;
      try {
        studyPlan = JSON.parse(planResult.content);
      } catch (parseError) {
        // Fallback structure if JSON parsing fails
        studyPlan = {
          title: 'Personalized Study Plan',
          duration: `${studyDuration} minutes per session`,
          frequency: studyFrequency,
          content: planResult.content,
          created_with_ai: true
        };
      }

      const finalPlan = {
        id: uuidv4(),
        sessionId,
        ...studyPlan,
        preferences,
        createdAt: new Date().toISOString(),
        progress: {
          completed_days: 0,
          total_days: studyPlan.weeks?.reduce((acc, week) => acc + (week.days?.length || 0), 0) || 0,
          milestones_reached: 0
        }
      };

      // Store study plan
      if (!this.studyPlans.has(sessionId)) {
        this.studyPlans.set(sessionId, []);
      }
      this.studyPlans.get(sessionId).push(finalPlan);

      logger.info(`Created study plan for session: ${sessionId}`);
      return finalPlan;

    } catch (error) {
      logger.error('Error creating study plan:', error);
      throw error;
    }
  }

  /**
   * Update learning progress
   * @param {string} sessionId - Session identifier
   * @param {string} activityType - Type of learning activity
   * @param {Object} activityData - Activity data
   */
  updateLearningProgress(sessionId, activityType, activityData = {}) {
    if (!this.learningProgress.has(sessionId)) {
      this.learningProgress.set(sessionId, {
        flashcardsStudied: 0,
        quizzesTaken: 0,
        totalQuizScore: 0,
        averageQuizScore: 0,
        conceptMapsViewed: 0,
        studyTime: 0, // in minutes
        lastActivity: null,
        streakDays: 0,
        achievements: []
      });
    }

    const progress = this.learningProgress.get(sessionId);
    
    switch (activityType) {
      case 'flashcard_study':
        progress.flashcardsStudied++;
        break;
      case 'quiz_completed':
        progress.quizzesTaken++;
        progress.totalQuizScore += activityData.score || 0;
        progress.averageQuizScore = Math.round(progress.totalQuizScore / progress.quizzesTaken);
        break;
      case 'concept_map_viewed':
        progress.conceptMapsViewed++;
        break;
      case 'study_time':
        progress.studyTime += activityData.minutes || 0;
        break;
    }

    progress.lastActivity = new Date().toISOString();
    
    // Check for achievements
    this.checkAchievements(sessionId, progress);
    
    logger.info(`Updated learning progress for session: ${sessionId}, activity: ${activityType}`);
  }

  /**
   * Check and award achievements
   * @param {string} sessionId - Session identifier
   * @param {Object} progress - Current progress
   */
  checkAchievements(sessionId, progress) {
    const achievements = [
      {
        id: 'first_quiz',
        name: 'Quiz Taker',
        description: 'Completed your first quiz',
        condition: () => progress.quizzesTaken >= 1
      },
      {
        id: 'quiz_master',
        name: 'Quiz Master',
        description: 'Completed 10 quizzes',
        condition: () => progress.quizzesTaken >= 10
      },
      {
        id: 'high_scorer',
        name: 'High Scorer',
        description: 'Average quiz score above 85%',
        condition: () => progress.averageQuizScore >= 85
      },
      {
        id: 'study_champion',
        name: 'Study Champion',
        description: 'Studied for more than 5 hours total',
        condition: () => progress.studyTime >= 300
      },
      {
        id: 'flashcard_enthusiast',
        name: 'Flashcard Enthusiast',
        description: 'Studied 50 flashcards',
        condition: () => progress.flashcardsStudied >= 50
      }
    ];

    const newAchievements = achievements.filter(
      achievement => 
        achievement.condition() && 
        !progress.achievements.some(earned => earned.id === achievement.id)
    );

    newAchievements.forEach(achievement => {
      progress.achievements.push({
        ...achievement,
        earnedAt: new Date().toISOString()
      });
      logger.info(`Achievement earned: ${achievement.name} for session: ${sessionId}`);
    });
  }

  /**
   * Get learning progress for session
   * @param {string} sessionId - Session identifier
   * @returns {Object} - Learning progress data
   */
  getLearningProgress(sessionId) {
    return this.learningProgress.get(sessionId) || {
      flashcardsStudied: 0,
      quizzesTaken: 0,
      averageQuizScore: 0,
      conceptMapsViewed: 0,
      studyTime: 0,
      achievements: []
    };
  }

  /**
   * Get all learning content for session
   * @param {string} sessionId - Session identifier
   * @returns {Object} - All learning content
   */
  getSessionLearningContent(sessionId) {
    return {
      flashcards: this.flashcards.get(sessionId) || [],
      quizzes: this.quizzes.get(sessionId) || [],
      conceptMaps: this.conceptMaps.get(sessionId) || [],
      studyPlans: this.studyPlans.get(sessionId) || [],
      progress: this.getLearningProgress(sessionId)
    };
  }

  /**
   * Delete learning content
   * @param {string} sessionId - Session identifier
   * @param {string} contentType - Type of content to delete
   * @param {string} contentId - ID of specific content (optional)
   */
  deleteLearningContent(sessionId, contentType, contentId = null) {
    const contentMaps = {
      flashcards: this.flashcards,
      quizzes: this.quizzes,
      conceptMaps: this.conceptMaps,
      studyPlans: this.studyPlans
    };

    const contentMap = contentMaps[contentType];
    if (!contentMap) {
      throw new Error(`Invalid content type: ${contentType}`);
    }

    if (contentId) {
      // Delete specific content
      const sessionContent = contentMap.get(sessionId) || [];
      const filteredContent = sessionContent.filter(item => item.id !== contentId);
      contentMap.set(sessionId, filteredContent);
    } else {
      // Delete all content of this type for session
      contentMap.delete(sessionId);
    }

    logger.info(`Deleted ${contentType} for session: ${sessionId}`);
  }

  /**
   * Clean up session data
   * @param {string} sessionId - Session identifier
   */
  cleanupSession(sessionId) {
    this.flashcards.delete(sessionId);
    this.quizzes.delete(sessionId);
    this.conceptMaps.delete(sessionId);
    this.studyPlans.delete(sessionId);
    this.learningProgress.delete(sessionId);
    
    logger.info(`Cleaned up learning features data for session: ${sessionId}`);
  }
}

module.exports = new LearningFeaturesService();
