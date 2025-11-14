const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');       // ファイルシステムモジュールを追加
const path = require('path');   // add ファイル書き込み用 
const { v4: uuidv4 } = require('uuid'); // ユニークID生成ライブラリ
const { fork } = require('child_process'); // Workerプロセス起動用
const archiver = require('archiver'); // 💡 archiver をインポート

const LOG_DIR = __dirname; // ログファイルをプロジェクトルートに保存
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

const app = express();
const PORT = process.env.PORT || 3000;
const SF_LOGIN_URL = 'https://login.salesforce.com/';

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public')); // 必要に応じて静的ファイル用フォルダ

// HTMLテンプレートを読み込む関数
//function renderHtml(results = '', lastUsernames = '', lastPassword = '') {
// 修正 : showForm 引数 (デフォルトは true) を追加
function renderHtml(results = '', lastUsernames = '', lastPassword = '', showForm = true) {    // index.html ファイルを読み込む
    let htmlContent;
    if(showForm==true){
        htmlContent = fs.readFileSync('./index.html', 'utf8');

        // プレースホルダーを置換
        htmlContent = htmlContent.replace('{{ results }}', results);
        htmlContent = htmlContent.replace('{{ lastUsernames }}', lastUsernames);
        htmlContent = htmlContent.replace('{{ lastPassword }}', lastPassword);
        
        // 修正 2: フォーム表示フラグを HTML に渡す
        htmlContent = htmlContent.replace('{{ showForm }}', showForm ? '' : 'none');
    }else{
        htmlContent = fs.readFileSync('./result.html', 'utf8');
        // プレースホルダーを置換
        htmlContent = htmlContent.replace('{{ results }}', results);
    }
    
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
        
        if (!logContent.includes('--- PROCESS COMPLETED ---')) {
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

    res.send(renderHtml(resultsOutput, '', '', false));
});


// フォーム送信ルート (POST)
app.post('/', async (req, res) => {
    const { usernames, password } = req.body;
    
    // ユーザー名リストを改行で分割
    const userList = usernames.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    
    if (userList.length === 0 || !password) {
        return res.send("ユーザー名とパスワードを入力してください。");
    }

    // 1. ユニークな Job ID を発番
    const jobId = uuidv4(); 
    const logFilePath = path.join(__dirname, `${jobId}.log`); // ログファイルのパス    
    const now = new Date();

    try {
        // 💡 追加修正: process.js キック前に、ログファイルの初期コンテンツを書き込み
        let initialContent = '';
        // initialContent += `--- 実行 ID: ${jobId} ---\n`;
        // initialContent += `ステータス: PENDING (処理待ち)\n`;
        initialContent += `--- PROCESS LIST ---  ${now.toLocaleString('ja-JP')}\n`;
        initialContent += usernames.trim() + '\n';
        initialContent += password + '\n';
        // initialContent += '--------------------\n';
        // initialContent += '--- RESULTS ---\n';

        console.log('INITIAL CONTENT: ', initialContent);
        // Web Dyno の処理中に同期的にファイルを書き込みます
        fs.writeFileSync(logFilePath, initialContent);
        
        console.log(`[Web] Initialized log file for Job ID: ${jobId}`);    // 2. Workerプロセスをフォークして非同期処理を開始 (H12回避)
        // Workerプロセスに jobId, usernames, password を引数として渡す
        const workerProcess = fork('process.js', [jobId, usernames, password, now.toISOString()]);

        workerProcess.on('error', (err) => {
            console.error(`Worker Process Error for ${jobId}:`, err);
            // エラー発生時、ファイルにエラーを追記するなどの処理も可能
        });

        // 3. 結果表示ページに即座にリダイレクト
        res.redirect(`/results/${jobId}`);
    } catch (error) {
        console.error("Error during job creation or file write:", error);
        res.status(500).send(renderHtml("ジョブの作成中にエラーが発生しました。", usernames, password));
    }
});

