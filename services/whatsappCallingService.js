const axios = require('axios');
const { db } = require('../models');
const { WhatsappPhoneNumber } = db;
const webrtcService = require('./whatsappWebrtcService');

const WHATSAPP_API_VERSION = 'v21.0';
const WHATSAPP_GRAPH_API_APP_URL = 'https://graph.facebook.com';

class WhatsappCallingService {

    async getAccessTokenForPhone(phoneNumberId) {
        const phone = await WhatsappPhoneNumber.findOne({
            whatsapp_phone_number_id: phoneNumberId, deleted_at: null
        }).populate('waba_id');

        if (!phone || !phone.waba_id || !phone.waba_id.access_token) {
            throw new Error(`Valid Phone Number or Access Token not found for phone_number_id: ${phoneNumberId}`);
        }
        return phone.waba_id.access_token;
    }

    async sendCallEvent(phoneNumberId, callId, event, session = null) {
        try {
            const accessToken = await this.getAccessTokenForPhone(phoneNumberId);
            console.log("accessToken", accessToken);
            const url = `${WHATSAPP_GRAPH_API_APP_URL}/${WHATSAPP_API_VERSION}/${phoneNumberId}/calls`;

            const payload = { messaging_product: 'whatsapp', call_id: callId, action: event };
            if (session) payload.session = session;

            const response = await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            return response.data;
        } catch (error) {
            console.error(`Error sending call event ${event}:`, error.response?.data || error.message);
            throw error;
        }
    }

    async initiateOutboundCallApi(phoneNumberId, to, sdpOffer, bizData = {}) {
        try {
            const accessToken = await this.getAccessTokenForPhone(phoneNumberId);
            const url = `${WHATSAPP_GRAPH_API_APP_URL}/${WHATSAPP_API_VERSION}/${phoneNumberId}/calls`;

            const payload = {
                messaging_product: 'whatsapp',
                to: to,
                action: 'connect',
                session: {
                    sdp_type: 'offer',
                    sdp: sdpOffer
                },
                biz_opaque_callback_data: JSON.stringify(bizData)
            };

            const response = await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            return response.data;
        } catch (error) {
            console.error(`Error initiating outbound call:`, error.response?.data || error.message);
            throw error;
        }
    }

    async answerCall(phoneNumberId, callId, sdpOffer, agent, contact, callLog) {
        const sdpAnswer = await webrtcService.answerCall(callId, phoneNumberId, sdpOffer, agent, contact, callLog);

        await this.sendCallEvent(phoneNumberId, callId, 'PRE_ACCEPT', { sdp_type: 'answer', sdp: sdpAnswer });

        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.sendCallEvent(phoneNumberId, callId, 'ACCEPT', { sdp_type: 'answer', sdp: sdpAnswer });
    }

    async connectOutboundCall(phoneNumberId, callId, sdpAnswer, agent, contact, callLog) {
        return webrtcService.connectOutboundCall(callId, sdpAnswer, agent, contact, callLog);
    }

    async terminateCall(phoneNumberId, callId) {
        return this.sendCallEvent(phoneNumberId, callId, 'terminate');
    }
}

module.exports = new WhatsappCallingService();
