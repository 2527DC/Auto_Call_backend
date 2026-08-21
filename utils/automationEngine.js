'use strict';

const { db } = require('../models');
const Form = db.Form;
const PaymentHistory = db.PaymentHistory;
const Template = db.WhatsAppTemplate;
const WhatsappWaba = db.WhatsappWaba;
const WhatsappPhoneNumber = db.WhatsappPhoneNumber;
const TeamMember = db.TeamMember;
const llmService = require('../services/llmService');
const appointmentService = require('../services/appointmentService');
const axios = require('axios');
const { sendMail } = require('../utils/mail');
const webhookDispatcher = require('../services/webhookDispatcher');

class AutomationEngine {
  constructor() {
    this.nodeHandlers = {
      message_output: this.executeMessageOutput.bind(this),
      input_capture: this.executeInputCapture.bind(this),
      decision_split: this.executeDecisionSplit.bind(this),
      redirect_call: this.executeRedirectCall.bind(this),
      terminate_call: this.executeTerminateCall.bind(this),
      book_slot: this.executeBookSlot.bind(this),
      team_alert: this.executeTeamAlert.bind(this),
      data_capture: this.executeDataCapture.bind(this),
      whatsapp_notice: this.executeWhatsAppNotice.bind(this),
      email_notice: this.executeEmailNotice.bind(this),
      variable_map: this.executeVariableMap.bind(this),
      audio_playback: this.executeAudioPlayback.bind(this),
    };
  }

  async executeFlowSync(flow, inputData = {}, startNodeId = null) {
    const executionLog = [];
    let currentData = { ...inputData };
    let currentNode;

    if (startNodeId) {
      currentNode = flow.nodes.find(n => n.id === startNodeId);
    } else {
      const incomingEdgeTargets = new Set(flow.edges.map(e => e.target));
      currentNode = flow.nodes.find(n => !incomingEdgeTargets.has(n.id));

      if (!currentNode && flow.nodes.length > 0) {
        currentNode = flow.nodes[0];
      }
    }

    if (!startNodeId) {
      const uId = inputData.userId || flow.user_id;
      if (uId) {
        webhookDispatcher.dispatchEvent(uId, 'Flow Initiated', { flowId: flow._id, name: flow.name });
      }
    }

    const startTime = Date.now();
    let steps = 0;
    const maxSteps = 50;

    while (currentNode && steps < maxSteps) {
      steps++;
      const nodeResult = await this.executeNode(currentNode, currentData);

      executionLog.push({
        node_id: currentNode.id,
        node_type: currentNode.type,
        status: nodeResult.success ? 'success' : 'failed',
        input: { ...currentData },
        output: nodeResult.output,
        error: nodeResult.error,
        timestamp: new Date()
      });

      if (!nodeResult.success) {
        const uId = inputData.userId || flow.user_id;
        if (uId) {
          webhookDispatcher.dispatchEvent(uId, 'Flow Errored', { flowId: flow._id, name: flow.name, error: nodeResult.error });
        }
        break;
      }

      currentData = { ...currentData, ...nodeResult.output };

      const waitForResponse = currentNode.data?.wait_for_response === true;
      const skipWaitNodes = ['team_alert', 'terminate_call'];

      const isExplicitGo = nodeResult.shouldPause === false;
      const nextNodeId = this.getNextNodeId(flow, currentNode.id, nodeResult.nextHandle);

      if (!isExplicitGo && (nodeResult.shouldPause === true || (waitForResponse && !skipWaitNodes.includes(currentNode.type)))) {
        if (currentNode.type === 'terminate_call' || currentNode.type === 'redirect_call') {
          const uId = inputData.userId || flow.user_id;
          if (uId) {
            webhookDispatcher.dispatchEvent(uId, 'Flow Finished', { flowId: flow._id, name: flow.name, type: currentNode.type });
          }
        }
        return {
          success: true,
          execution_time: Date.now() - startTime,
          logs: executionLog,
          final_data: currentData,
          currentNodeId: nodeResult.advanceOnPause ? nextNodeId : currentNode.id,
          shouldPause: true
        };
      }

      if (!nextNodeId) {
        const uId = inputData.userId || flow.user_id;
        if (uId) {
          webhookDispatcher.dispatchEvent(uId, 'Flow Finished', { flowId: flow._id, name: flow.name, type: 'end_of_nodes' });
        }
        break;
      }

      currentNode = flow.nodes.find(n => n.id === nextNodeId);
    }

    return {
      success: true,
      execution_time: Date.now() - startTime,
      logs: executionLog,
      final_data: currentData,
      currentNodeId: currentNode ? currentNode.id : null,
      shouldPause: false
    };
  }

