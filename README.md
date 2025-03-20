# TimeBoxing
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>任務計時器 - v1.3</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            text-align: center;
            margin: 50px;
            background-color: #f4f4f4;
        }
        #container {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1);
            display: inline-block;
        }
        h1 {
            color: #333;
        }
        #timer {
            font-size: 2.5em;
            margin: 20px;
            font-weight: bold;
            color: #007BFF;
        }
        #status {
            font-size: 1.2em;
            margin: 10px;
            color: blue;
        }
        button {
            font-size: 1em;
            margin: 10px;
            padding: 10px 15px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            transition: 0.3s;
        }
        button:hover {
            background: #007BFF;
            color: white;
        }
        .input-group {
            margin: 15px 0;
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 10px;
        }
        input[type="text"], input[type="number"] {
            padding: 8px;
            font-size: 1em;
            border: 1px solid #ccc;
            border-radius: 5px;
            width: 80px;
            text-align: center;
        }
        #history {
            margin-top: 20px;
            text-align: left;
            max-width: 400px;
            margin-left: auto;
            margin-right: auto;
            background: white;
            padding: 15px;
            border-radius: 10px;
            box-shadow: 0px 0px 5px rgba(0, 0, 0, 0.1);
        }
        .history-item {
            padding: 10px;
            border-bottom: 1px solid #ddd;
            cursor: pointer;
            transition: 0.3s;
        }
        .history-item:hover {
            background: #f0f0f0;
        }
        .delete-btn {
            background: none;
            border: none;
            color: red;
            font-size: 1.2em;
            cursor: pointer;
        }
    </style>
</head>
<body>
    <div id="container">
        <h1>任務計時器 - v1.3</h1>
        <div class="input-group">
            <label for="taskName">任務名稱:</label>
            <input type="text" id="taskName" placeholder="輸入任務名稱">
        </div>
        <div class="input-group">
            <label for="targetMinutes">設定目標時間:</label>
            <input type="number" id="targetMinutes" min="0" value="1"> 分
            <input type="number" id="targetSeconds" min="0" max="59" value="0"> 秒
        </div>
        <div id="timer">00:00:00</div>
        <div id="status">未開始</div>
        <button onclick="startTimer()">開始</button>
        <button onclick="pauseTimer()">暫停</button>
        <button onclick="clearFields()">清空</button>
        <button onclick="saveHistory()">儲存紀錄</button>
    </div>
    <h2>歷史紀錄</h2>
    <ul id="history"></ul>

    <script>
        let timer;
        let seconds = 0;
        let running = false;
        let historyRecords = JSON.parse(localStorage.getItem('history')) || [];

        function updateTimerDisplay() {
            let hrs = String(Math.floor(seconds / 3600)).padStart(2, '0');
            let mins = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
            let secs = String(seconds % 60).padStart(2, '0');
            document.getElementById('timer').textContent = `${hrs}:${mins}:${secs}`;
        }

        function startTimer() {
            if (!running) {
                running = true;
                timer = setInterval(() => {
                    seconds++;
                    updateTimerDisplay();
                }, 1000);
            }
        }

        function pauseTimer() {
            running = false;
            clearInterval(timer);
        }

        function clearFields() {
            running = false;
            clearInterval(timer);
            seconds = 0;
            updateTimerDisplay();
        }

        function saveHistory() {
            let taskName = document.getElementById('taskName').value.trim();
            if (!taskName) {
                alert("請輸入任務名稱後再儲存!");
                return;
            }
            let minutes = parseInt(document.getElementById('targetMinutes').value, 10);
            let sec = parseInt(document.getElementById('targetSeconds').value, 10);
            let targetTime = minutes * 60 + sec;
            
            let record = { name: taskName, targetTime: targetTime, actualTime: seconds };
            historyRecords.unshift(record);
            localStorage.setItem('history', JSON.stringify(historyRecords));
            updateHistoryDisplay();
        }

        function updateHistoryDisplay() {
            let historyList = document.getElementById('history');
            historyList.innerHTML = '';
            historyRecords.forEach((record, index) => {
                let difference = record.actualTime - record.targetTime;
                let statusText = difference < 0 ? `提前 ${Math.abs(difference)} 秒` : `延遲 ${difference} 秒`;
                let statusColor = difference < 0 ? 'green' : 'red';
                
                let li = document.createElement('li');
                li.classList.add('history-item');
                li.innerHTML = `${record.name}: 目標 ${Math.floor(record.targetTime / 60)} 分 ${record.targetTime % 60} 秒, 
                                實際 ${Math.floor(record.actualTime / 60)} 分 ${record.actualTime % 60} 秒 
                                <br><span style="color:${statusColor};">(${statusText})</span>
                                <button class="delete-btn" onclick="deleteHistory(${index})">❌</button>`;
                historyList.appendChild(li);
            });
        }

        function deleteHistory(index) {
            historyRecords.splice(index, 1);
            localStorage.setItem('history', JSON.stringify(historyRecords));
            updateHistoryDisplay();
        }

        updateHistoryDisplay();
    </script>
</body>
</html>
