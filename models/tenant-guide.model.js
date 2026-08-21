const mongoose = require('mongoose')
const { Schema } = mongoose
const { addVirtualId } = require('../utils/modelHelper')

const tenantGuideSchema = new Schema(
    {
        title: {
            type: String,
            required: true
        },
        description: {
            type: String,
            default: ''
        },
        endpoints: {
            type: [
                {
                    sub_title: {
                        type: String,
                        required: true
                    },
                    sub_description: {
                        type: String,
                        required: true
                    },
                    http_method: {
                        type: String,
                        required: true,
                        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
                    },
                    url_path: {
                        type: String,
                        required: true
                    },
                    payload: {
                        type: Object,
                    },
                    response: {
                        type: Object,
                        required: true
                    }
                }
            ],
            required: true
        },
        is_system: {
            type: Boolean,
            default: false
        },
        is_active: {
            type: Boolean,
            default: true
        }
    },
    {
        collection: 'tenant_guides',
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
    }
)

addVirtualId(tenantGuideSchema)

module.exports = mongoose.model('TenantGuide', tenantGuideSchema)