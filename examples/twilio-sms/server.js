/**
 * A2H Gateway - Twilio SMS Example
 *
 * This demonstrates the A2H channel abstraction pattern using Twilio SMS.
 */

require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const { TwilioProvider } = require('./providers/TwilioProvider');
const { SmsChannel } = require('./channels/SmsChannel');

// --- Configuration ---
const PORT = process.env.PORT || 3002;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// --- Initialize Provider & Channel ---
let smsChannel = null;

function initializeChannel() {
  const requiredEnv = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'];
  const missing = requiredEnv.filter(k => !process.env[k]);

  if (missing.length > 0) {
    console.warn(`[Config] Missing env vars: ${missing.join(', ')}`);
    console.warn('[Config] SMS channel disabled. Copy .env.example to .env and configure.');
    return null;
  }

  const provider = new TwilioProvider({
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
    userPhoneMap: process.env.USER_PHONE_MAP
  });

  return new SmsChannel(provider);
}

// --- Express App ---
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory request store
const requestDB = new Map();

// ============================================================
// ENDPOINT: Receive intent from agent
// ============================================================
app.post('/v1/intent', async (req, res) => {
  const msg = req.body;
  const interactionId = msg.interaction_id || `a2h-${crypto.randomUUID().slice(0, 8)}`;

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`→ A2H ${msg.type} REQUEST`);
  console.log(`  Interaction: ${interactionId}`);
  console.log(`  Principal: ${msg.principal_id}`);
  console.log(`  Assurance: ${msg.assurance?.level || 'default'}`);

  // Check if SMS channel can handle this
  if (!smsChannel) {
    console.log('  ✗ SMS channel not configured');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return res.status(503).json({
      error: { code: 'ERR.CHANNEL_NOT_CONFIGURED', message: 'SMS channel not available' }
    });
  }

  if (!smsChannel.canHandle(msg)) {
    console.log('  ✗ SMS channel cannot handle this request');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return res.status(400).json({
      error: { code: 'ERR.CANNOT_HANDLE', message: 'No matching channel for request' }
    });
  }

  // Store request
  requestDB.set(interactionId, {
    message: msg,
    createdAt: Date.now(),
    state: 'PENDING'
  });

  // Deliver via SMS channel
  try {
    const result = await smsChannel.deliver(msg, interactionId);
    requestDB.get(interactionId).state = 'SENT';

    console.log('  ✓ Delivered via SMS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return res.status(202).json({
      interaction_id: interactionId,
      state: 'SENT',
      channel: 'sms'
    });
  } catch (e) {
    console.log(`  ✗ Delivery failed: ${e.message}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return res.status(500).json({
      error: { code: 'ERR.DELIVERY_FAILED', message: e.message }
    });
  }
});

// ============================================================
// ENDPOINT: Poll for response
// ============================================================
app.get('/v1/status/:interactionId', (req, res) => {
  const { interactionId } = req.params;
  const request = requestDB.get(interactionId);

  if (!request) {
    return res.status(404).json({ error: 'Interaction not found' });
  }

  // Get status from channel
  const status = smsChannel ? smsChannel.getStatus(interactionId) : { state: 'UNKNOWN' };

  const response = {
    interaction_id: interactionId,
    state: status.state
  };

  if (status.state === 'ANSWERED' && status.response) {
    response.decision = status.response.decision;
    response.evidence = status.response.evidence;
  }

  return res.json(response);
});

// ============================================================
// ENDPOINT: Twilio SMS Webhook
// ============================================================
app.post('/webhook/sms', (req, res) => {
  const { From, Body } = req.body;

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('← SMS REPLY RECEIVED');
  console.log(`  From: ${From}`);
  console.log(`  Body: ${Body}`);

  if (!smsChannel) {
    console.log('  ✗ Channel not configured');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return res.status(200).send('<Response></Response>');
  }

  // Find interaction by phone number
  const interactionId = smsChannel.findByPhone(From);
  if (!interactionId) {
    console.log('  ✗ No pending interaction for this number');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return res.status(200).send('<Response><Message>No pending request.</Message></Response>');
  }

  // Process the response
  const result = smsChannel.processResponse(interactionId, { otp: Body });

  if (result.valid) {
    console.log(`  ✓ Valid response for ${interactionId}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Send confirmation SMS
    return res.status(200).send('<Response><Message>Approved. You can close this.</Message></Response>');
  } else {
    console.log(`  ✗ Invalid response: ${result.error || 'OTP mismatch'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return res.status(200).send('<Response><Message>Invalid code. Please try again.</Message></Response>');
  }
});

// ============================================================
// ENDPOINT: Health check
// ============================================================
app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    channels: {
      sms: smsChannel ? 'configured' : 'disabled'
    }
  };

  if (smsChannel) {
    const twilioOk = await smsChannel.provider.healthCheck();
    health.channels.sms = twilioOk ? 'healthy' : 'unhealthy';
  }

  res.json(health);
});

// ============================================================
// Start Server
// ============================================================
smsChannel = initializeChannel();

app.listen(PORT, () => {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  A2H Gateway (Twilio SMS Example)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  URL: ${BASE_URL}`);
  console.log(`  SMS Channel: ${smsChannel ? 'enabled' : 'disabled'}`);
  console.log('');
  console.log('  Endpoints:');
  console.log('    POST /v1/intent      - Send A2H intent');
  console.log('    GET  /v1/status/:id  - Poll for response');
  console.log('    POST /webhook/sms    - Twilio webhook');
  console.log('    GET  /health         - Health check');
  console.log('');
  if (!smsChannel) {
    console.log('  ⚠️  Configure .env to enable SMS channel');
    console.log('');
  }
  console.log('  Run: node agent-simulator.js');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});
