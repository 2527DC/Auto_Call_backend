require('dotenv').config();

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { db, connectDB } = require('../models');

async function runSeeders() {
  const MONGO_URI = process.env.MONGODB_URI;

  if (!MONGO_URI) {
    console.error('MONGODB_URI is not defined in environment variables');
    process.exit(1);
  }

  await connectDB();
  console.log('Connected to MongoDB');

  const seederFiles = fs
    .readdirSync(__dirname)
    .filter(file => file !== 'index.js' && file.endsWith('.js'))
    .sort();

  for (const file of seederFiles) {
    console.log(`\nRunning seeder: ${file}`);
    const seeder = require(path.join(__dirname, file));
    if (typeof seeder.up === 'function') {
      await seeder.up({ db, connection: mongoose.connection }, mongoose);
    } else {
      console.warn(`Seeder ${file} does not export an 'up' function. Skipping...`);
    }
  }

  console.log('\nAll seeders executed successfully');
  process.exit(0);
}

runSeeders().catch(err => {
  console.error('Seeder error:', err.message);
  process.exit(1);
});