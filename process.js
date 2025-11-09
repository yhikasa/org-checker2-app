// process.js (Worker 側の処理ロジック)
const fs = require('fs');
const path = require('path');
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

const SF_LOGIN_URL = 'https://login.salesforce.com/';

// ログファイルへの追記関数
function logResult(jobId, message) {
    const logFilePath = path.join(__dirname, `${jobId}.log`);
    fs.appendFileSync(logFilePath, message + '\n');
    console.log(`[Worker - ${jobId}] LOGGED: ${message}`);
}

// メインのログインテスト処理
async function executeLoginTest(jobId, usernames, password) {
    logResult(jobId, '--- STARTING LOGIN TEST ---');
    
    const userList = usernames.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    
    for (const username of userList) {
        logResult(jobId, `PROCESSING: ${username}`);
        let driver;
        let resultStatus = 'ERROR';
        let resultMessage = 'システムエラー';

        try {
            // ... (Selenium Builderとオプションの設定 - 前回の成功コードを使用) ...
            
            // 環境変数からのパス設定 (Heroku上での動作確認済みパスを強制適用)
            let options = new chrome.Options();
            options.addArguments('--headless', '--no-sandbox', '--disable-dev-shm-usage');
            
            // 🚨 動作環境変数の値を直接コードに設定（環境変数設定を削除済みの場合はこのパスを使用）
            options.setChromeBinaryPath(process.env.GOOGLE_CHROME_BIN || '/app/.chrome-for-testing/chrome-linux64/chrome');
            
            driver = await new Builder()
                .forBrowser('chrome')
                .setChromeOptions(options)
                .build();

            await driver.get(SF_LOGIN_URL);
            await driver.findElement(By.id('username')).sendKeys(username);
            await driver.findElement(By.id('password')).sendKeys(password);
            await driver.findElement(By.id('Login')).click();

            try {
                await driver.wait(until.urlContains('lightning'), 15000); // 待機
                resultStatus = 'SUCCESS ✅';
                resultMessage = 'ログイン成功';
            } catch (e) {
                const errorElement = await driver.findElements(By.id('error'));
                if (errorElement.length > 0) {
                    resultStatus = 'FAILURE ❌';
                    resultMessage = '無効な認証情報';
                } else {
                    resultStatus = 'FAILURE ❌';
                    resultMessage = 'タイムアウト';
                }
            }
        } catch (error) {
            resultStatus = 'ERROR 🛑';
            resultMessage = `Workerエラー: ${error.message}`;
        } finally {
            if (driver) {
                await driver.quit();
            }
            logResult(jobId, `RESULT: ${username} -> ${resultStatus} ${resultMessage}`);
        }
    }
    logResult(jobId, '--- JOB COMPLETED ---');
}

// Node.jsの子プロセスとして実行される
if (process.argv.length > 4) {
    const jobId = process.argv[2];
    const usernames = process.argv[3];
    const password = process.argv[4];
    executeLoginTest(jobId, usernames, password);
}