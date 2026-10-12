const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

// A price estimate for a prospective client: what they asked for, what it costs
// you, what you quoted, and every offer made while bargaining.
const PriceQuoteSchema = new Schema(
  {
    client: {
      name: { type: String, required: true, trim: true },
      company: { type: String, trim: true, default: '' },
      phone: { type: String, trim: true, default: '' },
      email: { type: String, trim: true, default: '' },
      industry: { type: String, trim: true, default: '' },
      city: { type: String, trim: true, default: '' },
    },
    status: {
      type: String,
      enum: ['draft', 'sent', 'negotiating', 'won', 'lost'],
      default: 'draft',
    },
    // The calculator's inputs (modules, volumes, prices, cost overrides), kept as
    // sent so a saved quote reopens exactly as it was left.
    inputs: { type: Schema.Types.Mixed, default: {} },
    requirements: [
      {
        _id: false,
        question: { type: String, trim: true },
        answer: { type: String, trim: true, default: '' },
      },
    ],
    offers: [
      {
        _id: false,
        party: { type: String, enum: ['you', 'client'], required: true },
        amount: { type: Number, required: true, min: 0 },
        note: { type: String, trim: true, default: '' },
        at: { type: Date, default: Date.now },
      },
    ],
    // Figures at the time of saving, for the quote list.
    summary: {
      minutes: { type: Number, default: 0 },
      monthly_cost: { type: Number, default: 0 },
      monthly_price: { type: Number, default: 0 },
      monthly_profit: { type: Number, default: 0 },
      margin_percent: { type: Number, default: null },
      setup_fee: { type: Number, default: 0 },
      setup_cost: { type: Number, default: 0 },
    },
    notes: { type: String, trim: true, default: '' },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updated_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    collection: 'price_quotes',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(PriceQuoteSchema);

PriceQuoteSchema.index({ updated_at: -1 });
PriceQuoteSchema.index({ status: 1 });

module.exports = mongoose.model('PriceQuote', PriceQuoteSchema);
