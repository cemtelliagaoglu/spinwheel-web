const fs = require('fs');

// Only public/client-safe values go here.
// ClickUp credentials stay server-side only (used by netlify/functions/places.mjs).
const config = {
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
};

const content = `export const CONFIG = ${JSON.stringify(config, null, 2)};\n`;
fs.writeFileSync('config.js', content);
console.log('config.js generated (client-safe values only)');
