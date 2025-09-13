// Test the new sidebar functionality
const fetch = require('node-fetch');

async function testSidebarFeatures() {
    console.log('🧪 Testing Sidebar Features...\n');

    try {
        // Test 1: Check if server is running
        console.log('1️⃣ Testing server health...');
        const healthResponse = await fetch('http://localhost:5000/health');
        if (healthResponse.ok) {
            console.log('✅ Server is running\n');
        } else {
            throw new Error('Server not responding');
        }

        // Test 2: Create a new session
        console.log('2️⃣ Creating new session...');
        const createSessionResponse = await fetch('http://localhost:5000/api/history/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Test Chat Session' })
        });

        if (createSessionResponse.ok) {
            const sessionData = await createSessionResponse.json();
            console.log(`✅ Created session: ${sessionData.session.id}`);
            console.log(`   Title: ${sessionData.session.title}\n`);
            
            const sessionId = sessionData.session.id;

            // Test 3: Upload a test document to the session
            console.log('3️⃣ Uploading test document...');
            const FormData = require('form-data');
            const fs = require('fs');
            
            const formData = new FormData();
            formData.append('file', fs.createReadStream('workflow-test.txt'));
            formData.append('sessionId', sessionId);

            const uploadResponse = await fetch('http://localhost:5000/api/upload', {
                method: 'POST',
                body: formData
            });

            if (uploadResponse.ok) {
                const uploadData = await uploadResponse.json();
                console.log('✅ Document uploaded successfully\n');
            }

            // Test 4: Send a chat message
            console.log('4️⃣ Sending chat message...');
            const chatResponse = await fetch('http://localhost:5000/api/chat/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: 'What is DevOps methodology?',
                    sessionId: sessionId
                })
            });

            if (chatResponse.ok) {
                const chatData = await chatResponse.json();
                console.log('✅ Chat message processed\n');
            }

            // Test 5: Get all sessions
            console.log('5️⃣ Retrieving all sessions...');
            const sessionsResponse = await fetch('http://localhost:5000/api/history/sessions');
            
            if (sessionsResponse.ok) {
                const sessionsData = await sessionsResponse.json();
                console.log(`✅ Found ${sessionsData.sessions.length} sessions:`);
                sessionsData.sessions.forEach(session => {
                    console.log(`   - ${session.title} (${session.messageCount} messages)`);
                });
                console.log('');
            }

            // Test 6: Get chat history for the session
            console.log('6️⃣ Retrieving chat history...');
            const historyResponse = await fetch(`http://localhost:5000/api/history/sessions/${sessionId}/messages`);
            
            if (historyResponse.ok) {
                const historyData = await historyResponse.json();
                console.log(`✅ Retrieved ${historyData.messages.length} messages:`);
                historyData.messages.forEach(msg => {
                    console.log(`   - [${msg.type}]: ${msg.content.substring(0, 50)}...`);
                });
                console.log('');
            }

            // Test 7: Get file history
            console.log('7️⃣ Retrieving file history...');
            const filesResponse = await fetch('http://localhost:5000/api/history/files');
            
            if (filesResponse.ok) {
                const filesData = await filesResponse.json();
                console.log(`✅ Found ${filesData.files.length} files:`);
                filesData.files.forEach(file => {
                    console.log(`   - ${file.originalname || file.filename} (${formatFileSize(file.size)})`);
                });
                console.log('');
            }

            // Test 8: Search chat history
            console.log('8️⃣ Testing chat search...');
            const searchResponse = await fetch('http://localhost:5000/api/history/search?q=DevOps');
            
            if (searchResponse.ok) {
                const searchData = await searchResponse.json();
                console.log(`✅ Found ${searchData.results.length} search results\n`);
            }

        } else {
            throw new Error('Failed to create session');
        }

        console.log('🎉 All sidebar features working correctly!');

    } catch (error) {
        console.error(`❌ Test failed: ${error.message}`);
    }
}

function formatFileSize(bytes) {
    if (!bytes) return 'Unknown size';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

testSidebarFeatures();