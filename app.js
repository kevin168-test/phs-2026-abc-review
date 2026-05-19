/* global Dexie */
const db = new Dexie('PHS_Review_V2');
db.version(1).stores({
    questions: 'id, subject, category',
    stats: 'id, subject, wrong_count, last_tested'
});

let currentQuestions = [];
let currentIndex = 0;
let timer = null;
let secondsLeft = 2400; // 40 mins
let isMockMode = true;

// Initialize
async function init() {
    try {
        if (!window.Dexie) {
            throw new Error("找不到 Dexie.js，請確認 lib/dexie.min.js 是否有上傳成功。");
        }
        
        const hasData = await db.questions.count();
        if (hasData === 0) {
            await loadDataIntoDB();
        }
        renderDashboard();
        updateGlobalStats();
        hideLoader();
    } catch (e) {
        console.error('Init failed:', e);
        document.getElementById('loader').innerHTML = `
            <div style="color: red; padding: 20px; text-align: center;">
                <h3>初始化失敗</h3>
                <p>${e.message}</p>
                <button onclick="location.reload()" style="padding: 10px 20px; margin-top: 10px;">重新整理</button>
            </div>
        `;
    }
}

async function loadDataIntoDB() {
    try {
        const resp = await fetch('./data/questions.dat');
        if (!resp.ok) {
            throw new Error(`無法讀取題庫檔案 (HTTP ${resp.status})，請確認 data/questions.dat 是否有上傳。`);
        }
        const base64 = await resp.text();
        // Decode base64 with UTF-8 support
        const jsonStr = new TextDecoder().decode(Uint8Array.from(atob(base64.trim()), c => c.charCodeAt(0)));
        const data = JSON.parse(jsonStr);
        
        await db.questions.bulkAdd(data.questions);
        localStorage.setItem('subjects', JSON.stringify(data.subjects));
    } catch (e) {
        throw new Error("解析題庫失敗：" + e.message);
    }
}

function hideLoader() {
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
}

async function renderDashboard() {
    const subjects = JSON.parse(localStorage.getItem('subjects') || '[]');
    const list = document.getElementById('subject-list');
    list.innerHTML = '';

    subjects.forEach(s => {
        const card = document.createElement('div');
        card.className = 'subject-card mock';
        card.innerHTML = `
            <div class="title">${s.title}</div>
            <div class="count">${s.count} 題庫 | 40題模擬</div>
        `;
        card.onclick = () => startQuiz(s.title);
        list.appendChild(card);
    });

    document.getElementById('btn-review-mistakes').onclick = startMistakeQuiz;
}

async function updateGlobalStats() {
    const wrongCount = await db.stats.where('wrong_count').above(0).count();
    document.getElementById('mistake-count').innerText = wrongCount;
}

// Sampling Logic: Weighted Random
async function startQuiz(subjectTitle) {
    isMockMode = true;
    const pool = await db.questions.where('subject').equals(subjectTitle).toArray();
    
    // Get user stats for weighting
    const stats = await db.stats.where('subject').equals(subjectTitle).toArray();
    const statsMap = new Map(stats.map(s => [s.id, s.wrong_count]));

    // Weighted selection (Mock)
    let weightedPool = [];
    pool.forEach(q => {
        const wc = statsMap.get(q.id) || 0;
        let weight = 1;
        if (wc === 1) weight = 3;
        if (wc >= 2) weight = 5;
        for (let i = 0; i < weight; i++) weightedPool.push(q);
    });

    // Shuffle and pick 40
    currentQuestions = weightedPool.sort(() => 0.5 - Math.random())
                                  .filter((v, i, a) => a.findIndex(t => t.id === v.id) === i) // Unique
                                  .slice(0, 40);

    // If not enough unique, fill with random from pool
    if (currentQuestions.length < 40) {
        const remaining = pool.filter(q => !currentQuestions.find(cq => cq.id === q.id));
        currentQuestions = currentQuestions.concat(remaining.sort(() => 0.5 - Math.random()).slice(0, 40 - currentQuestions.length));
    }

    currentIndex = 0;
    startTimer();
    showQuizView();
}

async function startMistakeQuiz() {
    isMockMode = false;
    const mistakes = await db.stats.where('wrong_count').above(0).toArray();
    if (mistakes.length === 0) {
        alert('目前沒有錯題紀錄！');
        return;
    }

    const ids = mistakes.map(m => m.id);
    const pool = await db.questions.where('id').anyOf(ids).toArray();
    
    currentQuestions = pool.sort(() => 0.5 - Math.random()).slice(0, 40);
    currentIndex = 0;
    document.getElementById('quiz-timer').classList.add('hidden');
    showQuizView();
}

function showQuizView() {
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('quiz-view').classList.remove('hidden');
    showQuestion();
}

