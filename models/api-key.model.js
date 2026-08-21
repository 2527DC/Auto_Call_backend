const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const APIKeySchema = new Schema(
    {
        user_id: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        name: {
            type: String,
            required: true
        },
        prefix: {
            type: Schema.Types.ObjectId,
            ref: 'Setting',
            required: true
        },
        permissions: [{
            type: Schema.Types.ObjectId,
            ref: 'Permission'
        }],
        encrypted_key: {
            type: String,
            required: true
        },
        last_used_at: {
            type: Date,
            default: null
        },
        is_active: {
            type: Boolean,
            default: true
        }
    }, {
    collection: 'api_keys',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
}
);

addVirtualId(APIKeySchema);

APIKeySchema.index({ user_id: 1, created_at: -1 });

module.exports = mongoose.model('ApiKey', APIKeySchema);