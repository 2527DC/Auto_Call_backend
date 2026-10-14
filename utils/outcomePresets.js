'use strict';

// Call outcomes (what happened on one call) and lead statuses (where the person
// stands across all calls), with the presets a client starts from. Every
// outcome carries fixed flags, so reports, retries and "do not call" keep
// working whatever a client renames or adds:
//   reached     - we spoke to the person
//   result      - good | bad | neutral
//   next_step   - none | retry | follow_up | team_task
//   stops_calls - never call or message this number again
//   lead_status - the contact's status after this outcome
//   system      - set by rules, never chosen by the AI

const NOT_REACHED = [
  { key: 'no_answer', label: 'No answer', description: 'The call rang but nobody answered.', reached: false, result: 'neutral', next_step: 'retry', lead_status: 'attempting', system: true },
  { key: 'busy', label: 'Busy', description: 'The line was busy or the call was declined.', reached: false, result: 'neutral', next_step: 'retry', lead_status: 'attempting', system: true },
  { key: 'voicemail', label: 'Voicemail / switched off', description: 'Voicemail, or the phone was switched off or unreachable.', reached: false, result: 'neutral', next_step: 'retry', lead_status: 'attempting', system: true },
  { key: 'hung_up_early', label: 'Hung up at once', description: 'Answered but hung up within seconds without speaking.', reached: false, result: 'neutral', next_step: 'retry', lead_status: 'attempting', system: true },
  { key: 'failed', label: 'Invalid number / failed', description: 'The call could not be placed (invalid number, blocked or a network error).', reached: false, result: 'bad', next_step: 'none', lead_status: 'attempting', system: true },
];

const REACHED = [
  { key: 'goal_achieved', label: 'Goal achieved', description: "The call achieved its purpose, as described in the agent's success description.", reached: true, result: 'good', next_step: 'none', lead_status: 'converted' },
  { key: 'interested', label: 'Interested', description: 'Showed clear interest, but the goal was not completed on this call.', reached: true, result: 'good', next_step: 'follow_up', lead_status: 'interested' },
  { key: 'call_back', label: 'Call back requested', description: 'Asked to be called at another time.', reached: true, result: 'neutral', next_step: 'follow_up', lead_status: 'follow_up' },
  { key: 'needs_info', label: 'Needs more information', description: 'Wants details (price, brochure, location) before deciding.', reached: true, result: 'neutral', next_step: 'follow_up', lead_status: 'interested' },
  { key: 'query_answered', label: 'Query answered', description: "The caller's question was answered and nothing more is needed.", reached: true, result: 'good', next_step: 'none', lead_status: 'contacted' },
  { key: 'not_interested', label: 'Not interested', description: 'Clearly said they are not interested.', reached: true, result: 'bad', next_step: 'none', lead_status: 'not_interested' },
  { key: 'not_eligible', label: 'Not eligible', description: "Doesn't meet the requirements (budget, location, experience, age...).", reached: true, result: 'bad', next_step: 'none', lead_status: 'not_qualified' },
  { key: 'wrong_number', label: 'Wrong number / wrong person', description: 'Not the person we wanted, or a wrong number.', reached: true, result: 'bad', next_step: 'none', lead_status: 'invalid' },
  { key: 'do_not_call', label: 'Do not call', description: 'Asked never to be called or messaged again.', reached: true, result: 'bad', next_step: 'none', stops_calls: true, lead_status: 'do_not_call' },
  { key: 'complaint', label: 'Complaint / wants a person', description: 'Has a complaint, is upset, or asked to talk to a person.', reached: true, result: 'neutral', next_step: 'team_task', lead_status: 'contacted' },
  { key: 'transferred', label: 'Transferred to team', description: 'The call was handed to a team member.', reached: true, result: 'neutral', next_step: 'none', lead_status: 'contacted' },
  { key: 'couldnt_understand', label: "Couldn't understand", description: 'Language, noise or a bad line made the conversation impossible.', reached: true, result: 'neutral', next_step: 'team_task', lead_status: 'contacted' },
  { key: 'call_dropped', label: 'Call dropped midway', description: 'The call ended before the purpose was reached, without a refusal.', reached: true, result: 'neutral', next_step: 'retry', lead_status: 'contacted' },
  { key: 'needs_review', label: 'Needs review', description: 'Unclear; a person should check this call.', reached: true, result: 'neutral', next_step: 'team_task', lead_status: null, system: true },
];

// kind: open (still working on it), won, lost, closed (stop all contact).
const LEAD_STATUSES = [
  { key: 'new', label: 'New', kind: 'open' },
  { key: 'attempting', label: 'Attempting', kind: 'open' },
  { key: 'contacted', label: 'Contacted', kind: 'open' },
  { key: 'interested', label: 'Interested', kind: 'open' },
  { key: 'follow_up', label: 'Follow-up', kind: 'open' },
  { key: 'converted', label: 'Converted', kind: 'won' },
  { key: 'not_interested', label: 'Not interested', kind: 'lost' },
  { key: 'not_qualified', label: 'Not qualified', kind: 'lost' },
  { key: 'invalid', label: 'Invalid number', kind: 'lost' },
  { key: 'unreachable', label: 'Unreachable', kind: 'lost' },
  { key: 'do_not_call', label: 'Do not call', kind: 'closed' },
];

