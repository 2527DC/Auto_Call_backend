const cron = require('node-cron');

// Every minute: place AI callbacks and campaign retries that are due (within
// calling hours, with credits, never to "do not call" numbers), and settle
// follow-up calls that never reported back. Created stopped; server.js starts it.
const followUpSweeper = cron.createTask('* * * * *', async () => {
  try {
    const followUpService = require('../services/followUpService');
    await followUpService.sweep();
  } catch (error) {
    console.error('Follow-up sweeper error:', error.message);
  }
}, { noOverlap: true });

module.exports = followUpSweeper;