  async executeNode(node, data) {
    const handler = this.nodeHandlers[node.type];
    if (!handler) {
      return { success: true, output: {}, error: `No handler for node type: ${node.type}` };
    }
    try {
      return await handler(node, data);
    } catch (error) {
      return { success: false, output: {}, error: error.message };
    }
  }

  getNextNodeId(flow, currentNodeId, sourceHandle = null) {
    const edge = flow.edges.find(e =>
      e.source === currentNodeId &&
      (sourceHandle ? e.sourceHandle === sourceHandle : true)
    );
    return edge ? edge.target : null;
  }

  async executeMessageOutput(node, data) {
    const msg = node.data.description || node.data.text;
    return { success: true, output: { last_message: msg, description: msg } };
  }

  async executeInputCapture(node, data) {
    const promptMsg = node.data.description || node.data.text;
    if (data.user_input) {
      const agent = data.agent || {};

      let personality = agent.personality || '';
      if (agent.custom_knowledge_base) {
        personality += `\n\nADDITIONAL KNOWLEDGE BASE:\n${agent.custom_knowledge_base}`;
      }

      const response = await llmService.generateResponse(
        data.user_input,
        personality,
        data.aiConfig?.model || agent.llm_model?.model_id,
        data.aiConfig
      );

      return {
        success: true,
        output: {
          prompt: promptMsg,
          description: promptMsg,
          user_input: data.user_input,
          last_message: response
        },
        shouldPause: false
      };
    }

    return { success: true, output: { prompt: promptMsg, description: promptMsg, last_message: promptMsg }, shouldPause: true };
  }

  async executeDecisionSplit(node, data) {
    if (node.data.condition === 'invoice_verified') {
      const invoiceNumber = data.extracted_data && data.extracted_data.invoice_number;
      let isAvailable = false;

      if (invoiceNumber) {

        const payment = await PaymentHistory.findOne({
          $or: [
            { transaction_id: invoiceNumber },
            { invoice_number: invoiceNumber }
          ],
          deleted_at: null
        });

        if (payment) {
          isAvailable = true;
        }
      }

      const nextHandle = isAvailable ? 'true' : 'false';
      return { success: true, output: { matched_condition: node.data.condition }, nextHandle };
    }

    if (node.data.condition) {
      const match = node.data.condition.match(/^([\w_]+)\s*(>=|<=|>|<|==|===|!=|!==)\s*(.+)$/);
      if (match) {
        const [_, key, op, val] = match;
        const actualValue = data[key] !== undefined ? data[key] : (data.form_responses && data.form_responses[key]);
        const numVal = parseFloat(val);
        const actualNum = parseFloat(actualValue);
        let result = false;
        if (!isNaN(actualNum) && !isNaN(numVal)) {
          switch (op) {
            case '>=': result = actualNum >= numVal; break;
            case '<=': result = actualNum <= numVal; break;
            case '>': result = actualNum > numVal; break;
            case '<': result = actualNum < numVal; break;
            case '==': case '===': result = actualNum === numVal; break;
            case '!=': case '!==': result = actualNum !== numVal; break;
          }
        } else {
          switch (op) {
            case '==': case '===': result = actualValue == val; break;
            case '!=': case '!==': result = actualValue != val; break;
          }
        }
        return { success: true, output: { matched_condition: result }, nextHandle: result ? 'true' : 'false' };
      } else if (data.user_input) {
        const result = await llmService.evaluateDecisionSplit(data.user_input, node.data.condition, data.aiConfig);
        return { success: true, output: { matched_condition: result }, nextHandle: result ? 'true' : 'false' };
      }
    }

    const conditions = node.data.conditions || [];
    const no_match_handle = node.data.no_match_handle;
    const userInput = (data.user_input || '').toLowerCase();

    for (const cond of conditions) {
      const isMatch = this.evaluateCondition(cond, userInput);
      if (isMatch) {
        return { success: true, output: { matched_condition: cond.id }, nextHandle: cond.sourceHandle };
      }
    }

    return { success: true, output: { matched_condition: 'default' }, nextHandle: no_match_handle };
  }

