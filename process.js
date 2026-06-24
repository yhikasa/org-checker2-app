// process.js (Worker 側の処理ロジック)
const fs = require('fs');
const path = require('path');
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

// 💡 修正: ログファイル・画像の保存先を「logs」フォルダ配下に指定
const LOG_DIR = path.join(__dirname, 'logs');

const SF_LOGIN_URL = 'https://login.salesforce.com/?type=twobox&login=1';

// ログファイルへの追記関数
function logResult(jobId, message) {
    const logFilePath = path.join(LOG_DIR, `${jobId}.log`);
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

        // 💡 修正: @以降、かつ最後のドット(.comなど)より前の部分を抽出してユニークにする
        // 例: admin@dex6022.55726.com -> dex6022.55726
        let domainPart = '';
        const match = username.match(/@([^@]+)\.[^.]+$/);
        if (match && match[1]) {
            domainPart = match[1].replace(/[^a-zA-Z0-9.-]/g, ''); // ドット(.)も含めて許可
        } else {
            // 万が一うまく切り出せなかった場合のセーフティ
            domainPart = username.replace(/[^a-zA-Z0-9_-]/g, '');
        }
        const screenshotName = `${jobId}-${domainPart}.png`;

        try {
            // Herokuなどの環境で実行するためのChromeオプション
            let options = new chrome.Options();
            options.addArguments('--headless=new'); // GUIなしのヘッドレスモード
            options.addArguments('--no-sandbox');
            options.addArguments('--disable-dev-shm-usage');

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
                // await driver.wait(until.urlContains('lightning'), 15000); // 待機
                await driver.wait(until.urlMatches(/lightning|home\.jsp/i), 15000); // 待機
                resultStatus = 'SUCCESS ✅';
                resultMessage = 'ログイン成功';
                successCounter++;
                // ログイン成功判定 (urlMatches(/lightning|home\.jsp/i) が true の後)
                // 💡 ステップ 1: 現在のURLを確認
                const currentUrl = await driver.getCurrentUrl();
                
                // URLに 'home.jsp' が含まれているか（Classic画面であるか）を確認
                if (currentUrl.includes('home.jsp')) {
                    resultMessage += ' (Classic画面';
                    console.log(`[Worker - ${jobId}] : classic画面のようです`);
                    
                    // 💡 ステップ 2: 「Lightning Experience に切り替え」リンクの探索とクリック
                    // リンクのテキストは言語設定によって変わるため、Xpathで両方のテキストをOR条件で検索します。
                    const switchLinkSelector = 'a.switch-to-lightning';
                    
                    try {
                        // まず要素がDOMに存在することを確認
                        await driver.wait(until.elementLocated(By.css(switchLinkSelector)), 10000);
                        const switchLink = await driver.findElement(By.css(switchLinkSelector));
                        await switchLink.click();
                        console.log(`[Worker - ${jobId}] : LEXに切り替えました！`);

                        // 💡 ステップ 3: Lightning URLに遷移が完了するまで待機 (最大15秒)
                        await driver.wait(until.urlContains('lightning'), 15000); 
                        console.log(`[Worker - ${jobId}] : LEXへの切り替え完了！`);
                        resultMessage += ' → LEXに切り替えました)';
                    } catch (linkError) {
                        // リンクが見つからない、またはクリックに失敗した場合は処理を続行
                        resultMessage += ' → LEX への切り替えリンクがみつかりませんでした)';
                        console.log(`[Worker - ${jobId}] : LEXへの切り替えリンクが見つからず`);
                    }
                }// end - ログイン成功判定-> switch to LEX
            } catch (e) {

                if (driver) {
                    const screenshot = await driver.takeScreenshot();
                    // 💡 画像の保存先も LOG_DIR 配下にする
                    const screenshotPath = path.join(LOG_DIR, screenshotName);
                    fs.writeFileSync(screenshotPath, screenshot, 'base64');
                    console.log(`[Worker - ${jobId}] Error Screenshot saved to ${screenshotPath}`);
                }

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

            if (driver) {
                try {
                    const screenshot = await driver.takeScreenshot();
                    const screenshotPath = path.join(LOG_DIR, screenshotName);
                    fs.writeFileSync(screenshotPath, screenshot, 'base64');
                    console.log(`[Worker - ${jobId}] Critical Error Screenshot saved.`);
                } catch (screenshotError) {
                    // スキップ
                }
            }

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
        logResult(jobId, `\n■ 終了 : ${endTime.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} (${durationSeconds} seconds, ✅${successCounter}, ❌${failureCounter})`);
    }else{
        logResult(jobId, `\n■ 終了 : ${endTime.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} (${durationSeconds} seconds, ✅${successCounter})`);
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