// --- 新規追加: ログファイルの一覧表示ルート (GET /logs) ---
app.get('/logs', (req, res) => {
    try {
        // __dirname にあるファイルを取得
        const files = fs.readdirSync(LOG_DIR);
        
        // 拡張子が .log または .PROCESS_LIST のファイルのみをフィルタリング
        const logFiles = files.filter(file => 
            file.endsWith('.log')
).map(file => {
            const filePath = path.join(LOG_DIR, file);
            const stats = fs.statSync(filePath);
            return {
                name: file,
                size: stats.size,
                // 最終更新日時 (Modification Time) を取得し、読みやすい形式に整形
                modifiedTime: stats.mtime.toLocaleString('ja-JP', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                })
            };
        }).sort((a, b) => {
            // ファイル一覧を更新日時が新しい順にソート（新しいものが上）
            return b.modifiedTime.localeCompare(a.modifiedTime);
        });

let html = `
            <!DOCTYPE html>
            <html lang="ja">
            <head>
                <meta charset="UTF-8">
                <title>ログファイル一覧</title>
                <link rel="stylesheet" href="https://unpkg.com/@salesforce-ux/design-system/assets/styles/salesforce-lightning-design-system.min.css">
                <style> 
                    .main-container { max-width: 900px; margin: 2rem auto; } 
                    .log-list-item { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px dashed #dddbda; }
                    .log-info { display: flex; gap: 20px; }
                </style>
            </head>
            <body class="slds-scope">
                <div class="main-container slds-card slds-p-around_medium">
                    <h2 class="slds-text-heading_medium slds-m-bottom_large">ログファイル一覧 (${LOG_DIR})</h2>
                    <ul class="slds-list_vertical slds-m-bottom_large">
                        <li class="log-list-item slds-text-title_bold">
                            <div>ファイル名</div>
                            <div class="log-info">
                                <div style="width: 120px; text-align: right;">サイズ</div>
                                <div style="width: 200px;">最終更新日時</div>
                            </div>
                        </li>
        `;
if (logFiles.length === 0) {
            html += `<li class="log-list-item">ファイルが見つかりません。</li>`;
        } else {
            logFiles.forEach(file => {
                const fileSizeKB = (file.size / 1024).toFixed(1); // KB表示
                html += `
                    <li class="log-list-item">
                        <a href="/log/${file.name}" class="slds-text-link">${file.name}</a> 
                        <div class="log-info">
                            <div style="width: 120px; text-align: right;">${fileSizeKB} KB</div>
                            <div style="width: 200px;">${file.modifiedTime}</div>
                        </div>
                    </li>
                `;
            });
        }
        
        html += `
                    </ul>
                    <div class="slds-m-top_large slds-grid slds-grid_align-spread">
                        <a href="/" class="slds-button slds-button_neutral">フォームに戻る</a>
                        <a href="/download-logs" class="slds-button slds-button_brand">全ログを ZIP ダウンロード</a>
                    </div>
                </div>
            </body>
            </html>
        `;
        res.send(html);
    } catch (error) {
        console.error('Error listing files:', error);
        res.status(500).send('ファイル一覧の取得中にエラーが発生しました。');
    }
});

// --- 新規追加: ファイル内容表示ルート (GET /log/:filename) ---
app.get('/log/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(LOG_DIR, filename);

    if (filename.includes('..') || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        return res.status(404).send('ファイルが見つからないか、アクセスが拒否されました。');
    }

    try {
        const content = fs.readFileSync(filePath, 'utf8');
        let html = `
            <!DOCTYPE html>
            <html lang="ja">
            <head>
                <meta charset="UTF-8">
                <title>${filename} の内容</title>
                <link rel="stylesheet" href="https://unpkg.com/@salesforce-ux/design-system/assets/styles/salesforce-lightning-design-system.min.css">
                <style> .main-container { max-width: 90%; margin: 2rem auto; } .log-content { white-space: pre-wrap; font-family: monospace; padding: 1rem; background-color: #f7f9fb; border: 1px solid #dddbda; } </style>
            </head>
            <body class="slds-scope">
                <div class="main-container slds-card slds-p-around_medium">
                    <h2 class="slds-text-heading_medium slds-m-bottom_large">${filename}</h2>
                    <pre class="log-content">${content}</pre>
                    <div class="slds-m-top_large">
                        <a href="/logs" class="slds-button slds-button_neutral">ログ一覧に戻る</a>
                    </div>
                </div>
            </body>
            </html>
        `;
        res.send(html);
    } catch (error) {
        console.error('Error reading file:', error);
        res.status(500).send('ファイル内容の読み込み中にエラーが発生しました。');
    }
});


// --- 新規追加: 全ログファイルの ZIP ダウンロードルート (GET /download-logs) ---
app.get('/download-logs', (req, res) => {
    const archive = archiver('zip', {
        zlib: { level: 9 } // 最高の圧縮レベル
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.attachment(`sf-login-logs-${timestamp}.zip`); // ダウンロード時のファイル名を指定

    archive.on('error', function(err) {
        res.status(500).send({ error: err.message });
    });

    // レスポンスパイプラインを設定
    archive.pipe(res);

    // ログファイルをアーカイブに追加
    const files = fs.readdirSync(LOG_DIR);
    files.filter(file => 
        file.endsWith('.log') || file.endsWith('.PROCESS_LIST')
    ).forEach(file => {
        const filePath = path.join(LOG_DIR, file);
        // ファイルをアーカイブにストリーミングで追加
        archive.file(filePath, { name: file }); 
    });

    // アーカイブ処理を完了
    archive.finalize();
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