  evaluateCondition(condition, input) {
    const value = (condition.value || '').toLowerCase();
    switch (condition.operator) {
      case 'equals': return input === value;
      case 'contains': return input.includes(value);
      case 'starts_with': return input.startsWith(value);
      default: return false;
    }
  }

  async executeRedirectCall(node, data) {
    let phoneNumber = node.data.phone_number;
    if (node.data.member_id) {
      const member = await TeamMember.findById(node.data.member_id);
      if (member && member.phone_number) {
        phoneNumber = member.phone_number;
      }
    }
    console.log(`[Redirect Call] Transferring to ${phoneNumber}`);
    const transferTxt = node.data.description || node.data.text;
    return { success: true, output: { transfer_to: phoneNumber, transfer_text: transferTxt, description: transferTxt } };
  }

  async executeTerminateCall(node, data) {
    const endTxt = node.data.description || node.data.text;
    console.log(`[Terminate Call] ${endTxt || 'Goodbye'}`);
    return { success: true, output: { end_message: endTxt, description: endTxt, last_message: endTxt }, shouldPause: true };
  }

  async executeBookSlot(node, data) {
    console.log(`[Book Slot] Processing appointment booking node`);

    let details = {
      name: data.appointment_details?.name || null,
      date: data.appointment_details?.date || null,
      time: data.appointment_details?.time || null
    };

    let prompt = node.data.description || node.data.text || "May I have your full name and preferred date for the appointment?";
    if (details.name && !details.date && !details.time) {
      prompt = `Got it, ${details.name}. What is your preferred date for the appointment?`;
    } else if (!details.name && details.date && !details.time) {
      prompt = `Got it for ${details.date}. May I have your full name?`;
    } else if (details.name && details.date && !details.time) {
      prompt = `Got it. And what time would you prefer on ${details.date}?`;
    }

    if (data.user_input) {
      const input = data.user_input.trim();

      if (!input || input.length < 2) {
        return { success: true, output: {}, shouldPause: true };
      }

      try {
        const extracted = await llmService.extractAppointmentDetails(input, new Date(), data.aiConfig);

        if (extracted) {
          if (extracted.name) details.name = extracted.name;
          if (extracted.date) details.date = extracted.date;
          if (extracted.time) details.time = extracted.time;
        }

        console.log(`[Book Slot] Merged Details:`, details);

        if (!details.name && !details.date) {
          const msg = "Could you please provide your name and preferred date for the appointment?";
          return {
            success: true,
            output: {
              last_message: msg,
              description: msg,
              appointment_details: details
            },
            shouldPause: true
          };
        }

        if (details.name && !details.date) {
          const msg = `Got it, ${details.name}. What is your preferred date for the appointment?`;
          return {
            success: true,
            output: {
              last_message: msg,
              description: msg,
              appointment_details: details
            },
            shouldPause: true
          };
        }

        if (!details.name && details.date) {
          const msg = `Got it for ${details.date}. May I have your full name?`;
          return {
            success: true,
            output: {
              last_message: msg,
              description: msg,
              appointment_details: details
            },
            shouldPause: true
          };
        }

        if (!details.time) {
          const msg = `Got it. And what time would you prefer on ${details.date}?`;
          return {
            success: true,
            output: {
              last_message: msg,
              description: msg,
              appointment_details: details
            },
            shouldPause: true
          };
        }

        if (data.userId) {
          const availability = await appointmentService.checkAvailability(data.userId, details.date, details.time);

          if (!availability.available) {
            return {
              success: true,
              output: {
                last_message: `I'm sorry, that slot is not available. ${availability.reason} Could you suggest another date or time?`,
                description: `I'm sorry, that slot is not available. ${availability.reason} Could you suggest another date or time?`,
                appointment_details: { ...details, time: null }
              },
              shouldPause: true
            };
          }
        }

        const confirmMsg = `Perfect! I've noted your appointment for ${details.name} on ${details.date} at ${details.time}. Your appointment is confirmed.`;

        return {
          success: true,
          output: {
            last_message: confirmMsg,
            description: confirmMsg,
            appointment_details: details
          },
          shouldPause: false
        };
      } catch (err) {
        console.error(`[Book Slot] Error:`, err.message);
        return { success: true, output: {}, shouldPause: true };
      }
    }

    return { success: true, output: { last_message: prompt, description: prompt }, shouldPause: true };
  }

