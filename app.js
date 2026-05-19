// Global State
let allData = {};
let currentQuiz = [];
let currentIndex = 0;
let userStats = JSON.parse(localStorage.getItem('phs_user_stats_2026') || '{}');
let timer = null;
let secondsLeft = 2700; // 45 minutes
let isMockMode = true;
let currentSubjectId = "";

// Helper: Clean Markdown
function clean(text) {
    if (!text) return "";
    return text.replace(/^>\s*/gm, '').replace(/\*\*/g, '').trim();
}

// Initialization
async function init() {
    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js');
    }

    try {
        const response = await fetch('data/questions.json');
        allData = await response.json();
        renderDashboard();
    } catch (e) {
        console.error("Data load failed:", e);
        alert("題庫載入失敗，請檢查網路或檔案路徑。");
    }
}

function renderDashboard() {
    const list = document.getElementById('subject-list');
    list.innerHTML = '';
    
    Object.keys(allData).forEach(id => {
        const s = allData[id];
        const mistakeCount = getMistakeCount(id);
        const card = document.createElement('div');
        card.className = 'subject-group';
        card.innerHTML = `
            <div class="subject-title">${s.title.replace('歷年(110-114) ', '')}</div>
            <div class="btn-group">
                <button class="main-btn btn-mock" onclick="startQuiz('${id}', true)">
                    <span>模擬考</span>
                    <small style="font-size:0.7rem; opacity:0.9">40題 / 45分</small>
                </button>
                <button class="main-btn btn-review" onclick="startQuiz('${id}', false)">
                    <span>錯題重測</span>
                    <span class="count">${mistakeCount} 題</span>
                </button>
            </div>
        `;
        list.appendChild(card);
    });
}

function getMistakeCount(subjectId) {
    return Object.values(userStats).filter(q => q.subjectId === subjectId && q.wrong_count > 0).length;
}

// Weighted Sampling Logic
function startQuiz(subjectId, mock) {
    currentSubjectId = subjectId;
    isMockMode = mock;
    const subject = allData[subjectId];
    const pool = subject.questions;
    
    if (!mock) {
        // Review Mode: Filter only mistakes
        currentQuiz = pool.filter(q => userStats[q.id] && userStats[q.id].wrong_count > 0);
        if (currentQuiz.length === 0) {
            alert("目前沒有錯題紀錄！");
            return;
        }
        currentQuiz = currentQuiz.sort(() => 0.5 - Math.random());
    } else {
        // Mock Mode: Weighted Sampling
        currentQuiz = weightedSample(pool, 40);
    }

    setupQuizUI();
}

function weightedSample(pool, count) {
    const weightedPool = [];
    pool.forEach(q => {
        const stats = userStats[q.id];
        let weight = 1; // Default
        if (!stats) weight = 1;
        else if (stats.wrong_count === 1) weight = 3;
        else if (stats.wrong_count >= 2) weight = 5;
        else if (stats.wrong_count === 0 && stats.correct_count > 0) weight = 0.2;

        // Add to weighted pool
        const entry = { q, weight };
        weightedPool.push(entry);
    });

    // Shuffle and pick
    const sampled = [];
    const tempPool = [...weightedPool];
    
    const limit = Math.min(count, pool.length);
    for (let i = 0; i < limit; i++) {
        const totalWeight = tempPool.reduce((sum, item) => sum + item.weight, 0);
        let random = Math.random() * totalWeight;
        
        for (let j = 0; j < tempPool.length; j++) {
            random -= tempPool[j].weight;
            if (random <= 0) {
                sampled.push(tempPool[j].q);
                tempPool.splice(j, 1); // Remove to avoid duplicates
                break;
            }
        }
    }
    return sampled;
}

function setupQuizUI() {
    currentIndex = 0;
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('quiz-view').classList.remove('hidden');
    document.getElementById('action-bar').classList.toggle('hidden', isMockMode);

    if (isMockMode) {
        startTimer();
        document.getElementById('timer').classList.remove('hidden');
    } else {
        document.getElementById('timer').classList.add('hidden');
    }

    showQuestion();
}

function startTimer() {
    secondsLeft = 2700;
    const timerEl = document.getElementById('timer');
    clearInterval(timer);
    timer = setInterval(() => {
        secondsLeft--;
        const m = Math.floor(secondsLeft / 60);
        const s = secondsLeft % 60;
        timerEl.innerText = `${m}:${s.toString().padStart(2, '0')}`;
        if (secondsLeft < 300) timerEl.classList.add('urgent');
        if (secondsLeft <= 0) {
            clearInterval(timer);
            submitQuiz();
        }
    }, 1000);
}

