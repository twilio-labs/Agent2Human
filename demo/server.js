// server.js - A2H Gateway POC (v2.0 - Unified Gateway + MCP)
// One process, one port. MCP and REST are two doors into the same room.

const express = require('express');
const crypto = require('crypto');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const RP_ID = process.env.RP_ID || 'localhost';
const RP_NAME = 'A2H Gateway';
const API_KEY = process.env.A2H_API_KEY || 'a2h_demo_secret'; // For agent auth
// ---------------------

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- IN-MEMORY DB (NOT FOR PROD) ---
const requestDB = new Map();
const userDB = new Map();
// ---------------------------------

const mintNonce = () => crypto.randomBytes(16).toString('base64url');

// ============================================================================
// AUTH MIDDLEWARE - Validates Bearer token for agent requests
// ============================================================================

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: { code: 'ERR.UNAUTHORIZED', message: 'Missing Authorization header' }});
  }
  const token = auth.slice(7);
  if (token !== API_KEY) {
    return res.status(401).json({ error: { code: 'ERR.INVALID_TOKEN', message: 'Invalid API key' }});
  }
  next();
}

// ============================================================================
// CORE A2H LOGIC - Shared by REST and MCP interfaces
// ============================================================================

/**
 * Create an authorization request
 * @returns {{ ticket_id: string, state: string, approval_url: string }}
 */
