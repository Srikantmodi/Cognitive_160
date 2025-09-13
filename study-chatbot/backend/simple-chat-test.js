// Simple chat test with minimal setup
const fetch = require('node-fetch');

async function testChat() {
    console.log('🧪 Testing chat endpoint directly...');
    
    try {
        const response = await fetch('http://localhost:5000/api/chat/ask', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                question: 'What is DevOps?',
                sessionId: 'test-session'
            })
        });

        console.log(`Response status: ${response.status}`);
        
        const responseText = await response.text();
        console.log(`Response body: ${responseText}`);
        
        if (response.ok) {
            console.log('✅ Chat test successful!');
        } else {
            console.log('❌ Chat test failed');
        }

    } catch (error) {
        console.log(`❌ Chat test error: ${error.message}`);
    }
}

// First check if server is running
fetch('http://localhost:5000/health')
    .then(response => {
        if (response.ok) {
            console.log('✅ Server is running');
            return testChat();
        } else {
            console.log('❌ Server not responding');
        }
    })
    .catch(error => {
        console.log(`❌ Server check failed: ${error.message}`);
    });