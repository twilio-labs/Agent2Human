#!/usr/bin/env node
// openclaw-simulator.js - Simulates OpenClaw agent using A2H for tool approval
//
// This demonstrates how OpenClaw's exec tool with `ask: "a2h"` mode would
// integrate with an A2H Gateway for cryptographic consent evidence.

const crypto = require('crypto');

const A2H_GATEWAY = 'http://localhost:3001';
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 150; // 5 minutes at 2s intervals

// Simulated OpenClaw config
const OPENCLAW_CONFIG = {
  tools: {
    exec: {
      ask: 'a2h',
      a2h: {
        gateway: A2H_GATEWAY,
        assurance: {
          'rm *': 'HIGH',
          'git push --force': 'HIGH',
          'git push': 'MEDIUM',
          'default': 'LOW'
        }
      }
    }
  }
};

// Map assurance levels to A2H factors
const ASSURANCE_TO_FACTOR = {
  HIGH: ['passkey.webauthn.v1'],
  MEDIUM: ['otp.sms.v1', 'otp.email.v1'],
  LOW: ['link.click.v1']
};

function log(prefix, message) {
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`[${timestamp}] [${prefix}] ${message}`);
}

function matchesPattern(command, pattern) {
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  return regex.test(command);
}

function getAssuranceLevel(command) {
  const config = OPENCLAW_CONFIG.tools.exec.a2h.assurance;
  for (const [pattern, level] of Object.entries(config)) {
    if (pattern !== 'default' && matchesPattern(command, pattern)) {
      return level;
    }
  }
  return config.default || 'LOW';
}

async function sendAuthorizeRequest(command, principalId) {
  const assuranceLevel = getAssuranceLevel(command);
  const ticketId = `openclaw-exec-${crypto.randomUUID().slice(0, 8)}`;

  const request = {
    a2h_version: '1.0',
    message_id: `msg-${Date.now()}`,
    interaction_id: ticketId,
    created_at: new Date().toISOString(),
    agent_id: 'did:web:openclaw.local',
    principal_id: principalId,
    channel: {
      type: 'web',
      address: A2H_GATEWAY,
      nonce: crypto.randomBytes(16).toString('base64url'),
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    },
    type: 'AUTHORIZE',
    render: {
      body: `OpenClaw wants to run:\n\n${command}`
    },
    params: {
      profile: 'x-openclaw:exec.v1',
      command,
      host: 'gateway',
      assurance_level: assuranceLevel
    },
    assurance: {
      level: assuranceLevel,
      required_factors: ASSURANCE_TO_FACTOR[assuranceLevel] || ASSURANCE_TO_FACTOR.LOW
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

      // Still waiting
      process.stdout.write('.');
    } catch (e) {
      log('OpenClaw', `Poll error: ${e.message}`);
    }
  }

  return { state: 'TIMEOUT', decision: null };
}

function hashEvidence(evidence) {
  if (!evidence) return null;
  const data = JSON.stringify(evidence);
  return 'sha256:' + crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

async function simulateExecWithA2H(userRequest, command, principalId) {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  OpenClaw + A2H Integration Demo');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  log('OpenClaw', `User requested: "${userRequest}"`);
  log('OpenClaw', `Resolved command: ${command}`);

  const assurance = getAssuranceLevel(command);
  log('OpenClaw', `Command matches assurance pattern → level: ${assurance}`);
  log('OpenClaw', `Config: ask="${OPENCLAW_CONFIG.tools.exec.ask}"`);
  console.log('');

  // Step 1: Send AUTHORIZE to A2H
  log('OpenClaw', 'Sending AUTHORIZE to A2H Gateway...');

  let authResponse;
  try {
    authResponse = await sendAuthorizeRequest(command, principalId);
  } catch (e) {
    log('OpenClaw', `Failed to reach A2H Gateway: ${e.message}`);
    log('OpenClaw', 'Make sure the gateway is running: npm start');
    process.exit(1);
  }

  if (authResponse.error) {
    log('A2H', `Error: ${authResponse.error.code || authResponse.error}`);
    process.exit(1);
  }

  const ticketId = authResponse.interaction_id;
  log('A2H', `Request accepted, interaction: ${ticketId}`);
  log('A2H', `State: ${authResponse.state}`);
  console.log('');

  // Step 2: Wait for human approval
  log('OpenClaw', 'Waiting for human approval...');
  process.stdout.write('[OpenClaw] Polling');

  const result = await pollForResponse(ticketId);
  console.log(''); // newline after dots
  console.log('');

  // Step 3: Handle response
  if (result.state === 'ANSWERED') {
    if (result.decision === 'APPROVE') {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      log('A2H', '✓ APPROVED with passkey evidence');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');

      log('OpenClaw', 'Received cryptographic proof of consent');
      log('OpenClaw', `Evidence hash: ${hashEvidence(result.evidence)}`);
      log('OpenClaw', `Executing command: ${command}`);
      console.log('');

      // Simulate execution
      log('Exec', '(simulated) Command executed successfully');
      log('OpenClaw', 'Audit log entry created with evidence attached');

      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('  Demo Complete');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');
      console.log('Key takeaways:');
      console.log('  1. Command required HIGH assurance (passkey)');
      console.log('  2. Approval happened out-of-band (web page)');
      console.log('  3. Evidence is cryptographically signed');
      console.log('  4. Audit log has non-repudiable proof');
      console.log('');

    } else if (result.decision === 'DECLINE') {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      log('A2H', '✗ DECLINED by user');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');
      log('OpenClaw', 'Execution blocked - user declined');
      log('OpenClaw', 'Notifying user in original channel...');
    }
  } else if (result.state === 'EXPIRED') {
    log('A2H', 'Request expired (TTL exceeded)');
    log('OpenClaw', 'Execution blocked - approval timed out');
  } else {
    log('OpenClaw', `Unexpected state: ${result.state}`);
  }
}

// Run the demo
const userRequest = 'delete old backups';
const command = 'rm -rf /var/backups/old/*';
const principalId = 'did:example:alice';

simulateExecWithA2H(userRequest, command, principalId);
