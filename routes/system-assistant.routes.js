'use strict';

const express = require('express');
const router = express.Router();
const systemAssistantController = require('../controllers/system-assistant.controller');
const { authenticate } = require('../middlewares/auth');

const requireAdmin = (req, res, next) => {
  const roleName = req.user?.roleId?.name;
  if (roleName === 'super_admin' || roleName === 'admin') {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Access denied: Admin access required.' });
};

// Member accessible routes (authenticated)
router.get('/config', authenticate, systemAssistantController.getConfig);
router.post('/chat', authenticate, systemAssistantController.chat);

// Admin accessible routes
router.get('/admin/config', authenticate, requireAdmin, systemAssistantController.getAdminConfig);
router.put('/admin/config', authenticate, requireAdmin, systemAssistantController.updateAdminConfig);

router.get('/admin/knowledge', authenticate, requireAdmin, systemAssistantController.getKnowledgeList);
router.get('/admin/knowledge/:id', authenticate, requireAdmin, systemAssistantController.getKnowledgeById);
router.post('/admin/knowledge', authenticate, requireAdmin, systemAssistantController.createKnowledge);
router.put('/admin/knowledge/:id', authenticate, requireAdmin, systemAssistantController.updateKnowledge);
router.delete('/admin/knowledge/bulk-delete', authenticate, requireAdmin, systemAssistantController.bulkDeleteKnowledge);
router.delete('/admin/knowledge/:id', authenticate, requireAdmin, systemAssistantController.deleteKnowledge);

module.exports = router;
