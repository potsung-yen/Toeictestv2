// ==========================================
// 全域變數與資料庫初始化 (含自動去重機制)
// ==========================================

// 🛡️ 自動去重函式：依據英文單字 (不分大小寫與前後空白) 過濾重複項目
function removeDuplicateWords(dataArray) {
    if (!Array.isArray(dataArray)) return [];
    const seen = new Set();
    return dataArray.filter(item => {
        if (!item || !item.english) return false;
        const cleanKey = item.english.trim().toLowerCase();
        if (seen.has(cleanKey)) {
            return false; // 已存在過，自動剔除
        }
        seen.add(cleanKey);
        return true; // 第一次出現，保留
    });
}

// 載入時自動執行去重
let rawWordList = typeof SpellingHeroData !== 'undefined' ? SpellingHeroData : [];
let wordList = removeDuplicateWords(rawWordList);

let currentPlayer = "冒險王";
let currentWord = {};

// 🎯 核心輪迴變數 (雙進度條與複測機制)
let currentRoundQueue = []; // 本回合要測試的單字陣列
let nextRoundQueue = [];    // 答錯後，被打入下一回合「複測」的單字陣列
let sessionTotalWords = 0;  // 這次測驗的總單字數
let masteredWords = 0;      // 已經「答對」的單字數 (用於計算總完成度)
let currentRoundIndex = 0;  // 本回合目前的題號
let roundNumber = 1;        // 回合數 (1=初測, 2=第1次複測, 以此類推)

// 玩家進度資料庫 (加入 testedWords 以記錄已測驗過的單字)
let playerData = { score: 0, errorCounts: {}, customGroups: {}, unknownWords: [], testedWords: [] }; 

document.addEventListener("DOMContentLoaded", () => {
    loadUserData();
    
    // 綁定輸入框的 Enter 鍵
    const englishInput = document.getElementById("englishInput");
    if (englishInput) {
        englishInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter" && document.getElementById("submitBtn").style.display !== "none") {
                checkAnswer();
            }
        });
    }
    
    // 綁定搜尋框的 Enter 鍵
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
        searchInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") searchWord();
        });
    }
});

// ==========================================
// 資料庫讀取與儲存 (LocalStorage)
// ==========================================
function loadUserData() {
    const nameInput = document.getElementById("playerName");
    if (nameInput) {
        currentPlayer = nameInput.value.trim() || "冒險王";
    }
    
    let data = localStorage.getItem(`SpHero_${currentPlayer}`);
    if (data) {
        playerData = JSON.parse(data);
        if (!playerData.errorCounts) playerData.errorCounts = {};
        if (!playerData.customGroups) playerData.customGroups = {};
        if (!playerData.unknownWords) playerData.unknownWords = [];
        if (!playerData.testedWords) playerData.testedWords = []; // 初始化已測驗清單
    } else {
        playerData = { score: 0, errorCounts: {}, customGroups: {}, unknownWords: [], testedWords: [] };
    }
    
    const scoreElem = document.getElementById("score");
    if (scoreElem) scoreElem.innerText = playerData.score;
    
    updateDashboardUI();
    updateGroupSelect();
    updateUnknownWordsUI(); 
}

function saveUserData() {
    localStorage.setItem(`SpHero_${currentPlayer}`, JSON.stringify(playerData));
}

// ==========================================
// 🆕 重置測驗進度
// ==========================================
function resetTestedWords() {
    if (confirm("⚠️ 確定要清除所有的「已測驗」進度嗎？\n(您的總分、錯誤次數與自訂群組都會保留)")) {
        playerData.testedWords = [];
        saveUserData();
        updateGroupSelect();
        alert("✅ 學習計畫進度已成功重置！");
    }
}

// ==========================================
// 系統自動分級與選單邏輯
// ==========================================
function getSystemLevel(errCount) {
    if (errCount >= 10) return "advanced";   
    if (errCount >= 3) return "intermediate"; 
    return "beginner";                       
}

function getSystemLevelName(level) {
    if (level === "advanced") return "🔴 高級 (錯 10次+)";
    if (level === "intermediate") return "🟡 中級 (錯 3-9次)";
    return "🟢 初級 (錯 0-2次)";
}

