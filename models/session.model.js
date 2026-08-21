const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const SessionSchema = new Schema(
  {
    user_id: { 
      type: Schema.Types.ObjectId, 
      ref: 'User', 
      required: true 
    },
    session_token: { 
      type: String, 
      required: true 
    },
    device_info: { 
      type: String 
    },
    ip_address: { 
      type: String 
    },
    agenda: { 
      type: String 
    },
    status: { 
      type: String, 
      enum: ['active', 'inactive'], 
      default: 'active' 
    },
    expires_at: { 
      type: Date,
      required: true
    }
  },
  {
    collection: 'sessions',
    timestamps: { 
      createdAt: 'created_at', 
      updatedAt: 'updated_at' 
    }
  }
);

addVirtualId(SessionSchema);

SessionSchema.index({ user_id: 1 });
SessionSchema.index({ session_token: 1 });
SessionSchema.index({ status: 1 });
SessionSchema.index({ expires_at: 1 });
SessionSchema.index({ user_id: 1, status: 1 });
SessionSchema.index({ session_token: 1, status: 1 });
SessionSchema.index({ user_id: 1, expires_at: 1 });
SessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Session', SessionSchema);