const express = require('express');
const learningFeatures = require('../services/learningFeatures');
const configService = require('../services/configService');
const logger = require('../services/logger');

const router = express.Router();

/**
 * @route POST /api/learning/flashcards/generate
 * @desc Generate flashcards from document content
 * @access Public
 */
router.post('/flashcards/generate', async (req, res) => {
  try {
    const { 
      sessionId, 
      documentIds = null,
      topic = null,
      count = 10,
      difficulty = 'mixed' 
    } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    const options = {
      documentIds,
      topic,
      count: Math.min(Math.max(count, 1), 50), // Limit between 1-50
      difficulty
    };

    const flashcardSet = await learningFeatures.generateFlashcards(sessionId, options);

    // Update session stats
    configService.updateSessionStats(sessionId, 'flashcardsGenerated');
    learningFeatures.updateLearningProgress(sessionId, 'flashcard_study');

    res.status(201).json({
      success: true,
      message: `Generated ${flashcardSet.count} flashcards`,
      flashcardSet,
      sessionId
    });

  } catch (error) {
    logger.error('Error generating flashcards:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate flashcards',
      error: error.message
    });
  }
});

/**
 * @route GET /api/learning/flashcards/:sessionId
 * @desc Get all flashcard sets for a session
 * @access Public
 */
router.get('/flashcards/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const learningContent = learningFeatures.getSessionLearningContent(sessionId);
    
    res.status(200).json({
      success: true,
      flashcardSets: learningContent.flashcards,
      count: learningContent.flashcards.length,
      sessionId
    });

  } catch (error) {
    logger.error('Error getting flashcards:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve flashcards',
      error: error.message
    });
  }
});

/**
 * @route POST /api/learning/quiz/generate
 * @desc Generate quiz from document content
 * @access Public
 */
router.post('/quiz/generate', async (req, res) => {
  try {
    const { 
      sessionId,
      documentIds = null,
      topic = null,
      questionCount = 10,
      difficulty = 'mixed',
      questionTypes = ['multiple_choice', 'true_false', 'short_answer'],
      timeLimit = null
    } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    const options = {
      documentIds,
      topic,
      questionCount: Math.min(Math.max(questionCount, 1), 30), // Limit between 1-30
      difficulty,
      questionTypes,
      timeLimit
    };

    const quiz = await learningFeatures.generateQuiz(sessionId, options);

    // Update session stats
    configService.updateSessionStats(sessionId, 'quizzesGenerated');

    res.status(201).json({
      success: true,
      message: `Generated quiz with ${quiz.questions.length} questions`,
      quiz: {
        ...quiz,
        // Don't send correct answers in initial response
        questions: quiz.questions.map(q => ({
          ...q,
          correct_answer: undefined,
          explanation: undefined
        }))
      },
      sessionId
    });

  } catch (error) {
    logger.error('Error generating quiz:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate quiz',
      error: error.message
    });
  }
});

/**
 * @route POST /api/learning/quiz/:quizId/submit
 * @desc Submit quiz answers and get results
 * @access Public
 */
router.post('/quiz/:quizId/submit', async (req, res) => {
  try {
    const { quizId } = req.params;
    const { sessionId, answers } = req.body;
    
    if (!sessionId || !answers || !Array.isArray(answers)) {
      return res.status(400).json({
        success: false,
        message: 'Session ID and answers array are required'
      });
    }

    const attempt = await learningFeatures.submitQuizAttempt(sessionId, quizId, answers);

    // Update learning progress
    learningFeatures.updateLearningProgress(sessionId, 'quiz_completed', { 
      score: attempt.score 
    });

    res.status(200).json({
      success: true,
      message: `Quiz completed with score: ${attempt.score}%`,
      attempt,
      sessionId
    });

  } catch (error) {
    logger.error('Error submitting quiz:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit quiz',
      error: error.message
    });
  }
});

/**
 * @route GET /api/learning/quiz/:sessionId
 * @desc Get all quizzes for a session
 * @access Public
 */