// 🆕 覆寫的 updateGroupSelect：支援學習計畫、每日隨機與情境分類
function updateGroupSelect() {
    const select = document.getElementById("groupSelect");
    const planSelect = document.getElementById("planSelect");
    if (!select) return;
    select.innerHTML = "";
    
    let plan = planSelect ? planSelect.value : "free";
    
    // 取得尚未被測驗過的單字
    let untestedWords = wordList.filter(w => !playerData.testedWords.includes(w.english.toLowerCase()));

    if (plan === "daily") {
        select.add(new Option(`🎲 每日隨機 40 題 (未測剩餘: ${untestedWords.length})`, "daily_40"));
        select.add(new Option(`🎲 每日隨機 20 題 (未測剩餘: ${untestedWords.length})`, "daily_20"));
        select.add(new Option(`🎲 每日隨機 10 題 (未測剩餘: ${untestedWords.length})`, "daily_10"));
        
    } else if (plan === "week" || plan === "month") {
        let days = plan === "week" ? 7 : 30;
        let chunkSize = Math.ceil(wordList.length / days);
        
        for(let i = 0; i < days; i++) {
            let start = i * chunkSize;
            let end = Math.min(start + chunkSize, wordList.length);
            if (start >= wordList.length) break;

            let chunkWords = wordList.slice(start, end);
            let chunkUntested = chunkWords.filter(w => !playerData.testedWords.includes(w.english.toLowerCase())).length;

            let label = plan === "week" ? `📅 第 ${i+1} 天任務` : `🗓️ 第 ${i+1} 天任務`;
            let status = chunkUntested === 0 ? "(✅已完成)" : `(剩餘 ${chunkUntested} 題未測)`;

            select.add(new Option(`${label} ${status}`, `chunk_${start}_${end}`));
        }
    } else {
        // 自由題庫模式
        let counts = { beginner: 0, intermediate: 0, advanced: 0 };
        wordList.forEach(w => {
            let errCount = playerData.errorCounts[w.english.toLowerCase()] || 0;
            counts[getSystemLevel(errCount)]++;
        });

        select.add(new Option(`📚 全部單字 (${wordList.length} 題)`, "all"));
        if (counts.beginner > 0) select.add(new Option(`${getSystemLevelName("beginner")} - ${counts.beginner}題`, "sys_beginner"));
        if (counts.intermediate > 0) select.add(new Option(`${getSystemLevelName("intermediate")} - ${counts.intermediate}題`, "sys_intermediate"));
        if (counts.advanced > 0) select.add(new Option(`${getSystemLevelName("advanced")} - ${counts.advanced}題`, "sys_advanced"));

        // 自訂群組
        Object.keys(playerData.customGroups).forEach(groupName => {
            let size = playerData.customGroups[groupName].length;
            if (size > 0) select.add(new Option(`📁 ${groupName} (${size} 題)`, `cust_${groupName}`));
        });

        // 動態抓取題庫中的「情境分類 (category)」
        let categorySet = new Set();
        wordList.forEach(w => {
            if (w.category) categorySet.add(w.category);
        });
        
        if (categorySet.size > 0) {
            categorySet.forEach(cat => {
                let catWords = wordList.filter(w => w.category === cat);
                let untestedCount = catWords.filter(w => !playerData.testedWords.includes(w.english.toLowerCase())).length;
                select.add(new Option(`🏢 情境：${cat} (剩 ${untestedCount} 題 / 共 ${catWords.length})`, `cat_${cat}`));
            });
        }
    }
}

// ==========================================
// 🗂️ 單字管理後台 (Dashboard) 邏輯
// ==========================================
function toggleDashboard() {
    const dash = document.getElementById("dashboardArea");
    if (!dash) return;
    dash.style.display = dash.style.display === "none" ? "block" : "none";
    if (dash.style.display === "block") updateDashboardUI();
}

