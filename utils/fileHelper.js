const fs = require('fs');
const path = require('path');

exports.ensureSocialPostMedia = async (filePath, subDir = 'social-post') => {
  if (!filePath) return null;
  if (filePath.startsWith('http')) return filePath;

  try {
    const uploadDir = path.join(__dirname, '..', 'uploads', subDir);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const absoluteInputPath = filePath.startsWith('/') 
      ? path.join(__dirname, '..', filePath)
      : path.join(__dirname, '..', ...filePath.split('/'));

    if (!fs.existsSync(absoluteInputPath)) {
      console.warn(`File not found at ${absoluteInputPath}`);
      return filePath;
    }

    const fileName = path.basename(filePath);
    const destinationPath = path.join(uploadDir, fileName);
    const relativeResultPath = `/uploads/${subDir}/${fileName}`;

    if (absoluteInputPath === destinationPath) {
      return relativeResultPath;
    }

    fs.copyFileSync(absoluteInputPath, destinationPath);
    
    return relativeResultPath;
  } catch (error) {
    console.error(`Error copying file to ${subDir}:`, error);
    return filePath;
  }
};

exports.getRelativePath = (url, baseUrl) => {
  if (!url || !baseUrl) return url;
  if (!url.startsWith(baseUrl)) return url;
  
  let relative = url.replace(baseUrl, '');
  if (!relative.startsWith('/')) relative = '/' + relative;
  return relative;
};

exports.getFullUrl = (relativePath, baseUrl) => {
  if (!relativePath) return null;
  if (relativePath.startsWith('http')) return relativePath;
  
  const cleanBase = baseUrl.replace(/\/$/, '');
  const cleanRelative = relativePath.startsWith('/') ? relativePath : '/' + relativePath;
  
  return `${cleanBase}${cleanRelative}`;
};
