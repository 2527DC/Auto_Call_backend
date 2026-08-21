const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const TeamMemberSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    team_id: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true
    },
    first_name: {
      type: String,
      required: true,
      trim: true
    },
    last_name: {
      type: String,
      default: '',
      trim: true
    },
    email: {
      type: String,
      required: true,
      trim: true
    },
    password: {
      type: String,
      required: true
    },
    phone_number: {
      type: String,
      required: true,
      trim: true
    },
    avatar: {
      type: String,
      default: null
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    },
    isAdmin: {
      type: Boolean,
      default: false
    }
  },
  {
    collection: 'team_members',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

addVirtualId(TeamMemberSchema);

TeamMemberSchema.index({ team_id: 1, email: 1 }, { unique: true });
TeamMemberSchema.index({ team_id: 1, phone_number: 1 }, { unique: true });
TeamMemberSchema.index({ user_id: 1 });
TeamMemberSchema.index({ team_id: 1 });
TeamMemberSchema.index({ email: 1 });
TeamMemberSchema.index({ status: 1 });

module.exports = mongoose.model('TeamMember', TeamMemberSchema);
