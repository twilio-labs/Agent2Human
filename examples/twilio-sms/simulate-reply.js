#!/usr/bin/env node
/**
 * Simulate SMS Reply - For local testing without ngrok
 *
 * When testing with Twilio Virtual Phone, replies from the Virtual Phone
 * won't hit your webhook unless you have ngrok configured.
 *
 * This script simulates what Twilio would send to /webhook/sms
 *
 * Usage:
 *   node simulate-reply.js <otp>
 *   node simulate-reply.js 847291
 */

const OTP = process.argv[2];

if (!OTP) {
  console.log('Usage: node simulate-reply.js <otp>');
  console.log('Example: node simulate-reply.js 847291');
  process.exit(1);
}

require('dotenv').config();

const GATEWAY_URL = process.env.A2H_GATEWAY || 'http://localhost:3002';
const VIRTUAL_PHONE = process.env.USER_PHONE_MAP?.split(':').pop() || '+15559876543';

async function simulateReply() {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Simulating SMS Reply (Virtual Phone → Gateway)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`  From: ${VIRTUAL_PHONE} (Virtual Phone)`);
  console.log(`  Body: ${OTP}`);
  console.log('');

  // Simulate Twilio webhook payload
  const params = new URLSearchParams({
    From: VIRTUAL_PHONE,
    To: process.env.TWILIO_PHONE_NUMBER || '+15551234567',
    Body: OTP,
    MessageSid: `SM${Date.now()}`,
    AccountSid: process.env.TWILIO_ACCOUNT_SID || 'ACtest'
  });

  try {
    const response = await fetch(`${GATEWAY_URL}/webhook/sms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    const text = await response.text();
    console.log('  Response:', text.replace(/<[^>]*>/g, ' ').trim());
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (e) {
    console.error('  Error:', e.message);
    console.log('');
    console.log('  Make sure the gateway is running: npm start');
  }
}

simulateReply();