function createCustomGroup() {
    const nameInput = document.getElementById("newGroupName");
    if (!nameInput) return;
    const groupName = nameInput.value.trim();
    if (!groupName) return alert("請輸入組別名稱！");
    if (playerData.customGroups[groupName]) return alert("這個組別已經存在囉！");

    playerData.customGroups[groupName] = [];
    saveUserData();
    nameInput.value = "";
    alert(`✅ 成功建立組別：${groupName}`);
    updateDashboardUI();
    updateGroupSelect();
}

function assignWordToGroup(wordEnglish, selectElement) {
    const groupName = selectElement.value;
    const wordKey = wordEnglish.toLowerCase();

    Object.keys(playerData.customGroups).forEach(g => {
        playerData.customGroups[g] = playerData.customGroups[g].filter(w => w !== wordKey);
    });

    if (groupName !== "none" && playerData.customGroups[groupName]) {
        playerData.customGroups[groupName].push(wordKey);
    }
    saveUserData();
    updateGroupSelect(); 
}

function updateDashboardUI() {
    const tbody = document.getElementById("wordTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const customGroupKeys = Object.keys(playerData.customGroups);
    let groupOptionsHTML = `<option value="none">-- 不加入 --</option>`;
    customGroupKeys.forEach(g => { groupOptionsHTML += `<option value="${g}">${g}</option>`; });

    wordList.forEach((w) => {
        let wordKey = w.english.toLowerCase();
        let errCount = playerData.errorCounts[wordKey] || 0;
        let sysLevel = getSystemLevel(errCount);
        let sysLevelName = getSystemLevelName(sysLevel);
        
        let currentGroup = "none";
        customGroupKeys.forEach(g => {
            if (playerData.customGroups[g].includes(wordKey)) currentGroup = g;
        });

        let tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid #dfe6e9";
        tr.innerHTML = `
            <td style="padding: 10px; font-weight:bold;">${w.english}<br><span style="font-size:12px; color:#636e72; font-weight:normal;">${w.chinese}</span></td>
            <td style="padding: 10px; color: ${errCount > 0 ? '#d63031' : '#2d3436'}; font-weight: bold;">${errCount} 次</td>
            <td style="padding: 10px;">${sysLevelName}</td>
            <td style="padding: 10px;"><select onchange="assignWordToGroup('${w.english}', this)" style="padding:5px; border-radius:5px;">${groupOptionsHTML}</select></td>
        `;
        tr.querySelector('select').value = currentGroup;
        tbody.appendChild(tr);
    });
}

// ==========================================
// 🚀 遊戲核心：測試與無限複測輪迴邏輯
// ==========================================
function startGame() {
    const groupSelect = document.getElementById("groupSelect");
    if (!groupSelect) return;
    const selectedGroup = groupSelect.value;
    let initialQueue = [];

    // 自由題庫
    if (selectedGroup === "all") {
        initialQueue = [...wordList];
    } else if (selectedGroup.startsWith("sys_")) {
        const targetLevel = selectedGroup.replace("sys_", "");
        initialQueue = wordList.filter(w => getSystemLevel(playerData.errorCounts[w.english.toLowerCase()] || 0) === targetLevel);
    } else if (selectedGroup.startsWith("cust_")) {
        const groupName = selectedGroup.replace("cust_", "");
        const wordsInGroup = playerData.customGroups[groupName] || [];
        initialQueue = wordList.filter(w => wordsInGroup.includes(w.english.toLowerCase()));
        
    // 每日隨機特訓
    } else if (selectedGroup.startsWith("daily_")) {
        let count = parseInt(selectedGroup.split("_")[1]);
        let untested = wordList.filter(w => !playerData.testedWords.includes(w.english.toLowerCase()));
        
        if (untested.length === 0) {
            alert("🎉 恭喜！您已經測驗完題庫所有的單字！請至管理後台重置進度以重新開始。");
            return;
        }
        initialQueue = untested.sort(() => Math.random() - 0.5).slice(0, count);
        
    // 一週/一個月情境分包
    } else if (selectedGroup.startsWith("chunk_")) {
        const parts = selectedGroup.split("_");
        const start = parseInt(parts[1]);
        const end = parseInt(parts[2]);
        
        let chunkWords = wordList.slice(start, end);
        initialQueue = chunkWords.filter(w => !playerData.testedWords.includes(w.english.toLowerCase()));

        if (initialQueue.length === 0) {
            alert("✅ 這個群組的單字您都已經測驗過囉！請選擇其他群組或前往後台重置進度。");
            return;
        }
        
    // 指定的情境分類測驗
    } else if (selectedGroup.startsWith("cat_")) {
        const catName = selectedGroup.replace("cat_", "");
        let catWords = wordList.filter(w => w.category === catName);
        initialQueue = catWords.filter(w => !playerData.testedWords.includes(w.english.toLowerCase()));

        if (initialQueue.length === 0) {
            alert(`✅ 「${catName}」情境的單字您都已經測驗過囉！請重置進度或選擇其他情境。`);
            return;
        }
    }

    if (initialQueue.length === 0) return alert("❌ 這個題庫目前沒有單字喔！");

    currentRoundQueue = [...initialQueue].sort(() => Math.random() - 0.5); 
    sessionTotalWords = currentRoundQueue.length;
    masteredWords = 0;
    nextRoundQueue = [];
    currentRoundIndex = 0;
    roundNumber = 1;
    
    document.getElementById("setupArea").style.display = "none";
    document.getElementById("dashboardArea").style.display = "none";
    document.getElementById("gameArea").style.display = "block";
    document.getElementById("progressArea").style.display = "block";
    
    nextQuestion();
}

function nextQuestion() {
    if (currentRoundIndex >= currentRoundQueue.length) {
        if (nextRoundQueue.length > 0) {
            roundNumber++;
            alert(`🔥 準備進入第 ${roundNumber - 1} 次複測！\n還有 ${nextRoundQueue.length} 個單字需要克服，加油！`);
            
            currentRoundQueue = [...nextRoundQueue].sort(() => Math.random() - 0.5); 
            nextRoundQueue = [];
            currentRoundIndex = 0;
        } else {
            alert(`🎉 恭喜！您已完美通關本組別的所有單字！\n總得分：${playerData.score}`);
            location.reload(); 
            return;
        }
    }

    currentWord = currentRoundQueue[currentRoundIndex];
    let modeElem = document.querySelector('input[name="gameMode"]:checked');
    let mode = modeElem ? modeElem.value : "spelling";
    
    document.getElementById("nextBtn").style.display = "none";
    document.getElementById("feedbackMsg").innerText = "";
    document.getElementById("chineseHint").innerText = currentWord.chinese;
    
    let overallPercent = (masteredWords / sessionTotalWords) * 100;
    document.getElementById("overallProgressBar").style.width = `${overallPercent}%`;
    document.getElementById("overallProgressText").innerText = `${masteredWords} / ${sessionTotalWords}`;

    let roundPercent = (currentRoundIndex / currentRoundQueue.length) * 100;
    document.getElementById("roundProgressBar").style.width = `${roundPercent}%`;
    document.getElementById("roundProgressText").innerText = `${currentRoundIndex + 1} / ${currentRoundQueue.length}`;
    document.getElementById("roundLabel").innerText = roundNumber === 1 ? "🔄 本回合進度 (初測)" : `🔄 本回合進度 (第 ${roundNumber - 1} 次複測)`;

    const sentenceHint = document.getElementById("sentenceHint");
    if (currentWord.sentence) {
        const cleanTarget = currentWord.english.replace(/^(a |an |the |to )/i, '').replace(/\([^)]*\)/g, '').trim();
        const regex = new RegExp(cleanTarget, 'gi');
        sentenceHint.innerText = currentWord.sentence.replace(regex, "________");
    } else {
        sentenceHint.innerText = "";
    }

    if (mode === "spelling") {
        document.getElementById("spellingArea").style.display = "flex";
        document.getElementById("choiceArea").style.display = "none";
        const englishInput = document.getElementById("englishInput");
        englishInput.disabled = false;
        englishInput.value = "";
        document.getElementById("submitBtn").style.display = "inline-block";
        englishInput.focus();
    } else {
        document.getElementById("spellingArea").style.display = "none";
        document.getElementById("choiceArea").style.display = "flex";
        renderChoiceOptions();
    }
}

