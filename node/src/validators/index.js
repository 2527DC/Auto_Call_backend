"use strict";

const { body } = require('express-validator');

const validateLicenseBody = [
  body('license').trim().notEmpty().withMessage('License key is required'),
  body('envato_username').trim().notEmpty().withMessage('Envato username is required')
];

const validateDbBody = [
  body('database.DB_HOST').trim().notEmpty().withMessage('Database host is required'),
  body('database.DB_DATABASE').trim().notEmpty().withMessage('Database name is required')
];

const getAdminValidators = () => [
  body('admin.first_name').trim().notEmpty().withMessage('First name is required'),
  body('admin.last_name').trim().notEmpty().withMessage('Last name is required'),
  body('admin.email').trim().isEmail().withMessage('Valid email is required'),
  body('admin.password').trim().isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
];

module.exports = {
  validateLicenseBody,
  validateDbBody,
  getAdminValidators
};
