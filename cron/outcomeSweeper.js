const cron = require('node-cron');

// Every minute: analyse calls that ended without being queued (status callbacks,
// campaign failures), restart analyses stuck after a restart, and finish calls
// whose transcript never came. Does nothing while outcomes are off.
// Created stopped (server.js starts it), so requiring it elsewhere runs nothing.
const outcomeSweeper = cron.createTask('* * * * *', async () => {
  try {
    const outcomeService = require('../services/outcomeService');
    await outcomeService.sweep();
  } catch (error) {
    console.error('Outcome sweeper error:', error.message);
  }
}, { noOverlap: true });

module.exports = outcomeSweeper;
