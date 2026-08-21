const { db } = require('../models');
const Notification = db.Notification;

exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const notifications = await Notification.find({ user_id: userId })
      .sort({ created_at: -1 })
      .limit(50);

    const unreadCount = await Notification.countDocuments({ user_id: userId, is_read: false });

    res.status(200).json({ success: true, notifications, unreadCount });
  } catch (error) {
    console.error('getNotifications Error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user._id || req.user.id;

    if (id === 'all') {
      await Notification.updateMany({ user_id: user_id, is_read: false }, { is_read: true });
    } else {
      await Notification.findOneAndUpdate({ _id: id, user_id: user_id }, { is_read: true });
    }

    res.status(200).json({ success: true, message: 'Updated successfully' });
  } catch (error) {
    console.error('markAsRead Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
