const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const UserSchema = new Schema(
  {
    name: { 
      type: String, 
      required: true 
    },
    avatar: { 
      type: String, 
      default: null 
    },
    email: { 
      type: String, 
      required: true,
      unique: true 
    },
    password: { 
      type: String, 
      required: true 
    },
    roleId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Role',
      default: null
    },
    team_id: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      default: null
    },
    created_by: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    plan_id: {
      type: Schema.Types.ObjectId,
      ref: 'Plan',
      default: null
    },
    isVerified: { 
      type: Boolean, 
      default: false 
    },
    verificationToken: { 
      type: String 
    },
    resetPasswordToken: { 
      type: String 
    },
    resetPasswordExpires: { 
      type: Date 
    },
    lastLogin: { 
      type: Date 
    },
    isActive: { 
      type: Boolean, 
      default: true 
    },
    isOnline: { 
      type: Boolean, 
      default: false 
    },
    last_seen: { 
      type: Date, 
      default: null 
    },
    total_credits: {
      type: Number,
      default: 0
    },
    used_credits: {
      type: Number,
      default: 0
    },
    top_up_credits: {
      type: Number,
      default: 0
    },
    top_up_expires_at: {
      type: Date,
      default: null
    },
    storage_used: {
      type: Number,
      default: 0
    },
  },
  {
    collection: 'users',
    timestamps: { 
      createdAt: 'created_at', 
      updatedAt: 'updated_at' 
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(UserSchema);

UserSchema.virtual('settings', {
  ref: 'UserSettings',
  localField: '_id',
  foreignField: 'user',
  justOne: true
});

UserSchema.index({ email: 1 });
UserSchema.index({ verificationToken: 1 });
UserSchema.index({ resetPasswordToken: 1 });
UserSchema.index({ roleId: 1 });
UserSchema.index({ isActive: 1 });
UserSchema.index({ email: 1, isActive: 1 });
UserSchema.index({ roleId: 1, isActive: 1 });
UserSchema.index({ name: 'text', email: 'text' });

module.exports = mongoose.model('User', UserSchema);