function showQuestion() {
    const q = currentQuiz[currentIndex];
    const container = document.getElementById('question-container');
    
    // Progress
    const progress = ((currentIndex + 1) / currentQuiz.length) * 100;
    document.getElementById('progress-bar').style.width = `${progress}%`;
    document.getElementById('progress-text').innerText = `${currentIndex + 1} / ${currentQuiz.length}`;

    container.innerHTML = `
        <div class="q-card">
            <div class="q-meta">${q.category}</div>
            <div class="q-text">${q.question}</div>
            <div class="options-list">
                ${Object.entries(q.options).map(([key, text]) => `
                    <button class="opt-btn ${q.userAnswer === key ? 'selected' : ''}" 
                            id="opt-${key}"
                            onclick="handleSelect('${key}')">
                        <span class="opt-label">(${key})</span>
                        <span class="opt-text">${text}</span>
                    </button>
                `).join('')}
            </div>
            <div id="feedback" class="feedback-area ${(!isMockMode && q.answered) ? '' : 'hidden'}">
                <div class="hint-box"><strong>💡 一句話判斷：</strong><br>${clean(q.hint)}</div>
                <div class="expl-box"><strong>📋 專業解析：</strong><br>${clean(q.explanation)}</div>
            </div>
        </div>
    `;

    // Footer
    document.getElementById('btn-prev').style.visibility = currentIndex === 0 ? 'hidden' : 'visible';
    const isLast = currentIndex === currentQuiz.length - 1;
    document.getElementById('btn-next').classList.toggle('hidden', isLast);
    document.getElementById('btn-submit').classList.toggle('hidden', !isLast);
}

window.handleSelect = function(key) {
    const q = currentQuiz[currentIndex];
    if (!isMockMode && q.answered) return;

    q.userAnswer = key;

    if (isMockMode) {
        // Just select in Mock Mode
        document.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('selected'));
        document.getElementById(`opt-${key}`).classList.add('selected');
    } else {
        // Immediate Feedback in Review Mode
        q.answered = true;
        const isCorrect = key === q.answer;
        updateStats(q.id, isCorrect);
        showQuestion(); // Refresh to show colors and feedback
        
        // Color coding for Review Mode
        setTimeout(() => {
            const btns = document.querySelectorAll('.opt-btn');
            btns.forEach(btn => {
                const label = btn.querySelector('.opt-label').innerText.replace('(','').replace(')','');
                if (label === q.answer) btn.classList.add('correct');
                if (label === key && !isCorrect) btn.classList.add('wrong');
            });
        }, 10);
    }
};

function updateStats(questionId, isCorrect) {
    if (!userStats[questionId]) {
        userStats[questionId] = { wrong_count: 0, correct_count: 0, subjectId: currentSubjectId };
    }
    if (isCorrect) {
        userStats[questionId].correct_count++;
        if (userStats[questionId].wrong_count > 0) userStats[questionId].wrong_count--;
    } else {
        userStats[questionId].wrong_count++;
    }
    localStorage.setItem('phs_user_stats_2026', JSON.stringify(userStats));
}

function submitQuiz() {
    clearInterval(timer);
    let score = 0;
    const wrongQuestions = [];

    currentQuiz.forEach(q => {
        const isCorrect = q.userAnswer === q.answer;
        if (isCorrect) score++;
        else wrongQuestions.push(q);
        
        if (isMockMode) updateStats(q.id, isCorrect);
    });

    document.getElementById('quiz-view').classList.add('hidden');
    document.getElementById('result-view').classList.remove('hidden');
    document.getElementById('score-num').innerText = score;
    document.getElementById('score-total').innerText = `/ ${currentQuiz.length}`;

    // Render Review List
    const reviewList = document.getElementById('review-list');
    reviewList.innerHTML = '';
    
    if (wrongQuestions.length === 0) {
        reviewList.innerHTML = '<div style="text-align:center; padding:20px;">太棒了！全對！</div>';
    } else {
        wrongQuestions.forEach(q => {
            const item = document.createElement('div');
            item.className = 'review-item';
            item.innerHTML = `
                <div class="q-meta">${q.category}</div>
                <div style="font-weight:bold; margin-bottom:10px;">${q.question}</div>
                <div style="color:var(--error-color)">您的答案：(${q.userAnswer || '未答'})</div>
                <div style="color:var(--success-color)">正確答案：(${q.answer})</div>
                <div class="feedback-area">
                    <div class="hint-box"><strong>💡 一句話判斷：</strong><br>${clean(q.hint)}</div>
                    <div class="expl-box">${clean(q.explanation)}</div>
                </div>
            `;
            reviewList.appendChild(item);
        });
    }
}

// Event Listeners
document.getElementById('btn-prev').onclick = () => { if(currentIndex > 0) { currentIndex--; showQuestion(); } };
document.getElementById('btn-next').onclick = () => { if(currentIndex < currentQuiz.length - 1) { currentIndex++; showQuestion(); } };
document.getElementById('btn-submit').onclick = () => { if(confirm("確定要交卷嗎？")) submitQuiz(); };
document.getElementById('btn-exit').onclick = () => { if(confirm("確定要離開測驗嗎？進度將不會儲存。")) location.reload(); };

document.getElementById('btn-clear-mistakes').onclick = () => {
    if (confirm("確定要清空本科所有的錯題紀錄嗎？此動作無法復原。")) {
        Object.keys(userStats).forEach(id => {
            if (userStats[id].subjectId === currentSubjectId) {
                userStats[id].wrong_count = 0;
            }
        });
        localStorage.setItem('phs_user_stats_2026', JSON.stringify(userStats));
        alert("已清空！");
        location.reload();
    }
};

init();
