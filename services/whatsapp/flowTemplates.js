'use strict';

// Starter flows for the WhatsApp automation builder. Each step sits under the
// previous one; branches spread sideways, ~310px apart so the cards don't touch.

const node = (id, type, x, y, data = {}) => ({ id, type, position: { x, y }, data });
const edge = (source, target, sourceHandle = 'next') => ({ id: `e_${source}_${sourceHandle}_${target}`, source, sourceHandle, target });

const TEMPLATES = {
  blank: {
    name: 'New automation',
    description: '',
    trigger: { type: 'keyword', keywords: ['hi'], match: 'contains' },
    nodes: [node('start', 'start', 250, 0)],
    edges: [],
  },

  welcome_menu: {
    name: 'Welcome menu',
    description: 'Greets the customer and offers three buttons.',
    trigger: { type: 'keyword', keywords: ['hi', 'hello', 'menu'], match: 'contains' },
    nodes: [
      node('start', 'start', 250, 0),
      node('menu', 'buttons', 250, 150, {
        text: 'Hi {{contact.first_name}}! 👋 Welcome. How can we help you today?',
        buttons: [
          { id: 'services', title: 'Our services' },
          { id: 'pricing', title: 'Pricing' },
          { id: 'team', title: 'Talk to us' },
        ],
      }),
      node('services', 'message', -60, 380, { text: 'Here is what we offer:\n• Service one\n• Service two\n• Service three\n\nReply "menu" any time to see the options again.' }),
      node('pricing', 'message', 250, 380, { text: 'Our plans start at ₹999 a month. Reply "menu" to go back, or tap "Talk to us" for a custom quote.' }),
      node('team', 'handoff', 560, 380, { text: 'Thanks! A team member will reply to you shortly.', status: 'pending' }),
    ],
    edges: [edge('start', 'menu'), edge('menu', 'services', 'btn:services'), edge('menu', 'pricing', 'btn:pricing'), edge('menu', 'team', 'btn:team')],
  },

  lead_capture: {
    name: 'Lead capture',
    description: 'Asks for name, email and requirement, saves the contact and hands over to the team.',
    trigger: { type: 'keyword', keywords: ['enquiry', 'interested', 'quote'], match: 'contains' },
    nodes: [
      node('start', 'start', 250, 0),
      node('ask_name', 'question', 250, 140, { text: 'Great! What is your name?', variable: 'name', validation: 'any' }),
      node('ask_email', 'question', 250, 300, { text: 'Thanks {{vars.name}}. What is your email address?', variable: 'email', validation: 'email' }),
      node('ask_need', 'question', 250, 460, { text: 'In a line or two, what are you looking for?', variable: 'requirement', validation: 'any' }),
      node('save', 'contact', 250, 620, { fields: { first_name: '{{vars.name}}', email: '{{vars.email}}' }, add_labels: ['lead'] }),
      node('thanks', 'handoff', 250, 780, { text: 'Thank you, {{vars.name}}! Our team will get back to you soon.', status: 'pending', note: 'New lead: {{vars.requirement}}' }),
    ],
    edges: [edge('start', 'ask_name'), edge('ask_name', 'ask_email'), edge('ask_email', 'ask_need'), edge('ask_need', 'save'), edge('save', 'thanks')],
  },

  ai_faq: {
    name: 'AI answers questions',
    description: 'The AI answers from your knowledge base until the customer asks for a person.',
    trigger: { type: 'keyword', keywords: ['question', 'help', 'info'], match: 'contains' },
    nodes: [
      node('start', 'start', 250, 0),
      node('ai', 'ai_reply', 250, 140, {
        mode: 'chat',
        intro_text: 'Hi! Ask me anything about our services. Type "agent" any time to talk to a person.',
        exit_keywords: ['agent', 'human', 'person'],
        max_turns: 10,
      }),
      node('team', 'handoff', 250, 320, { text: 'Connecting you to our team. Someone will reply shortly.', status: 'pending' }),
    ],
    edges: [edge('start', 'ai'), edge('ai', 'team')],
  },

  book_appointment: {
    name: 'Book an appointment',
    description: 'Offers free slots from your appointment settings and books the one chosen.',
    trigger: { type: 'keyword', keywords: ['book', 'appointment', 'slot'], match: 'contains' },
    nodes: [
      node('start', 'start', 250, 0),
      node('ask_name', 'question', 250, 140, { text: 'Sure! What name should we book it under?', variable: 'name', validation: 'any' }),
      node('slots', 'appointment', 250, 300, {
        text: 'Thanks {{vars.name}}. Pick a time that suits you:',
        button_label: 'Choose a time',
        days_ahead: 7,
        slot_minutes: 30,
        name_variable: 'name',
        confirm_text: 'You\'re booked for {{appointment_date}} at {{appointment_time}}. See you then! {{meet_link}}',
      }),
      node('done', 'end', 60, 500, { text: 'Reply "book" any time to make another booking.' }),
      node('no_slots', 'handoff', 440, 500, { text: 'A team member will contact you to find a time.', status: 'pending' }),
    ],
    edges: [edge('start', 'ask_name'), edge('ask_name', 'slots'), edge('slots', 'done', 'booked'), edge('slots', 'no_slots', 'failed')],
  },
};

const fromTemplate = (key) => JSON.parse(JSON.stringify(TEMPLATES[key] || TEMPLATES.blank));

module.exports = { TEMPLATES, fromTemplate };
