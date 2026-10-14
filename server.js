'use strict';

require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const deleteExpiredOtp = require('./cron/deleteExpiredOtps');
const { initTopUpExpiryCron } = require('./cron/topup-expiry.cron');
const whatsappFlowSweeper = require('./cron/whatsappFlowSweeper');
const outcomeSweeper = require('./cron/outcomeSweeper');
const followUpSweeper = require('./cron/followUpSweeper');
const outcomeDigest = require('./cron/outcomeDigest');

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
    whatsappFlowSweeper.start();
    outcomeSweeper.start();
    followUpSweeper.start();
    outcomeDigest.start();

    app.set('io', io);
    require('./utils/realtime').attach(io);

    // Call media streams connect at "/". Socket.io handles its own upgrades at
    // /socket.io; letting ws see those too broke the socket.io handshake.
    const { WebSocketServer } = require('ws');
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      const pathname = (req.url || '').split('?')[0];
      if (pathname.startsWith('/socket.io')) return;
      if (pathname !== '/') {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    const voiceAutomationService = require('./services/voiceAutomationService');
    voiceAutomationService.setIo(io);

    wss.on('connection', (ws, req) => {
      console.log('Media Stream WebSocket connected');
      voiceAutomationService.handleMediaStream(ws, req);
    });

    server.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Startup error:', err);
    process.exit(1);
  }
})();