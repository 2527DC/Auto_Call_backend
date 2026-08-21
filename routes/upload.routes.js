const express = require('express');
const router = express.Router();
const { uploadSingle } = require('../utils/upload');
const { authenticate } = require('../middlewares/auth');

router.post('/image', authenticate, uploadSingle('landing-page', 'image', ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const imagePath = `uploads/landing-page/${req.file.filename}`;
    
    return res.status(200).json({
      message: 'Image uploaded successfully',
      imagePath: imagePath,
      filename: req.file.filename
    });
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ message: 'Error uploading image' });
  }
});

module.exports = router;
