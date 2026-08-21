const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const TeamPermissionSchema = new Schema(
  {
    team_id: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
      index: true
    },
    permission_id: {
      type: Schema.Types.ObjectId,
      ref: 'Permission',
      required: true,
      index: true
    }
  },
  {
    collection: 'team_permissions',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

addVirtualId(TeamPermissionSchema);

module.exports = mongoose.model('TeamPermission', TeamPermissionSchema);
