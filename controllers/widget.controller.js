const { db } = require('../models');
const Widget = db.Widget;
const Agent = db.Agent;
const UserSettings = db.UserSettings;
const Call = db.Call;
const crypto = require('crypto');
const twilio = require('twilio');
const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

exports.getWidgets = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', status, sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    
    const query = { user_id: req.user._id };
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { widget_key: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (status && status !== 'all') {
      query.status = status;
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const widgets = await Widget.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));
      
    const total = await Widget.countDocuments(query);
    const totalPages = Math.ceil(total / parseInt(limit));

    return res.status(200).json({ 
      success: true, 
      data: widgets,
      pagination: {
        total,
        page: parseInt(page),
        pages: totalPages
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getWidget = async (req, res) => {
  try {
    const widget = await Widget.findOne({ _id: req.params.id, user_id: req.user._id });
    if (!widget) {
      return res.status(404).json({ success: false, message: 'Widget not found' });
    }
    return res.status(200).json({ success: true, data: widget });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.createWidget = async (req, res) => {
  try {
    const { agent_id } = req.body;

    if (agent_id) {
      const agent = await Agent.findOne({ _id: agent_id, user_id: req.user._id });
      if (!agent) {
        return res.status(404).json({ success: false, message: 'Agent not found.' });
      }
      if (agent.type !== 'incoming') {
        return res.status(400).json({
          success: false,
          message: 'Only incoming type agents can be assigned to a widget. Flow agents are not supported.'
        });
      }
    }

    const widgetData = {
      ...req.body,
      user_id: req.user._id,
      widget_key: `wgt_${crypto.randomBytes(12).toString('hex')}`
    };
    const widget = await Widget.create(widgetData);
    return res.status(201).json({ success: true, data: widget });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateWidget = async (req, res) => {
  try {
    const { agent_id } = req.body;

    if (agent_id) {
      const agent = await Agent.findOne({ _id: agent_id, user_id: req.user._id });
      if (!agent) {
        return res.status(404).json({ success: false, message: 'Agent not found.' });
      }
      if (agent.type !== 'incoming') {
        return res.status(400).json({
          success: false,
          message: 'Only incoming type agents can be assigned to a widget. Flow agents are not supported.'
        });
      }
    }

    const widget = await Widget.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user._id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!widget) {
      return res.status(404).json({ success: false, message: 'Widget not found' });
    }
    return res.status(200).json({ success: true, data: widget });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.deleteWidget = async (req, res) => {
  try {
    const { widgetIds } = req.body;
    if (!Array.isArray(widgetIds) || widgetIds.length === 0) {
      return res.status(400).json({ success: false, message: 'widgetIds must be a non-empty array' });
    }

    const result = await Widget.deleteMany({ _id: { $in: widgetIds }, user_id: req.user._id });
    return res.status(200).json({
      success: true,
      message: `${result.deletedCount} Widgets deleted successfully`,
      deleted_count: result.deletedCount
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPublicWidget = async (req, res) => {
  try {
    const widget = await Widget.findOne({ widget_key: req.params.key, status: 'active' })
      .select('-user_id -created_at -updated_at')
      .lean();

    if (!widget) {
      return res.status(404).json({ success: false, message: 'Widget not found or inactive' });
    }

    return res.status(200).json({ success: true, data: widget });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getEmbedCode = async (req, res) => {
  try {
    const widget = await Widget.findOne({ _id: req.params.id, user_id: req.user._id });
    if (!widget) {
      return res.status(404).json({ success: false, message: 'Widget not found' });
    }

    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const embedCode = `<!-- ${widget.name} Voice Widget -->
<script>
  (function(w,d,s,o,f,js){
    w[o]=w[o]||function(){(w[o].q=w[o].q||[]).push(arguments)};
    js=d.createElement(s);js.id=o;js.src=f;js.async=1;
    (d.head||d.body).appendChild(js);
  }(window,document,'script','vw','${baseUrl}/widget/embed.js'));
  vw('init', '${widget.widget_key}');
</script>`;

    return res.status(200).json({ success: true, embed_code: embedCode });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getWidgetToken = async (req, res) => {
  try {
    const widget = await Widget.findOne({ widget_key: req.params.key, status: 'active' });
    if (!widget) return res.status(404).json({ success: false, message: 'Widget not found' });

    const userSettings = await UserSettings.findOne({ user: widget.user_id });
    const accountSid = userSettings?.twilio_account_sid || process.env.TWILIO_ACCOUNT_SID;
    const apiKey = process.env.TWILIO_API_KEY || process.env.TWILIO_ACCOUNT_SID;
    const apiSecret = process.env.TWILIO_API_SECRET || process.env.TWILIO_AUTH_TOKEN;
    const appSid = process.env.TWILIO_APP_SID;

    if (!accountSid || !apiKey || !apiSecret) {
      return res.status(400).json({ success: false, message: 'Twilio credentials not configured' });
    }

    const identity = `user_${Math.random().toString(36).substring(7)}`;
    const token = new AccessToken(accountSid, apiKey, apiSecret, { identity: identity });

    const grant = new VoiceGrant({
      outgoingApplicationSid: appSid,
      incomingAllow: true,
    });
    token.addGrant(grant);

    return res.status(200).json({ success: true, token: token.toJwt(), identity: identity });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPublicWidgetKey = async (req, res) => {
  try {
    const widget = await Widget.findOne({ status: 'active' }).select('widget_key').lean();
    if (!widget) {
      return res.status(404).json({ success: false, message: 'No active widget found' });
    }
    return res.status(200).json({ success: true, widget_key: widget.widget_key });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.handleWidgetVoice = async (req, res) => {
  try {
    const widgetKey = req.body.widgetKey || req.query.widgetKey;
    const widget = await Widget.findOne({ widget_key: widgetKey }).populate('agent_id');

    if (!widget || !widget.agent_id) {
      const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, this widget is not correctly configured with an active AI agent.</Say></Response>`;
      res.type('text/xml');
      return res.send(errorTwiml);
    }

    const flowId = widget.agent_id.flow_id || null;
    const agentId = widget.agent_id._id;
    const userId = widget.user_id;

    await Call.create({
      user_id: userId,
      flow_id: flowId,
      agent_id: agentId,
      twilio_call_sid: req.body.CallSid,
      from_number: 'Web Widget',
      to_number: widget.name,
      status: 'in-progress',
      direction: 'inbound'
    });

    const appUrl = process.env.APP_URL.replace('http', 'ws');

    let parametersXml = '';
    if (flowId && flowId !== 'undefined') {
      parametersXml += `<Parameter name="flowId" value="${flowId}" />\n`;
    }
    if (agentId && agentId !== 'undefined') {
      parametersXml += `<Parameter name="agentId" value="${agentId}" />\n`;
    }
    if (userId && userId !== 'undefined') {
      parametersXml += `<Parameter name="userId" value="${userId}" />`;
    }

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${appUrl}">
            ${parametersXml}
        </Stream>
    </Connect>
</Response>`;

    res.type('text/xml');
    res.send(twiml);
  } catch (err) {
    console.error('Widget Voice Error:', err);
    res.status(500).send('Error');
  }
};

exports.getWidgetAnalytics = async (req, res) => {
  try {
    const userId = req.user._id;

    const totalWidgets = await Widget.countDocuments({ user_id: userId });
    const activeWidgets = await Widget.countDocuments({ user_id: userId, status: 'active' });
    const totalWidgetCalls = await Call.countDocuments({ user_id: userId, from_number: 'Web Widget' });

    const widgetMinutesAgg = await Call.aggregate([
      {
        $match: {
          user_id: userId,
          from_number: 'Web Widget'
        }
      },
      {
        $group: {
          _id: '$to_number',
          totalCalls: { $sum: 1 },
          totalDurationSeconds: { $sum: '$duration' }
        }
      }
    ]);

    let overallDurationSeconds = 0;
    widgetMinutesAgg.forEach(w => overallDurationSeconds += w.totalDurationSeconds);
    const totalWidgetMinutes = Math.round(overallDurationSeconds / 60);

    const widgets = await Widget.find({ user_id: userId }).select('name status created_at').lean();
    const individualReports = widgets.map(widget => {
      const stats = widgetMinutesAgg.find(w => w._id === widget.name) || { totalCalls: 0, totalDurationSeconds: 0 };
      return {
        _id: widget._id,
        name: widget.name,
        status: widget.status,
        created_at: widget.created_at,
        totalCalls: stats.totalCalls,
        totalMinutes: Math.round(stats.totalDurationSeconds / 60),
        totalSeconds: stats.totalDurationSeconds
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        totalWidgets,
        activeWidgets,
        totalWidgetCalls,
        totalWidgetMinutes,
        totalWidgetSeconds: overallDurationSeconds,
        individualReports
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