  async executeTeamAlert(node, data) {
    const webhookUrl = node.data.webhook_url;
    console.log(`[Team Alert] Sending notification to ${webhookUrl}`);

    if (webhookUrl) {
      try {
        await axios.post(webhookUrl, {
          event: 'appointment_booking_attempt',
          data: data
        });
      } catch (err) {
        console.error('[Team Alert] Webhook failed:', err.message);
      }
    }

    return { success: true, output: { alert_sent: true } };
  }

  async executeDataCapture(node, data) {
    console.log(`[Data Capture] Processing form node: ${node.id}`);

    const formId = node.data.form_id;
    const fieldName = node.data.field;

    if (!formId && fieldName) {
      let extractedData = data.extracted_data || {};

      if (data.user_input) {
        const extractedValue = await llmService.extractFormFieldValue(
          data.user_input,
          fieldName,
          node.data.question || node.data.text || node.data.description,
          data.aiConfig
        );

        if (extractedValue !== null) {
          extractedData[fieldName] = extractedValue;
          data.user_input = null;
          return {
            success: true,
            output: {
              extracted_data: extractedData,
              last_message: "Got it.",
              [fieldName]: extractedValue
            },
            shouldPause: false
          };
        } else {
          return {
            success: true,
            output: {
              last_message: `I didn't quite catch that. ${node.data.question || node.data.description}`
            },
            shouldPause: true
          };
        }
      }

      return {
        success: true,
        output: { last_message: node.data.question || node.data.description },
        shouldPause: true
      };
    }
    ``
    if (!formId) {
      return { success: false, output: {}, error: 'No form_id provided in node data' };
    }

    const form = await Form.findById(formId);
    if (!form) {
      return { success: false, output: {}, error: `Form with ID ${formId} not found` };
    }

    let responses = data.form_responses || {};
    let currentFieldIndex = data.current_field_index || 0;

    const fields = form.fields;
    if (currentFieldIndex >= fields.length) {
      return {
        success: true,
        output: {
          last_message: "Thank you for providing all the information.",
          form_completed: true
        },
        shouldPause: false
      };
    }

    const currentField = fields[currentFieldIndex];
    let prompt = currentField.question;

    if (data.user_input) {
      const extractedValue = await llmService.extractFormFieldValue(
        data.user_input,
        currentField.label,
        currentField.question,
        data.aiConfig
      );

      if (extractedValue !== null) {
        responses[currentField.key] = extractedValue;
        currentFieldIndex++;

        if (currentFieldIndex < fields.length) {
          const nextField = fields[currentFieldIndex];
          return {
            success: true,
            output: {
              last_message: `Got it. ${nextField.question}`,
              form_responses: responses,
              current_field_index: currentFieldIndex,
              form_id: formId
            },
            shouldPause: true
          };
        } else {
          const confirmMsg = node.data.confirmation_message || "Thank you! I've collected all the details. We will get back to you soon.";
          return {
            success: true,
            output: {
              last_message: confirmMsg,
              form_responses: responses,
              current_field_index: currentFieldIndex,
              form_completed: true,
              form_id: formId
            },
            shouldPause: false
          };
        }
      } else {
        return {
          success: true,
          output: {
            last_message: `I didn't quite catch that. ${currentField.question}`,
            form_responses: responses,
            current_field_index: currentFieldIndex,
            form_id: formId
          },
          shouldPause: true
        };
      }
    }

    return {
      success: true,
      output: {
        last_message: prompt,
        form_responses: responses,
        current_field_index: currentFieldIndex,
        form_id: formId
      },
      shouldPause: true
    };
  }

