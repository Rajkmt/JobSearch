require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const FILE_PATH = path.join(__dirname, 'data', 'combined_results.csv');
const URL = process.env.N8N_WEBHOOK_URL;   // put in .env
const AUTH = process.env.N8N_AUTH_TOKEN || ''; // optional auth

(async () => {
  try {
    if (!URL) {
      console.error('❌ Missing N8N_WEBHOOK_URL in .env');
      process.exit(1);
    }
    if (!fs.existsSync(FILE_PATH)) {
      console.error('❌ CSV not found:', FILE_PATH);
      process.exit(1);
    }

    const form = new FormData();
    form.append('file', fs.createReadStream(FILE_PATH), 'combined_results.csv');

    const headers = form.getHeaders();
    if (AUTH) headers['Authorization'] = `Bearer ${AUTH}`;

    const res = await axios.post(URL, form, {
      headers,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 60000,
    });

    console.log('✅ Uploaded to n8n:', res.status, res.statusText);
  } catch (err) {
    console.error('❌ Upload failed:', err.response?.status, err.response?.data || err.message);
    process.exit(1);
  }
})();
