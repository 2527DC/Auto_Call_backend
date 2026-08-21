const creditService = require('../services/creditService');

exports.getCreditBalance = async (req, res) => {
  try {
    const userId = req.user.id;
    const balance = await creditService.getCreditBalance(userId);

    res.json({
      success: true,
      data: balance
    });
  } catch (error) {
    console.error('Get Credit Balance Error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to get credit balance' });
  }
};

exports.getCreditUsageHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const history = await creditService.getCreditUsageHistory(userId, page, limit);

    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('Get Credit Usage History Error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to get credit usage history' });
  }
};

exports.getCreditStatistics = async (req, res) => {
  try {
    const userId = req.user.id;
    const statistics = await creditService.getCreditStatistics(userId);

    res.json({
      success: true,
      data: statistics
    });
  } catch (error) {
    console.error('Get Credit Statistics Error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to get credit statistics' });
  }
};