  async executeWhatsAppNotice(node, data) {
    const templateId = node.data?.template_id;
    console.log(`[WhatsApp Notice] Executing node with WhatsApp template ID: "${templateId || 'default'}"`);

    if (!templateId) {
      console.warn('[WhatsApp Notice] No template_id configured in node. Skipping WhatsApp send.');
      return { success: true, output: { whatsapp_sent: false, error: 'No template ID configured' } };
    }

    let recipientNumber = data.phone_number || data.phone || data.customer_phone || data.appointment_details?.phone;
    if (!recipientNumber && data.call) {
      recipientNumber = data.call.direction === 'inbound' ? data.call.from_number : data.call.to_number;
    }

    if (!recipientNumber) {
      console.warn('[WhatsApp Notice] Recipient phone number could not be determined. Skipping WhatsApp send.');
      return { success: true, output: { whatsapp_sent: false, error: 'Recipient phone number not found' } };
    }

    recipientNumber = String(recipientNumber).replace(/\D/g, '');

    try {

      const template = await Template.findById(templateId).lean();
      if (!template) {
        console.warn(`[WhatsApp Notice] WhatsApp template with ID "${templateId}" not found in database.`);
        return { success: true, output: { whatsapp_sent: false, error: 'Template not found' } };
      }

      const waba = await WhatsappWaba.findOne({ _id: template.waba_id, deleted_at: null }).lean();
      if (!waba) {
        console.warn('[WhatsApp Notice] WABA connection not found for template.');
        return { success: true, output: { whatsapp_sent: false, error: 'WABA connection not found' } };
      }

      const phoneNumDoc = await WhatsappPhoneNumber.findOne({ waba_id: waba._id, deleted_at: null }).lean();
      const phoneNumId = phoneNumDoc?.whatsapp_phone_number_id;

      if (!waba.access_token || !phoneNumId) {
        console.warn('[WhatsApp Notice] WhatsApp access token or phone number ID missing.');
        return { success: true, output: { whatsapp_sent: false, error: 'Credentials or Phone ID missing' } };
      }

      const bodyVariables = template.body_variables || [];
      const parameters = [];

      const details = data.appointment_details || {};
      const fallbacks = [
        details.name || 'Valued Customer',
        details.date || 'Scheduled Date',
        details.time || 'Scheduled Time'
      ];

      for (let i = 0; i < bodyVariables.length; i++) {
        const v = bodyVariables[i];
        const key = (v.key || '').toLowerCase();
        const example = (v.example || '').toLowerCase();

        let value = '';

        if (key.includes('name') || example.includes('john') || example.includes('doe') || example.includes('smith') || example.includes('client') || example.includes('customer')) {
          value = details.name;
        } else if (key.includes('date') || example.includes('202') || example.includes('oct') || example.includes('nov') || example.includes('dec') || example.includes('jan') || example.includes('feb') || example.includes('mar') || example.includes('apr') || example.includes('may') || example.includes('jun') || example.includes('jul') || example.includes('aug') || example.includes('sep') || example.includes('/') || example.includes('-')) {
          value = details.date;
        } else if (key.includes('time') || example.includes(':') || example.includes('am') || example.includes('pm') || example.includes('o\'clock')) {
          value = details.time;
        }

        if (!value) {
          value = fallbacks[i] || v.example || '';
        }

        parameters.push({
          type: 'text',
          text: String(value)
        });
      }

      const components = [];
      if (parameters.length > 0) {
        components.push({
          type: 'body',
          parameters: parameters
        });
      }

      const payload = {
        messaging_product: 'whatsapp',
        to: recipientNumber,
        type: 'template',
        template: {
          name: template.template_name,
          language: { code: template.language },
          components: components
        }
      };

      const response = await axios.post(
        `https://graph.facebook.com/v21.0/${phoneNumId}/messages`,
        payload,
        { headers: { Authorization: `Bearer ${waba.access_token}` } }
      );
      let messageSid = response.data?.messages?.[0]?.id || null;

      await db.WhatsAppLog.create({
        user_id: template.user_id,
        waba_id: waba._id,
        template_id: template._id,
        to_number: recipientNumber,
        message_sid: messageSid,
        status: 'sent',
        direction: 'outbound',
        call_id: data.call?._id || null
      });

      console.log(`[WhatsApp Notice] Message sent successfully to ${recipientNumber}. Message SID: ${messageSid}`);
      return { success: true, output: { whatsapp_sent: true, message_sid: messageSid } };

    } catch (error) {
      const errMsg = error.response?.data?.error?.message || error.message;
      console.error('[WhatsApp Notice] Error sending WhatsApp template message:', errMsg);

      try {
        const template = await Template.findById(templateId).lean();
        if (template) {
          await db.WhatsAppLog.create({
            user_id: template.user_id,
            waba_id: template.waba_id,
            template_id: template._id,
            to_number: recipientNumber,
            status: 'failed',
            direction: 'outbound',
            call_id: data.call?._id || null,
            error_message: errMsg
          });
        }
      } catch (logError) {
        console.error('[WhatsApp Notice] Failed to log failure:', logError.message);
      }

      return { success: true, output: { whatsapp_sent: false, error: errMsg } };
    }
  }

