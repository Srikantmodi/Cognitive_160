// Test chat endpoint
const fetch = require('node-fetch');

async function testChat() {
    try {
        console.log('Testing chat endpoint...');
        
        const response = await fetch('http://localhost:5000/api/chat/ask', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                question: 'What are the main topics in my documents?',
                sessionId: 'demo-session'
            })
        });
        
        console.log('Response status:', response.status);
        
        const result = await response.json();
        console.log('Response body:', JSON.stringify(result, null, 2));
        
        if (response.ok) {
            console.log('✅ Chat endpoint working!');
        } else {
            console.log('❌ Chat endpoint failed!');
        }
        
    } catch (error) {
        console.error('❌ Chat test failed:', error.message);
    }
}

testChat();