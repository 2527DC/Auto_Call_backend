const { db } = require('../models');
const Notification = db.Notification;

exports.sendNotification = async (app, userId, type, title, message, data = {}) => {
  try {
    const notification = await Notification.create({
      user_id: userId,
      type,
      title,
      message,
      data,
    });

    const io = (app && typeof app.get === 'function') ? app.get('io') : null;
    if (io) {
      io.to(`user_${userId}`).emit('new-notification', notification);
    }
    
    return notification;
  } catch (error) {
    console.error('sendNotification Error:', error);
  }
};
