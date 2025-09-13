// Test complete upload and chat workflow
const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');

async function testCompleteWorkflow() {
    try {
        console.log('🚀 Testing complete upload + chat workflow...\n');
        
        // Step 1: Upload a document
        console.log('1️⃣ Uploading test document...');
        const testContent = 'DevOps is a software development methodology that combines development and operations teams. It focuses on automation, continuous integration, and continuous deployment. Key topics include: Docker containers, Kubernetes orchestration, CI/CD pipelines, monitoring and logging, infrastructure as code, and cloud computing.';
        
        const testFile = 'workflow-test.txt';
        fs.writeFileSync(testFile, testContent);
        
        const form = new FormData();
        form.append('document', fs.createReadStream(testFile));
        form.append('sessionId', 'demo-session');
        
        const uploadResponse = await fetch('http://localhost:5000/api/upload', {
            method: 'POST',
            body: form,
            headers: form.getHeaders()
        });
        
        if (uploadResponse.ok) {
            console.log('✅ Upload successful!');
        } else {
            throw new Error('Upload failed');
        }
        
        // Step 2: Wait a moment for processing
        console.log('⏳ Waiting for document processing...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Step 3: Test chat
        console.log('2️⃣ Testing chat with uploaded document...');
        const chatResponse = await fetch('http://localhost:5000/api/chat/ask', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                question: 'What is DevOps?',
                sessionId: 'demo-session'
            })
        });
        
        console.log('Chat response status:', chatResponse.status);
        
        if (chatResponse.ok) {
            const chatResult = await chatResponse.json();
            console.log('✅ Chat successful!');
            console.log('Answer:', chatResult.answer.substring(0, 200) + '...');
            console.log('Sources count:', chatResult.sources?.length || 0);
        } else {
            const errorData = await chatResponse.json();
            console.log('❌ Chat failed:', errorData.message);
        }
        
        // Cleanup
        fs.unlinkSync(testFile);
        
        console.log('\n🎉 Workflow test completed!');
        
    } catch (error) {
        console.error('❌ Workflow test failed:', error.message);
    }
}

testCompleteWorkflow();