const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const basename = path.basename(__filename);
const db = {};

fs.readdirSync(__dirname)
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== basename &&
      file.slice(-3) === '.js' &&
      file.indexOf('.test.js') === -1
    );
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file));
    const modelName = path.basename(file, '.js')
      .replace(/[-_](\w)/g, (_, c) => c.toUpperCase())
      .replace(/^\w/, c => c.toUpperCase());
    db[model.modelName] = model;
  });

db.mongoose = mongoose;

mongoose.Schema.prototype.options = mongoose.Schema.prototype.options || {};
mongoose.Schema.prototype.options.toJSON = {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret._id;
    return ret;
  }
};

mongoose.Schema.prototype.options.toObject = {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret._id;
    return ret;
  }
};

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

module.exports = {
  db,
  connectDB,
  mongoose
};