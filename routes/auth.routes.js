const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const passport = require('../config/passport');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { uploadSingle } = require('../utils/upload');

router.post('/register', authController.register);
router.post('/register-verify-otp', authController.verifyRegistration)
router.post('/login', authController.login);

router.get('/google/signup', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback', passport.authenticate('google', { session: false, failureRedirect: '/login' }), authController.googleCallback);

router.get('/facebook/signup', passport.authenticate('facebook', { scope: ['email', 'public_profile'] }));
router.get('/facebook/callback', passport.authenticate('facebook', { session: false, failureRedirect: '/login' }), authController.facebookCallback);

router.post('/team-member/login', authController.teamMemberLogin);
router.get('/team-member/profile', authenticate, authController.getTeamMemberProfile);

router.post('/request-password-reset', authController.requestPasswordReset);
router.post('/verify-otp', authController.verifyOTP);
router.post('/resend-otp', authController.resendOTP);
router.post('/reset-password', authController.resetPassword);

router.get('/profile', authenticate, authController.getProfile);
router.put('/profile', authenticate, uploadSingle('avatars', 'avatar'), authController.updateProfile);
router.post('/change-password', authenticate, authController.changePassword);

router.post('/logout', authenticate, authController.logout);

module.exports = router;
