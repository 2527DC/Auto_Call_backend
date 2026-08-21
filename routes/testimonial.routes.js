const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const testimonialController = require('../controllers/testimonial.controller');
const { uploader } = require('../utils/upload');

const testimonialUpload = uploader('testimonials');

router.get('/all', testimonialController.getActiveTestimonials);

router.use(authenticate);

router.get('/list', checkPermission('view.testimonials'), testimonialController.getAllTestimonials);
router.get('/:id', checkPermission('view.testimonials'), testimonialController.getTestimonialById);
router.post('/create', checkPermission('create.testimonials'), testimonialUpload.single('user_image'), testimonialController.createTestimonial);
router.put('/:id/update', checkPermission('update.testimonials'), testimonialUpload.single('user_image'), testimonialController.updateTestimonial);
router.put('/:id/update-status', checkPermission('update.testimonials'), testimonialController.updateTestimonialStatus);
router.delete('/delete', checkPermission('delete.testimonials'), testimonialController.deleteTestimonial);

module.exports = router;
