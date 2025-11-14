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
async function executeLoginTest(jobId, usernames, password, startTimeIso) {
    // logResult(jobId, '--- RESULT LIST ---');
    logResult(jobId, '\n■ 結果');
    
    const userList = usernames.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    
    let successCounter = 0;
    let failureCounter = 0;

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
                successCounter++;
            } catch (e) {
                const errorElement = await driver.findElements(By.id('error'));
                if (errorElement.length > 0) {
                    resultStatus = 'FAILURE ❌';
                    resultMessage = '無効な認証情報';
                } else {
                    resultStatus = 'FAILURE ❌';
                    resultMessage = 'タイムアウト';
                }
                failureCounter++;
            }
        } catch (error) {
            resultStatus = 'ERROR 🛑';
            resultMessage = `Workerエラー: ${error.message}`;
            failureCounter++;
        } finally {
            if (driver) {
                await driver.quit();
            }
            logResult(jobId, `${username} -> ${resultStatus} ${resultMessage}`);
        }
    }
    const endTime = new Date();
    const startTime = new Date(startTimeIso);
    const durationMs = endTime.getTime() - startTime.getTime();
    const durationSeconds = (durationMs / 1000).toFixed(2);
    if(failureCounter>0){
        logResult(jobId, `\n■ 終了 : ${endTime.toLocaleString('ja-JP')} (${durationSeconds} seconds, ✅${successCounter}, ❌${failureCounter})`);
    }else{
        logResult(jobId, `\n■ 終了 : ${endTime.toLocaleString('ja-JP')} (${durationSeconds} seconds, ✅${successCounter})`);
    }
    // logResult(jobId, `END TIME: ${endTime.toLocaleString('ja-JP')}(JST)`);
    // logResult(jobId, `DURATION: ${durationSeconds} seconds`);

}

// Node.jsの子プロセスとして実行される
if (process.argv.length > 5) {
    const jobId = process.argv[2];
    const usernames = process.argv[3];
    const password = process.argv[4];
    const startTimeIso = process.argv[5]; // 開始日時（ISO形式）
    executeLoginTest(jobId, usernames, password, startTimeIso);
}