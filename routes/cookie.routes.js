const express = require('express');
const router = express.Router();
const cookieController = require('../controllers/cookie.controller');

router.post('/consent', cookieController.saveConsent);

module.exports = router;
