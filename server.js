const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs'); // ファイルシステムモジュールを追加
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

// ログイン処理を実行する関数
async function runLoginTest(username, password) {
    let driver;
    try {
        // Herokuなどの環境で実行するためのChromeオプション
        let options = new chrome.Options();
        options.addArguments('--headless'); // GUIなしのヘッドレスモード
        options.addArguments('--no-sandbox');
        options.addArguments('--disable-dev-shm-usage');
        
        driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();
        
        await driver.get(SF_LOGIN_URL);
        
        // ユーザー名とパスワードを入力
        await driver.findElement(By.id('username')).sendKeys(username);
        await driver.findElement(By.id('password')).sendKeys(password);
        await driver.findElement(By.id('Login')).click();

        // ログイン成功/失敗の判定
        // 成功: ログイン後に表示される要素（例: App Launcherのアイコン）が出現するまで待機
        try {
            await driver.wait(until.urlContains('lightning'), 10000); // URLがLightningに変わるのを待つ
            return { username, status: '成功 ✅' };
        } catch (e) {
            // 失敗: エラーメッセージが表示されているか確認
            const errorElement = await driver.findElements(By.id('error'));
            if (errorElement.length > 0) {
                return { username, status: '失敗 ❌ (無効な認証情報)' };
            }
            return { username, status: '失敗 ❌ (タイムアウト/不明なエラー)' };
        }

    } catch (error) {
        console.error(`Error processing ${username}:`, error.message);
        return { username, status: 'エラー 🛑 (システムエラー)' };
    } finally {
        if (driver) {
            await driver.quit(); // ブラウザを閉じる
        }
    }
}

// フォーム送信ルート (POST)
app.post('/test-login', async (req, res) => {
    const { usernames, password } = req.body;
    
    // ユーザー名リストを改行で分割
    const userList = usernames.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    
    if (userList.length === 0 || !password) {
        return res.send("ユーザー名とパスワードを入力してください。");
    }

    const testResults = [];
    
    // 各ユーザーに対してログインテストを順番に実行
    for (const username of userList) {
        const result = await runLoginTest(username, password);
        console.log(`ユーザー: ${result.username} -> ${result.status}`);
        testResults.push(result);
    }

    // 結果を整形してHTMLに返す
    let output = "--- ログインテスト結果 ---\n";
    testResults.forEach(r => {
        output += `ユーザー: ${r.username} -> ${r.status}\n`;
    });
    
    // フォームに以前の入力内容を埋め込んでクライアントに返す
    res.send(renderHtml(output, usernames, password));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});