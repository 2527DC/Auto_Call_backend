const mongoose = require('mongoose')
const { Schema } = mongoose
const { addVirtualId } = require('../utils/modelHelper')

const notificationSchema = new Schema(
    {
        user_id : {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required : true
        },
        type : {
            type : String,
            required : true
        },
        title : {
            type : String,
            required : true
        },
        message : {
            type : String,
            required : true
        },
        is_read : {
            type : Boolean,
            default : false
        },
        // What the notification is about, for a link (e.g. { call_id, contact_id }).
        data : {
            type : Schema.Types.Mixed,
            default : {}
        }
    },
    {
        collection: "notifications",
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" }
    }
)

addVirtualId(notificationSchema)

module.exports = mongoose.model('Notification', notificationSchema)