  async executeEmailNotice(node, data) {
    console.log(`[Email Notice] Processing email notification node`);
    
    let targetEmail = node.data.email || data.email || data.extracted_data?.email;
    
    if (!targetEmail) {
      if (data.user_input) {
        const extractedEmail = await llmService.extractFormFieldValue(
          data.user_input,
          'email',
          'What is your email address?',
          data.aiConfig
        );
        
        if (extractedEmail) {
           targetEmail = extractedEmail;
        } else {
          return {
            success: true,
            output: {
              last_message: "I didn't quite catch your email address. Could you please provide it?",
              description: "I didn't quite catch your email address. Could you please provide it?"
            },
            shouldPause: true
          };
        }
      } else {
        return {
          success: true,
          output: {
            last_message: "To send you the information, could you please provide your email address?",
            description: "To send you the information, could you please provide your email address?"
          },
          shouldPause: true
        };
      }
    }
    
    const templateId = node.data.template_id;
    if (templateId) {
      try {
        const EmailTemplate = db.EmailTemplate;
        const template = await EmailTemplate.findById(templateId);
        if (template && template.is_active) {
          let subject = template.subject;
          let body = template.body;
          
          await sendMail(targetEmail, subject, body);
          console.log(`[Email Notice] Sent email to ${targetEmail}`);
        }
      } catch (err) {
        console.error(`[Email Notice] Failed to send email to ${targetEmail}`, err.message);
      }
    }
    
    return { success: true, output: { email_sent: true, email: targetEmail }, shouldPause: false };
  }

  async executeVariableMap(node, data) {
    const variables = node.data.variables || [];
    let mapped = {};
    for (const v of variables) {
      if (v.key && v.value) {
        let valToAssign = v.value;
        if (data.form_responses && data.form_responses[v.value] !== undefined) {
          valToAssign = data.form_responses[v.value];
        } else if (data[v.value] !== undefined) {
          valToAssign = data[v.value];
        }
        mapped[v.key] = valToAssign;
      }
    }
    return { success: true, output: mapped, shouldPause: false };
  }

  async executeAudioPlayback(node, data) {
    const audioUrl = node.data.audio_url;
    return { success: true, output: { play_audio: audioUrl, description: node.data.description }, shouldPause: true, advanceOnPause: true };
  }
}

module.exports = new AutomationEngine();