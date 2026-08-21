'use strict';

const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { db } = require('../models');
const Setting = db.Setting;

class StorageService {
  async getSettings() {
    return await Setting.findOne().lean();
  }

  async uploadFile(file, userId, folder = 'knowledgebase') {
    const settings = await this.getSettings();
    const storageType = settings.storage_type || 'local';

    if (storageType === 'aws' && this.isAWSConfigured(settings)) {
      return await this.uploadToS3(file, userId, folder, settings);
    } else {
      return await this.uploadToLocal(file, userId, folder);
    }
  }

  isAWSConfigured(settings) {
    return !!(settings.aws_access_key_id && settings.aws_secret_access_key && settings.aws_region && settings.aws_bucket_name);
  }

  async uploadToLocal(file, userId, folder) {
    const fileName = file.filename || `${Date.now()}-${path.basename(file.originalname || 'file')}`;
    const userFolder = `user_${userId}`;
    const relativeDir = path.join('uploads', folder, userFolder);
    const absoluteDir = path.join(process.cwd(), relativeDir);

    if (!fs.existsSync(absoluteDir)) {
      fs.mkdirSync(absoluteDir, { recursive: true });
    }

    const filePath = path.join(absoluteDir, fileName);

    if (file.path) {
      fs.renameSync(file.path, filePath);
    } else if (file.buffer) {
      fs.writeFileSync(filePath, file.buffer);
    } else {
      throw new Error("Invalid file object. Must contain path or buffer.");
    }

    return path.join('/', relativeDir, fileName).replace(/\\/g, '/');
  }

  async uploadToS3(file, userId, folder, settings) {
    const rawRegion = settings.aws_region;
    const region = rawRegion && typeof rawRegion === 'string' ? rawRegion.split(' ').pop().replace(/[()]/g, '') : 'us-east-1';

    const s3Client = new S3Client({
      region: region,
      credentials: {
        accessKeyId: settings.aws_access_key_id,
        secretAccessKey: settings.aws_secret_access_key,
      },
    });

    const fileName = file.filename || `${Date.now()}-${path.basename(file.originalname || 'file')}`;
    const userFolder = `user_${userId}`;
    const key = `${userFolder}/${folder}/${fileName}`.replace(/\/+/g, '/');

    let body;
    if (file.path) {
      body = fs.createReadStream(file.path);
    } else if (file.buffer) {
      body = file.buffer;
    } else {
      throw new Error("Invalid file object. Must contain path or buffer.");
    }

    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: settings.aws_bucket_name,
        Key: key,
        Body: body,
        ContentType: file.mimetype || 'application/octet-stream',
        ACL: 'public-read',
      },
    });

    await upload.done();
    if (file.path && fs.existsSync(file.path)) {
      try { fs.unlinkSync(file.path); } catch (e) { }
    }

    return `https://${settings.aws_bucket_name}.s3.${region}.amazonaws.com/${key}`;
  }

  async deleteFile(fileUrlOrPath) {
    if (!fileUrlOrPath) return;

    const settings = await this.getSettings();

    if (fileUrlOrPath.startsWith('http')) {
      await this.deleteFromS3(fileUrlOrPath, settings);
    } else {
      await this.deleteFromLocal(fileUrlOrPath);
    }
  }

  async deleteFromLocal(filePath) {
    const absolutePath = path.join(process.cwd(), filePath.startsWith('/') ? filePath.substring(1) : filePath);
    if (fs.existsSync(absolutePath)) {
      try {
        fs.unlinkSync(absolutePath);
      } catch (err) {
        console.error(`Error deleting local file ${absolutePath}:`, err);
      }
    }
  }

  async deleteFromS3(fileUrl, settings) {
    if (!this.isAWSConfigured(settings)) return;

    try {
      const rawRegion = settings.aws_region;
      const region = rawRegion && typeof rawRegion === 'string' ? rawRegion.split(' ').pop().replace(/[()]/g, '') : 'us-east-1';

      const s3Client = new S3Client({
        region: region,
        credentials: {
          accessKeyId: settings.aws_access_key_id,
          secretAccessKey: settings.aws_secret_access_key,
        },
      });

      let key = fileUrl;
      try {
        const url = new URL(fileUrl);
        key = decodeURIComponent(url.pathname.substring(1));
        if (key.startsWith(settings.aws_bucket_name + '/')) {
          key = key.substring(settings.aws_bucket_name.length + 1);
        }
      } catch (e) { }

      const command = new DeleteObjectCommand({
        Bucket: settings.aws_bucket_name,
        Key: key,
      });

      await s3Client.send(command);
    } catch (error) {
      console.error("AWS S3 Delete Error:", error);
    }
  }
}

module.exports = new StorageService();