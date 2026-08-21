const mongoose = require('mongoose')
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper')

const CampaignTypeSchema = new Schema(
  {
    name: {
      type: String,
      required: true
    },
    description: {
      type: String,
      default: ''
    },
    status: {
      type: Boolean,
      default: true
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    }
  },
  {
    collection: 'campaign_types',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
)

addVirtualId(CampaignTypeSchema)

CampaignTypeSchema.index({ name: 1 }, {
  unique: true,
  collation: { locale: 'en', strength: 2 }
});

module.exports = mongoose.model('CampaignType', CampaignTypeSchema)