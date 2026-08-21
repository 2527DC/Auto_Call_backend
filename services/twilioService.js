'use strict';

const twilio = require('twilio');

class TwilioService {
  async getNumbers(accountSid, authToken) {
    try {
      const client = twilio(accountSid, authToken);

      const purchasedResponse = await client.incomingPhoneNumbers.list();
      const verifiedResponse = await client.outgoingCallerIds.list();

      return {
        purchased: purchasedResponse.map(n => ({
          phone_number: n.phoneNumber,
          sid: n.sid,
          friendly_name: n.friendlyName,
          type: 'purchased'
        })),
        verified: verifiedResponse.map(n => ({
          phone_number: n.phoneNumber,
          sid: n.sid,
          friendly_name: n.friendlyName,
          type: 'verified'
        }))
      };
    } catch (error) {
      console.error('Twilio Service Error:', error.message);
      throw new Error(`Failed to fetch numbers from Twilio: ${error.message}`);
    }
  }

  async makeCall(accountSid, authToken, from, to, url, statusCallbackUrl = null) {
    try {
      const client = twilio(accountSid, authToken);
      const callOptions = {
        url,
        to,
        from,
        record: true
      };

      if (statusCallbackUrl) {
        callOptions.statusCallback = statusCallbackUrl;
        callOptions.statusCallbackMethod = 'POST';
        callOptions.statusCallbackEvent = ['initiated', 'ringing', 'answered', 'completed'];

        callOptions.recordingStatusCallback = statusCallbackUrl.replace('/status', '/recording-callback');
        callOptions.recordingStatusCallbackMethod = 'POST';
        callOptions.recordingStatusCallbackEvent = ['completed'];
      }

      const call = await client.calls.create(callOptions);
      return call;
    } catch (error) {
      console.error('Twilio Make Call Error:', error.message);
      throw new Error(`Failed to place call via Twilio: ${error.message}`);
    }
  }
  async sendSMS(accountSid, authToken, from, to, body) {
    try {
      const client = twilio(accountSid, authToken);
      const message = await client.messages.create({
        body,
        from,
        to
      });
      return message;
    } catch (error) {
      console.error('Twilio Send SMS Error:', error.message);
      throw new Error(`Failed to send SMS via Twilio: ${error.message}`);
    }
  }

  async getCallStatus(accountSid, authToken, callSid) {
    try {
      const client = twilio(accountSid, authToken);
      const call = await client.calls(callSid).fetch();
      return call.status;
    } catch (error) {
      console.error('Twilio Get Call Status Error:', error.message);
      throw new Error(`Failed to fetch call status from Twilio: ${error.message}`);
    }
  }
}

module.exports = new TwilioService();
