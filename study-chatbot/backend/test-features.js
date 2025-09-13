// Test script for search and summarization functionality
const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');

async function testSearchAndSummarization() {
    console.log('🔍 Testing Search and Summarization Features...');
    
    try {
        // Test 1: Health check
        console.log('\n1️⃣ Testing server health...');
        const healthResponse = await fetch('http://localhost:5000/health');
        if (healthResponse.ok) {
            console.log('✅ Server is healthy');
        } else {
            console.log('❌ Server health check failed');
            return;
        }

        const testSessionId = `test_session_${Date.now()}`;
        console.log(`🆔 Using session ID: ${testSessionId}`);

        // Test 2: Upload a test document
        console.log('\n2️⃣ Uploading test document...');
        const testContent = `
        DevOps is a set of practices that combines software development (Dev) and IT operations (Ops).
        It aims to shorten the systems development life cycle and provide continuous delivery with high software quality.
        DevOps is complementary with Agile software development; several DevOps aspects came from Agile methodology.
        
        Key principles of DevOps include:
        - Continuous Integration (CI)
        - Continuous Deployment (CD)
        - Infrastructure as Code
        - Monitoring and Logging
        - Collaboration and Communication
        
        Popular DevOps tools include Jenkins, Docker, Kubernetes, Git, and AWS.
        `;
        
        fs.writeFileSync('test-devops-doc.txt', testContent);
        
        const form = new FormData();
        form.append('document', fs.createReadStream('test-devops-doc.txt'));
        form.append('sessionId', testSessionId);
        
        const uploadResponse = await fetch('http://localhost:5000/api/upload', {
            method: 'POST',
            body: form
        });
        
        if (uploadResponse.ok) {
            console.log('✅ Document uploaded successfully');
        } else {
            const errorText = await uploadResponse.text();
            console.log('❌ Upload failed:', errorText);
            return;
        }

        // Test 3: Test semantic search
        console.log('\n3️⃣ Testing semantic search...');
        const searchResponse = await fetch('http://localhost:5000/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: 'What are DevOps tools?',
                sessionId: testSessionId,
                searchType: 'semantic',
                maxResults: 5
            })
        });

        if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            console.log('✅ Search completed');
            console.log(`📊 Found ${searchData.results?.length || 0} results`);
            
            if (searchData.results?.length > 0) {
                console.log('🔍 First result preview:', searchData.results[0].content.substring(0, 100) + '...');
            }
        } else {
            const searchError = await searchResponse.text();
            console.log('❌ Search failed:', searchError);
        }

        // Test 4: Test summarization
        console.log('\n4️⃣ Testing document summarization...');
        const summaryResponse = await fetch('http://localhost:5000/api/summarize/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: testSessionId,
                summaryType: 'comprehensive'
            })
        });

        if (summaryResponse.ok) {
            const summaryData = await summaryResponse.json();
            console.log('✅ Summarization completed');
            console.log('📄 Summary preview:', summaryData.summary?.substring(0, 200) + '...');
        } else {
            const summaryError = await summaryResponse.text();
            console.log('❌ Summarization failed:', summaryError);
        }

        // Test 5: Test Q&A generation
        console.log('\n5️⃣ Testing Q&A generation...');
        const qaResponse = await fetch('http://localhost:5000/api/chat/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: 'Generate 3 important questions and answers about DevOps from the document.',
                sessionId: testSessionId
            })
        });

        if (qaResponse.ok) {
            const qaData = await qaResponse.json();
            console.log('✅ Q&A generation completed');
            console.log('❓ Q&A preview:', qaData.answer?.substring(0, 200) + '...');
        } else {
            const qaError = await qaResponse.text();
            console.log('❌ Q&A generation failed:', qaError);
        }

        // Cleanup
        try {
            fs.unlinkSync('test-devops-doc.txt');
            console.log('\n🧹 Cleanup completed');
        } catch (err) {
            // Ignore cleanup errors
        }

        console.log('\n🎉 Search and summarization test completed!');
        
    } catch (error) {
        console.log(`❌ Test error: ${error.message}`);
    }
}

// Run the test
testSearchAndSummarization();