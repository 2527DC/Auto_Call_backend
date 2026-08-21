const SmsSession = require('../models/sms-session.model');
const SmsMessage = require('../models/sms-message.model');
const TeamMember = require('../models/teamMember.model');
const smsAutomationService = require('../services/smsAutomationService');
const PhoneNumber = require('../models/phone-number.model');
const { db } = require('../models');
const TeamPermission = db.TeamPermission;
const Permission = db.Permission;
const { sendNotification } = require('../utils/notificationHelper');

exports.getSessions = async (req, res) => {
  try {
    const query = {};

    if (req.user.isTeamMember) {
      query.user_id = req.user.user_id;
      query.assigned_member_id = req.user._id;
    } else {
      query.user_id = req.user._id;
    }

    if (req.query.status) {
      query.status = req.query.status;
    }

    const sessions = await SmsSession.find(query)
      .populate('assigned_member_id', 'first_name last_name email avatar')
      .populate('campaign_id', 'name')
      .populate('contact_id', 'first_name last_name')

      .sort({ updated_at: -1 });

    res.status(200).json({ success: true, sessions });
  } catch (error) {
    console.error('getSessions error:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.getSessionMessages = async (req, res) => {
  try {
    const { id } = req.params;

    const session = await SmsSession.findById(id);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    if (session.user_id?.toString() !== (req.user.isTeamMember ? req.user.user_id.toString() : req.user._id.toString())) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this chat' });
    }

    const messages = await SmsMessage.find({ session_id: id }).sort({ created_at: 1 });

    res.status(200).json({ success: true, messages });
  } catch (error) {
    console.error('getSessionMessages error:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.assignSession = async (req, res) => {
  try {
    const { id } = req.params;
    const { member_id } = req.body;

    if (req.user.isTeamMember) {
      const hasPermission = req.user.permissionSlugs && req.user.permissionSlugs.includes('assign.sms_inbox');
      if (!hasPermission) {
        return res.status(403).json({ success: false, message: 'Permission denied: Missing assign.sms_inbox permission.' });
      }
    }

    const session = await SmsSession.findById(id);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    if (session.status === 'completed') {
      return res.status(400).json({ success: false, message: 'Cannot assign a Resolved Chat' });
    }



    if (session.assigned_member_id && member_id && session.assigned_member_id.toString() !== member_id.toString()) {
      return res.status(400).json({ success: false, message: 'This chat is already assigned to a team member' });
    }

    if (!req.user.isTeamMember && session.user_id?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    if (req.user.isTeamMember && session.user_id?.toString() !== req.user.user_id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (member_id) {
      if (req.user.isTeamMember && member_id !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Team members can only assign chats to themselves' });
      }

      const member = await TeamMember.findById(member_id);
      if (!member) {
        return res.status(404).json({ success: false, message: 'Team member not found' });
      }


      const replyPermissionDoc = await Permission.findOne({ slug: 'reply.sms_inbox' }).lean();
      if (replyPermissionDoc) {
        const hasReplyPermission = await TeamPermission.exists({
          team_id: member.team_id,
          permission_id: replyPermissionDoc._id
        });

        if (!hasReplyPermission) {
          return res.status(403).json({ success: false, message: 'Cannot assign chat. The team member does not have reply permissions.' });
        }
      }
    }

    session.assigned_member_id = member_id || null;
    await session.save();

    if (member_id && member_id.toString() !== req.user._id.toString()) {
      await sendNotification(
        req.app, 
        member_id, 
        'info', 
        'New SMS Chat Assigned', 
        `You have been assigned to a new SMS chat (Phone: ${session.phone_number}).`
      );
    }

    res.status(200).json({ success: true, message: 'Session assigned successfully', session });
  } catch (error) {
    console.error('assignSession error:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.sendManualReply = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }

    if (req.user.isTeamMember) {
      const hasPermission = req.user.permissionSlugs && req.user.permissionSlugs.includes('reply.sms_inbox');
      if (!hasPermission) {
        return res.status(403).json({ success: false, message: 'Permission denied: Missing reply.sms_inbox permission.' });
      }
    }

    const session = await SmsSession.findById(id).populate('user_id');
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    if (session.status === 'completed') {
      return res.status(400).json({ success: false, message: 'Cannot reply to a Resolved Chat' });
    }

    if (req.user.isTeamMember && session.assigned_member_id?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to reply to this chat' });
    } else if (!req.user.isTeamMember && session.user_id?._id?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to reply to this chat' });
    }

    const accountOwnerId = session.user_id?._id || session.user_id;
    const client = await smsAutomationService.getTwilioClient(accountOwnerId);
    if (!client) {
      return res.status(500).json({ success: false, message: 'Twilio configuration missing' });
    }

    const lastOurMessage = await SmsMessage.findOne({
      session_id: session._id,
      role: 'ai'
    }).sort({ created_at: -1 });

    const lastUserMessage = await SmsMessage.findOne({
      session_id: session._id,
      role: 'user'
    }).sort({ created_at: -1 });

    const phoneNumberRecord = await PhoneNumber.findOne({ user_id: accountOwnerId });

    let twilioFromNumber = null;
    if (phoneNumberRecord && phoneNumberRecord.phone_number) {
      twilioFromNumber = phoneNumberRecord.phone_number;
    }

    if (!twilioFromNumber) {
      return res.status(400).json({ success: false, message: 'Could not determine your Twilio sending number. Please ensure you have a Phone Number registered in the platform.' });
    }

    const twilioMsg = await client.messages.create({
      body: message,
      from: twilioFromNumber,
      to: session.phone_number
    });

    const newMsg = await SmsMessage.create({
      session_id: session._id,
      role: 'human_agent',
      content: message,
      twilio_message_sid: twilioMsg.sid
    });

    res.status(200).json({ success: true, message: 'Reply sent', data: newMsg });
  } catch (error) {
    console.error('sendManualReply error:', error);
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
};

exports.resolveSession = async (req, res) => {
  try {
    const { id } = req.params;

    const session = await SmsSession.findById(id);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }

    if (session.status === 'completed') {
      return res.status(400).json({ success: false, message: 'Chat is already completed' });
    }

    if (req.user.isTeamMember) {
      if (session.assigned_member_id?.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
      }
    } else if (session.user_id?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    session.status = 'completed';
    session.is_human_takeover = false;
    session.assigned_member_id = null;
    await session.save();

    res.status(200).json({ success: true, message: 'Session resolved successfully' });
  } catch (error) {
    console.error('resolveSession error:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.getReplyTeamMembers = async (req, res) => {
  try {
    const accountUserId = req.user.isTeamMember ? req.user.user_id : req.user._id;

    const replyPermissionDoc = await Permission.findOne({ slug: 'reply.sms_inbox' }).lean();
    let teamIds = [];
    if (replyPermissionDoc) {
      const teamPermissions = await TeamPermission.find({ permission_id: replyPermissionDoc._id }).lean();
      teamIds = teamPermissions.map(tp => tp.team_id);
    }

    let query = {
      user_id: accountUserId,
      team_id: { $in: teamIds },
      status: 'active'
    };

    if (req.user.isTeamMember) {
      query._id = req.user._id;
    }

    const members = await TeamMember.find(query).select('-password').lean();
    const memberIds = members.map(m => m._id);

    const sessionCounts = await SmsSession.aggregate([
      {
        $match: {
          assigned_member_id: { $in: memberIds },
          status: { $ne: 'completed' }
        }
      },
      {
        $group: {
          _id: '$assigned_member_id',
          count: { $sum: 1 }
        }
      }
    ]);

    const Call = db.Call;
    const callCounts = await Call.aggregate([
      {
        $match: {
          transfer_member_id: { $in: memberIds },
          is_transferred: true,
          "transfer_details.human_call_status": { $nin: ['completed', 'failed', 'missed', 'declined'] }
        }
      },
      {
        $group: {
          _id: '$transfer_member_id',
          count: { $sum: 1 }
        }
      }
    ]);

    const countMap = {};
    sessionCounts.forEach(c => {
      countMap[c._id.toString()] = c.count;
    });
    callCounts.forEach(c => {
      const idStr = c._id.toString();
      countMap[idStr] = (countMap[idStr] || 0) + c.count;
    });

    const result = members.map(m => ({
      ...m,
      assigned_tasks_count: countMap[m._id.toString()] || 0
    }));

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('getReplyTeamMembers error:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

