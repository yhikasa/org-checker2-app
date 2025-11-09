const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs'); // ファイルシステムモジュールを追加

// add ファイル書き込み用 
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // ユニークID生成ライブラリ
const { fork } = require('child_process'); // Workerプロセス起動用
// npm install uuid が必要
const LOG_DIR = __dirname; // ログファイルをプロジェクトルートに保存

const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

const app = express();
const PORT = process.env.PORT || 3000;
const SF_LOGIN_URL = 'https://login.salesforce.com/';

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public')); // 必要に応じて静的ファイル用フォルダ

// HTMLテンプレートを読み込む関数
function renderHtml(results = '', lastUsernames = '', lastPassword = '') {
    // index.html ファイルを読み込む
    let htmlContent = fs.readFileSync('./index.html', 'utf8');

    // プレースホルダーを置換
    htmlContent = htmlContent.replace('{{ results }}', results);
    htmlContent = htmlContent.replace('{{ lastUsernames }}', lastUsernames);
    htmlContent = htmlContent.replace('{{ lastPassword }}', lastPassword);
    
    return htmlContent;
}

// ルートページ (GET)
app.get('/', (req, res) => {
    // 初回アクセス時は空の値を設定
    res.send(renderHtml());
});

// 結果表示ページ (GET /results/:jobId) - 2回目以降のアクセスはこちら
app.get('/results/:jobId', async (req, res) => {
    const jobId = req.params.jobId;
    const logFilePath = path.join(LOG_DIR, `${jobId}.log`);
    let resultsOutput = `--- 実行 ID: ${jobId} ---\nステータス: 処理中... \n\n`;

    try {
        // ログファイルの内容を読み込み
        const logContent = fs.readFileSync(logFilePath, 'utf8');
        resultsOutput = logContent;
        
        if (!logContent.includes('--- JOB COMPLETED ---')) {
            // 処理中の場合、自動更新を促すメッセージを追加
            resultsOutput += "\n\n(処理中です。数秒後にページをリロードして結果を確認してください。)";
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            // ファイルが存在しない場合（まだWorkerが書き込みを開始していない、またはIDが不正）
            resultsOutput = `実行 ID: ${jobId} のジョブはまだ開始されていません。しばらくしてからリロードしてください。`;
        } else {
            // その他のファイル読み込みエラー
            resultsOutput = `エラー: 結果ファイルの読み込みに失敗しました。`;
        }
    }

    res.send(renderHtml(resultsOutput, '', ''));
});


// フォーム送信ルート (POST)
app.post('/test-login', async (req, res) => {
    const { usernames, password } = req.body;
    
    // ユーザー名リストを改行で分割
    const userList = usernames.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    
    if (userList.length === 0 || !password) {
        return res.send("ユーザー名とパスワードを入力してください。");
    }

// 1. ユニークな Job ID を発番
    const jobId = uuidv4(); 
    
    // 2. Workerプロセスをフォークして非同期処理を開始 (H12回避)
    // Workerプロセスに jobId, usernames, password を引数として渡す
    const workerProcess = fork('process.js', [jobId, usernames, password]);

    workerProcess.on('error', (err) => {
        console.error(`Worker Process Error for ${jobId}:`, err);
        // エラー発生時、ファイルにエラーを追記するなどの処理も可能
    });

    // 3. 結果表示ページに即座にリダイレクト
    res.redirect(`/results/${jobId}`);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});