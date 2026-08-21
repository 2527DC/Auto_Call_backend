'use strict';

require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const deleteExpiredOtp = require('./cron/deleteExpiredOtps');
const { initTopUpExpiryCron } = require('./cron/topup-expiry.cron');

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    const app = require('./app');

    const server = http.createServer(app);
    const io = new Server(server, {
      cors: {
        origin: (origin, callback) => {
          if (!origin) return callback(null, true);

          const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];

          if (allowedOrigins.includes(origin)) {
            callback(null, true);
          } else {
            callback(new Error('Socket.io CORS blocked: ' + origin));
          }
        },
        methods: ['GET', 'POST'],
        credentials: true,
      },
    });

    deleteExpiredOtp.start();
    initTopUpExpiryCron();

    app.set('io', io);

    const { WebSocketServer } = require('ws');
    const wss = new WebSocketServer({ server, path: '/' });
    const voiceAutomationService = require('./services/voiceAutomationService');

    wss.on('connection', (ws) => {
      console.log('Twilio Media Stream WebSocket connected');
      voiceAutomationService.handleMediaStream(ws);
    });

    server.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Startup error:', err);
    process.exit(1);
  }
})();