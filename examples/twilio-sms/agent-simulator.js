#!/usr/bin/env node
/**
 * Agent Simulator - Tests A2H Gateway with Twilio SMS
 *
 * Sends an AUTHORIZE request and polls for OTP verification.
 */

const crypto = require('crypto');

const A2H_GATEWAY = process.env.A2H_GATEWAY || 'http://localhost:3002';
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 150; // 5 minutes

function log(prefix, message) {
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`[${timestamp}] [${prefix}] ${message}`);
}

async function sendAuthorizeRequest(action, principalId) {
  const ticketId = `agent-${crypto.randomUUID().slice(0, 8)}`;

  const request = {
    a2h_version: '1.0',
    message_id: `msg-${Date.now()}`,
    interaction_id: ticketId,
    created_at: new Date().toISOString(),
    agent_id: 'did:web:example-agent.local',
    principal_id: principalId,
    type: 'AUTHORIZE',
    render: {
      body: `Your agent wants to: ${action}`
    },
    params: {
      action,
      assurance_level: 'MEDIUM'
    },
    assurance: {
      level: 'MEDIUM',
      required_factors: ['sms.otp.v1']
    },
    ttl_sec: 300
  };

  const response = await fetch(`${A2H_GATEWAY}/v1/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  });

  return response.json();
}

async function pollForResponse(ticketId) {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    try {
      const response = await fetch(`${A2H_GATEWAY}/v1/status/${ticketId}`);
      const data = await response.json();

      if (data.state === 'ANSWERED') {
        return data;
      } else if (data.state === 'EXPIRED') {
        return { state: 'EXPIRED', decision: null };
      }

      process.stdout.write('.');
    } catch (e) {
      log('Agent', `Poll error: ${e.message}`);
    }
  }

  return { state: 'TIMEOUT', decision: null };
}

async function main() {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  A2H Agent Simulator (Twilio SMS)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const action = 'Transfer $500 to savings account';
  const principalId = 'did:example:alice';

  log('Agent', `Action: "${action}"`);
  log('Agent', `Principal: ${principalId}`);
  log('Agent', `Assurance: MEDIUM (SMS OTP)`);
  console.log('');

  // Send AUTHORIZE request
  log('Agent', 'Sending AUTHORIZE to A2H Gateway...');

  let authResponse;
  try {
    authResponse = await sendAuthorizeRequest(action, principalId);
  } catch (e) {
    log('Agent', `Failed to reach A2H Gateway: ${e.message}`);
    log('Agent', 'Make sure the gateway is running: npm start');
    process.exit(1);
  }

  if (authResponse.error) {
    log('A2H', `Error: ${authResponse.error.code} - ${authResponse.error.message}`);
    process.exit(1);
  }

  const ticketId = authResponse.interaction_id;
  log('A2H', `Request accepted, interaction: ${ticketId}`);
  log('A2H', `Channel: ${authResponse.channel || 'sms'}`);
  console.log('');

  // Wait for human to reply with OTP
  log('Agent', 'Waiting for SMS OTP verification...');
  log('Agent', '(Check your phone and reply with the code)');
  process.stdout.write('[Agent] Polling');

  const result = await pollForResponse(ticketId);
  console.log('');
  console.log('');

  // Handle response
  if (result.state === 'ANSWERED') {
    if (result.decision === 'APPROVE') {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      log('A2H', '✓ APPROVED via SMS OTP');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');

      log('Agent', 'Received OTP verification evidence');
      log('Agent', `Evidence factor: ${result.evidence?.factor || 'sms.otp.v1'}`);
      log('Agent', `Phone hash: ${result.evidence?.proof?.phone_number_hash || 'N/A'}`);
      log('Agent', `Timestamp: ${result.evidence?.proof?.timestamp || 'N/A'}`);
      console.log('');

      log('Agent', `Executing action: ${action}`);
      log('Agent', '(simulated) Action completed successfully');

      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('  Demo Complete');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');
      console.log('Key points:');
      console.log('  1. AUTHORIZE sent with sms.otp.v1 factor');
      console.log('  2. User received SMS with 6-digit OTP');
      console.log('  3. User replied with OTP to approve');
      console.log('  4. Evidence includes phone hash + timestamp');
      console.log('');

    } else {
      log('A2H', `Decision: ${result.decision}`);
    }
  } else if (result.state === 'EXPIRED') {
    log('A2H', 'Request expired (TTL exceeded)');
    log('Agent', 'Action blocked - approval timed out');
  } else {
    log('Agent', `Unexpected state: ${result.state}`);
  }
}

main();
