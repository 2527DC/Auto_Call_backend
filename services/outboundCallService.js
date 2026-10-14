'use strict';

const { db } = require('../models');
const { Call, UserSettings, Agent, PhoneNumber, Contact } = db;
const twilioService = require('./twilioService');
const creditService = require('./creditService');
const elevenLabsService = require('./elevenlabsService');
const webhookDispatcher = require('./webhookDispatcher');
const plivoService = require('./plivoService');
const { findContactByPhone } = require('../utils/phone');
const { isDoNotContact } = require('../utils/doNotContact');

const httpError = (status, message) => Object.assign(new Error(message), { status });

// Starts making the greeting audio so it is ready by the time the call is
// answered. Loaded on first use: the voice service pulls in much of the app.
const prepareGreeting = (args) => require('./voiceAutomationService').prepareGreeting(args);

// Places an outbound AI call and returns its call log. Used by the dialer and by
// WhatsApp automations. Errors carry the HTTP status the dialer should answer with.
// callFields: extra fields for the call record (e.g. follow_up_id, campaign_id).
const placeCall = async ({ userId, isAdmin = false, flowId, agentId, phoneNumber, fromNumber, callFields = {} }) => {
  const contact = await findContactByPhone(Contact, userId, phoneNumber);
  if (contact && contact.is_blocked) {
    throw httpError(403, 'This contact is blocked due to policy violations.');
  }
  if (isDoNotContact(contact)) {
    throw httpError(403, 'This person asked not to be called. Change their lead status first if they agreed to be contacted again.');
  }

  let agent;
  if (agentId) {
    agent = await Agent.findById(agentId);
    if (!agent) {
      throw httpError(404, 'Selected agent not found');
    }
  } else {
    agent = await Agent.findOne({ flow_id: flowId, type: 'flow', status: 'active' });
  }
  if (!agent) {
    throw httpError(400, 'This flow is not assigned to any active AI flow agent. Please assign a flow agent to the flow before placing a call.');
  }

  const settings = await UserSettings.findOne({ user: userId });
  if (!settings) {
    throw httpError(400, 'User settings not found');
  }

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    throw httpError(500, 'APP_URL not configured');
  }

  const sourceNumber = await PhoneNumber.findOne({ phone_number: fromNumber });
  if (!sourceNumber) {
    throw httpError(404, 'Source phone number not found in your account');
  }
  if (!isAdmin && sourceNumber.user_id && sourceNumber.user_id.toString() !== userId.toString()) {
    throw httpError(404, 'Source phone number not found in your account');
  }

  if (!(await creditService.hasCredits(userId))) {
    throw httpError(402, 'Insufficient credits. Please top up to place calls.');
  }

  let callLog;

  if (sourceNumber.type === 'sip' && sourceNumber.elevenlabs_phone_number_id && agent.elevenlabs_agent_id) {
    if (!settings.elevenlabs_api_key) {
      throw httpError(400, 'ElevenLabs API key not configured');
    }

    const sipResponse = await elevenLabsService.makeSipOutboundCall(
      agent.elevenlabs_agent_id,
      sourceNumber.elevenlabs_phone_number_id,
      phoneNumber,
      settings.elevenlabs_api_key
    );

    callLog = await Call.create({
      user_id: userId,
      flow_id: flowId,
      agent_id: agent._id,
      twilio_call_sid: sipResponse.sip_call_id || sipResponse.conversation_id || `sip_${Date.now()}`,
      from_number: fromNumber,
      to_number: phoneNumber,
      status: 'queued',
      direction: 'outbound',
      contact_id: contact ? contact._id : null,
      ...callFields
    });
    webhookDispatcher.dispatchEvent(userId, 'Call Initiated', callLog);
  } else if (sourceNumber.provider === 'plivo' || sourceNumber.type === 'sip') {
    const authId = settings.plivo_auth_id || process.env.PLIVO_AUTH_ID;
    const authToken = settings.plivo_auth_token || process.env.PLIVO_AUTH_TOKEN;
    if (!authId || !authToken) {
      throw httpError(400, 'Plivo settings not configured');
    }

    const xmlUrl = `${appUrl}/api/calls/plivo-xml?flowId=${flowId}&userId=${userId}&agentId=${agent._id.toString()}&dir=out&rec=${agent.enable_call_recording ? 1 : 0}`;
    const statusCallbackUrl = `${appUrl}/api/calls/plivo-status`;
    prepareGreeting({ agent, flowId, userId, userSettings: settings });

    const plivoCall = await plivoService.makeCall(
      authId,
      authToken,
      fromNumber,
      phoneNumber,
      xmlUrl,
      statusCallbackUrl,
      { agent }
    );

    callLog = await Call.create({
      user_id: userId,
      flow_id: flowId,
      agent_id: agent._id,
      twilio_call_sid: plivoCall.requestUuid,
      from_number: fromNumber,
      to_number: phoneNumber,
      status: 'queued',
      direction: 'outbound',
      contact_id: contact ? contact._id : null,
      ...callFields
    });
    webhookDispatcher.dispatchEvent(userId, 'Call Initiated', callLog);
  } else {
    if (!settings.twilio_account_sid || !settings.twilio_auth_token) {
      throw httpError(400, 'Twilio settings not configured');
    }

    const twimlUrl = `${appUrl}/api/calls/twiml?flowId=${flowId}&userId=${userId}&agentId=${agent._id.toString()}&dir=out`;
    const statusCallbackUrl = `${appUrl}/api/calls/status`;
    prepareGreeting({ agent, flowId, userId, userSettings: settings });

    const twilioCall = await twilioService.makeCall(
      settings.twilio_account_sid,
      settings.twilio_auth_token,
      fromNumber,
      phoneNumber,
      twimlUrl,
      statusCallbackUrl
    );

    callLog = await Call.create({
      user_id: userId,
      flow_id: flowId,
      agent_id: agent._id,
      twilio_call_sid: twilioCall.sid,
      from_number: fromNumber,
      to_number: phoneNumber,
      status: twilioCall.status || 'queued',
      direction: 'outbound',
      contact_id: contact ? contact._id : null,
      ...callFields
    });
    webhookDispatcher.dispatchEvent(userId, 'Call Initiated', callLog);
  }

  return callLog;
};

module.exports = { placeCall };
