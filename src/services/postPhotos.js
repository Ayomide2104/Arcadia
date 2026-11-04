const cloudinary = require('../config/cloudinary');
const { hasImageSignature } = require('./media');

/*
 * Validates and uploads post photos (used by community posts).
 * Returns { media, uploaded }. Call cleanup(uploaded) if saving the post fails.
 */
async function uploadPostPhotos(files) {
  for (const file of files) {
    if (!hasImageSignature(file.buffer)) {
      const error = new Error('One of the files is not a supported image.');
      error.status = 400;
      throw error;
    }
  }
  if (!files.length) return { media: [], uploaded: [] };

  cloudinary.ensureCloudinaryConfigured();
  const results = await Promise.allSettled(files.map((file) => new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'arcadia/posts',
        resource_type: 'image',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
        transformation: [{ width: 1600, height: 1600, crop: 'limit' }],
      },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(file.buffer);
  })));

  const uploaded = results.filter((item) => item.status === 'fulfilled').map((item) => item.value);
  const failed = results.find((item) => item.status === 'rejected');
  if (failed) {
    await cleanup(uploaded);
    throw failed.reason;
  }
  return {
    uploaded,
    media: uploaded.map((image) => ({
      type: 'image', url: image.secure_url, publicId: image.public_id, width: image.width, height: image.height, format: image.format, bytes: image.bytes,
    })),
  };
}

async function cleanup(uploaded) {
  for (const image of uploaded || []) {
    try { await cloudinary.uploader.destroy(image.public_id); } catch { /* best effort */ }
  }
}

module.exports = { uploadPostPhotos, cleanup };
