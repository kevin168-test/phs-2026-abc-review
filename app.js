let allQuestions = {};
let currentQuiz = [];
let currentIndex = 0;
let score = 0;
let isMockMode = false;
let timerInterval = null;
let timeLeft = 0;
let wrongAnswers = JSON.parse(localStorage.getItem('phs_wrong_answers') || '{}');
let recentIds = JSON.parse(localStorage.getItem('phs_recent_ids') || '[]');

// Helper to clean Markdown characters
function cleanText(text) {
    if (!text) return "";
    return text.replace(/^>\s*/gm, '')
               .replace(/^\s*[\*\-]\s*/gm, '')
               .replace(/\*\*/g, '')
               .trim();
}

// Initialize
async function init() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js');
    }
    
    try {
        const response = await fetch('data/questions.dat');
        const base64 = await response.text();
        const jsonStr = new TextDecoder().decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
        allQuestions = JSON.parse(jsonStr);
        setupEventListeners();
        renderDashboard();
        updateMistakeCount();
    } catch (error) {
        console.error("Failed to load questions:", error);
        // Fallback to JSON if dat fails during development
        try {
            const resp = await fetch('data/questions.json');
            allQuestions = await resp.json();
            setupEventListeners();
            renderDashboard();
            updateMistakeCount();
        } catch(e) {}
    }
}

function setupEventListeners() {
    document.getElementById('tab-normal').onclick = () => switchMode(false);
    document.getElementById('tab-mock').onclick = () => switchMode(true);
    document.getElementById('btn-review-mistakes').onclick = startMistakeQuiz;
    document.getElementById('btn-full-mock').onclick = () => startQuiz(null, true);
}

function switchMode(mock) {
    isMockMode = mock;
    document.getElementById('tab-normal').classList.toggle('active', !mock);
    document.getElementById('tab-mock').classList.toggle('active', mock);
    document.getElementById('mode-desc').innerText = mock ? '模式：40 分鐘 / 40 題 (限時考驗)' : '模式：不限時 / 20 題 (即時解析)';
    document.getElementById('btn-full-mock').classList.toggle('hidden', !mock);
    renderDashboard();
}

function updateMistakeCount() {
    const totalMistakes = Object.values(wrongAnswers).reduce((sum, list) => sum + list.length, 0);
    const badge = document.getElementById('mistake-count');
    if (badge) badge.innerText = totalMistakes;
}

function renderDashboard() {
    const list = document.getElementById('subject-list');
    if (!list) return;
    list.innerHTML = '';
    
    Object.keys(allQuestions).forEach(fileId => {
        const subject = allQuestions[fileId];
        const card = document.createElement('div');
        card.className = `subject-card ${isMockMode ? 'mock' : ''}`;
        card.innerHTML = `
            <div class="title">${subject.title.replace('歷年(110-114) ', '')}</div>
            <div class="stats">共 ${subject.questions.length} 題 | ${isMockMode ? '模擬 40 題' : '練習 20 題'}</div>
        `;
        card.onclick = () => startQuiz(fileId, isMockMode);
        list.appendChild(card);
    });
}

// Sampling Logic: Weighted Random + Recent Filter
function startQuiz(fileId, mock = false) {
    isMockMode = mock;
    const targetSize = isMockMode ? 40 : 20;
    let sampled = [];

    if (fileId === null) {
        // Full Comprehensive Mock
        const totalQuestionsAll = Object.values(allQuestions).reduce((sum, s) => sum + s.questions.length, 0);
        Object.keys(allQuestions).forEach(fId => {
            const subject = allQuestions[fId];
            let subTarget = Math.round((subject.questions.length / totalQuestionsAll) * targetSize);
            sampled = sampled.concat(drawFromPool(subject.questions, subTarget));
        });
    } else {
        // Specific Subject (Normal or Mock)
        const subject = allQuestions[fileId];
        subject.categories.forEach(cat => {
            const catQuestions = subject.questions.filter(q => q.category === cat.name);
            const totalInCat = cat.end - cat.start + 1;
            let count = Math.round((totalInCat / subject.questions.length) * targetSize);
            if (count < 1 && totalInCat > 0) count = 1;
            sampled = sampled.concat(drawFromPool(catQuestions, count));
        });
    }

    // Shuffle and trim to exact size
    sampled = sampled.sort(() => 0.5 - Math.random());
    if (sampled.length > targetSize) {
        sampled = sampled.slice(0, targetSize);
    } else if (sampled.length < targetSize) {
        const pool = fileId ? allQuestions[fileId].questions : Object.values(allQuestions).flatMap(s => s.questions);
        const remaining = pool.filter(q => !sampled.find(s => s.id === q.id));
        sampled = sampled.concat(drawFromPool(remaining, targetSize - sampled.length));
    }

    currentQuiz = sampled.sort(() => 0.5 - Math.random());
    
    if (isMockMode) {
        startTimer(40 * 60);
    } else {
        document.getElementById('quiz-timer').classList.add('hidden');
    }
    
    setupQuizView();
}

