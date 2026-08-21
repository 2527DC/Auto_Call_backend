const twilio = require('twilio');
const plivoService = require('./plivoService');
const UserSettings = require('../models/user-settings.model');
const SmsSession = require('../models/sms-session.model');
const SmsMessage = require('../models/sms-message.model');
const SmsAgent = require('../models/sms-agent.model');
const llmService = require('./llmService');
const { sendMail } = require('../utils/mail');
const { sendNotification } = require('../utils/notificationHelper');
const User = require('../models/user.model');
const PhoneNumber = require('../models/phone-number.model');
const Contact = require('../models/contact.model');
const SMSLog = require('../models/sms-log.model');
const SMSCampaign = require('../models/sms-campaign.model');
const { db } = require('../models');


class SmsAutomationService {
  async getTwilioClient(userId) {
    if (!userId) return null;
    const settings = await UserSettings.findOne({ user: userId });
    const accountSid = settings?.twilio_account_sid || process.env.TWILIO_ACCOUNT_SID;
    const authToken = settings?.twilio_auth_token || process.env.TWILIO_AUTH_TOKEN;

    if (accountSid && authToken) {
      return twilio(accountSid, authToken);
    }
    return null;
  }

  async sendRescheduleSMS(userId, appointment) {
    try {
      const client = await this.getTwilioClient(userId);
      if (!client) return false;

      let fromNumber = null;

      if (appointment.call_id) {
        const Call = db.Call;
        const callLog = await Call.findById(appointment.call_id);
        if (callLog) {
          fromNumber = callLog.direction === 'inbound' ? callLog.to_number : callLog.from_number;
        }
      }

      if (!fromNumber) {
        const lastSession = await SmsSession.findOne({ user_id: userId, phone_number: appointment.phone })
          .sort({ created_at: -1 })
          .populate('campaign_id');
        if (lastSession && lastSession.campaign_id && lastSession.campaign_id.phone_number) {
           fromNumber = lastSession.campaign_id.phone_number;
        }
      }

      if (!fromNumber) {
        const phoneDoc = await PhoneNumber.findOne({ user_id: userId, status: "active", type: "purchased" });
        if (phoneDoc) {
          fromNumber = phoneDoc.phone_number;
        }
      }


      if (!fromNumber) {
        console.log(`[SMS] Failed to send reschedule SMS: No valid fromNumber found.`);
        return false;
      }


      const formattedDate = new Date(appointment.appointment_date).toDateString();
      const messageBody = `Hi ${appointment.name}, your appointment has been rescheduled to ${formattedDate} at ${appointment.appointment_time}. If this time does not work for you, please reply 'not possible' or 'rejected'.`;

      const phoneDocInfo = await PhoneNumber.findOne({ phone_number: fromNumber });
      const isPlivo = phoneDocInfo && phoneDocInfo.provider === 'plivo';

      let twilioMsgSid = '';
      if (isPlivo) {
        const settings = await UserSettings.findOne({ user: userId });
        const authId = settings?.plivo_auth_id || process.env.PLIVO_AUTH_ID;
        const authToken = settings?.plivo_auth_token || process.env.PLIVO_AUTH_TOKEN;
        if (authId && authToken) {
          const plivoMsg = await plivoService.sendSMS(authId, authToken, fromNumber, appointment.phone, messageBody);
          twilioMsgSid = plivoMsg.messageUuid[0];
        }
      } else {
        const twilioMsg = await client.messages.create({
          body: messageBody,
          from: fromNumber,
          to: appointment.phone
        });
        twilioMsgSid = twilioMsg.sid;
      }
      console.log(`[SMS] Reschedule SMS sent to ${appointment.phone}`);

      try {
        let session = await SmsSession.findOne({
          phone_number: appointment.phone,
          user_id: userId,
        }).sort({ created_at: -1 });

        if (!session) {
          const contactDoc = await Contact.findOne({ user_id: userId, phone_number: appointment.phone });
          session = await SmsSession.create({
            phone_number: appointment.phone,
            user_id: userId,
            contact_id: contactDoc ? contactDoc._id : null,
            status: 'human_takeover',
            is_human_takeover: true
          });
        } else if (session.status === 'resolved' || session.status === 'completed') {
          session.status = 'human_takeover';
          session.is_human_takeover = true;
          await session.save();
        }

        await SmsMessage.create({
          session_id: session._id,
          role: 'ai',
          content: messageBody,
          twilio_message_sid: twilioMsgSid
        });
      } catch (logErr) {
        console.error('[SMS] Failed to log reschedule SMS to Inbox:', logErr.message);
      }

      return true;
    } catch (error) {
      console.error('[SMS] Failed to send reschedule SMS:', error.message);
      return false;
    }
  }

