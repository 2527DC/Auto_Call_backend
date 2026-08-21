const ViolenceWord = require('../models/violence-word.model');
const Call = require('../models/call.model');
const Contact = require('../models/contact.model');
const EmailDispatcher = require('../services/emailDispatcher');

exports.addRestrictedWord = async (req, res) => {
  try {
    const { word, severity_level, is_active } = req.body;

    if (!word) {
      return res.status(400).json({ error: 'Word is required' });
    }

    const existingWord = await ViolenceWord.findOne({ word: word.toLowerCase() });
    if (existingWord) {
      return res.status(400).json({ error: 'Word already exists' });
    }

    const newWord = new ViolenceWord({
      word,
      severity_level,
      is_active,
      user_id: req.user ? req.user._id : undefined
    });

    await newWord.save();
    res.status(201).json({ message: 'Violence word added successfully', data: newWord });
  } catch (error) {
    console.error('Error adding violence word:', error);
    res.status(500).json({ error: 'Server error adding violence word' });
  }
};

exports.getRestrictedWords = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';

    const query = {};
    if (search) {
      query.word = { $regex: search, $options: 'i' };
    }

    const total = await ViolenceWord.countDocuments(query);
    const words = await ViolenceWord.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.status(200).json({
      data: words,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching violence words:', error);
    res.status(500).json({ error: 'Server error fetching violence words' });
  }
};

exports.updateRestrictedWord = async (req, res) => {
  try {
    const { id } = req.params;
    const { word, severity_level, is_active } = req.body;

    const wordToUpdate = await ViolenceWord.findById(id);
    if (!wordToUpdate) {
      return res.status(404).json({ error: 'Violence word not found' });
    }

    if (word) wordToUpdate.word = word;
    if (severity_level) wordToUpdate.severity_level = severity_level;
    if (typeof is_active !== 'undefined') wordToUpdate.is_active = is_active;

    await wordToUpdate.save();
    res.status(200).json({ message: 'Violence word updated successfully', data: wordToUpdate });
  } catch (error) {
    console.error('Error updating violence word:', error);
    res.status(500).json({ error: 'Server error updating violence word' });
  }
};

exports.deleteRestrictedWord = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedWord = await ViolenceWord.findByIdAndDelete(id);

    if (!deletedWord) {
      return res.status(404).json({ error: 'Violence word not found' });
    }

    res.status(200).json({ message: 'Violence word deleted successfully' });
  } catch (error) {
    console.error('Error deleting violence word:', error);
    res.status(500).json({ error: 'Server error deleting violence word' });
  }
};


exports.getRestrictedUsers = async (req, res) => {
  try {
    const users = await ViolenceUser.find()
      .populate('contact_id', 'first_name last_name phone_number email is_blocked')
      .populate('call_id', 'twilio_call_sid status recording_url')
      .sort({ createdAt: -1 });

    res.status(200).json({ data: users });
  } catch (error) {
    console.error('Error fetching flagged violence users:', error);
    res.status(500).json({ error: 'Server error fetching flagged users' });
  }
};

exports.getRestrictedUserByCallId = async (req, res) => {
  try {
    const { call_id } = req.params;
    const userLog = await ViolenceUser.findOne({ call_id })
      .populate('contact_id')
      .populate('call_id');

    if (!userLog) {
      return res.status(404).json({ error: 'No violence record found for this call' });
    }

    res.status(200).json({ data: userLog });
  } catch (error) {
    console.error('Error fetching violence user details:', error);
    res.status(500).json({ error: 'Server error fetching details' });
  }
};

