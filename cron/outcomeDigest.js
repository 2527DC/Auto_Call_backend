const cron = require('node-cron');

// Every 10 minutes: morning call summaries due (from 9 AM India time, once a day).
// Created stopped; server.js starts it.
const outcomeDigest = cron.createTask('*/10 * * * *', async () => {
  try {
    await require('../services/outcomeDigest').sendDue();
  } catch (error) {
    console.error('Outcome digest error:', error.message);
  }
}, { noOverlap: true });

module.exports = outcomeDigest;