function renderChoiceOptions() {
    const choiceArea = document.getElementById("choiceArea");
    choiceArea.innerHTML = "";
    let wrongOptions = wordList.filter(w => w.english.toLowerCase() !== currentWord.english.toLowerCase());
    wrongOptions.sort(() => Math.random() - 0.5);
    
    let options = [currentWord, ...wrongOptions.slice(0, 3)].sort(() => Math.random() - 0.5);
    options.forEach(opt => {
        let btn = document.createElement("button");
        btn.className = "option-btn";
        btn.innerText = opt.english;
        btn.onclick = () => checkChoiceAnswer(btn, opt.english);
        choiceArea.appendChild(btn);
    });
}

function checkAnswer() {
    const userInput = document.getElementById("englishInput").value.trim().toLowerCase();
    if (!userInput) return; 
    processResult(userInput, false);
}

function checkChoiceAnswer(clickedBtn, selectedWord) {
    const choiceArea = document.getElementById("choiceArea");
    choiceArea.querySelectorAll(".option-btn").forEach(b => b.disabled = true);
    
    if (selectedWord.toLowerCase() === currentWord.english.toLowerCase()) {
        clickedBtn.style.backgroundColor = "#00b894";
        clickedBtn.style.color = "white";
    } else {
        clickedBtn.style.backgroundColor = "#d63031";
        clickedBtn.style.color = "white";
        choiceArea.querySelectorAll(".option-btn").forEach(b => {
            if (b.innerText.toLowerCase() === currentWord.english.toLowerCase()) {
                b.style.backgroundColor = "#00b894";
                b.style.color = "white";
            }
        });
    }
    processResult(selectedWord, true);
}

