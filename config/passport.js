const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
require('dotenv').config();

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'dummy_client_id',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'dummy_client_secret',
    callbackURL: `${process.env.BACKEND_URL || 'http://localhost:3000'}/api/auth/google/callback`,
    passReqToCallback: true
  },
  function(req, accessToken, refreshToken, profile, cb) {
    return cb(null, profile);
  }
));

passport.use(new FacebookStrategy({
    clientID: process.env.FACEBOOK_APP_ID || 'dummy_app_id',
    clientSecret: process.env.FACEBOOK_APP_SECRET || 'dummy_app_secret',
    callbackURL: `${process.env.BACKEND_URL || 'http://localhost:3000'}/api/auth/facebook/callback`,
    profileFields: ['id', 'emails', 'name', 'picture.type(large)'],
    passReqToCallback: true
  },
  function(req, accessToken, refreshToken, profile, cb) {
    return cb(null, profile);
  }
));

module.exports = passport;