function createAuthorizationRequest(params) {
  const { action, principal_id, ttl_sec = 300, message_id } = params;
  const ticketId = crypto.randomUUID();
  const ttlMs = Math.max(30, ttl_sec) * 1000;
  const createdAt = Date.now();
  const expiresAt = createdAt + ttlMs;
  const approvalNonce = mintNonce();

  requestDB.set(ticketId, {
    state: 'WAITING_INPUT',  // PENDING → SENT → WAITING_INPUT → ANSWERED | EXPIRED
    payload: { principal_id, action, message_id },
    createdAt,
    expiresAt,
    approvalNonce,
    decision: null,
    evidence: null
  });

  const approvalUrl = `${BASE_URL}/approve?ticket=${encodeURIComponent(ticketId)}&nonce=${encodeURIComponent(approvalNonce)}`;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('→ A2H AUTHORIZE REQUEST');
  console.log(`  Ticket:    ${ticketId}`);
  console.log(`  Principal: ${principal_id}`);
  console.log(`  Action:    ${action}`);
  console.log(`  TTL:       ${ttl_sec}s`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n🔗 Approval Link:\n   ${approvalUrl}\n`);

  return { interaction_id: ticketId, state: 'WAITING_INPUT', approval_url: approvalUrl };
}

/**
 * Get status of a request
 * @returns {{ state: string, decision?: string }}
 */
function getRequestStatus(interactionId) {
  const rec = requestDB.get(interactionId);
  if (!rec) return null;

  // Check expiration
  if (rec.state === 'WAITING_INPUT' && Date.now() > rec.expiresAt) {
    rec.state = 'EXPIRED';
  }

  const result = {
    interaction_id: interactionId,
    state: rec.state,
    decision: rec.decision,
    principal_id: rec.payload.principal_id
  };

  // Include cryptographic evidence when approved — this is the whole point
  if (rec.state === 'ANSWERED' && rec.evidence) {
    result.evidence = rec.evidence;
  }

  return result;
}

/**
 * Send an inform notification (fire-and-forget)
 */
function sendInformNotification(params) {
  const { message, principal_id } = params;
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('→ A2H INFORM');
  console.log(`  Principal: ${principal_id}`);
  console.log(`  Message:   ${message}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  return { delivered: true };
}

// ============================================================================
// REST API ENDPOINTS
// ============================================================================

/**
 * POST /v1/intent - Submit an intent (AUTHORIZE or INFORM)
 */
app.post('/v1/intent', requireAuth, (req, res) => {
  const { type, principal_id, render, ttl_sec, message_id } = req.body;

  if (type === 'AUTHORIZE') {
    if (!render?.body) {
      return res.status(400).json({ error: { code: 'ERR.INVALID_REQUEST', message: 'render.body is required' }});
    }
    const result = createAuthorizationRequest({
      action: render.body,
      principal_id: principal_id || 'anonymous',
      ttl_sec,
      message_id
    });
    return res.status(202).json({ interaction_id: result.interaction_id, state: result.state });
  }

  if (type === 'INFORM') {
    if (!render?.body) {
      return res.status(400).json({ error: { code: 'ERR.INVALID_REQUEST', message: 'render.body is required' }});
    }
    sendInformNotification({ message: render.body, principal_id: principal_id || 'anonymous' });
    return res.json({ delivered: true });
  }

  return res.status(400).json({ error: { code: 'ERR.INVALID_REQUEST', message: `Unknown type: ${type}` }});
});

/**
 * GET /v1/status/:ticket - Check status of a request
 */
app.get('/v1/status/:interactionId', requireAuth, (req, res) => {
  const status = getRequestStatus(req.params.interactionId);
  if (!status) {
    return res.status(404).json({ error: { code: 'ERR.INVALID_REQUEST', message: 'Interaction not found' }});
  }
  res.json(status);
});

// ============================================================================
// MCP ENDPOINTS - Same logic, MCP interface
// ============================================================================

// MCP tool definitions
const MCP_TOOLS = [
  {
    name: 'human_authorize',
    description: `Request cryptographic authorization from a human for a high-stakes action.

The human will receive a link and must authenticate with their passkey (WebAuthn) to approve.
Use this for: file deletion, payments, system commands, or any action requiring explicit consent.

Returns a ticket_id that you can poll with check_status to see the decision.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Clear description of the action requiring authorization' },
        principal_id: { type: 'string', description: 'User identifier (optional)' },
        ttl_sec: { type: 'number', description: 'Time-to-live in seconds (default: 300)' }
      },
      required: ['action']
    }
  },
  {
    name: 'human_inform',
    description: `Send a fire-and-forget notification to a human. No response expected.

Use this for: progress updates, completion notices, alerts.`,
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message to send' },
        principal_id: { type: 'string', description: 'User identifier (optional)' }
      },
      required: ['message']
    }
  },
  {
    name: 'check_status',
    description: `Check the status of a pending authorization request.

Returns: WAITING_INPUT (not yet decided), ANSWERED (with decision APPROVE or DECLINE), or EXPIRED.`,
    inputSchema: {
      type: 'object',
      properties: {
        interaction_id: { type: 'string', description: 'The interaction_id from human_authorize' }
      },
      required: ['interaction_id']
    }
  }
];

/**
 * POST /mcp - MCP Streamable HTTP endpoint
 */
app.post('/mcp', (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  if (jsonrpc !== '2.0') {
    return res.json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid JSON-RPC' }, id });
  }

  // Handle MCP methods
  switch (method) {
    case 'initialize':
      return res.json({
        jsonrpc: '2.0',
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'a2h-gateway', version: '2.0.0' },
          capabilities: { tools: {} }
        },
        id
      });

    case 'tools/list':
      return res.json({
        jsonrpc: '2.0',
        result: { tools: MCP_TOOLS },
        id
      });

    case 'tools/call':
      return handleMCPToolCall(params, id, res);

    case 'notifications/initialized':
      // Client acknowledgment after initialize — no response needed for notifications
      return res.status(204).end();

    default:
      return res.json({ jsonrpc: '2.0', error: { code: -32601, message: `Unknown method: ${method}` }, id });
  }
});

function handleMCPToolCall(params, id, res) {
  const { name, arguments: args } = params || {};

  switch (name) {
    case 'human_authorize': {
      const result = createAuthorizationRequest({
        action: args.action,
        principal_id: args.principal_id || 'mcp-user',
        ttl_sec: args.ttl_sec || 300,
        message_id: `mcp-${Date.now()}`
      });
      return res.json({
        jsonrpc: '2.0',
        result: {
          content: [{
            type: 'text',
            text: `Authorization requested.\n\nInteraction: ${result.interaction_id}\nState: ${result.state}\n\nThe human will receive an approval link. Poll with check_status to see their decision.`
          }],
          structuredContent: result
        },
        id
      });
    }

    case 'human_inform': {
      sendInformNotification({ message: args.message, principal_id: args.principal_id || 'mcp-user' });
      return res.json({
        jsonrpc: '2.0',
        result: {
          content: [{ type: 'text', text: `Notification sent: "${args.message}"` }],
          structuredContent: { delivered: true }
        },
        id
      });
    }

    case 'check_status': {
      const status = getRequestStatus(args.interaction_id);
      if (!status) {
        return res.json({
          jsonrpc: '2.0',
          result: {
            content: [{ type: 'text', text: `Interaction not found: ${args.interaction_id}` }],
            isError: true
          },
          id
        });
      }
      let statusText;
      if (status.state === 'WAITING_INPUT') {
        statusText = 'Still waiting for human decision...';
      } else if (status.state === 'ANSWERED' && status.decision === 'APPROVE') {
        statusText = `APPROVED by ${status.principal_id} with cryptographic evidence (${status.evidence?.factor || 'unknown'}).`;
      } else if (status.state === 'ANSWERED' && status.decision === 'DECLINE') {
        statusText = `DECLINED by ${status.principal_id}.`;
      } else {
        statusText = `Status: ${status.state}`;
      }
      return res.json({
        jsonrpc: '2.0',
        result: {
          content: [{ type: 'text', text: statusText }],
          structuredContent: status
        },
        id
      });
    }

    default:
      return res.json({ jsonrpc: '2.0', error: { code: -32601, message: `Unknown tool: ${name}` }, id });
  }
}

// ============================================================================
// WEBAUTHN APPROVAL FLOW
// ============================================================================

function getFakeUser(principalId) {
  if (!userDB.has(principalId)) {
    userDB.set(principalId, {
      id: principalId,
      username: `user_${principalId.slice(0, 8)}`,
      authenticators: []
    });
  }
  return userDB.get(principalId);
}

/**
 * GET /approve - Human clicks approval link
 */
app.get('/approve', (req, res) => {
  const { ticket, nonce } = req.query;
  const rec = requestDB.get(ticket);

  if (!rec) return res.status(404).send('Request not found.');
  if (rec.state !== 'WAITING_INPUT') return res.status(410).send(`Request already handled: ${rec.state}`);
  if (nonce !== rec.approvalNonce) return res.status(403).send('Invalid link.');
  if (Date.now() > rec.expiresAt) {
    rec.state = 'EXPIRED';
    return res.status(410).send('<h1>Request Expired</h1>');
  }

  res.send(getApprovalHTML(ticket, nonce, rec.payload));
});

// WebAuthn registration
app.post('/register-options', async (req, res) => {
  const { principalId } = req.body;
  const user = getFakeUser(principalId);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: Buffer.from(user.id),
    userName: user.username,
    attestationType: 'none',
    excludeCredentials: user.authenticators.map(auth => ({
      id: auth.credential.id,
      type: 'public-key',
    })),
  });

  requestDB.set(`challenge_${principalId}`, options.challenge);
  res.json(options);
});

app.post('/register-verify', async (req, res) => {
  const { principalId, response } = req.body;
  const user = getFakeUser(principalId);
  const expectedChallenge = requestDB.get(`challenge_${principalId}`);

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: BASE_URL,
      expectedRPID: RP_ID,
    });

    if (verification.verified && verification.registrationInfo) {
      user.authenticators.push(verification.registrationInfo);
      userDB.set(principalId, user);
      requestDB.delete(`challenge_${principalId}`);
      console.log(`✓ Passkey registered for: ${principalId}`);
      return res.json({ verified: true });
    }
  } catch (e) {
    console.error(`✗ Registration failed:`, e.message);
    return res.status(400).json({ error: e.message });
  }
  res.status(400).json({ error: 'Verification failed' });
});

// WebAuthn authentication (approval)
app.post('/auth-options', async (req, res) => {
  const { ticket } = req.body;
  const rec = requestDB.get(ticket);
  if (!rec) return res.status(404).json({ error: 'Ticket not found' });

  const user = getFakeUser(rec.payload.principal_id);
  if (user.authenticators.length === 0) {
    return res.status(400).json({ error: 'No passkeys registered.' });
  }

  try {
    const options = await generateAuthenticationOptions({
      allowCredentials: user.authenticators.map(auth => ({
        id: auth.credential.id,
        type: 'public-key',
        transports: auth.credential.transports || [],
      })),
      userVerification: 'preferred',
      rpID: RP_ID,
    });

    requestDB.set(`challenge_${ticket}`, options.challenge);
    res.json(options);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post('/auth-verify', async (req, res) => {
  const { ticket, response } = req.body;
  const rec = requestDB.get(ticket);

  if (!rec || rec.state !== 'WAITING_INPUT') return res.status(404).json({ error: 'Not found or already decided' });
  if (Date.now() > rec.expiresAt) {
    rec.state = 'EXPIRED';
    return res.status(410).json({ error: 'Expired' });
  }

  const user = getFakeUser(rec.payload.principal_id);
  const expectedChallenge = requestDB.get(`challenge_${ticket}`);
  const storedAuth = user.authenticators.find(auth => auth.credential?.id === response.id);

  if (!storedAuth) return res.status(400).json({ error: 'Passkey not recognized' });

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: BASE_URL,
      expectedRPID: RP_ID,
      credential: storedAuth.credential,
    });

    if (verification.verified) {
      storedAuth.credential.counter = verification.authenticationInfo.newCounter;
      rec.state = 'ANSWERED';
      rec.decision = 'APPROVE';
      rec.evidence = {
        factor: 'passkey.webauthn.v1',
        proof: {
          authenticatorData: response.authenticatorData,
          signature: response.signature
        }
      };
      requestDB.delete(`challenge_${ticket}`);

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✓ APPROVED');
      console.log(`  Interaction: ${ticket}`);
      console.log(`  Principal:   ${rec.payload.principal_id}`);
      console.log(`  Evidence:    passkey.webauthn.v1`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return res.json({ verified: true });
    }
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  res.status(400).json({ error: 'Verification failed' });
});

app.post('/auth-decline', (req, res) => {
  const { ticket } = req.body;
  const rec = requestDB.get(ticket);

  if (!rec || rec.state !== 'WAITING_INPUT') return res.status(404).json({ error: 'Not found or already decided' });
  if (Date.now() > rec.expiresAt) {
    rec.state = 'EXPIRED';
    return res.status(410).json({ error: 'Expired' });
  }

  rec.state = 'ANSWERED';
  rec.decision = 'DECLINE';

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✗ DECLINED');
  console.log(`  Interaction: ${ticket}`);
  console.log(`  Principal:   ${rec.payload.principal_id}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  return res.json({ verified: true, decision: 'DECLINE' });
});

// ============================================================================
// APPROVAL UI
// ============================================================================

function getApprovalHTML(ticket, nonce, payload) {
  const user = getFakeUser(payload.principal_id);
  const hasPasskey = user.authenticators.length > 0;

  return `<!DOCTYPE html>
<html>
<head>
  <title>A2H Approval</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 500px; margin: 40px auto; padding: 20px; }
    .card { background: #f5f5f5; padding: 20px; border-radius: 12px; margin: 20px 0; }
    .action { font-size: 1.1em; white-space: pre-wrap; }
    button { font-size: 1.1em; padding: 12px 24px; margin: 8px; border-radius: 8px; border: none; cursor: pointer; }
    .approve { background: #22c55e; color: white; }
    .deny { background: #ef4444; color: white; }
    .register { background: #3b82f6; color: white; }
    #message { color: #666; margin-top: 20px; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <h2>Authorization Request</h2>
  <div class="card">
    <div class="action">${payload.action}</div>
  </div>

  <div id="register-section" class="${hasPasskey ? 'hidden' : ''}">
    <p>First time? Register your passkey to approve requests.</p>
    <button class="register" onclick="register()">Register Passkey</button>
  </div>

  <div id="auth-section" class="${hasPasskey ? '' : 'hidden'}">
    <button class="approve" onclick="approve()">Approve</button>
    <button class="deny" onclick="deny()">Deny</button>
  </div>

  <p id="message"></p>

  <script>
    const ticket = "${ticket}";
    const principalId = "${payload.principal_id}";
    const msg = document.getElementById('message');

    function b64ToBuffer(b64) {
      const str = atob(b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(b64.length + (4 - b64.length % 4) % 4, '='));
      return Uint8Array.from(str, c => c.charCodeAt(0)).buffer;
    }

    function bufferToB64(buf) {
      return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
    }

    async function register() {
      msg.textContent = 'Starting registration...';
      const opts = await (await fetch('/register-options', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ principalId })
      })).json();

      opts.challenge = b64ToBuffer(opts.challenge);
      opts.user.id = b64ToBuffer(opts.user.id);

      try {
        const cred = await navigator.credentials.create({ publicKey: opts });
        const resp = {
          id: cred.id,
          rawId: bufferToB64(cred.rawId),
          response: {
            clientDataJSON: bufferToB64(cred.response.clientDataJSON),
            attestationObject: bufferToB64(cred.response.attestationObject)
          },
          type: cred.type
        };

        const result = await (await fetch('/register-verify', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ principalId, response: resp })
        })).json();

        if (result.verified) {
          document.getElementById('register-section').classList.add('hidden');
          document.getElementById('auth-section').classList.remove('hidden');
          msg.textContent = 'Passkey registered! You can now approve.';
        }
      } catch (e) {
        msg.textContent = 'Registration failed: ' + e.message;
      }
    }

    async function approve() {
      msg.textContent = 'Authenticating...';
      const opts = await (await fetch('/auth-options', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ ticket })
      })).json();

      if (opts.error) { msg.textContent = opts.error; return; }

      opts.challenge = b64ToBuffer(opts.challenge);
      if (opts.allowCredentials) {
        opts.allowCredentials = opts.allowCredentials.map(c => ({ ...c, id: b64ToBuffer(c.id) }));
      }

      try {
        const assertion = await navigator.credentials.get({ publicKey: opts });
        const resp = {
          id: assertion.id,
          rawId: bufferToB64(assertion.rawId),
          response: {
            clientDataJSON: bufferToB64(assertion.response.clientDataJSON),
            authenticatorData: bufferToB64(assertion.response.authenticatorData),
            signature: bufferToB64(assertion.response.signature),
            userHandle: assertion.response.userHandle ? bufferToB64(assertion.response.userHandle) : null
          },
          type: assertion.type
        };

        const result = await (await fetch('/auth-verify', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ ticket, response: resp })
        })).json();

        if (result.verified) {
          document.body.innerHTML = '<h1>✓ Approved</h1><p>You can close this window.</p>';
        }
      } catch (e) {
        msg.textContent = 'Failed: ' + e.message;
      }
    }

    async function deny() {
      const result = await (await fetch('/auth-decline', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ ticket })
      })).json();

      if (result.verified) {
        document.body.innerHTML = '<h1>✗ Denied</h1><p>You can close this window.</p>';
      }
    }
  </script>
</body>
</html>`;
}

// ============================================================================
// STARTUP
// ============================================================================

app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  A2H Gateway (v2.0)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  REST API:   ${BASE_URL}/v1/intent`);
  console.log(`  MCP:        ${BASE_URL}/mcp`);
  console.log(`  Status:     ${BASE_URL}/v1/status/:interactionId`);
  console.log('───────────────────────────────────────────────────────────────');
  console.log(`  API Key:    ${API_KEY}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('MCP Tools: human_authorize, human_inform, check_status');
  console.log('');
});