  async handleIncomingMessage(fromNumber, toNumber, messageBody) {
    try {
      console.log(`[SMS] Received message from ${fromNumber} to ${toNumber}: "${messageBody}"`);

      let session = await SmsSession.findOne({
        phone_number: fromNumber,
        status: { $in: ['active', 'human_takeover'] }
      }).populate('user_id').populate('agent_id');

      if (!session) {
        const lastSession = await SmsSession.findOne({ phone_number: fromNumber }).sort({ created_at: -1 });

        if (lastSession) {
          const newSession = await SmsSession.create({
            phone_number: lastSession.phone_number,
            user_id: lastSession.user_id,
            campaign_id: lastSession.campaign_id,
            agent_id: lastSession.agent_id,
            contact_id: lastSession.contact_id,
            status: 'active',
            is_human_takeover: false,
            assigned_member_id: null
          });
          session = await SmsSession.findById(newSession._id).populate('user_id').populate('agent_id');
          console.log(`[SMS] Created new active session ${session._id} for ${fromNumber} from previous session.`);
        } else {

          const phoneDoc = await PhoneNumber.findOne({ phone_number: toNumber });
          let userId = phoneDoc && phoneDoc.user_id ? phoneDoc.user_id : null;

          const lastLog = await SMSLog.findOne({
            to_number: fromNumber,
            from_number: toNumber
          }).sort({ created_at: -1 });

          if (!userId && lastLog && lastLog.user_id) {
            userId = lastLog.user_id;
          }

          if (!userId) {
            console.log(`[SMS] No active or previous session found, and cannot determine user for toNumber ${toNumber}. Ignoring.`);
            return { success: true, message: 'No session and no user found' };
          }

          const contactDoc = await Contact.findOne({ user_id: userId, phone_number: fromNumber });

          let assignedAgentId = null;
          let assignedCampaignId = null;
          let isHumanTakeover = true;
          let sessionStatus = 'human_takeover';

          if (lastLog && lastLog.campaign_id) {
            const campaign = await SMSCampaign.findById(lastLog.campaign_id);
            if (campaign && campaign.smsAgentId) {
              assignedAgentId = campaign.smsAgentId;
              assignedCampaignId = campaign._id;
              isHumanTakeover = false;
              sessionStatus = 'active';
            }
          }

          const newSession = await SmsSession.create({
            phone_number: fromNumber,
            user_id: userId,
            contact_id: contactDoc ? contactDoc._id : null,
            campaign_id: assignedCampaignId,
            agent_id: assignedAgentId,
            status: sessionStatus,
            is_human_takeover: isHumanTakeover,
            assigned_member_id: null
          });

          if (!isHumanTakeover && lastLog && lastLog.message_body) {
            await SmsMessage.create({
              session_id: newSession._id,
              role: 'ai',
              content: lastLog.message_body,
              twilio_message_sid: lastLog.twilio_message_sid
            });
          }

          session = await SmsSession.findById(newSession._id).populate('user_id').populate('agent_id');
          console.log(`[SMS] Created brand new ${sessionStatus} session ${session._id} for ${fromNumber} upon first reply.`);

          if (isHumanTakeover && session.user_id) {
            const userId = session.user_id._id || session.user_id;
            await sendNotification(
              null,
              userId,
              'sms_human_handoff',
              'New SMS Message Received',
              `You received a new inbound SMS from ${fromNumber}.`,
              { session_id: session._id, phone_number: fromNumber }
            );

            const user = await User.findById(userId);
            if (user && user.email) {
              try {
                await sendMail(
                  user.email,
                  'New SMS Message Received',
                  `<p>You have received a new SMS message from ${fromNumber}.</p>
                   <p>Please log in to your SMS Inbox to review the conversation and reply manually.</p>`
                );
              } catch (e) {
                console.error('[SMS] Failed to send new chat email:', e.message);
              }
            }
          }
        }
      }

      await SmsMessage.create({
        session_id: session._id,
        role: 'user',
        content: messageBody
      });

      const textLower = messageBody.toLowerCase();
      const rejectKeywords = ['not possible', 'rejected'];
      const isReject = rejectKeywords.some(kw => textLower.includes(kw));

      if (isReject) {
        session.is_human_takeover = true;
        session.status = 'human_takeover';
        await session.save();

        const userId = session.user_id._id || session.user_id;
        
        await sendNotification(
          null,
          userId,
          'sms_appointment_rejected',
          'Appointment Reschedule Rejected',
          `Contact (${fromNumber}) rejected the rescheduled time.`,
          { session_id: session._id, phone_number: fromNumber }
        );

        const user = await User.findById(userId);
        if (user && user.email) {
          try {
            await sendMail(
              user.email,
              'Appointment Reschedule Rejected',
              `<p>A contact (${fromNumber}) has replied indicating that the rescheduled appointment time is <b>not possible</b>.</p>
               <p>Please log in to your dashboard to review the conversation and coordinate a new time.</p>`
            );
          } catch (e) {
            console.error('[SMS] Failed to send rejection email:', e.message);
          }
        }

        const client = await this.getTwilioClient(userId);
        if (client) {
          const standbyMsg = "Thank you for letting us know. A team member will review this and reach out to you shortly to coordinate a better time.";
          const phoneDocInfo = await PhoneNumber.findOne({ phone_number: toNumber });
          const isPlivo = phoneDocInfo && phoneDocInfo.provider === 'plivo';

          if (isPlivo) {
            const settings = await UserSettings.findOne({ user: userId });
            const authId = settings?.plivo_auth_id || process.env.PLIVO_AUTH_ID;
            const authToken = settings?.plivo_auth_token || process.env.PLIVO_AUTH_TOKEN;
            if (authId && authToken) {
              await plivoService.sendSMS(authId, authToken, toNumber, fromNumber, standbyMsg);
            }
          } else {
            await client.messages.create({
              body: standbyMsg,
              from: toNumber,
              to: fromNumber
            });
          }

          await SmsMessage.create({
            session_id: session._id,
            role: 'ai',
            content: standbyMsg
          });
        }
        
        return { success: true, message: 'Rejection handled' };
      }

      if (session.is_human_takeover) {
        console.log(`[SMS] Session ${session._id} is in human takeover mode. AI will not respond.`);
        return { success: true, message: 'In human takeover mode' };
      }

      const agent = session.agent_id;
      if (!agent) {
        console.log(`[SMS] No AI agent assigned to session ${session._id}. Cannot reply.`);
        return { success: false, message: 'No AI agent' };
      }

      const transferConfig = agent.transfer_to_human || {};
      let needsHuman = false;

      if (transferConfig.enabled) {
        const handoffKeywords = transferConfig.transfer_keywords || [];

        if (handoffKeywords.length > 0) {
          const textLower = messageBody.toLowerCase();
          needsHuman = handoffKeywords.some(kw => textLower.includes(kw.toLowerCase()));
        }
      }

      if (needsHuman) {
        session.is_human_takeover = true;
        session.status = 'human_takeover';
        await session.save();

        console.log(`[SMS] Human handoff triggered for session ${session._id}`);

        if (session.user_id) {
          const userId = session.user_id._id || session.user_id;

          await sendNotification(
            null,
            userId,
            'sms_human_handoff',
            'SMS Chat Needs Human Attention',
            `A contact (${fromNumber}) requested human assistance.`,
            { session_id: session._id, phone_number: fromNumber }
          );

          const user = await User.findById(userId);
          if (user && user.email) {
            try {
              await sendMail(
                user.email,
                'SMS Chat Needs Human Attention',
                `<p>A contact (${fromNumber}) has requested human assistance in an SMS campaign.</p>
                 <p>Please log in to your dashboard to review the conversation and reply manually.</p>`
              );
            } catch (e) {
              console.error('[SMS] Failed to send handoff email:', e.message);
            }
          }
        }

        const client = await this.getTwilioClient(session.user_id._id || session.user_id);
        if (client) {
          const standbyMsg = "I'm transferring you to a human agent. They will reply to you shortly.";
          const phoneDocInfo = await PhoneNumber.findOne({ phone_number: toNumber });
          const isPlivo = phoneDocInfo && phoneDocInfo.provider === 'plivo';

          if (isPlivo) {
            const settings = await UserSettings.findOne({ user: session.user_id._id || session.user_id });
            const authId = settings?.plivo_auth_id || process.env.PLIVO_AUTH_ID;
            const authToken = settings?.plivo_auth_token || process.env.PLIVO_AUTH_TOKEN;
            if (authId && authToken) {
              await plivoService.sendSMS(authId, authToken, toNumber, fromNumber, standbyMsg);
            }
          } else {
            await client.messages.create({
              body: standbyMsg,
              from: toNumber,
              to: fromNumber
            });
          }

          await SmsMessage.create({
            session_id: session._id,
            role: 'ai',
            content: standbyMsg
          });
        }

        return { success: true, message: 'Human handoff triggered' };
      }

      const messages = await SmsMessage.find({ session_id: session._id })
        .sort({ created_at: 1 })
        .limit(10);

      const conversationContext = messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
      const prompt = `Conversation history:\n${conversationContext}\n\nUser: ${messageBody}`;

      const settings = await UserSettings.findOne({ user: session.user_id._id || session.user_id }).populate('ai_model');
      const aiConfig = settings?.ai_model ? {
        model: settings.ai_model.model_id,
        apiKey: settings.ai_api_key,
        provider: settings.ai_model.provider
      } : null;

      const systemPrompt = `${agent.prompt}\n\nYou are an SMS AI Assistant. Keep answers strictly concise (1-2 sentences). Do not use emojis unless appropriate.`;

      console.log(`[SMS] Generating AI response for session ${session._id}...`);
      const aiResponse = await llmService.generateResponseWithSystemPrompt(
        prompt,
        systemPrompt,
        aiConfig?.model,
        aiConfig,
        null
      );

      if (aiResponse && aiResponse.trim()) {
        const client = await this.getTwilioClient(session.user_id._id || session.user_id);
        if (client) {
          const phoneDocInfo = await PhoneNumber.findOne({ phone_number: toNumber });
          const isPlivo = phoneDocInfo && phoneDocInfo.provider === 'plivo';
          let twilioMsgSid = '';
          
          if (isPlivo) {
            const settings = await UserSettings.findOne({ user: session.user_id._id || session.user_id });
            const authId = settings?.plivo_auth_id || process.env.PLIVO_AUTH_ID;
            const authToken = settings?.plivo_auth_token || process.env.PLIVO_AUTH_TOKEN;
            if (authId && authToken) {
              const plivoMsg = await plivoService.sendSMS(authId, authToken, toNumber, fromNumber, aiResponse);
              twilioMsgSid = plivoMsg.messageUuid[0];
            }
          } else {
            const twilioMsg = await client.messages.create({
              body: aiResponse,
              from: toNumber,
              to: fromNumber
            });
            twilioMsgSid = twilioMsg.sid;
          }

          await SmsMessage.create({
            session_id: session._id,
            role: 'ai',
            content: aiResponse,
            twilio_message_sid: twilioMsgSid
          });

          console.log(`[SMS] AI replied: "${aiResponse}"`);
        } else {
          console.error(`[SMS] Twilio client not found for user ${session.user_id._id}`);
        }
      }

      return { success: true, message: 'AI reply sent' };
    } catch (error) {
      console.error('[SMS Automation] Error handling incoming message:', error);
      return { success: false, message: 'Internal Server Error' };
    }
  }
}

module.exports = new SmsAutomationService();