function processResult(userInput, isChoiceMode) {
    const wordKey = currentWord.english.toLowerCase();
    let isCorrect = (userInput.toLowerCase() === wordKey);
    const feedback = document.getElementById("feedbackMsg");

    // 將出現過的單字標記為「已測驗」，避免學習計畫隔日重複出現
    if (!playerData.testedWords.includes(wordKey)) {
        playerData.testedWords.push(wordKey);
    }

    if (isCorrect) {
        feedback.innerText = "✨ 答對了！";
        feedback.className = "feedback correct";
        playerData.score += 10;
        masteredWords++; 
    } else {
        feedback.innerText = `❌ 錯誤！正解: ${currentWord.english}`;
        feedback.className = "feedback wrong";
        
        playerData.errorCounts[wordKey] = (playerData.errorCounts[wordKey] || 0) + 1;
        nextRoundQueue.push(currentWord);
    }

    if (currentWord.sentence) document.getElementById("sentenceHint").innerText = currentWord.sentence;
    
    saveUserData(); 
    document.getElementById("score").innerText = playerData.score;

    if (!isChoiceMode) {
        document.getElementById("englishInput").disabled = true;
        document.getElementById("submitBtn").style.display = "none";
    }

    currentRoundIndex++; 

    let overallPercent = (masteredWords / sessionTotalWords) * 100;
    document.getElementById("overallProgressBar").style.width = `${overallPercent}%`;
    document.getElementById("overallProgressText").innerText = `${masteredWords} / ${sessionTotalWords}`;
    let roundPercent = (currentRoundIndex / currentRoundQueue.length) * 100;
    document.getElementById("roundProgressBar").style.width = `${roundPercent}%`;

    if (document.getElementById("autoNext").checked) {
        setTimeout(() => nextQuestion(), isCorrect ? 1500 : 3500);
    } else {
        document.getElementById("nextBtn").style.display = "inline-block";
    }
}

function endGameEarly() {
    if (confirm("確定要提早結束本次測驗嗎？您的錯誤紀錄已保存。")) {
        location.reload();
    }
}

