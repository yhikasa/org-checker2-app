// queue.js
const { Queue } = require('bullmq');

// Heroku Redis の環境変数を使用
const connection = {
    host: new URL(process.env.REDIS_URL).hostname,
    port: new URL(process.env.REDIS_URL).port,
    password: new URL(process.env.REDIS_URL).password,
    tls: { rejectUnauthorized: false } 
};

const loginQueue = new Queue('loginCheckerQueue', { connection });

async function addLoginJob(runId, usernames, password) {
    await loginQueue.add('processLogin', { runId, usernames, password }, {
        removeOnComplete: true,
        removeOnFail: false 
    });
}

module.exports = { addLoginJob, connection };