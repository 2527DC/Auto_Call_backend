'use strict';

// Queue of calls waiting for their after-call analysis (BullMQ on Redis), so a
// campaign ending with thousands of calls is analysed steadily rather than all
// at once, and nothing is lost on a restart. Without Redis, outcomeService runs
// the analysis in-process instead.
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');

const CONCURRENCY = 3;
let queue = null;

if (process.env.REDIS_URL) {
  const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  queue = new Queue('outcome-queue', { connection });
  const worker = new Worker('outcome-queue', async (job) => {
    const outcomeService = require('./outcomeService');
    await outcomeService.process(job.data.callId, { force: !!job.data.force });
  }, {
    connection,
    concurrency: CONCURRENCY,
    // At most 30 analyses a minute across all clients (AI rate limits).
    limiter: { max: 30, duration: 60 * 1000 }
  });
  worker.on('failed', (job, err) => console.error(`[Outcome] Job for call ${job?.data?.callId} failed:`, err.message));
}

const available = () => !!queue;

// One job per call (its id), so the call ending, the provider's status
// callback and the sweeper asking at once still analyse it once.
async function add(callId, { delayMs = 4000, force = false } = {}) {
  if (!queue) return null;
  const jobId = force ? `call-${callId}-${Date.now()}` : `call-${callId}`;
  return queue.add('analyze', { callId, force }, {
    jobId,
    delay: delayMs,
    attempts: 2,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: true,
    removeOnFail: 500
  }).catch(err => console.error('[Outcome] Could not queue call', callId, err.message));
}

module.exports = { available, add };