router.get('/quiz/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const learningContent = learningFeatures.getSessionLearningContent(sessionId);
    
    // Remove correct answers from response for security
    const quizzes = learningContent.quizzes.map(quiz => ({
      ...quiz,
      questions: quiz.questions.map(q => ({
        ...q,
        correct_answer: undefined,
        explanation: undefined
      }))
    }));

    res.status(200).json({
      success: true,
      quizzes,
      count: quizzes.length,
      sessionId
    });

  } catch (error) {
    logger.error('Error getting quizzes:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve quizzes',
      error: error.message
    });
  }
});

/**
 * @route POST /api/learning/concept-map/generate
 * @desc Generate concept map from document content
 * @access Public
 */
router.post('/concept-map/generate', async (req, res) => {
  try {
    const { 
      sessionId,
      documentIds = null,
      topic = null,
      maxConcepts = 20,
      depth = 'comprehensive' 
    } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    const options = {
      documentIds,
      topic,
      maxConcepts: Math.min(Math.max(maxConcepts, 5), 50), // Limit between 5-50
      depth
    };

    const conceptMap = await learningFeatures.generateConceptMap(sessionId, options);

    // Update learning progress
    learningFeatures.updateLearningProgress(sessionId, 'concept_map_viewed');

    res.status(201).json({
      success: true,
      message: `Generated concept map with ${conceptMap.concepts?.length || 0} concepts`,
      conceptMap,
      sessionId
    });

  } catch (error) {
    logger.error('Error generating concept map:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate concept map',
      error: error.message
    });
  }
});

/**
 * @route GET /api/learning/concept-map/:sessionId
 * @desc Get all concept maps for a session
 * @access Public
 */
router.get('/concept-map/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const learningContent = learningFeatures.getSessionLearningContent(sessionId);
    
    res.status(200).json({
      success: true,
      conceptMaps: learningContent.conceptMaps,
      count: learningContent.conceptMaps.length,
      sessionId
    });

  } catch (error) {
    logger.error('Error getting concept maps:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve concept maps',
      error: error.message
    });
  }
});

/**
 * @route POST /api/learning/explain-step-by-step
 * @desc Generate step-by-step explanation for a topic
 * @access Public
 */
router.post('/explain-step-by-step', async (req, res) => {
  try {
    const { 
      sessionId, 
      topic, 
      depth = 'detailed',
      includeExamples = true 
    } = req.body;
    
    if (!sessionId || !topic) {
      return res.status(400).json({
        success: false,
        message: 'Session ID and topic are required'
      });
    }

    const options = { depth, includeExamples };
    const explanation = await learningFeatures.generateStepByStepExplanation(
      sessionId, 
      topic, 
      options
    );

    res.status(200).json({
      success: true,
      explanation,
      topic,
      sessionId
    });

  } catch (error) {
    logger.error('Error generating step-by-step explanation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate explanation',
      error: error.message
    });
  }
});

/**
 * @route POST /api/learning/study-plan/create
 * @desc Create personalized study plan
 * @access Public
 */
router.post('/study-plan/create', async (req, res) => {
  try {
    const { 
      sessionId,
      studyDuration = 30,
      difficulty = 'progressive',
      focusAreas = [],
      studyFrequency = 'daily'
    } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    const preferences = {
      studyDuration: Math.min(Math.max(studyDuration, 15), 120), // 15-120 minutes
      difficulty,
      focusAreas: Array.isArray(focusAreas) ? focusAreas : [],
      studyFrequency
    };

    const studyPlan = await learningFeatures.createStudyPlan(sessionId, preferences);

    res.status(201).json({
      success: true,
      message: 'Study plan created successfully',
      studyPlan,
      sessionId
    });

  } catch (error) {
    logger.error('Error creating study plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create study plan',
      error: error.message
    });
  }
});

/**
 * @route GET /api/learning/progress/:sessionId
 * @desc Get learning progress for a session
 * @access Public
 */
