const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const RolePermissionSchema = new Schema(
  {
    role_id: {
      type: Schema.Types.ObjectId,
      ref: 'Role',
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
    collection: 'role_permissions',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

addVirtualId(RolePermissionSchema);

module.exports = mongoose.model('RolePermission', RolePermissionSchema);
