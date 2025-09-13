const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch');

async function debugApiTest() {
    try {
        console.log('🔍 Debug API Test...');
        
        // Create test session
        const testSessionId = 'debug_api_' + Date.now();
        console.log('🆔 Using session ID:', testSessionId);
        
        // Create test document
        const testContent = `DevOps is a set of practices that combines software development (Dev) and IT operations (Ops).
It aims to shorten the systems development life cycle and provide continuous delivery with high software quality.
DevOps includes automation, monitoring, collaboration, and integration between development and operations teams.
Key tools include Jenkins, Docker, Kubernetes, Git, and various monitoring systems.`;
        
        console.log('\n📝 Creating test document...');
        fs.writeFileSync('debug-api-test-doc.txt', testContent);
        
        // Upload document
        console.log('\n2️⃣ Uploading test document...');
        const form = new FormData();
        form.append('document', fs.createReadStream('debug-api-test-doc.txt'));
        form.append('sessionId', testSessionId);
        
        const uploadResponse = await fetch('http://localhost:5000/api/upload', {
            method: 'POST',
            body: form
        });
        
        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            console.log('❌ Upload failed:', errorText);
            return;
        }
        
        const uploadData = await uploadResponse.json();
        console.log('✅ Upload response:', JSON.stringify(uploadData, null, 2));
        
        // Wait for processing
        console.log('\n⏳ Waiting 3 seconds for processing...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Test search first to verify document is there
        console.log('\n🔍 Testing search to verify document exists...');
        const searchResponse = await fetch('http://localhost:5000/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: 'DevOps',
                sessionId: testSessionId,
                searchType: 'semantic',
                maxResults: 5
            })
        });
        
        if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            console.log('✅ Search successful, found:', searchData.results?.length || 0, 'results');
        } else {
            console.log('❌ Search failed');
        }
        
        // Try summarization
        console.log('\n📄 Testing summarization...');
        console.log('Using sessionId:', testSessionId);
        console.log('Endpoint: http://localhost:5000/api/summarize/summarize');
        
        const summaryResponse = await fetch('http://localhost:5000/api/summarize/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: testSessionId,
                modelType: 'granite'
            })
        });
        
        console.log('Summary response status:', summaryResponse.status);
        const summaryResult = await summaryResponse.json();
        console.log('📄 Summary response:', JSON.stringify(summaryResult, null, 2));
        
        if (summaryResult.success) {
            console.log('✅ Summarization successful!');
            console.log('📝 Summary:', summaryResult.summary);
        } else {
            console.log('❌ Summarization failed:', summaryResult.message);
            console.log('🐛 Error details:', summaryResult.error);
        }
        
        // Clean up
        console.log('\n🧹 Cleaning up...');
        try {
            fs.unlinkSync('debug-api-test-doc.txt');
            console.log('✅ Cleanup completed');
        } catch (e) {
            console.log('⚠️ Cleanup warning:', e.message);
        }
        
    } catch (error) {
        console.error('❌ Debug API test error:', error);
    }
}

debugApiTest();