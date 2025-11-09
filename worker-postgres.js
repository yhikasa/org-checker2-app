// worker.js
const { Worker } = require('bullmq');
const { connection } = require('./queue');
const { updateDetail, updateSummaryStatus } = require('./db');
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

const SF_LOGIN_URL = 'https://login.salesforce.com/';

// Selenium ログインテスト関数 (以前の server.js から移動)
async function runLoginTest(username, password) {
    let driver;
    try {
        let options = new chrome.Options();
        options.addArguments('--headless'); 
        options.addArguments('--no-sandbox');
        options.addArguments('--disable-dev-shm-usage');

        // Heroku環境変数からパスを設定
        const chromePath = process.env.GOOGLE_CHROME_BIN;
        if (chromePath) {
            options.setChromeBinaryPath(chromePath);
        }
        
        driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();
        
        await driver.get(SF_LOGIN_URL);
        
        // ログイン処理... (省略。server.jsのロジックと同じ)

        try {
            await driver.wait(until.urlContains('lightning'), 20000); // タイムアウトを延長
            return { status: 'SUCCESS', message: 'ログイン成功' };
        } catch (e) {
            // 失敗判定ロジック... (省略)
            const errorElement = await driver.findElements(By.id('error'));
            if (errorElement.length > 0) {
                return { status: 'FAILURE', message: '無効な認証情報' };
            }
            return { status: 'FAILURE', message: 'タイムアウトまたは不明なエラー' };
        }

    } catch (error) {
        console.error(`Selenium Error for ${username}:`, error);
        return { status: 'ERROR', message: `システムエラー: ${error.message}` };
    } finally {
        if (driver) {
            await driver.quit(); 
        }
    }
}

// キューからジョブを取得し処理するワーカー
const worker = new Worker('loginCheckerQueue', async (job) => {
    const { runId, usernames, password } = job.data;
    
    console.log(`Starting job ${runId} with ${usernames.length} users.`);
    
    // 概要ステータスを PROCESSING に更新
    await updateSummaryStatus(runId, 'PROCESSING');
    
    for (const username of usernames) {
        // 各ユーザーごとにテストを実行
        const result = await runLoginTest(username, password);
        
        // 結果を明細テーブルに書き込む
        await updateDetail(runId, username, result.status, result.message);
        console.log(`[Worker] ${username} finished with status: ${result.status}`);
    }
    
    // 全て完了したらステータスを COMPLETED に更新
    await updateSummaryStatus(runId, 'COMPLETED');
    
}, { connection });

worker.on('completed', (job) => {
    console.log(`Job ${job.id} completed.`);
});

worker.on('failed', (job, err) => {
    console.error(`Job ${job.id} failed with error:`, err);
    // ジョブ全体が失敗した場合、概要ステータスを FAILED に更新するロジックをここに追加
    // updateSummaryStatus(job.data.runId, 'FAILED'); 
});