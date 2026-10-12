'use strict';

const { verifyToken } = require('./jwt');
const { db } = require('../models');
const { Session, TeamMember } = db;

let io = null;

// Signs each socket in with the same token the API uses and puts it in its rooms:
// user_<id> for personal notifications and account_<owner id> for the shared inbox.
const attach = (server) => {
  io = server;
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next();
      const decoded = verifyToken(token);
      const session = await Session.findOne({ session_token: token, status: 'active' }).select('expires_at').lean();
      if (!session || (session.expires_at && new Date() > new Date(session.expires_at))) return next();

      let accountId = decoded.id;
      if (decoded.isTeamMember) {
        const member = await TeamMember.findById(decoded.id).select('user_id').lean();
        if (!member) return next();
        accountId = String(member.user_id);
      }
      socket.join([`user_${decoded.id}`, `account_${accountId}`]);
      next();
    } catch {
      // An invalid token just means an unsigned socket that joins no rooms.
      next();
    }
  });
};

// Tells everyone in an account that something changed. Payloads carry ids, not
// message content: clients refetch through the API, which checks access.
const emitToAccount = (accountId, event, payload) => {
  if (io && accountId) io.to(`account_${accountId}`).emit(event, payload);
};

const getIo = () => io;

module.exports = { attach, emitToAccount, getIo };