// ==========================================
// 輔助功能 (發音 / 解析 / 匯出錯題)
// ==========================================
function showWordInfo() {
    document.getElementById("modalWordTitle").innerText = currentWord.english;
    
    let youtubeLinkHTML = `<p><b>▶️ 影音發音：</b> <a href="https://www.youtube.com/results?search_query=how+to+pronounce+${encodeURIComponent(currentWord.english)}" target="_blank" style="color: #d63031; text-decoration: underline; font-weight: bold;">在 YouTube 上聽發音</a></p>`;

    document.getElementById("modalWordContent").innerHTML = `
        <p><b>📝 意思：</b> ${currentWord.chinese}</p>
        <p><b>🏢 類別：</b> <span style="color:#0984e3;">${currentWord.category || "一般商務"}</span></p>
        <p><b>🧬 字根字首：</b> <span style="color:#d35400;">${currentWord.roots || "暫無資料"}</span></p>
        <p><b>🔄 同義字：</b> ${currentWord.synonyms || "無"}</p>
        <p><b>↔️ 反義字：</b> ${currentWord.antonyms || "無"}</p>
        <p><b>⚠️ 易混淆：</b> <span style="color:#c0392b;">${currentWord.confused || "無"}</span></p>
        ${youtubeLinkHTML}
    `;
    document.getElementById("infoModal").style.display = "flex";
}

function closeModal(id) { 
    const modal = document.getElementById(id);
    if (modal) modal.style.display = "none"; 
}

function speakWord() {
    if (!currentWord || !currentWord.english) return;
    let utterance = new SpeechSynthesisUtterance(currentWord.english);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
}

function exportMistakes() {
    let mistakes = wordList.filter(w => (playerData.errorCounts[w.english.toLowerCase()] || 0) > 0);
    if (mistakes.length === 0) { alert("🎉 目前沒有錯題紀錄！"); return; }
    
    let csv = "\uFEFF英文單字,中文意思,累積錯誤次數\n" + mistakes.map(w => `"${w.english}","${w.chinese}","${playerData.errorCounts[w.english.toLowerCase()]}"`).join("\n");
    let blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    let link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `我的錯題本.csv`;
    link.click();
}