router.get('/progress/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const progress = learningFeatures.getLearningProgress(sessionId);
    const learningContent = learningFeatures.getSessionLearningContent(sessionId);
    
    // Calculate additional stats
    const totalQuizzes = learningContent.quizzes.length;
    const totalFlashcardSets = learningContent.flashcards.length;
    const totalConceptMaps = learningContent.conceptMaps.length;
    
    const enhancedProgress = {
      ...progress,
      content: {
        totalQuizzes,
        totalFlashcardSets,
        totalConceptMaps,
        totalStudyPlans: learningContent.studyPlans.length
      },
      performance: {
        averageQuizScore: progress.averageQuizScore,
        quizImprovement: progress.quizzesTaken >= 2 ? 
          learningContent.quizzes.slice(-2).reduce((acc, quiz) => {
            if (quiz.attempts.length > 0) {
              acc.push(quiz.attempts[quiz.attempts.length - 1].score);
            }
            return acc;
          }, []) : []
      }
    };

    res.status(200).json({
      success: true,
      progress: enhancedProgress,
      sessionId
    });

  } catch (error) {
    logger.error('Error getting learning progress:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve learning progress',
      error: error.message
    });
  }
});

/**
 * @route DELETE /api/learning/content/:contentType/:contentId
 * @desc Delete specific learning content
 * @access Public
 */
router.delete('/content/:contentType/:contentId', async (req, res) => {
  try {
    const { contentType, contentId } = req.params;
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    const validContentTypes = ['flashcards', 'quizzes', 'conceptMaps', 'studyPlans'];
    if (!validContentTypes.includes(contentType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid content type'
      });
    }

    learningFeatures.deleteLearningContent(sessionId, contentType, contentId);

    res.status(200).json({
      success: true,
      message: `${contentType} deleted successfully`,
      contentType,
      contentId,
      sessionId
    });

  } catch (error) {
    logger.error('Error deleting learning content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete content',
      error: error.message
    });
  }
});

/**
 * @route GET /api/learning/dashboard/:sessionId
 * @desc Get comprehensive learning dashboard data
 * @access Public
 */
router.get('/dashboard/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = configService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    const learningContent = learningFeatures.getSessionLearningContent(sessionId);
    const progress = learningFeatures.getLearningProgress(sessionId);

    // Calculate dashboard statistics
    const recentActivity = [];
    
    // Add recent flashcard sets
    learningContent.flashcards.slice(-3).forEach(set => {
      recentActivity.push({
        type: 'flashcard_generated',
        timestamp: set.createdAt,
        description: `Generated ${set.count} flashcards`,
        id: set.id
      });
    });

    // Add recent quizzes
    learningContent.quizzes.slice(-3).forEach(quiz => {
      recentActivity.push({
        type: 'quiz_generated',
        timestamp: quiz.createdAt,
        description: `Generated quiz: ${quiz.title}`,
        id: quiz.id
      });
      
      // Add recent attempts
      quiz.attempts.slice(-1).forEach(attempt => {
        recentActivity.push({
          type: 'quiz_completed',
          timestamp: attempt.submittedAt,
          description: `Completed quiz with ${attempt.score}% score`,
          id: attempt.id
        });
      });
    });

    // Sort by timestamp
    recentActivity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const dashboard = {
      session: {
        id: sessionId,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        documentsCount: session.documentIds?.length || 0
      },
      progress,
      content: {
        flashcardSets: learningContent.flashcards.length,
        quizzes: learningContent.quizzes.length,
        conceptMaps: learningContent.conceptMaps.length,
        studyPlans: learningContent.studyPlans.length
      },
      recentActivity: recentActivity.slice(0, 10), // Last 10 activities
      achievements: progress.achievements || []
    };

    res.status(200).json({
      success: true,
      dashboard,
      sessionId
    });

  } catch (error) {
    logger.error('Error getting learning dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve dashboard data',
      error: error.message
    });
  }
});

module.exports = router;