function drawFromPool(pool, count) {
    let shuffled = pool.sort(() => 0.5 - Math.random());
    let selected = [];
    // First pass: avoid recent
    for (let q of shuffled) {
        if (selected.length >= count) break;
        if (!recentIds.includes(q.id)) selected.push(q);
    }
    // Second pass: if not enough, pick anything
    if (selected.length < count) {
        for (let q of shuffled) {
            if (selected.length >= count) break;
            if (!selected.includes(q)) selected.push(q);
        }
    }
    return selected;
}

function startTimer(seconds) {
    timeLeft = seconds;
    const timerEl = document.getElementById('quiz-timer');
    timerEl.classList.remove('hidden');
    timerEl.classList.remove('warning');
    timerEl.classList.remove('danger');
    
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        timeLeft--;
        const mins = Math.floor(timeLeft / 60);
        const secs = timeLeft % 60;
        timerEl.innerText = `${mins}:${secs.toString().padStart(2, '0')}`;
        
        if (timeLeft <= 600) timerEl.classList.add('warning');
        if (timeLeft <= 300) timerEl.classList.add('danger');
        
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            alert("時間到！強制交卷。");
            finishQuiz();
        }
    }, 1000);
}

function startMistakeQuiz() {
    let allMistakes = [];
    Object.keys(wrongAnswers).forEach(fileId => {
        const subject = allQuestions[fileId];
        if (!subject) return;
        const mistakeIds = wrongAnswers[fileId];
        const qs = subject.questions.filter(q => mistakeIds.includes(q.id));
        allMistakes = allMistakes.concat(qs);
    });

    if (allMistakes.length === 0) {
        alert("目前沒有錯題紀錄！");
        return;
    }

    isMockMode = false;
    currentQuiz = allMistakes.sort(() => 0.5 - Math.random()).slice(0, 20);
    document.getElementById('quiz-timer').classList.add('hidden');
    setupQuizView();
}

function setupQuizView() {
    currentIndex = 0;
    score = 0;
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('result-view').classList.add('hidden');
    document.getElementById('quiz-view').classList.remove('hidden');
    showQuestion();
}

function showQuestion() {
    const q = currentQuiz[currentIndex];
    const container = document.getElementById('question-container');
    
    const progress = ((currentIndex + 1) / currentQuiz.length) * 100;
    document.getElementById('progress-bar').style.width = `${progress}%`;
    document.getElementById('progress-text').innerText = `${currentIndex + 1} / ${currentQuiz.length}`;

    container.innerHTML = `
        <div class="q-card">
            <div class="q-category">${q.category}</div>
            <div class="q-text">${q.question}</div>
            <div class="options-list">
                ${Object.entries(q.options).map(([key, text]) => `
                    <button class="opt-btn ${q.userAnswer === key ? 'selected' : ''}" onclick="selectOption('${key}')">
                        <span class="opt-label">(${key})</span>
                        <span class="opt-text">${text}</span>
                    </button>
                `).join('')}
            </div>
            <div id="feedback" class="feedback-area hidden">
                <div class="hint-box">
                    <strong>💡 一句話判斷：</strong><br>${cleanText(q.hint)}
                </div>
                <div class="expl-box">
                    <strong>📋 專業解析：</strong><br>
                    <div style="white-space: pre-wrap; margin-top:10px">${cleanText(q.explanation)}</div>
                </div>
            </div>
        </div>
    `;

    updateNavButtons();
}

function updateNavButtons() {
    const nextBtn = document.getElementById('btn-next-question');
    const finishBtn = document.getElementById('btn-finish-quiz');
    
    if (isMockMode) {
        nextBtn.innerText = "下一題";
        nextBtn.classList.toggle('hidden', currentIndex >= currentQuiz.length - 1);
        finishBtn.classList.toggle('hidden', currentIndex < currentQuiz.length - 1);
    } else {
        // Normal mode uses immediate feedback, shown after checkAnswer
        nextBtn.classList.add('hidden');
        finishBtn.classList.add('hidden');
        if (currentQuiz[currentIndex].answered) {
            showFeedback();
        }
    }
}