// ==========================================
// 🚀 單字下載與匯出功能 (CSV)
// ==========================================
function exportFullDatabase() {
    // 檢查題庫是否有資料
    if (!wordList || wordList.length === 0) {
        alert("題庫目前沒有單字喔！");
        return;
    }

    // 建立 CSV 標頭
    let csv = "\uFEFF英文單字,中文意思,例句,同義字,反義字,易混淆字,字根字首,YouTube發音連結,分類\n";

    // 遍歷所有單字並填入資料
    wordList.forEach(w => {
        // 處理可能為 undefined 或 null 的情況，並將雙引號替換為兩個雙引號 (CSV跳脫規則)
        let english = `"${(w.english || "").replace(/"/g, '""')}"`;
        let chinese = `"${(w.chinese || "").replace(/"/g, '""')}"`;
        let sentence = `"${(w.sentence || "").replace(/"/g, '""')}"`;
        let synonyms = `"${(w.synonyms || "").replace(/"/g, '""')}"`;
        let antonyms = `"${(w.antonyms || "").replace(/"/g, '""')}"`;
        let confused = `"${(w.confused || "").replace(/"/g, '""')}"`;
        let roots = `"${(w.roots || "").replace(/"/g, '""')}"`;
        let youtube = `"${(w.youtube || "").replace(/"/g, '""')}"`;
        let category = `"${(w.category || "").replace(/"/g, '""')}"`;

        // 將每個單字的資料加入 CSV 字串
        csv += `${english},${chinese},${sentence},${synonyms},${antonyms},${confused},${roots},${youtube},${category}\n`;
    });

    // 產生 Blob 物件並設定為 CSV 格式
    let blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    
    // 建立隱藏的 a 標籤來觸發下載
    let link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "多益單字冒險王_完整題庫.csv"; // 設定下載檔名
    
    // 觸發下載並移除 a 標籤
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==========================================
// 📖 字典查詢與「未收錄單字」自動捕捉系統
// ==========================================
function searchWord() {
    const searchInput = document.getElementById("searchInput");
    if (!searchInput) return;
    
    const query = searchInput.value.trim().toLowerCase();
    const resultArea = document.getElementById("searchResultArea");
    if (!query) { resultArea.style.display = "none"; return; }
    
    const matches = wordList.filter(w => w.english.toLowerCase().includes(query) || (w.chinese && w.chinese.includes(query)));
    
    if (matches.length === 0) {
        if (!playerData.unknownWords.includes(query)) {
            playerData.unknownWords.push(query);
            saveUserData();
            updateUnknownWordsUI();
        }
        
        resultArea.innerHTML = `<p style="color: #d63031; font-weight: bold;">找不到與「${query}」相關的單字 😢<br><span style="font-size:14px; color:#636e72;">已自動將此單字加入待擴充清單！</span></p>`;
    } else {
        resultArea.innerHTML = matches.map(w => `
            <div style="background:#f1f2f6; padding:12px; margin-bottom:10px; border-radius:8px; border-left: 5px solid #0984e3;">
                <h4 style="margin:0 0 5px 0; color:#2c3e50; font-size:18px;">${w.english} <span style="font-size:14px; color:#636e72; font-weight:normal;">${w.chinese}</span></h4>
                <p style="margin:0; font-size:14px; color:#555; font-style:italic;">${w.sentence || "暫無例句"}</p>
            </div>
        `).join("");
    }
    resultArea.style.display = "block";
}

function updateUnknownWordsUI() {
    const area = document.getElementById("unknownWordsArea");
    const countSpan = document.getElementById("unknownCount");
    const listDiv = document.getElementById("unknownWordsList");
    if (!area || !countSpan || !listDiv) return;

    if (!playerData.unknownWords || playerData.unknownWords.length === 0) {
        area.style.display = "none";
        return;
    }

    area.style.display = "block";
    countSpan.innerText = playerData.unknownWords.length;
    
    listDiv.innerHTML = playerData.unknownWords.map(word => 
        `<span style="background: white; border: 1px solid #fdcb6e; padding: 5px 10px; border-radius: 15px; font-weight: bold; color: #e17055; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">${word}</span>`
    ).join("");
}

// 🆕 更新後的 AI 擴充提示詞 (強制加入 10 大標準分類)
function copyUnknownWordsPrompt() {
    if (!playerData.unknownWords || playerData.unknownWords.length === 0) return;
    
    const wordListStr = playerData.unknownWords.join(",\n");
    const prompt = `你現在是一位專業的多益英文老師與資料工程師。
請幫我針對以下這批單字，自動補齊資訊並輸出成 JSON 陣列：
1. 多益 (TOEIC) 程度的實用商業例句 (須確保無特殊跳脫字元衝突)。
2. 該單字的字根字首解析 (若無則填寫 "無")。
3. 3~5 個同義字 (附中文)。
4. 3~5 個反義字 (附中文，若無則填寫 "無")。
5. 2~3 個易混淆字 (附中文，若無則填寫 "無")。

請「嚴格」依照以下的純 JSON 陣列格式輸出，不要包含任何 Markdown 標記，直接輸出讓我能複製到 JS 檔中的純 JSON：
[
  {
    "english": "單字",
    "chinese": "中文意思 (詞性)",
    "sentence": "多益例句。",
    "synonyms": "同義字1 (中文), 同義字2 (中文)",
    "antonyms": "反義字1 (中文)",
    "confused": "易混淆字 (中文)",
    "roots": "字根字首解析",
    "youtube": "https://www.youtube.com/results?search_query=how+to+pronounce+單字",
    "category": "請『只能』從以下 10 個標準類別中挑選最適合的一個填入：辦公室與行政、人事與管理、企劃與業務、財務與金融、出差與交通、住宿與餐飲、生產與製造、採購與物流、健康與醫療、地產與建築"
  }
]

以下是需要處理的單字清單：
${wordListStr}`;

    const tempInput = document.createElement("textarea");
    tempInput.value = prompt;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand("copy");
    document.body.removeChild(tempInput);
    
    alert("✅ AI 提示詞與待擴充單字已成功複製！\n\n請直接貼給 ChatGPT/Gemini 產生 JSON 陣列，然後接在您的 words.js 檔案最下方！");
}

function clearUnknownWords() {
    if (confirm("確定要清空這些尚未收錄的單字嗎？")) {
        playerData.unknownWords = [];
        saveUserData();
        updateUnknownWordsUI();
    }
}
