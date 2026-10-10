'use strict';

require('dotenv').config();
const { db, mongoose } = require('../models');
const SystemAssistantKnowledge = db.SystemAssistantKnowledge;
const User = db.User;

const articles = [
  {
    title: 'How Workflows and Flows Run During Calls',
    category: 'flows',
    route_match: ['/workflow-builder', '/workflow-builder/*'],
    order: 1,
    tags: ['flow', 'workflow', 'engine', 'turns', 'call-lifecycle'],
    content: `# How Workflows Run During Phone Calls

A workflow (called a **Flow**) is a visual call script made up of nodes (actions) and edges (connecting arrows).

### Key Execution Rules:
1. **Flow Agent Requirement:** A flow runs only when assigned to an AI Voice Agent of type \`flow\` (\`flow_id\`). Outbound campaigns and incoming calls use the agent's flow.
2. **Turn-Based Execution:** Calls operate in turns. On each turn:
   - The engine starts at the active node.
   - Nodes execute sequentially and generate messages.
   - All spoken messages (\`last_message\`) in that turn are joined and spoken as one natural voice reply.
   - The engine pauses when waiting for customer speech (e.g. at an Input Capture or Data Capture node).
3. **Resuming on Customer Speech:** When the caller replies, Speech-to-Text converts their voice to \`user_input\` and resumes at the paused node.
4. **Always End with Terminate Call:** If a branch has no outgoing arrow and is not Terminate Call, the call stays open and the last node repeats. Always finish call branches with a **Terminate Call** or **Redirect Call** node.`
  },
  {
    title: 'Workflow Node: Message Output',
    category: 'workflow_nodes',
    route_match: ['/workflow-builder', '/workflow-builder/*'],
    order: 2,
    tags: ['node', 'message_output', 'greeting', 'speak', 'announcement'],
    content: `# Message Output Node (\`message_output\`)

### Purpose
Speaks a statement or announcement to the caller without waiting for a response, then immediately executes the next connected node.

### Settings & Fields:
- **Label:** Display name on the canvas (e.g., "Greeting", "Company Intro").
- **Description / Message:** The exact sentence or script the AI agent speaks out loud.

### Runtime Behavior:
- Speaks the configured message.
- Does **not** pause the call. If followed immediately by another talking node (such as an Input Capture asking a question), both messages are spoken together in one seamless sentence.

### Example:
- Message Output: *"Hi Priya, thanks for calling Acme Dental."*
- Followed by Input Capture: *"Are you calling to book an appointment or ask about billing?"*
- Result: Spoken together naturally in one breath.

### Best Practices:
- Use for greetings, disclosures, confirmations, and announcements.
- Do not check \`wait_for_response\` on this node; if you need the caller's answer, connect an **Input Capture** node immediately after it.`
  },
  {
    title: 'Workflow Node: Input Capture',
    category: 'workflow_nodes',
    route_match: ['/workflow-builder', '/workflow-builder/*'],
    order: 3,
    tags: ['node', 'input_capture', 'question', 'listen', 'speech-to-text', 'branch'],
    content: `# Input Capture Node (\`input_capture\`)

### Purpose
Asks the caller a question, pauses the engine, and listens for their speech response.

### Settings & Fields:
- **Label:** Display name (e.g., "Ask Intent", "Interested Question").
- **Question / Description:** The question spoken to the caller (e.g., *"Are you looking to buy or sell a property?"*).

### Runtime Behavior:
1. **Asking the Question:** Speaks the question and pauses the call while listening for caller speech.
2. **Capturing the Answer:** When the caller finishes speaking, speech-to-text saves the answer into \`user_input\`.
3. **Routing vs AI Answer:**
   - **If connected to a next node (e.g., Decision Split):** Passes \`user_input\` forward immediately to evaluate conditions.
   - **If placed as the final node with no outgoing arrow:** Acts as an open conversational AI! It answers the caller's question using the agent's prompt and knowledge base, allowing flexible free-form Q&A.

### Best Practices:
- Connect directly to a **Decision Split** node to branch the call based on what the caller said (yes/no, booking interest, options).`
  },
  {
    title: 'Workflow Node: Decision Split & Branching Logic',
    category: 'workflow_nodes',
    route_match: ['/workflow-builder', '/workflow-builder/*'],
    order: 4,
    tags: ['node', 'decision_split', 'branching', 'conditions', 'logic', 'true-false'],
    content: `# Decision Split Node (\`decision_split\`)

### Purpose
Evaluates the caller's last response using AI reasoning to branch the workflow down different paths (e.g. Yes vs No, Interested vs Not Interested).

### Settings & Fields:
- **Label:** Display name (e.g., "Check Interest", "Wants Human Agent?").
- **Condition:** Natural language condition describing what causes the \`true\` path (e.g., *"Caller said yes, agrees, or wants to schedule a demo"*).

### Output Handles:
- **True handle (\`true\`):** Takes this arrow if the caller's response matches the condition.
- **False handle (\`false\`):** Takes this arrow if the caller's response does not match the condition.

### Runtime Behavior:
- Does not speak anything to the caller.
- Uses LLM intelligence to evaluate whether \`user_input\` satisfies the condition (returns \`match: true\` or \`false\`).
- Immediately routes the conversation to the corresponding connected node.

### Example Configuration:
- Input Capture: *"Would you like to book a dental checkup this week?"*
- Decision Split Condition: *"Caller wants an appointment or says yes"*
  - **True path** -> Connects to **Book Slot** node.
  - **False path** -> Connects to **Message Output** (*"No problem! Can I help you with anything else?"*).`
  },
  {
    title: 'Workflow Node: Book Slot (Appointments & Calendars)',
    category: 'workflow_nodes',
    route_match: ['/workflow-builder', '/workflow-builder/*'],
    order: 5,
    tags: ['node', 'book_slot', 'appointment', 'calendar', 'scheduling', 'booking'],
    content: `# Book Slot Node (\`book_slot\`)

### Purpose
Conducts an interactive booking conversation during the call to collect appointment details (name, date, time) and creates the event in Google Calendar.

### Settings & Fields:
- **Calendar:** Select the connected Google Calendar from Toolbox Hub.
- **Duration:** Appointment length in minutes (e.g. 30 minutes, 60 minutes).
- **Timezone:** User's calendar timezone.

### Runtime Behavior:
- Extracts \`{ name, date, time }\` from what the caller says.
- If pieces of information are missing (e.g. caller gave a date but not a time), the node asks follow-up questions to gather the missing details.
- Once all details are confirmed, it schedules the event on the connected calendar and outputs \`appointment_details\`.

### Best Practices:
- Ensure Google Calendar is authorized under **Toolbox Hub -> Google Workspace**.
- Connect a **Message Output** or **Terminate Call** node after it to confirm the booking (*"Great! Your appointment is scheduled for Friday at 3 PM. Goodbye!"*).`
  },
  {
    title: 'Workflow Node: Data Capture (Lead Forms & Fields)',
    category: 'workflow_nodes',
    route_match: ['/workflow-builder', '/workflow-builder/*'],
    order: 6,
    tags: ['node', 'data_capture', 'forms', 'leads', 'survey', 'fields', 'collection'],
    content: `# Data Capture Node (\`data_capture\`)

### Purpose
Collects structured customer information field by field during a phone call using pre-configured Lead Capture Forms.

### Two Modes of Operation:
1. **Form Mode (Recommended):**
   - Select a Lead Capture Form created under **Toolbox Hub -> Lead Capture Forms**.
   - The engine automatically asks for each form field sequentially (e.g., Name -> Email -> Company -> Budget).
   - Once all questions are answered, \`form_completed\` becomes true, and all answers are saved to the call log under \`form_responses\`.
2. **Single Field Mode:**
   - Define a single custom field key, question, and expected data type.

### Best Practices:
- Keep phone form questions brief and conversational.
- All collected answers survive after call pauses and appear in **Call Activity -> Extracted Data**.`
  },
  {
    title: 'Workflow Node: Redirect Call (Live Call Transfer)',
    category: 'workflow_nodes',
    route_match: ['/workflow-builder', '/workflow-builder/*'],
    order: 7,
    tags: ['node', 'redirect_call', 'transfer', 'human-agent', 'live-transfer'],
    content: `# Redirect Call Node (\`redirect_call\`)

### Purpose
Transfers the live caller to a human agent, manager, or external phone number.

### Settings & Fields:
- **Transfer Phone Number (\`transfer_to\`):** The phone number in E.164 format (e.g., \`+1234567890\` or \`+919876543210\`).
- **Transfer Message:** Spoken announcement before transferring (e.g., *"Please hold while I connect you with our support team."*).

### Runtime Behavior:
- Speaks the transfer announcement to the caller.
- Issues a telecom call transfer command to the telephony provider (Plivo / Twilio).
- Ends the AI agent session and connects the caller to the target phone number.

### Best Practices:
- Always use the full country code format (\`+\` followed by country code and number).
- Frequently paired after a Decision Split (*"Caller asks to speak to a human or representative"*).`
  },
  {
    title: 'Workflow Node: Terminate Call',
    category: 'workflow_nodes',
    route_match: ['/workflow-builder', '/workflow-builder/*'],
    order: 8,
    tags: ['node', 'terminate_call', 'hangup', 'end-call', 'goodbye'],
    content: `# Terminate Call Node (\`terminate_call\`)

### Purpose
Speaks a polite closing or goodbye message and hangs up the telephone call.

### Settings & Fields:
- **End Message / Description:** The final sentence spoken before disconnecting (e.g., *"Thank you for your time. Have a wonderful day! Goodbye."*).

### Runtime Behavior:
- Speaks the end message via Text-to-Speech.
- Sends the telecom hang-up signal to terminate the call session immediately after speaking.
- Dispatches the \`Flow Finished\` webhook.

### Best Practices:
- Every path and branch in a workflow must end with a **Terminate Call** node (or Redirect Call) to prevent calls from hanging open awkwardly.`
  },
  {
    title: 'Workflow Nodes: WhatsApp, Email & Audio Playback',
    category: 'workflow_nodes',
    route_match: ['/workflow-builder', '/workflow-builder/*'],
    order: 9,
    tags: ['node', 'whatsapp_notice', 'email_notice', 'audio_playback', 'multimedia'],
    content: `# Specialized Communication Nodes

### 1. WhatsApp Notice (\`whatsapp_notice\`)
- **Purpose:** Automatically sends a WhatsApp template message to the caller's phone number during or immediately following the call.
- **Prerequisite:** An approved WhatsApp template configured under **WhatsApp Templates**.
- **Use Case:** Sending a booking confirmation link, brochure, or address directions while talking to the customer.

### 2. Email Notice (\`email_notice\`)
- **Purpose:** Sends an email notification to the customer or team.
- **Behavior:** If the customer's email address is not already known from the contact list or prior form step, the agent verbally asks the caller for their email address and then sends the email.

### 3. Audio Playback (\`audio_playback\`)
- **Purpose:** Plays a pre-recorded audio file (MP3/WAV) on the call instead of AI Text-to-Speech.
- **Use Case:** Playing hold music, legal disclaimers, or pre-recorded IVR messages.`
  },
  {
    title: 'Workflow Recipes: Building Common Call Flows',
    category: 'flows',
    route_match: ['/workflow-builder', '/workflow-builder/*'],
    order: 10,
    tags: ['recipes', 'flow-examples', 'appointment-flow', 'lead-qualification', 'support'],
    content: `# Step-by-Step Flow Recipes

### Recipe 1: Lead Qualification Flow
1. **Message Output:** *"Hello! Thanks for your interest in our services."*
2. **Input Capture:** *"Are you currently looking to get started within the next 30 days?"*
3. **Decision Split:** Condition = *"Caller says yes, agreed, or looking soon"*
   - **True Path:**
     - **Data Capture:** Lead Form (Collects Name, Email, Budget).
     - **Terminate Call:** *"Thank you! Our senior team will reach out to you shortly. Goodbye!"*
   - **False Path:**
     - **Terminate Call:** *"No problem at all! Feel free to visit our website when you're ready. Have a great day!"*

### Recipe 2: Appointment Scheduling Flow
1. **Message Output:** *"Thanks for calling Acme Clinic."*
2. **Input Capture:** *"Would you like to schedule an appointment today?"*
3. **Decision Split:** Condition = *"Caller wants to schedule or says yes"*
   - **True:** **Book Slot** node (connects to Google Calendar) -> **Terminate Call** (*"Your appointment is confirmed. Goodbye!"*).
   - **False:** **Terminate Call** (*"Alright, have a wonderful day! Goodbye."*).

### Recipe 3: Call Transfer / Escalation Flow
1. **Message Output:** *"Hello! How can I help you today?"*
2. **Input Capture:** (Listens to caller's request).
3. **Decision Split:** Condition = *"Caller asks for an agent, supervisor, billing help, or human"*
   - **True:** **Redirect Call** -> Number = \`+1234567890\` (*"Connecting you right now, please hold."*).
   - **False:** **Input Capture** (Free-form AI questions & answers).`
  }
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');

    const admin = await User.findOne({ email: process.env.ADMIN_EMAIL || 'chethanr@dhatri.info' });

    for (const art of articles) {
      await SystemAssistantKnowledge.findOneAndUpdate(
        { title: art.title },
        {
          ...art,
          is_active: true,
          created_by: admin?._id || null
        },
        { upsert: true, new: true }
      );
      console.log(`✓ Seeded: ${art.title}`);
    }

    console.log('Knowledge articles seeding completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
}

seed();
