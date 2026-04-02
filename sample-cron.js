const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'cron-test-result.log');
const now = new Date().toLocaleString();
const message = `[${now}] Cron Job is working correctly!\n`;

fs.appendFileSync(logFile, message);
console.log(message);
