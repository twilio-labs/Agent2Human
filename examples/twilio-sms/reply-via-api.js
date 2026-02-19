#!/usr/bin/env node
/**
 * Reply via Twilio API - Send OTP reply from Virtual Phone
 *
 * This sends an SMS from the Virtual Phone to your Twilio number,
 * simulating a user replying with the OTP.
 *
 * Usage:
 *   node reply-via-api.js <otp>
 *   node reply-via-api.js 847291
 */

require('dotenv').config();

const OTP = process.argv[2];

if (!OTP) {
  console.log('Usage: node reply-via-api.js <otp>');
  console.log('Example: node reply-via-api.js 847291');
  process.exit(1);
}

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+15551234567';
const VIRTUAL_PHONE = process.env.USER_PHONE_MAP?.split(':').pop() || '+15559876543';

async function sendReply() {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Sending OTP Reply via Twilio API');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`  From: ${VIRTUAL_PHONE} (Virtual Phone)`);
  console.log(`  To: ${TWILIO_NUMBER} (Your Twilio Number)`);
  console.log(`  Body: ${OTP}`);
  console.log('');

  const url = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;

  const params = new URLSearchParams({
    To: TWILIO_NUMBER,
    From: VIRTUAL_PHONE,
    Body: OTP
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    const data = await response.json();

    if (response.ok) {
      console.log(`  ✓ Message sent: ${data.sid}`);
      console.log(`  Status: ${data.status}`);
      console.log('');
      console.log('  Twilio will now POST to your webhook at /webhook/sms');
      console.log('  (Make sure zrok/ngrok is running and webhook is configured)');
    } else {
      console.log(`  ✗ Error: ${data.message || data.code}`);
    }
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (e) {
    console.error('  Error:', e.message);
  }
}

sendReply();
