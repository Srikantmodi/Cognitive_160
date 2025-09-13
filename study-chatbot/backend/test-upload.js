// Simple upload test script
const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

async function testUpload() {
    try {
        console.log('Testing upload functionality...');
        
        // Create a simple test file
        const testFile = 'test.txt';
        const testContent = 'This is a test document for upload testing.';
        
        if (!fs.existsSync(testFile)) {
            fs.writeFileSync(testFile, testContent);
            console.log('Created test file:', testFile);
        }
        
        // Create form data
        const form = new FormData();
        form.append('document', fs.createReadStream(testFile));
        form.append('sessionId', 'demo-session');
        
        console.log('Sending upload request...');
        
        // Send upload request
        const response = await fetch('http://localhost:5000/api/upload', {
            method: 'POST',
            body: form,
            headers: form.getHeaders()
        });
        
        console.log('Response status:', response.status);
        console.log('Response headers:', response.headers);
        
        const result = await response.json();
        console.log('Response body:', JSON.stringify(result, null, 2));
        
        if (response.ok) {
            console.log('✅ Upload successful!');
        } else {
            console.log('❌ Upload failed!');
        }
        
    } catch (error) {
        console.error('❌ Upload test failed:', error.message);
        console.error('Full error:', error);
    }
}

testUpload();