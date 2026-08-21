const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const GoogleSheetSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    google_account_id: {
      type: Schema.Types.ObjectId,
      ref: 'GoogleAccount',
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    spreadsheet_id: {
      type: String,
      trim: true
    },
    sheet_name: {
      type: String,
      default: 'Sheet1',
      trim: true
    },
    range: {
      type: String,
      default: 'A:E',
      trim: true
    },
    headers: {
      type: [String],
      default: ['Name', 'Phone', 'Date', 'Time', 'Status']
    },
    is_active: {
      type: Boolean,
      default: true
    },
    is_linked: {
      type: Boolean,
      default: false
    },
    description: {
      type: String,
      default: ''
    },
    last_synced_at: {
      type: Date,
      default: null
    },
    deleted_at: {
      type: Date,
      default: null
    }
  },
  {
    collection: 'google_sheets',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(GoogleSheetSchema);

GoogleSheetSchema.index({ user_id: 1 });
GoogleSheetSchema.index({ user_id: 1, is_active: 1 });

module.exports = mongoose.model('GoogleSheet', GoogleSheetSchema);