window.selectOption = function(choice) {
    if (isMockMode) {
        currentQuiz[currentIndex].userAnswer = choice;
        document.querySelectorAll('.opt-btn').forEach(btn => {
            const label = btn.querySelector('.opt-label').innerText.replace('(', '').replace(')', '');
            btn.classList.toggle('selected', label === choice);
        });
    } else {
        if (currentQuiz[currentIndex].answered) return;
        checkAnswer(choice);
    }
};

function checkAnswer(choice) {
    const q = currentQuiz[currentIndex];
    q.answered = true;
    q.userAnswer = choice;
    
    let correct = q.answer;
    if (correct === '#') correct = choice;

    if (choice === correct) {
        score++;
    } else {
        addToMistakes(q);
    }
    
    showFeedback();
}

function showFeedback() {
    const q = currentQuiz[currentIndex];
    const btns = document.querySelectorAll('.opt-btn');
    const feedback = document.getElementById('feedback');
    
    let correct = q.answer;
    if (correct === '#') correct = q.userAnswer;

    btns.forEach(btn => {
        btn.disabled = true;
        const label = btn.querySelector('.opt-label').innerText.replace('(', '').replace(')', '');
        if (label === correct) btn.classList.add('correct');
        if (label === q.userAnswer && q.userAnswer !== correct) btn.classList.add('wrong');
    });

    feedback.classList.remove('hidden');
    
    if (currentIndex < currentQuiz.length - 1) {
        document.getElementById('btn-next-question').classList.remove('hidden');
    } else {
        document.getElementById('btn-finish-quiz').classList.remove('hidden');
    }
}

function finishQuiz() {
    clearInterval(timerInterval);
    
    if (isMockMode) {
        score = 0;
        currentQuiz.forEach(q => {
            let correct = q.answer;
            if (correct === '#') correct = q.userAnswer;
            if (q.userAnswer === correct) {
                score++;
            } else if (q.userAnswer) {
                addToMistakes(q);
            }
        });
    }

    // Update recent IDs
    const newIds = currentQuiz.map(q => q.id);
    recentIds = [...new Set([...newIds, ...recentIds])].slice(0, 200);
    localStorage.setItem('phs_recent_ids', JSON.stringify(recentIds));

    document.getElementById('quiz-view').classList.add('hidden');
    document.getElementById('result-view').classList.remove('hidden');
    document.getElementById('correct-count').innerText = score;
    document.getElementById('total-count').innerText = currentQuiz.length;
    
    // Render summary for Mock Mode
    if (isMockMode) {
        renderMockSummary();
    }
}

function renderMockSummary() {
    const summary = document.getElementById('result-summary');
    summary.innerHTML = '<h3>題目檢討</h3>';
    currentQuiz.forEach((q, idx) => {
        const isCorrect = q.userAnswer === (q.answer === '#' ? q.userAnswer : q.answer);
        const item = document.createElement('div');
        item.className = `summary-item ${isCorrect ? 'correct' : 'wrong'}`;
        item.innerHTML = `
            <div><strong>第 ${idx + 1} 題：${isCorrect ? '✅' : '❌'}</strong></div>
            <div style="font-size:0.9rem; color:#666">${q.question.substring(0, 50)}...</div>
        `;
        summary.appendChild(item);
    });
}

function addToMistakes(q) {
    const parts = q.id.split('_');
    const fileId = parts.slice(0, -1).join('_');
    
    if (!wrongAnswers[fileId]) wrongAnswers[fileId] = [];
    if (!wrongAnswers[fileId].includes(q.id)) {
        wrongAnswers[fileId].push(q.id);
        localStorage.setItem('phs_wrong_answers', JSON.stringify(wrongAnswers));
        updateMistakeCount();
    }
}

document.getElementById('btn-next-question').onclick = () => {
    currentIndex++;
    showQuestion();
};

document.getElementById('btn-finish-quiz').onclick = finishQuiz;

document.getElementById('btn-exit-quiz').onclick = () => {
    if (confirm("確定要離開本次測驗嗎？進度將不會儲存。")) {
        location.reload();
    }
};

init();
