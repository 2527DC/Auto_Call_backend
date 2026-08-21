'use strict';

const plivo = require('plivo');

class PlivoService {
  async getNumbers(authId, authToken) {
    try {
      const client = new plivo.Client(authId, authToken);
      const response = await client.numbers.list();
      
      return {
        purchased: response.map(n => ({
          phone_number: n.number.startsWith('+') ? n.number : '+' + n.number,
          sid: n.number, 
          friendly_name: n.alias || n.number,
          type: 'purchased'
        })),
        verified: [] 
      };
    } catch (error) {
      console.error('Plivo Service Error:', error.message);
      throw new Error(`Failed to fetch numbers from Plivo: ${error.message}`);
    }
  }

  async makeCall(authId, authToken, from, to, url, statusCallbackUrl = null) {
    try {
      const client = new plivo.Client(authId, authToken);
      
      const callOptions = {
        answerUrl: url,
        answerMethod: 'POST',
      };

      if (statusCallbackUrl) {
        callOptions.fallbackUrl = statusCallbackUrl;
        callOptions.fallbackMethod = 'POST';
      }

      const call = await client.calls.create(from, to, url, callOptions);
      return call;
    } catch (error) {
      console.error('Plivo Make Call Error:', error.message);
      throw new Error(`Failed to place call via Plivo: ${error.message}`);
    }
  }

  async sendSMS(authId, authToken, from, to, body) {
    try {
      const client = new plivo.Client(authId, authToken);
      const message = await client.messages.create(
        from,
        to,
        body
      );
      return message;
    } catch (error) {
      console.error('Plivo Send SMS Error:', error.message);
      throw new Error(`Failed to send SMS via Plivo: ${error.message}`);
    }
  }

  async getCallStatus(authId, authToken, callUuid) {
    try {
      const client = new plivo.Client(authId, authToken);
      const call = await client.calls.get(callUuid);
      return call.callState;
    } catch (error) {
      console.error('Plivo Get Call Status Error:', error.message);
      throw new Error(`Failed to fetch call status from Plivo: ${error.message}`);
    }
  }
}

module.exports = new PlivoService();
