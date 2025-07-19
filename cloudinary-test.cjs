// cloudinary-test.cjs
require('dotenv').config();
const { v2: cloudinary } = require('cloudinary');

(async function() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  try {
    const uploadResult = await cloudinary.uploader.upload(
      'https://res.cloudinary.com/demo/image/upload/getting-started/shoes.jpg',
      { public_id: 'test_upload' }
    );
    console.log('✅ Upload OK:', uploadResult.secure_url);
  } catch (error) {
    console.error('❌ Upload failed:', error);
  }
})();
