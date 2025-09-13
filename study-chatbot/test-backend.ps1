# Backend API Testing Script for Study Chatbot
# Test all major functionality

$baseUrl = "http://localhost:5000"
$sessionId = "test-session-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

Write-Host "=== Study Chatbot Backend Testing ===" -ForegroundColor Green
Write-Host "Session ID: $sessionId" -ForegroundColor Yellow
Write-Host "Base URL: $baseUrl" -ForegroundColor Yellow
Write-Host ""

# Test 1: Health Check
Write-Host "1. Testing Health Endpoint..." -ForegroundColor Cyan
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get
    Write-Host "✅ Health Check: $($health.status)" -ForegroundColor Green
    Write-Host "   Uptime: $($health.uptime) seconds" -ForegroundColor Gray
} catch {
    Write-Host "❌ Health Check Failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 2: File Upload (simulating PDF upload)
Write-Host "`n2. Testing File Upload..." -ForegroundColor Cyan
try {
    # Create a simple test file
    $testContent = @"
Test Study Document

This is a test document for the AI study chatbot.

Key Topics:
- Artificial Intelligence basics
- Machine Learning concepts
- Deep Learning fundamentals

Important Facts:
1. AI stands for Artificial Intelligence
2. Machine Learning is a subset of AI
3. Neural networks are used in deep learning
4. Natural Language Processing helps computers understand human language

Questions to test:
- What is AI?
- How does machine learning work?
- What are neural networks?
"@
    
    $testFile = "D:\projects\ibm\study-chatbot\test-upload.txt"
    $testContent | Out-File -FilePath $testFile -Encoding UTF8
    
    # Upload file using multipart form data
    $form = @{
        file = Get-Item -Path $testFile
        sessionId = $sessionId
        documentName = "Test Study Material"
    }
    
    $uploadResponse = Invoke-RestMethod -Uri "$baseUrl/api/upload/pdf" -Method Post -Form $form
    Write-Host "✅ File Upload Successful" -ForegroundColor Green
    Write-Host "   Document ID: $($uploadResponse.documentId)" -ForegroundColor Gray
    Write-Host "   Chunks created: $($uploadResponse.chunks)" -ForegroundColor Gray
    
    $documentId = $uploadResponse.documentId
} catch {
    Write-Host "❌ File Upload Failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $errorDetail = $reader.ReadToEnd()
        Write-Host "   Error Details: $errorDetail" -ForegroundColor Red
    }
}

# Test 3: Ask a Question (Q&A)
Write-Host "`n3. Testing Q&A Feature..." -ForegroundColor Cyan
try {
    $questionBody = @{
        question = "What is Artificial Intelligence?"
        sessionId = $sessionId
        answerDepth = "medium"
    } | ConvertTo-Json
    
    $qaResponse = Invoke-RestMethod -Uri "$baseUrl/api/chat/ask" -Method Post -Body $questionBody -ContentType "application/json"
    Write-Host "✅ Q&A Successful" -ForegroundColor Green
    Write-Host "   Question: What is Artificial Intelligence?" -ForegroundColor Gray
    Write-Host "   Answer: $($qaResponse.answer.Substring(0, [Math]::Min(100, $qaResponse.answer.Length)))..." -ForegroundColor Gray
} catch {
    Write-Host "❌ Q&A Failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $errorDetail = $reader.ReadToEnd()
        Write-Host "   Error Details: $errorDetail" -ForegroundColor Red
    }
}

# Test 4: Semantic Search
Write-Host "`n4. Testing Semantic Search..." -ForegroundColor Cyan
try {
    $searchResponse = Invoke-RestMethod -Uri "$baseUrl/api/chat/search?query=machine learning&sessionId=$sessionId&maxResults=3" -Method Get
    Write-Host "✅ Semantic Search Successful" -ForegroundColor Green
    Write-Host "   Found $($searchResponse.results.Count) results" -ForegroundColor Gray
} catch {
    Write-Host "❌ Semantic Search Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 5: Summarization (IBM Granite API)
Write-Host "`n5. Testing Summarization..." -ForegroundColor Cyan
try {
    $summaryBody = @{
        sessionId = $sessionId
        summaryType = "overview"
        length = "medium"
    } | ConvertTo-Json
    
    $summaryResponse = Invoke-RestMethod -Uri "$baseUrl/api/pdf/summarize" -Method Post -Body $summaryBody -ContentType "application/json"
    Write-Host "✅ Summarization Successful" -ForegroundColor Green
    Write-Host "   Summary: $($summaryResponse.summary.Substring(0, [Math]::Min(100, $summaryResponse.summary.Length)))..." -ForegroundColor Gray
} catch {
    Write-Host "❌ Summarization Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 6: Generate Flashcards
Write-Host "`n6. Testing Flashcard Generation..." -ForegroundColor Cyan
try {
    $flashcardBody = @{
        topic = "Artificial Intelligence basics"
        sessionId = $sessionId
        count = 3
        difficulty = "medium"
    } | ConvertTo-Json
    
    $flashcardResponse = Invoke-RestMethod -Uri "$baseUrl/api/learning/flashcards/generate" -Method Post -Body $flashcardBody -ContentType "application/json"
    Write-Host "✅ Flashcard Generation Successful" -ForegroundColor Green
    Write-Host "   Generated $($flashcardResponse.flashcards.Count) flashcards" -ForegroundColor Gray
} catch {
    Write-Host "❌ Flashcard Generation Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 7: Generate Quiz
Write-Host "`n7. Testing Quiz Generation..." -ForegroundColor Cyan
try {
    $quizBody = @{
        topic = "Machine Learning"
        sessionId = $sessionId
        questionCount = 3
        questionType = "multiple-choice"
        difficulty = "medium"
    } | ConvertTo-Json
    
    $quizResponse = Invoke-RestMethod -Uri "$baseUrl/api/learning/quiz/generate" -Method Post -Body $quizBody -ContentType "application/json"
    Write-Host "✅ Quiz Generation Successful" -ForegroundColor Green
    Write-Host "   Generated $($quizResponse.quiz.questions.Count) questions" -ForegroundColor Gray
} catch {
    Write-Host "❌ Quiz Generation Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 8: Session Stats
Write-Host "`n8. Testing Session Statistics..." -ForegroundColor Cyan
try {
    $statsResponse = Invoke-RestMethod -Uri "$baseUrl/api/chat/session/$sessionId/stats" -Method Get
    Write-Host "✅ Session Stats Retrieved" -ForegroundColor Green
    Write-Host "   Documents: $($statsResponse.stats.documentCount)" -ForegroundColor Gray
    Write-Host "   Chunks: $($statsResponse.stats.chunkCount)" -ForegroundColor Gray
} catch {
    Write-Host "❌ Session Stats Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Cleanup
Write-Host "`n🧹 Cleaning up test files..." -ForegroundColor Yellow
if (Test-Path $testFile) {
    Remove-Item $testFile -Force
    Write-Host "   Removed test file" -ForegroundColor Gray
}

Write-Host "`n=== Testing Complete! ===" -ForegroundColor Green
Write-Host "Session ID used: $sessionId" -ForegroundColor Yellow