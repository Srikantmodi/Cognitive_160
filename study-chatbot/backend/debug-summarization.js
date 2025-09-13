const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch');

async function debugSummarization() {
    try {
        console.log('🔍 Debugging Summarization...');
        
        // Test session ID
        const testSessionId = 'debug_session_' + Date.now();
        console.log('🆔 Using session ID:', testSessionId);
        
        // Create test document
        const testContent = `DevOps is a set of practices that combines software development (Dev) and IT operations (Ops).
It aims to shorten the systems development life cycle and provide continuous delivery with high software quality.
DevOps includes automation, monitoring, collaboration, and integration between development and operations teams.
Key tools include Jenkins, Docker, Kubernetes, Git, and various monitoring systems.`;
        
        console.log('\n📝 Creating test document...');
        fs.writeFileSync('debug-test-doc.txt', testContent);
        
        // Upload document
        console.log('\n2️⃣ Uploading test document...');
        const form = new FormData();
        form.append('document', fs.createReadStream('debug-test-doc.txt'));
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
        
        console.log('✅ Document uploaded successfully');
        
        // Wait a moment for processing
        console.log('\n⏳ Waiting for document processing...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Try summarization
        console.log('\n📄 Testing summarization...');
        const summaryResponse = await fetch('http://localhost:5000/api/summarize/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: testSessionId,
                modelType: 'granite'
            })
        });
        
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
            fs.unlinkSync('debug-test-doc.txt');
            console.log('✅ Cleanup completed');
        } catch (e) {
            console.log('⚠️ Cleanup warning:', e.message);
        }
        
    } catch (error) {
        console.error('❌ Debug script error:', error);
    }
}

debugSummarization();