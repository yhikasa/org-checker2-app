// db.js
const { Pool } = require('pg');

// Herokuでは DATABASE_URL 環境変数が自動で設定されます
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false 
    }
});

// ログインテスト概要レコードを作成
async function createSummary(password, usernames) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 概要レコード作成
        const summaryRes = await client.query(
            'INSERT INTO login_check_summary (password) VALUES ($1) RETURNING run_id',
            [password]
        );
        const runId = summaryRes.rows[0].run_id;

        // 明細レコードを一括作成
        const detailValues = usernames.map(u => `('${runId}', '${u}')`).join(', ');
        await client.query(
            `INSERT INTO login_check_detail (run_id, username) VALUES ${detailValues}`
        );

        await client.query('COMMIT');
        return runId;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

// 実行結果を取得
async function getResults(runId) {
    const summaryRes = await pool.query(
        'SELECT status, password, created_at FROM login_check_summary WHERE run_id = $1',
        [runId]
    );
    const detailsRes = await pool.query(
        'SELECT username, status, result_message FROM login_check_detail WHERE run_id = $1 ORDER BY detail_id',
        [runId]
    );
    return {
        summary: summaryRes.rows[0],
        details: detailsRes.rows
    };
}

// 明細レコードを更新 (Worker用)
async function updateDetail(runId, username, status, message) {
    const now = new Date();
    await pool.query(
        `UPDATE login_check_detail SET status = $1, result_message = $2, completed_at = $3 
         WHERE run_id = $4 AND username = $5`,
        [status, message, now, runId, username]
    );
}

// 概要レコードのステータスを更新 (Worker用)
async function updateSummaryStatus(runId, status) {
    await pool.query(
        'UPDATE login_check_summary SET status = $1 WHERE run_id = $2',
        [status, runId]
    );
}

module.exports = {
    createSummary,
    getResults,
    updateDetail,
    updateSummaryStatus
};