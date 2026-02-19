// server.js - A2H Gateway for OpenClaw Integration Demo
const express = require('express');
const crypto = require('crypto');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');

// --- CONFIGURATION ---
const PORT = 3001; // Different from reference demo (3000)
const BASE_URL = `http://localhost:${PORT}`;
const RP_ID = 'localhost';
const RP_NAME = 'A2H Gateway (OpenClaw Demo)';

const app = express();
app.use(express.json());

// --- IN-MEMORY STORES ---
const requestDB = new Map();
const userDB = new Map();

const mintNonce = () => crypto.randomBytes(16).toString('base64url');

function getOrCreateUser(principalId) {
  if (!userDB.has(principalId)) {
    userDB.set(principalId, {
      id: principalId,
      username: `openclaw_user_${principalId.slice(-8)}`,
      authenticators: [],
    });
  }
  return userDB.get(principalId);
}

// ============================================================
// ENDPOINT: Receive AUTHORIZE intent from OpenClaw
// ============================================================
app.post('/v1/intent', async (req, res) => {
  const msg = req.body;
  const interactionId = msg.interaction_id || `openclaw-${crypto.randomUUID()}`;

  if (msg.type !== 'AUTHORIZE') {
    return res.status(400).json({ error: { code: 'ERR.INVALID_REQUEST', message: `Unsupported type: ${msg.type}` }});
  }

  const ttlMs = Math.max(30, (msg.ttl_sec || 300)) * 1000;
  const createdAt = Date.now();
  const expiresAt = createdAt + ttlMs;
  const approvalNonce = mintNonce();

  requestDB.set(interactionId, {
    state: 'WAITING_INPUT',
    type: msg.type,
    payload: msg,
    createdAt,
    expiresAt,
    approvalNonce,
    response: null
  });

  const approvalLink = `${BASE_URL}/decide?id=${encodeURIComponent(interactionId)}&nonce=${encodeURIComponent(approvalNonce)}`;

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('→ A2H AUTHORIZE REQUEST');
  console.log(`  Interaction: ${interactionId}`);
  console.log(`  Principal: ${msg.principal_id}`);
  console.log(`  Command: ${msg.params?.command || 'N/A'}`);
  console.log(`  Assurance: ${msg.assurance?.required_factors?.join(', ') || 'default'}`);
  console.log(`  TTL: ${msg.ttl_sec || 300}s`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n🔗 Approval Link: ${approvalLink}\n`);

  return res.status(202).json({
    interaction_id: interactionId,
    state: 'SENT',
    approval_url: approvalLink
  });
});

// ============================================================
// ENDPOINT: Poll for response (OpenClaw would call this)
// ============================================================
app.get('/v1/status/:interactionId', (req, res) => {
  const { interactionId } = req.params;
  const rec = requestDB.get(interactionId);

  if (!rec) {
    return res.status(404).json({ error: 'Interaction not found' });
  }

  if (Date.now() > rec.expiresAt && rec.state === 'WAITING_INPUT') {
    rec.state = 'EXPIRED';
  }

  const response = {
    interaction_id: interactionId,
    state: rec.state,
  };

  if (rec.state === 'ANSWERED' && rec.response) {
    response.decision = rec.response.decision;
    response.evidence = rec.response.evidence;
  }

  return res.json(response);
});

// ============================================================
// ENDPOINT: Human clicks approval link
// ============================================================
app.get('/decide', (req, res) => {
  const { id, nonce } = req.query;
  const rec = requestDB.get(id);

  if (!rec) return res.status(404).send('Request not found.');
  if (rec.state !== 'WAITING_INPUT') return res.status(410).send(`Request already handled: ${rec.state}`);
  if (nonce !== rec.approvalNonce) return res.status(403).send('Invalid link.');
  if (Date.now() > rec.expiresAt) {
    rec.state = 'EXPIRED';
    return res.status(410).send('<h1>Request Expired</h1>');
  }

  res.send(getApprovalHTML(id, nonce, rec.payload));
});

// ============================================================
// WebAuthn Registration (one-time passkey setup)
// ============================================================
app.post('/register-options', async (req, res) => {
  const { principalId } = req.body;
  const user = getOrCreateUser(principalId);

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
  const user = getOrCreateUser(principalId);
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

// ============================================================
// WebAuthn Authentication (the actual approval)
// ============================================================
app.post('/auth-options', async (req, res) => {
  const { ticket } = req.body;
  const rec = requestDB.get(ticket);
  const user = getOrCreateUser(rec.payload.principal_id);

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

  if (!rec || rec.state !== 'WAITING_INPUT') {
    return res.status(404).json({ error: 'Request not found or already decided.' });
  }
  if (Date.now() > rec.expiresAt) {
    rec.state = 'EXPIRED';
    return res.status(410).json({ error: 'Request Expired' });
  }

  const user = getOrCreateUser(rec.payload.principal_id);
  const expectedChallenge = requestDB.get(`challenge_${ticket}`);
  const storedAuth = user.authenticators.find(auth => auth.credential?.id === response.id);

  if (!storedAuth) {
    return res.status(400).json({ error: 'Passkey not recognized.' });
  }

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
      userDB.set(rec.payload.principal_id, user);

      rec.state = 'ANSWERED';
      rec.response = {
        decision: 'APPROVE',
        evidence: {
          factor: 'passkey.webauthn.v1',
          proof: {
            clientDataJSON: response.response.clientDataJSON,
            authenticatorData: response.response.authenticatorData,
            signature: response.response.signature,
          }
        }
      };
      requestDB.delete(`challenge_${ticket}`);

      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✓ A2H APPROVAL RECEIVED');
      console.log(`  Interaction: ${ticket}`);
      console.log(`  Principal: ${rec.payload.principal_id}`);
      console.log(`  Decision: APPROVE`);
      console.log(`  Evidence: passkey.webauthn.v1`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      return res.json({ verified: true });
    }
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  res.status(400).json({ error: 'Verification failed' });
});

app.post('/auth-decline', async (req, res) => {
  const { ticket } = req.body;
  const rec = requestDB.get(ticket);

  if (!rec || rec.state !== 'WAITING_INPUT') {
    return res.status(404).json({ error: 'Request not found or already decided.' });
  }

  rec.state = 'ANSWERED';
  rec.response = {
    decision: 'DECLINE',
    timestamp: new Date().toISOString()
  };

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✗ A2H DECLINE RECEIVED');
  console.log(`  Interaction: ${ticket}`);
  console.log(`  Decision: DECLINE`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return res.json({ verified: true, decision: 'DECLINE' });
});

// ============================================================
// HTML for approval page
// ============================================================
function getApprovalHTML(ticket, nonce, payload) {
  const user = getOrCreateUser(payload.principal_id);
  const hasPasskey = user.authenticators.length > 0;
  const command = payload.params?.command || 'Unknown command';

  return `<!DOCTYPE html>
<html>
<head>
  <title>OpenClaw - Approve Command</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .container { max-width: 500px; margin: 0 auto; }
    .card { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
    .logo { width: 48px; height: 48px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; }
    h1 { margin: 0; font-size: 20px; }
    .subtitle { color: #666; font-size: 14px; }
    .command-box { background: #1a1a2e; color: #00ff88; padding: 16px; border-radius: 8px; font-family: 'SF Mono', Monaco, monospace; font-size: 14px; margin: 20px 0; overflow-x: auto; }
    .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 12px; border-radius: 8px; margin: 20px 0; }
    .warning-title { font-weight: 600; color: #856404; }
    .buttons { display: flex; gap: 12px; margin-top: 24px; }
    button { flex: 1; padding: 14px; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; border: none; }
    .btn-approve { background: #10b981; color: white; }
    .btn-approve:hover { background: #059669; }
    .btn-decline { background: #ef4444; color: white; }
    .btn-decline:hover { background: #dc2626; }
    .register-section { background: #e0e7ff; padding: 16px; border-radius: 8px; margin: 20px 0; }
    .btn-register { background: #4f46e5; color: white; width: 100%; }
    #message { text-align: center; margin-top: 16px; color: #666; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <div class="logo">OC</div>
        <div>
          <h1>Approve Command</h1>
          <div class="subtitle">OpenClaw wants to execute:</div>
        </div>
      </div>

      <div class="command-box">${escapeHtml(command)}</div>

      <div class="warning">
        <div class="warning-title">High-Risk Operation</div>
        This action requires passkey authentication (Touch ID / Face ID).
      </div>

      <div id="register-section" class="${hasPasskey ? 'hidden' : 'register-section'}">
        <p><strong>First time?</strong> Register a passkey to continue.</p>
        <button id="btn-register" class="btn-register">Register Passkey</button>
      </div>

      <div id="auth-section" class="${hasPasskey ? '' : 'hidden'}">
        <div class="buttons">
          <button id="btn-approve" class="btn-approve">Approve</button>
          <button id="btn-decline" class="btn-decline">Decline</button>
        </div>
      </div>

      <div id="message"></div>
    </div>
  </div>

  <script>
    const ticket = "${ticket}";
    const principalId = "${payload.principal_id}";
    const msgEl = document.getElementById('message');

    function base64urlToBuffer(base64url) {
      const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    }

    function bufferToBase64url(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=/g, '');
    }

    document.getElementById('btn-register')?.addEventListener('click', async () => {
      msgEl.textContent = 'Starting registration...';
      const res = await fetch('/register-options', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ principalId })
      });
      const options = await res.json();
      if (options.error) { msgEl.textContent = 'Error: ' + options.error; return; }

      options.challenge = base64urlToBuffer(options.challenge);
      options.user.id = base64urlToBuffer(options.user.id);
      if (options.excludeCredentials) {
        options.excludeCredentials = options.excludeCredentials.map(c => ({...c, id: base64urlToBuffer(c.id)}));
      }

      try {
        const attestation = await navigator.credentials.create({ publicKey: options });
        const regResponse = {
          id: attestation.id,
          rawId: bufferToBase64url(attestation.rawId),
          response: {
            clientDataJSON: bufferToBase64url(attestation.response.clientDataJSON),
            attestationObject: bufferToBase64url(attestation.response.attestationObject),
          },
          type: attestation.type
        };

        const vRes = await fetch('/register-verify', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ principalId, response: regResponse })
        });
        if (vRes.ok) {
          msgEl.textContent = 'Passkey registered! You can now approve.';
          document.getElementById('register-section').classList.add('hidden');
          document.getElementById('auth-section').classList.remove('hidden');
        }
      } catch (e) {
        msgEl.textContent = 'Registration failed: ' + e.message;
      }
    });

    document.getElementById('btn-approve')?.addEventListener('click', async () => {
      msgEl.textContent = 'Authenticating...';
      const res = await fetch('/auth-options', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ ticket })
      });
      const options = await res.json();
      if (options.error) { msgEl.textContent = 'Error: ' + options.error; return; }

      options.challenge = base64urlToBuffer(options.challenge);
      if (options.allowCredentials) {
        options.allowCredentials = options.allowCredentials.map(c => ({...c, id: base64urlToBuffer(c.id)}));
      }

      try {
        const assertion = await navigator.credentials.get({ publicKey: options });
        const authResponse = {
          id: assertion.id,
          rawId: bufferToBase64url(assertion.rawId),
          response: {
            clientDataJSON: bufferToBase64url(assertion.response.clientDataJSON),
            authenticatorData: bufferToBase64url(assertion.response.authenticatorData),
            signature: bufferToBase64url(assertion.response.signature),
            userHandle: assertion.response.userHandle ? bufferToBase64url(assertion.response.userHandle) : null,
          },
          type: assertion.type
        };

        const vRes = await fetch('/auth-verify', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ ticket, response: authResponse })
        });
        if (vRes.ok) {
          document.body.innerHTML = '<div style="text-align:center;padding:60px;"><h1 style="color:#10b981;">Approved</h1><p>Command execution authorized.</p></div>';
        }
      } catch (e) {
        msgEl.textContent = 'Auth failed: ' + e.message;
      }
    });

    document.getElementById('btn-decline')?.addEventListener('click', async () => {
      const res = await fetch('/auth-decline', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ ticket })
      });
      if (res.ok) {
        document.body.innerHTML = '<div style="text-align:center;padding:60px;"><h1 style="color:#ef4444;">Declined</h1><p>Command execution blocked.</p></div>';
      }
    });
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// Start server
// ============================================================
app.listen(PORT, () => {
  console.log(`A2H Gateway listening on ${BASE_URL}`);
  console.log(`Run 'node openclaw-simulator.js' to test.\n`);
});
