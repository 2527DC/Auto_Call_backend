require('dotenv').config();

const path = require('path');
const fs = require('fs');

const seedLanguage = async (dbConnection, mongoose) => {
  try {
    const Language = dbConnection.db.Language;
    const Setting = dbConnection.db.Setting;

    console.log('Seeding default language...');

    const existing = await Language.findOne({ locale: 'en' });

    if (!existing) {
      await Language.create({
        name: 'English',
        locale: 'en',
        flag: 'uploads/languages/en/us.svg',
        front_translation_file: 'uploads/languages/en/english-autocall.json',
        is_rtl: false,
        is_active: true,
        is_default: true,
        sort_order: 0,
      });



      console.log('Default English language seeded successfully!');
    } else {
      console.log('Default language (en) already exists.');
    }
  } catch (error) {
    console.error('Error seeding language:', error);
    throw error;
  }
};

module.exports = { up: seedLanguage };
