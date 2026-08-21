const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { db } = require('../models');
const { mongoose } = require('mongoose');
const ExcelJS = require('exceljs');
const { generateExcel, generateCSV } = require('../helpers/exportHelper');
const User = db.User;
const Role = db.Role;
const UserSettings = db.UserSettings;
const { getSettings } = require('../helpers/authHelpers');
const creditService = require('../services/creditService');

exports.getAllUsers = async (req, res) => {
  const { page = 1, limit = 10, search, has_last_login } = req.query;
  const sortField = req.query.sort_by || 'created_at';
  const sortOrder = req.query.sort_order?.toUpperCase() === 'ASC' ? 1 : -1;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  try {
    const allowedSortFields = ['id', 'name', 'email', 'isActive', 'role', 'lastLogin', 'created_at', 'updated_at', 'deleted_at'];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';

    const superAdminRole = await Role.findOne({ name: 'super_admin' });

    const query = { roleId: { $ne: superAdminRole?._id } };

    if (search) {
      const searchRegex = new RegExp(search, 'i');

      const matchingRoles = await Role.find({ name: searchRegex });
      const matchingRoleIds = matchingRoles.map(r => r._id);

      query.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { roleId: { $in: matchingRoleIds } }
      ];
    }

    if (has_last_login === 'true') {
      query.lastLogin = { $ne: null };
    } else if (has_last_login === 'false') {
      query.lastLogin = null;
    }

    let sortObj = {};
    if (safeSortField === 'role') {
      sortObj['role_name'] = sortOrder;
    } else if (safeSortField === 'name') {
      sortObj['name_lower'] = sortOrder;
    } else if (safeSortField === 'email') {
      sortObj['email_lower'] = sortOrder;
    } else {
      sortObj[safeSortField === 'id' ? '_id' : safeSortField] = sortOrder;
    }

    const [usersResult, total] = await Promise.all([
      User.aggregate([
        { $match: query },
        { $lookup: { from: 'roles', localField: 'roleId', foreignField: '_id', as: 'roleInfo' } },
        { $unwind: { path: '$roleInfo', preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            role_name: '$roleInfo.name',
            name_lower: { $toLower: '$name' },
            email_lower: { $toLower: '$email' }
          }
        },
        { $sort: sortObj },
        { $skip: skip },
        { $limit: parseInt(limit) },
        {
          $project: {
            id: '$_id',
            _id: 1,
            avatar: 1,
            name: 1,
            email: 1,
            isVerified: 1,
            roleId: 1,
            lastLogin: 1,
            isActive: 1,
            created_at: 1,
            role: '$roleInfo.name'
          }
        }
      ]),
      User.countDocuments(query),
    ]);

    const formattedUsers = usersResult.map(u => ({
      ...u,
      role: u.role || null,
      roleId: u.roleId || null
    }));

    res.status(200).json({
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
      page: parseInt(page),
      limit: parseInt(limit),
      users: formattedUsers,
    });
  } catch (error) {
    console.error('Error in getAllUsers:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.exportUsers = async (req, res) => {
  const { format = 'excel' } = req.query;

  try {
    const superAdminRole = await Role.findOne({ name: 'super_admin' });
    const query = { roleId: { $ne: superAdminRole?._id } };

    const users = await User.find(query)
      .populate('roleId', 'name')
      .lean();

    const data = users.map(u => ({
      name: u.name,
      email: u.email,
      role: u.roleId ? u.roleId.name : null,
      status: u.isActive ? 'Active' : 'Inactive',
      lastLogin: u.lastLogin ? new Date(u.lastLogin).toLocaleString() : 'Never'
    }));

    const columns = [
      { header: 'Name', key: 'name' },
      { header: 'Email', key: 'email' },
      { header: 'Role', key: 'role' },
      { header: 'Status', key: 'status' },
      { header: 'Last Login', key: 'lastLogin' }
    ];

    let buffer;
    let contentType;
    let fileName = `users_export_${Date.now()}`;

    switch (format.toLowerCase()) {
      case 'csv':
        buffer = await generateCSV(data, columns);
        contentType = 'text/csv';
        fileName += '.csv';
        break;
      case 'excel':
      default:
        buffer = await generateExcel(data, columns, 'Users');
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        fileName += '.xlsx';
        break;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    return res.status(200).send(buffer);
  } catch (error) {
    console.error('Error exporting users:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createUser = async (req, res) => {
  const { name, email, password, roleId, isActive } = req.body;

  try {
    if (!email) {
      return res.status(400).json({ message: 'Provide Email or phone number.' });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Invalid Email format' });
    }

    if (!roleId) {
      return res.status(400).json({ message: 'roleId is required.' });
    }

    const roleExists = await Role.findById(roleId);
    if (!roleExists) {
      return res.status(404).json({ message: 'Role not found' });
    }

    if (email) {
      const existingEmail = await User.findOne({ email, roleId: roleId });
      if (existingEmail) {
        return res.status(409).json({ message: 'Email already registered with this role' });
      }
    }

    const hashed = await bcrypt.hash(password, 10);

    let avatar = null;
    if (req.file) {
      avatar = req.file.path;
    }

    const settings = await getSettings();

    const user = await User.create({ avatar, name, email, password: hashed, roleId, isActive, total_credits: settings.free_credits || 0 });

    await UserSettings.create({ user: user._id });

    return res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    console.error('Error in createUser:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateUser = async (req, res) => {
  const { name, email, id, roleId, isActive, remove_avatar } = req.body;

  try {
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    if (email && email !== user.email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: 'Invalid Email format' });
      }
      const checkRoleId = roleId || user.roleId;
      const existingEmail = await User.findOne({ email, roleId: checkRoleId, _id: { $ne: id } });
      if (existingEmail) {
        return res.status(409).json({ message: 'Email already registered with this role' });
      }
    }

    const deleteOldAvatar = () => {
      if (!user.avatar) return;

      const oldAvatarPath = path.join(__dirname, '..', user.avatar);
      if (fs.existsSync(oldAvatarPath)) {
        try {
          fs.unlinkSync(oldAvatarPath);
        } catch (err) {
          console.error('Error deleting old avatar:', err);
        }
      }
    };

    let avatar = user.avatar;

    if (remove_avatar === 'true') {
      deleteOldAvatar();
      avatar = null;
    } else if (req.file) {
      deleteOldAvatar();
      avatar = req.file.path;
    }

    const updateData = { name, avatar };
    if (email) updateData.email = email;
    if (roleId) {
      const roleExists = await Role.findById(roleId);
      if (!roleExists) {
        return res.status(404).json({ message: 'Role not found' });
      }
      updateData.roleId = roleId;
    }
    if (isActive !== undefined) updateData.isActive = isActive === 'true' || isActive === true;

    await User.updateOne({ _id: id }, { $set: updateData });

    const updatedUser = await User.findById(id)
      .populate('roleId', 'name')
      .select('id avatar name email roleId isActive');

    const formattedUser = {
      ...updatedUser.toObject(),
      role: updatedUser.roleId ? updatedUser.roleId.name : null,
      roleId: updatedUser.roleId ? updatedUser.roleId._id : null
    };

    res.status(200).json({ message: 'User updated successfully', user: formattedUser });
  } catch (error) {
    console.error('Error in updateUser:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateUserStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    await User.updateOne({ _id: id }, { $set: { isActive: status } });

    const io = req.app.get('io');

    if (status === 'false' || !status) {
      io.to(`user_${id}`).emit('admin-deactivation', { id, status });
    }

    res.status(200).json({ message: `User ${status ? 'activated' : 'deactivated'} successfully.` });
  } catch (error) {
    console.error('Error in updateUserStatus:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteUser = async (req, res) => {
  const { ids } = req.body;

  try {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'User IDs array is required' });
    }

    const objectIds = ids.map(id => new mongoose.Types.ObjectId(id));

    const result = await User.deleteMany({ _id: { $in: objectIds } });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'No users found' });
    }

    const response = {
      message: `${result.deletedCount} user(s) deleted successfully`,
      deletedCount: result.deletedCount,
    };

    const io = req.app.get('io');
    ids.forEach((userId) => {
      io.to(`user_${userId}`).emit('admin-deletion');
    });

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error in deleteUser:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.importUsers = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Excel file is required' });
    }

    const workbook = new ExcelJS.Workbook();
    const ext = path.extname(req.file.path).toLowerCase();

    if (ext === '.csv') {
      await workbook.csv.readFile(req.file.path);
    } else {
      await workbook.xlsx.readFile(req.file.path);
    }

    const worksheet = workbook.getWorksheet(1);

    const users = [];
    const errors = [];

    const defaultRole = await Role.findOne({ name: 'user' });

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const name = row.getCell(1).value;
      const email = row.getCell(2).value;
      const password = row.getCell(3).value;
      const roleName = row.getCell(4).value;

      if (!name || !email) {
        errors.push(`Row ${rowNumber}: Name and Email are required`);
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push(`Row ${rowNumber}: Invalid email format (${email})`);
        return;
      }

      users.push({ name, email, password, roleName, rowNumber });
    });

    if (users.length === 0) {
      return res.status(400).json({ message: 'No valid data found in the file', errors });
    }

    const results = {
      success: 0,
      failed: 0,
      details: []
    };

    for (const userData of users) {
      try {
        const existingUser = await User.findOne({ email: userData.email.toLowerCase() });
        if (existingUser) {
          results.failed++;
          results.details.push(`Row ${userData.rowNumber}: Email ${userData.email} already exists`);
          continue;
        }

        let roleId = defaultRole?._id;
        if (userData.roleName) {
          const role = await Role.findOne({ name: userData.roleName.toLowerCase() });
          if (role) roleId = role._id;
        }

        const hashedPassword = await bcrypt.hash(userData.password.toString(), 10);

        await User.create({
          name: userData.name,
          email: userData.email.toLowerCase(),
          password: hashedPassword,
          roleId: roleId,
          isActive: true
        });

        results.success++;
      } catch (err) {
        results.failed++;
        results.details.push(`Row ${userData.rowNumber}: ${err.message}`);
      }
    }

    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(200).json({ message: `Import completed: ${results.success} succeeded, ${results.failed} failed`, results });

  } catch (error) {
    console.error('Error in importUsers:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.downloadImportTemplate = async (req, res) => {
  try {
    const headers = ['Name', 'Email', 'Password', 'Role'];
    const sampleRows = [
      ['John Doe', 'john@example.com', 'SecurePass123', 'user'],
      ['Jane Smith', 'jane@example.com', 'SecurePass456', 'editor'],
    ];

    const csvContent = [headers, ...sampleRows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="user-import-template.csv"');
    return res.send(csvContent);
  } catch (error) {
    console.error('Error in downloadImportTemplate (user):', error);
    return res.status(500).json({ success: false, message: 'Failed to generate template' });
  }
};

exports.addBonusCredits = async (req, res) => {
  const { id, amount } = req.body;

  try {
    if (!id || amount === undefined || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ message: 'Valid user ID and positive amount are required.' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const bonusAmount = Number(amount);

    const updatedCredits = await creditService.addCredits(
      id,
      bonusAmount,
      'bonus_credit',
      'Admin added bonus credits',
      null,
      null
    );

    return res.status(200).json({
      message: `${bonusAmount} bonus credits added successfully.`,
      credits: updatedCredits
    });
  } catch (error) {
    console.error('Error in addBonusCredits:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};