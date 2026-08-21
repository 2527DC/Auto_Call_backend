const { db } = require('../models');
const Contact = db.Contact;
const fs = require('fs');
const csv = require('fast-csv');
const { checkFeatureLimit } = require('../utils/limitHelper');

exports.createContact = async (req, res) => {
  try {
    const { phone_number, first_name, last_name, email } = req.body;

    if (!phone_number) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }

    const currentContactsCount = await Contact.countDocuments({ user_id: req.user._id });
    await checkFeatureLimit(req.user._id, 'Contact', 'contact_limit', currentContactsCount);

    const existingContact = await Contact.findOne({ user_id: req.user._id, phone_number });
    if (existingContact) {
      return res.status(409).json({ success: false, message: 'Contact with this phone number already exists' });
    }

    const contact = new Contact({
      user_id: req.user._id,
      phone_number,
      first_name,
      last_name,
      email
    });

    await contact.save();
    res.status(201).json({ success: true, message: 'Contact created successfully', data: contact });
  } catch (error) {
    console.log('Error creating contact:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getContacts = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    const query = { user_id: req.user._id };

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    if (search) {
      query.$or = [
        { phone_number: { $regex: search, $options: 'i' } },
        { first_name: { $regex: search, $options: 'i' } },
        { last_name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const contacts = await Contact.find(query)
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort(sortOptions);

    const total = await Contact.countDocuments(query);

    res.status(200).json({
      success: true,
      data: contacts,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.log('Error fetching contacts:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateContact = async (req, res) => {
  try {
    const { phone_number, first_name, last_name, email } = req.body;

    const contact = await Contact.findOne({ _id: req.params.id, user_id: req.user._id });
    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contact not found' });
    }

    if (phone_number && phone_number !== contact.phone_number) {
      const existingContact = await Contact.findOne({ user_id: req.user._id, phone_number });
      if (existingContact) {
        return res.status(409).json({ success: false, message: 'Another contact with this phone number already exists' });
      }
      contact.phone_number = phone_number;
    }

    if (first_name !== undefined) contact.first_name = first_name;
    if (last_name !== undefined) contact.last_name = last_name;
    if (email !== undefined) contact.email = email;

    await contact.save();
    res.status(200).json({ success: true, message: 'Contact updated successfully', data: contact });
  } catch (error) {
    console.log('Error updating contact:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.bulkDeleteContacts = async (req, res) => {
  try {
    const { contactIds } = req.body;

    if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide an array of contactIds' });
    }

    await Contact.deleteMany({ _id: { $in: contactIds }, user_id: req.user._id });

    res.status(200).json({ success: true, message: 'Contacts deleted successfully' });
  } catch (error) {
    console.log('Error bulk deleting contacts:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.importContacts = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload a CSV file' });
    }

    const contacts = [];
    let processed = 0;
    let added = 0;

    await new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csv.parse({ headers: true }))
        .on('data', (row) => {
          processed++;
          const phone = row.phone_number || row.phone || row.phoneNumber || row.Phone || row['Phone Number'];
          if (phone) {
            contacts.push({
              user_id: req.user._id,
              phone_number: phone,
              first_name: row.first_name || row.firstName || row.name || row.Name || row['First Name'] || '',
              last_name: row.last_name || row.lastName || row['Last Name'] || '',
              email: row.email || row.Email || ''
            });
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    if (contacts.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid contacts found in CSV' });
    }

    const currentContactsCount = await Contact.countDocuments({ user_id: req.user._id });
    await checkFeatureLimit(req.user._id, 'Contact', 'contact_limit', currentContactsCount, contacts.length);

    for (const contact of contacts) {
      try {
        const existing = await Contact.findOne({ user_id: req.user._id, phone_number: contact.phone_number });
        if (!existing) {
          await Contact.create(contact);
          added++;
        }
      } catch (err) {
        console.log(`Failed to import contact ${contact.phone_number}:`, err.message);
      }
    }

    res.status(200).json({
      success: true,
      message: `Import completed. Processed ${processed} rows, added ${added} new contacts.`,
      data: { processed, added }
    });

  } catch (error) {
    console.log('Error importing contacts:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.exportContacts = async (req, res) => {
  try {
    const contacts = await Contact.find({ user_id: req.user._id }).lean();

    if (contacts.length === 0) {
      return res.status(404).json({ success: false, message: 'No contacts found to export' });
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');

    const csvStream = csv.format({ headers: true });
    csvStream.pipe(res);

    for (const contact of contacts) {
      csvStream.write({
        first_name: contact.first_name || '',
        last_name: contact.last_name || '',
        phone_number: contact.phone_number,
        email: contact.email || ''
      });
    }

    csvStream.end();
  } catch (error) {
    console.log('Error exporting contacts:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.downloadImportTemplate = async (req, res) => {
  try {
    const headers = ['First Name', 'Last Name', 'Phone Number', 'Email'];
    const sampleRows = [
      ['John', 'Doe', '+1234567890', 'john@example.com'],
      ['Jane', 'Smith', '+0987654321', 'jane@example.com'],
    ];

    const csvContent = [headers, ...sampleRows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="contact-import-template.csv"');
    return res.send(csvContent);
  } catch (error) {
    console.error('Error in downloadImportTemplate (contact):', error);
    return res.status(500).json({ success: false, message: 'Failed to generate template' });
  }
};
