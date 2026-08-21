'use strict';

const jwt = require('jsonwebtoken');
const { db } = require('../models');
const Session = db.Session;

exports.checkImpersonationStatus = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  req.isImpersonating = false;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded && decoded.isImpersonated) {
      req.isImpersonating = true;
      req.impersonatorId = decoded.impersonatorId;
      req.originalRole = decoded.originalRole || decoded.role;
      return next();
    }

    const session = await Session.findOne({
      session_token: token,
      agenda: { $regex: /^impersonation_by_/ },
      status: 'active',
    }).lean();

    if (session) {
      req.isImpersonating = true;
      req.impersonatorId = session.agenda.replace('impersonation_by_', '');
    }
  } catch (err) {}

  next();
};

exports.restrictImpersonationActions = (req, res, next) => {
  if (!req.isImpersonating) {
    return next();
  }

  const url = (req.originalUrl || req.url || '').toLowerCase();
  const method = (req.method || '').toUpperCase();

  if (url.includes('/impersonate/stop')) {
    return next();
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return res.status(403).json({
      success: false,
      message: 'Modifications are not allowed during impersonation',
    });
  }

  next();
};