exports.scanCallTranscript = async (req, res) => {
  try {
    const { call_id } = req.params;
    const userId = req.user.id;
    const violenceWords = await ViolenceWord.find({ is_active: true });

    if (call_id === 'all') {
      const calls = await Call.find({ user_id: userId, 'transcript.0': { $exists: true } });
      let scannedCount = 0;
      for (const currentCallLog of calls) {
        const transcriptText = currentCallLog.transcript
          .filter(t => t.role === 'user')
          .map(t => t.text)
          .join(' ')
          .toLowerCase();

        const detectedWords = violenceWords
          .filter(vw => transcriptText.includes(vw.word.toLowerCase()))
          .map(vw => vw.word);

        if (detectedWords.length > 0) {
          currentCallLog.detected_words = [...new Set(detectedWords)];
          currentCallLog.has_restricted_words = true;
          currentCallLog.transcript_snippet = transcriptText;
          await currentCallLog.save();
        } else {
          if (currentCallLog.has_restricted_words || (currentCallLog.detected_words && currentCallLog.detected_words.length > 0)) {
            currentCallLog.detected_words = [];
            currentCallLog.has_restricted_words = false;
            currentCallLog.transcript_snippet = '';
            await currentCallLog.save();
          }
        }
        scannedCount++;
      }
      return res.status(200).json({ message: 'All calls scanned', scannedCount });
    }

    const currentCallLog = await Call.findById(call_id);
    if (!currentCallLog) {
      return res.status(404).json({ error: 'Call not found' });
    }

    const transcriptText = currentCallLog.transcript
      .filter(t => t.role === 'user')
      .map(t => t.text)
      .join(' ')
      .toLowerCase();

    const detectedWords = violenceWords
      .filter(vw => transcriptText.includes(vw.word.toLowerCase()))
      .map(vw => vw.word);

    if (detectedWords.length > 0) {
      currentCallLog.detected_words = [...new Set(detectedWords)];
      currentCallLog.has_restricted_words = true;
      currentCallLog.transcript_snippet = transcriptText;
      await currentCallLog.save();
      
      return res.status(200).json({ message: 'Violations found', violations: currentCallLog.detected_words });
    } else {
      currentCallLog.detected_words = [];
      currentCallLog.has_restricted_words = false;
      currentCallLog.transcript_snippet = '';
      await currentCallLog.save();
      return res.status(200).json({ message: 'No violations detected', violations: [] });
    }

  } catch (error) {
    console.error('Error scanning call transcript:', error);
    res.status(500).json({ error: 'Server error scanning transcript' });
  }
};

exports.takeAction = async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;

    if (!['block', 'warning', 'unblock'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Must be block, warning, or unblock.' });
    }

    const call = await Call.findById(id);
    if (!call) {
      return res.status(404).json({ error: 'Call log not found' });
    }

    let contact = null;
    if (call.contact_id) {
      contact = await Contact.findById(call.contact_id);
    }

    if (!contact) {
      const phone = call.direction === 'outbound' ? call.to_number : call.from_number;
      if (phone) {
        contact = await Contact.findOne({ user_id: call.user_id, phone_number: phone });
        if (!contact) {
          contact = await Contact.create({
            user_id: call.user_id,
            phone_number: phone,
            first_name: call.lead_name || 'Unknown',
            last_name: 'Caller'
          });
        }
        call.contact_id = contact._id;
        await call.save();
      }
    }

    if (!contact) {
      return res.status(400).json({ error: 'Unable to identify contact for this action' });
    }

    if (action === 'block') {
      contact.is_blocked = true;
      await contact.save();
      return res.status(200).json({ message: 'Contact has been blocked successfully' });
    }

    if (action === 'unblock') {
      contact.is_blocked = false;
      await contact.save();
      return res.status(200).json({ message: 'Contact has been unblocked successfully' });
    }

    if (action === 'warning') {
      if (!contact.email) {
        return res.status(400).json({ error: 'Contact does not have an email address' });
      }

      const result = await EmailDispatcher.dispatch(contact.email, 'violence-warning', {
        "contact.first_name": contact.first_name,
        "contact.last_name": contact.last_name,
        "contact.phone_number": contact.phone_number,
        "violation.words": (call.detected_words || []).join(', '),
        "violation.transcript": call.transcript_snippet || ''
      });

      if (result.success) {
        return res.status(200).json({ message: 'Warning email sent successfully' });
      } else {
        return res.status(500).json({ error: 'Failed to send warning email: ' + result.message });
      }
    }

  } catch (error) {
    console.error('Error taking action on contact:', error);
    res.status(500).json({ error: 'Server error processing action' });
  }
};
