const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const WidgetSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    agent_id: {
      type: Schema.Types.ObjectId,
      ref: 'Agent',
      default: null
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    },
    branding: {
      icon_url: { type: String, default: null },
      brand_name: { type: String, default: 'Your Company' },
      button_label: { type: String, default: 'VOICE CHAT' },
      primary_color: { type: String, default: '#3B82F6' }
    },
    settings: {
      allowed_domains: { type: [String], default: [] },
      business_hours: {
        enabled: { type: Boolean, default: false },
        timezone: { type: String, default: 'UTC' },
        start_time: { type: String, default: '09:00' },
        end_time: { type: String, default: '17:00' },
        days: { type: [String], default: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] }
      },
      max_duration: { type: Number, default: 300 },
      cooldown: { type: Number, default: 0 },
      max_sessions: { type: Number, default: 5 }
    },
    widget_key: {
      type: String,
      unique: true,
      required: true
    }
  },
  {
    collection: 'widgets',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

addVirtualId(WidgetSchema);

module.exports = mongoose.model('Widget', WidgetSchema);