// What changes per type of business: names, the default success description
// and the details worth collecting. Flags never change.
const PRESETS = {
  general: {
    label: 'General',
    success: 'The caller got what they needed, or agreed to the next step.',
    outcomes: {},
    statuses: {},
    fields: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'requirement', label: 'Requirement', type: 'text' }],
  },
  clinic: {
    label: 'Clinic / hospital',
    success: 'An appointment was booked.',
    outcomes: { goal_achieved: 'Appointment booked' },
    statuses: { converted: 'Patient' },
    fields: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'problem', label: 'Problem', type: 'text' }, { key: 'preferred_date', label: 'Preferred date', type: 'date' }, { key: 'doctor', label: 'Doctor', type: 'text' }],
  },
  real_estate: {
    label: 'Real estate',
    success: 'A site visit was booked.',
    outcomes: { goal_achieved: 'Site visit booked' },
    statuses: { converted: 'Booked' },
    fields: [{ key: 'budget', label: 'Budget (lakhs)', type: 'number' }, { key: 'location', label: 'Location', type: 'text' }, { key: 'bhk', label: 'BHK', type: 'choice', options: ['1BHK', '2BHK', '3BHK', '4BHK+'] }, { key: 'timeline', label: 'Buying timeline', type: 'text' }],
  },
  education: {
    label: 'Education / admissions',
    success: 'A counselling session was booked or an application was started.',
    outcomes: { goal_achieved: 'Counselling booked' },
    statuses: { converted: 'Enrolled' },
    fields: [{ key: 'course', label: 'Course', type: 'text' }, { key: 'city', label: 'City', type: 'text' }, { key: 'qualification', label: 'Qualification', type: 'text' }, { key: 'start_term', label: 'Start term', type: 'text' }],
  },
  sales: {
    label: 'Sales / lead generation',
    success: 'A meeting or demo was booked.',
    outcomes: { goal_achieved: 'Meeting booked' },
    statuses: { converted: 'Customer' },
    fields: [{ key: 'company', label: 'Company', type: 'text' }, { key: 'need', label: 'Need', type: 'text' }, { key: 'budget', label: 'Budget', type: 'text' }, { key: 'timeline', label: 'Timeline', type: 'text' }],
  },
  support: {
    label: 'Support desk',
    success: "The caller's issue was resolved on the call.",
    outcomes: { goal_achieved: 'Issue resolved' },
    statuses: { converted: 'Resolved' },
    fields: [{ key: 'order_id', label: 'Order ID', type: 'text' }, { key: 'issue_type', label: 'Issue type', type: 'text' }],
  },
  payments: {
    label: 'Payment reminders',
    success: 'The person promised to pay by a date, or has already paid.',
    outcomes: { goal_achieved: 'Promise to pay' },
    statuses: { converted: 'Paid' },
    fields: [{ key: 'promised_date', label: 'Promised date', type: 'date' }, { key: 'amount', label: 'Amount', type: 'number' }],
  },
  recruitment: {
    label: 'Recruitment',
    success: 'The candidate meets the requirements and wants to go ahead.',
    // The AI only shortlists; a person decides hiring and rejection.
    outcomes: { goal_achieved: 'Shortlisted (to confirm)', not_eligible: 'Not shortlisted (AI)' },
    statuses: { converted: 'Hired', interested: 'Shortlisted', not_qualified: 'Not shortlisted' },
    leadStatusOverride: { goal_achieved: 'interested' },
    fields: [{ key: 'total_experience', label: 'Experience (years)', type: 'number' }, { key: 'skills', label: 'Skills', type: 'text' }, { key: 'notice_period', label: 'Notice period', type: 'text' }, { key: 'expected_ctc', label: 'Expected CTC', type: 'text' }],
  },
};

const clone = (v) => JSON.parse(JSON.stringify(v));

// The full settings a client starts with for a preset.
function presetSettings(presetKey = 'general') {
  const preset = PRESETS[presetKey] || PRESETS.general;
  const outcomes = [...NOT_REACHED, ...REACHED].map((o, i) => ({
    ...clone(o),
    label: preset.outcomes[o.key] || o.label,
    lead_status: preset.leadStatusOverride?.[o.key] ?? o.lead_status ?? null,
    stops_calls: !!o.stops_calls,
    system: !!o.system,
    archived: false,
    order: i,
  }));
  const lead_statuses = LEAD_STATUSES.map((s, i) => ({ ...clone(s), label: preset.statuses[s.key] || s.label, order: i }));
  return { preset: PRESETS[presetKey] ? presetKey : 'general', success_description: preset.success, outcomes, lead_statuses };
}

const presetList = () => Object.entries(PRESETS).map(([key, p]) => ({ key, label: p.label, success: p.success, fields: p.fields }));

// Twilio and Plivo call statuses that mean nobody was reached, and the outcome for each.
const STATUS_OUTCOME = {
  'no-answer': 'no_answer',
  missed: 'no_answer',
  busy: 'busy',
  declined: 'busy',
  failed: 'failed',
  canceled: 'no_answer',
};

module.exports = { NOT_REACHED, REACHED, LEAD_STATUSES, PRESETS, presetSettings, presetList, STATUS_OUTCOME };
