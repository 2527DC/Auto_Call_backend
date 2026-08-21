"use strict";

const mongoose = require('mongoose');
const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');

function reloadEnvVariables() {
  try {
    const envConfig = dotenv.parse(fs.readFileSync('.env'));
    for (const key in envConfig) {
      process.env[key] = envConfig[key];
    }
    console.log('Environment variables reloaded from .env file');
    return true;
  } catch (error) {
    console.error('Error reloading environment variables:', error);
    return false;
  }
}

async function configureDb(cfg) {
  const dbPort = cfg.DB_PORT || 27017;
  let mongoUri;
  if (cfg.DB_USERNAME && cfg.DB_PASSWORD) {
    const authString = `${encodeURIComponent(cfg.DB_USERNAME)}:${encodeURIComponent(cfg.DB_PASSWORD)}@`;
    mongoUri = `mongodb://${authString}${cfg.DB_HOST}:${dbPort}/${cfg.DB_DATABASE}`;
  } else {
    mongoUri = `mongodb://${cfg.DB_HOST}:${dbPort}/${cfg.DB_DATABASE}`;
  }
  process.env.MONGODB_URI = mongoUri;
  await mongoose.connect(mongoUri);
}

async function connectDb() {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('Database not connected');
  }
}

async function runMigrations() {
  return Promise.resolve();
}

async function writeEnv(cfg, admin) {
  try {
    let existingContent = '';
    if (await fs.pathExists('.env')) {
      existingContent = await fs.readFile('.env', 'utf8');
    }

    const existingVars = {};
    existingContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [key, ...valueParts] = trimmed.split('=');
        existingVars[key.trim()] = valueParts.join('=').trim();
      }
    });

    const mergedVars = {
      ...existingVars,
      DB_HOST: cfg.DB_HOST,
      DB_PORT: cfg.DB_PORT,
      DB_DATABASE: cfg.DB_DATABASE,
      DB_USERNAME: cfg.DB_USERNAME || '',
      DB_PASSWORD: cfg.DB_PASSWORD || '',
      MONGODB_URI: cfg.DB_USERNAME && cfg.DB_PASSWORD
        ? `mongodb://${encodeURIComponent(cfg.DB_USERNAME)}:${encodeURIComponent(cfg.DB_PASSWORD)}@${cfg.DB_HOST}:${cfg.DB_PORT || 27017}/${cfg.DB_DATABASE}`
        : `mongodb://${cfg.DB_HOST}:${cfg.DB_PORT || 27017}/${cfg.DB_DATABASE}`,
      ADMIN_NAME: `${admin.first_name} ${admin.last_name}`,
      ADMIN_EMAIL: admin.email,
      ADMIN_PASSWORD: admin.password
    };

    const newContent = Object.entries(mergedVars)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n';

    await fs.writeFile('.env', newContent);
  } catch (error) {
    console.log('Error writing .env file:', error);
  }
}

async function reloadAndReconnect() {
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    reloadEnvVariables();
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI not found');
    }
    await mongoose.connect(mongoUri);
    return { success: true };
  } catch (error) {
    console.error('Error reloading environment and reconnecting:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  configureDb,
  connectDb,
  runMigrations,
  writeEnv,
  reloadAndReconnect
};