function showQuestion() {
    const q = currentQuestions[currentIndex];
    const container = document.getElementById('question-container');
    
    // Progress
    const progress = ((currentIndex + 1) / currentQuestions.length) * 100;
    document.getElementById('progress-bar').style.width = `${progress}%`;
    document.getElementById('progress-text').innerText = `${currentIndex + 1}/${currentQuestions.length}`;

    container.innerHTML = `
        <div class="q-card">
            <div class="q-meta">${q.subject} | ${q.category}</div>
            <div class="q-text">${q.question}</div>
            <div class="options-list">
                ${['A', 'B', 'C', 'D'].map(key => q.options[key] ? `
                    <button class="opt-btn ${q.userAnswer === key ? 'selected' : ''}" onclick="selectOption('${key}')">
                        <strong>(${key})</strong> ${q.options[key]}
                    </button>
                ` : '').join('')}
            </div>
            <div id="feedback" class="feedback-area ${(!isMockMode && q.answered) ? '' : 'hidden'}">
                <div class="hint-box"><strong>💡 一句話判斷：</strong><br>${q.hint}</div>
                <div class="expl-box"><strong>📋 專業解析：</strong><br>${q.explanation}</div>
            </div>
        </div>
    `;

    // Footer buttons
    document.getElementById('btn-prev-question').style.visibility = currentIndex === 0 ? 'hidden' : 'visible';
    document.getElementById('btn-next-question').classList.toggle('hidden', currentIndex === currentQuestions.length - 1);
    document.getElementById('btn-submit-quiz').classList.toggle('hidden', currentIndex !== currentQuestions.length - 1);
}

window.selectOption = async function(key) {
    const q = currentQuestions[currentIndex];
    q.userAnswer = key;

    if (isMockMode) {
        // Just highlight in Mock Mode
        document.querySelectorAll('.opt-btn').forEach(btn => {
            btn.classList.toggle('selected', btn.innerText.includes(`(${key})`));
        });
    } else {
        // Immediate feedback in Review Mode
        if (q.answered) return;
        q.answered = true;
        const isCorrect = key === q.answer;
        
        // Update stats
        const stat = await db.stats.get(q.id) || { id: q.id, subject: q.subject, wrong_count: 0 };
        if (!isCorrect) stat.wrong_count++;
        else if (stat.wrong_count > 0) stat.wrong_count--;
        stat.last_tested = Date.now();
        await db.stats.put(stat);

        showQuestion(); // Re-render to show feedback
    }
};

function startTimer() {
    secondsLeft = 2400;
    const timerEl = document.getElementById('quiz-timer');
    timerEl.classList.remove('hidden');
    clearInterval(timer);
    
    timer = setInterval(() => {
        secondsLeft--;
        const mins = Math.floor(secondsLeft / 60);
        const secs = secondsLeft % 60;
        timerEl.innerText = `${mins}:${secs.toString().padStart(2, '0')}`;
        
        if (secondsLeft < 300) timerEl.classList.add('urgent');
        if (secondsLeft <= 0) {
            clearInterval(timer);
            alert('時間到！自動提交。');
            submitQuiz();
        }
    }, 1000);
}

async function submitQuiz() {
    clearInterval(timer);
    document.getElementById('quiz-view').classList.add('hidden');
    document.getElementById('result-view').classList.remove('hidden');

    let correctCount = 0;
    const resultsContainer = document.getElementById('result-list');
    resultsContainer.innerHTML = '';

    for (let i = 0; i < currentQuestions.length; i++) {
        const q = currentQuestions[i];
        const isCorrect = q.userAnswer === q.answer;
        if (isCorrect) correctCount++;
        
        // Update Stats in DB
        const stat = await db.stats.get(q.id) || { id: q.id, subject: q.subject, wrong_count: 0 };
        if (!isCorrect && q.userAnswer) stat.wrong_count++;
        stat.last_tested = Date.now();
        await db.stats.put(stat);

        // Render result item
        const item = document.createElement('div');
        item.className = `result-item ${isCorrect ? 'correct' : 'wrong'}`;
        item.innerHTML = `
            <span>${i + 1}.</span>
            <div style="flex:1">${q.question.substring(0, 30)}...</div>
            <span>${isCorrect ? '✅' : '❌'}</span>
        `;
        item.onclick = () => {
            isMockMode = false; // Switch to review mode for this viewing
            q.answered = true;
            currentIndex = i;
            showQuizView();
        };
        resultsContainer.appendChild(item);
    }

    document.getElementById('score-text').innerText = correctCount;
    const timeUsed = 2400 - secondsLeft;
    document.getElementById('result-time').innerText = `耗時：${Math.floor(timeUsed/60)}分${timeUsed%60}秒`;
    updateGlobalStats();
}

document.getElementById('btn-prev-question').onclick = () => { currentIndex--; showQuestion(); };
document.getElementById('btn-next-question').onclick = () => { currentIndex++; showQuestion(); };
document.getElementById('btn-submit-quiz').onclick = submitQuiz;
document.getElementById('btn-exit-quiz').onclick = () => { if(confirm('確定要離開嗎？進度將不會儲存。')) location.reload(); };

init();
