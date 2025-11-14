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
            // 環境変数が設定されていない場合、ローカル環境と判断する
            // Heroku環境では通常、'production'や'staging'などのNODE_ENVが設定されています
            const isHeroku = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
            
            let serviceBuilder;
            if(isHeroku){
                const chromePath = process.env.CHROME_BIN || process.env.GOOGLE_CHROME_BIN;
                if (chromePath) {
                    options.setChromeBinaryPath(chromePath);
                }
                const driverPath = process.env.CHROMEDRIVER_PATH; // 環境変数から取得
                if(driverPath){
                    serviceBuilder = new chrome.ServiceBuilder(driverPath);
                }
            }
            // else (ローカル環境の場合): ServiceBuilder の設定は不要。
            // Selenium Manager が自動でローカルPCのPATHからドライバーを見つけます。
            
            // ... (Selenium Builderとオプションの設定 - 前回の成功コードを使用) ...
            // Herokuなどの環境で実行するためのChromeオプション
            let options = new chrome.Options();
            options.addArguments('--headless'); // GUIなしのヘッドレスモード
            options.addArguments('--no-sandbox');
            options.addArguments('--disable-dev-shm-usage');

            // Driverの構築
            let builder = new Builder()
                .forBrowser('chrome')
                .setChromeOptions(options);
            
            // Service Builderが設定されている場合のみ、セットする
            if (serviceBuilder) {
                builder = builder.setChromeService(serviceBuilder);
            }
            
            driver = await builder.build();

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