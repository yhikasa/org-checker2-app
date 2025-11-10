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
    logResult(jobId, '--- RESULT LIST ---');
    
    const userList = usernames.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    
    for (const username of userList) {
//        logResult(jobId, `PROCESSING: ${username}`);
        let driver;
        let resultStatus = 'ERROR';
        let resultMessage = 'システムエラー';

        try {
            // ... (Selenium Builderとオプションの設定 - 前回の成功コードを使用) ...
            // Herokuなどの環境で実行するためのChromeオプション
            let options = new chrome.Options();
            options.addArguments('--headless'); // GUIなしのヘッドレスモード
            options.addArguments('--no-sandbox');
            options.addArguments('--disable-dev-shm-usage');

            // Heroku環境でパスを動的に参照させる (または以下のパスを環境変数として設定)
            const chromePath = process.env.CHROME_BIN || process.env.GOOGLE_CHROME_BIN;
            const driverPath = process.env.CHROMEDRIVER_PATH; // 環境変数から取得

            if (chromePath) {
                options.setBinaryPath(chromePath);
            }
            // 💡 修正 2: Chromedriver のパスを Service Builder に設定 (最も重要な修正)
            let serviceBuilder;
            if (driverPath) {
                serviceBuilder = new chrome.ServiceBuilder(driverPath);
            }

            driver = await new Builder()
                .forBrowser('chrome')
                .setChromeOptions(options)
                .setChromeService(serviceBuilder)
                .build();
            
            await driver.get(SF_LOGIN_URL); 
            // ユーザー名とパスワードを入力
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
    logResult(jobId, '--- PROCESS COMPLETED ---');
}

// Node.jsの子プロセスとして実行される
if (process.argv.length > 4) {
    const jobId = process.argv[2];
    const usernames = process.argv[3];
    const password = process.argv[4];
    executeLoginTest(jobId, usernames, password);
}