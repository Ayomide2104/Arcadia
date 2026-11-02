const multer = require('multer');

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
    fields: 10,
  },
  fileFilter: (req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      return callback(Object.assign(new Error('Upload a JPEG, PNG, WebP, or GIF image.'), { status: 400 }));
    }

    callback(null, true);
  },
});

// Posts can carry up to four photos (field "photos"; the old single "photo" field still works).
const MAX_POST_PHOTOS = 4;
uploadImage.postPhotos = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: MAX_POST_PHOTOS + 1, fields: 10 },
  fileFilter: (req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) return callback(Object.assign(new Error('Upload a JPEG, PNG, WebP, or GIF image.'), { status: 400 }));
    callback(null, true);
  },
}).fields([{ name: 'photos', maxCount: MAX_POST_PHOTOS }, { name: 'photo', maxCount: 1 }]);
uploadImage.MAX_POST_PHOTOS = MAX_POST_PHOTOS;

module.exports = uploadImage;
