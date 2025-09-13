const documentService = require('./src/services/documentService');
const logger = require('./src/services/logger');

async function directTest() {
    try {
        console.log('🔍 Direct DocumentService Test...');
        
        await documentService.initialize();
        console.log('✅ DocumentService initialized');
        
        // Check current sessions
        const sessions = Array.from(documentService.sessions.keys());
        console.log('📋 Current sessions:', sessions);
        
        // Create a test session ID (should match one that exists)
        let testSessionId = null;
        if (sessions.length > 0) {
            testSessionId = sessions[sessions.length - 1]; // Use the most recent session
        } else {
            // Create a new session by uploading a document
            console.log('📄 Creating new session with document...');
            const fs = require('fs');
            const path = require('path');
            
            testSessionId = 'direct_test_' + Date.now();
            
            // Create a fake file object like multer would
            const testContent = 'DevOps is a set of practices that combines software development and operations.';
            const tempFile = path.join(__dirname, 'temp-test.txt');
            fs.writeFileSync(tempFile, testContent);
            
            const fakeFile = {
                filename: 'temp-test.txt',
                originalname: 'test.txt',
                mimetype: 'text/plain',
                size: testContent.length,
                path: tempFile
            };
            
            // Process the document
            const result = await documentService.processDocuments([fakeFile], testSessionId, {
                useEnhancedProcessing: true,
                enableOCR: false,
                enableSemanticAnalysis: true
            });
            
            console.log('✅ Document processed');
            console.log('📄 Processing result:', JSON.stringify(result, null, 2));
            
            // Clean up temp file (if it still exists)
            try {
                fs.unlinkSync(tempFile);
            } catch (e) {
                // File might already be deleted by document processing
                console.log('Note: Temp file already cleaned up');
            }
        }
        
        console.log(`🎯 Testing summarization for session: ${testSessionId}`);
        
        // Now try generating summary
        const summary = await documentService.generateSummary(testSessionId, 'granite');
        console.log('✅ Summary generated successfully!');
        console.log('📄 Summary:', summary);
        
    } catch (error) {
        console.error('❌ Direct test failed:', error);
        console.error('Stack trace:', error.stack);
    }
}

directTest();