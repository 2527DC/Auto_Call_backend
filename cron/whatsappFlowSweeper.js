const cron = require('node-cron');
const { db } = require('../models');
const { WhatsappFlowRun } = db;

// Every minute: continue WhatsApp automations whose wait step is over, close
// runs nobody answered, and clear old builder test runs.
const whatsappFlowSweeper = cron.schedule('* * * * *', async () => {
  try {
    const flowEngine = require('../services/whatsapp/flowEngine');
    const due = await WhatsappFlowRun.find({ status: 'active', simulation: false, 'waiting.kind': 'delay', 'waiting.resume_at': { $lte: new Date() } })
      .select('_id')
      .limit(100)
      .lean();
    for (const run of due) {
      await flowEngine.resumeDelay(run._id).catch((e) => console.error('[WhatsApp flow] Resume after wait failed:', e.message));
    }
    await flowEngine.expireStale();
    await WhatsappFlowRun.deleteMany({ simulation: true, updated_at: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } });
  } catch (error) {
    console.error('WhatsApp flow sweeper error:', error);
  }
});

module.exports = whatsappFlowSweeper;
