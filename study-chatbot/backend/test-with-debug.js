const fetch = require('node-fetch');
const fs = require('fs');
const FormData = require('form-data');

async function testWithDebug() {
    try {
        console.log('🔍 Testing with Debug Endpoint...');
        
        // Check initial sessions
        console.log('\n1️⃣ Checking initial sessions...');
        let debugRes = await fetch('http://localhost:5000/api/debug/sessions');
        let debugData = await debugRes.json();
        console.log('Initial sessions:', JSON.stringify(debugData, null, 2));
        
        // Upload a document
        const sessionId = 'test_debug_' + Date.now();
        console.log('\n2️⃣ Uploading document with sessionId:', sessionId);
        
        const content = 'DevOps practices improve collaboration between development and operations teams.';
        fs.writeFileSync('test-debug.txt', content);
        
        const form = new FormData();
        form.append('document', fs.createReadStream('test-debug.txt'));
        form.append('sessionId', sessionId);
        
        const uploadRes = await fetch('http://localhost:5000/api/upload', {
            method: 'POST',
            body: form
        });
        
        if (uploadRes.ok) {
            console.log('✅ Upload successful');
        } else {
            console.log('❌ Upload failed');
            return;
        }
        
        // Check sessions after upload
        console.log('\n3️⃣ Checking sessions after upload...');
        debugRes = await fetch('http://localhost:5000/api/debug/sessions');
        debugData = await debugRes.json();
        console.log('Sessions after upload:', JSON.stringify(debugData, null, 2));
        
        // Try summarization
        console.log('\n4️⃣ Testing summarization...');
        const summaryRes = await fetch('http://localhost:5000/api/summarize/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: sessionId,
                modelType: 'granite'
            })
        });
        
        const summaryData = await summaryRes.json();
        console.log('Summary result:', JSON.stringify(summaryData, null, 2));
        
        // Cleanup
        fs.unlinkSync('test-debug.txt');
        console.log('\n✅ Test completed');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

testWithDebug();