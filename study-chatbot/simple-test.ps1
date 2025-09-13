# Simple Backend Test - File Upload and Q&A

# Test file upload using System.Net.Http
Add-Type -AssemblyName System.Net.Http

$sessionId = "test-session-simple"
$baseUrl = "http://localhost:5000"

Write-Host "Testing Study Chatbot Backend..." -ForegroundColor Green

# Create test content
$testContent = @"
Introduction to Machine Learning

Machine Learning (ML) is a subset of artificial intelligence (AI) that provides systems the ability to automatically learn and improve from experience without being explicitly programmed.

Key Concepts:
1. Supervised Learning - Learning with labeled data
2. Unsupervised Learning - Finding patterns in unlabeled data  
3. Reinforcement Learning - Learning through rewards and penalties

Applications:
- Image recognition
- Natural language processing
- Recommendation systems
- Fraud detection

Algorithms:
- Linear Regression
- Decision Trees
- Neural Networks
- Support Vector Machines
"@

# Save test file
$testFile = "test-ml.txt"
$testContent | Out-File -FilePath $testFile -Encoding UTF8

Write-Host "Created test file: $testFile" -ForegroundColor Yellow

# Test file upload using .NET HttpClient
try {
    $httpClient = New-Object System.Net.Http.HttpClient
    $form = New-Object System.Net.Http.MultipartFormDataContent
    
    # Add file
    $fileStream = [System.IO.File]::OpenRead((Resolve-Path $testFile).Path)
    $fileContent = New-Object System.Net.Http.StreamContent($fileStream)
    $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("text/plain")
    $form.Add($fileContent, "pdfs", $testFile)
    
    # Add session ID
    $sessionContent = New-Object System.Net.Http.StringContent($sessionId)
    $form.Add($sessionContent, "sessionId")
    
    # Add document name
    $nameContent = New-Object System.Net.Http.StringContent("Machine Learning Basics")
    $form.Add($nameContent, "documentName")
    
    Write-Host "Uploading file..." -ForegroundColor Cyan
    $uploadResponse = $httpClient.PostAsync("$baseUrl/api/upload/pdf", $form).Result
    $uploadResult = $uploadResponse.Content.ReadAsStringAsync().Result
    
    $fileStream.Close()
    $httpClient.Dispose()
    
    if ($uploadResponse.IsSuccessStatusCode) {
        Write-Host "✅ File uploaded successfully!" -ForegroundColor Green
        Write-Host "$uploadResult" -ForegroundColor Gray
        
        # Now test Q&A
        Write-Host "`nTesting Q&A..." -ForegroundColor Cyan
        $questionBody = @{
            question = "What is machine learning?"
            sessionId = $sessionId
        } | ConvertTo-Json
        
        $qaResponse = Invoke-RestMethod -Uri "$baseUrl/api/chat/ask" -Method Post -Body $questionBody -ContentType "application/json"
        Write-Host "✅ Q&A successful!" -ForegroundColor Green
        Write-Host "Question: What is machine learning?" -ForegroundColor Yellow
        Write-Host "Answer: $($qaResponse.answer)" -ForegroundColor White
        
    } else {
        Write-Host "❌ Upload failed: $($uploadResponse.StatusCode)" -ForegroundColor Red
        Write-Host "$uploadResult" -ForegroundColor Red
    }
    
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    # Cleanup
    if (Test-Path $testFile) {
        Remove-Item $testFile -Force
    }
}

Write-Host "`nTest completed!" -ForegroundColor Green