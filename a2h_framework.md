# A2H Framework - v1.0 Specification

A2H (Agent-to-Human) is a channel-agnostic, auditable protocol for agents to communicate with their human principals. It defines a standard interface for notifications, data collection, authorization with cryptographic consent evidence, escalation, and result reporting.

## Scope

**In scope:** A generic framework for agents to inform (notify), collect (get input), authorize (get consent), report results, or escalate (handoff) to a human. This includes progress, exceptions, and an auditable, observable trail.

**Non-goals:** Agent planning, capability learning, long-term memory, channel-specific UI.

### Deferred to Layer 2

The following capabilities are recognized as important for autonomous agents but are deferred to future versions to allow real-world validation:

- **Standing policies:** Pre-approved action classes with conditions ("approve all flights under $500")
- **Delegation:** Authority transfer between principals ("Bob can approve for Alice")
- **Revocation:** Canceling pending or standing approvals
- **Scope boundaries:** Defining what agents can do without approval
- **Multi-party approval:** N-of-M approval requirements
- **Conditional defaults:** "If no response in X, do Y"

These will be addressed in Layer 2 of the protocol (v1.2+). The current Layer 1 provides the foundation: channel abstraction, delivery, and single-action consent with cryptographic evidence.

---

## 1. A2H Protocol

### 1.1 Core Principles

**Simple Primitives:** Atomic, non-overlapping intents. Chain them; don't combine them.
- **Agent → Human:** INFORM, COLLECT, AUTHORIZE, ESCALATE, RESULT
- **Human → Agent:** RESPONSE

**Extensibility via Profiles:** Base intents are generic. Use case-specific data added via profiles (e.g., `profile: "transaction.v1"`).

**Stable Identifiers:** `principal_id` is non-routable (DID, OIDC sub). Routing info lives in `channel`.

**Strong Signatures:** One JWS per message over JCS-canonicalized payload.

---

### 1.1.2 Terminology

| Term | Definition |
|------|------------|
| **Agent ID** | Software entity acting on behalf of a human |
| **Principal ID** | The human who delegated authority to the agent |
| **A2H Gateway** | Service handling delivery, state, and evidence collection |
| **Channel** | Delivery medium (sms, push, email, voice, wallet) |
| **Intent Type** | Message verb: INFORM, COLLECT, AUTHORIZE, ESCALATE, RESULT, RESPONSE, ERROR |
| **Profile** | Optional schema extending base intents for specific use cases |
| **Interaction ID** | UUIDv7 for a single human-agent interaction loop |
| **Message ID** | UUIDv7 per message; many per interaction |
| **Links** | References to related protocol objects (acp_ref, ap2_mandate) |
| **Evidence** | Proof of principal's decision (OTP, passkey assertion) |

---

### 1.2 A2H Common Data Envelope

This model is the base of every A2H message. Additional fields can be passed.


```json
{
  "a2h_version": "1.0",
  "a2h_min_version": "1.0",
  "interaction_id": "uuidv7",
  "type": "INFORM | COLLECT | AUTHORIZE | ESCALATE | RESULT | RESPONSE | ERROR",
  "message_id": "uuidv7",
  "responds_to": "uuidv7",
  "agent_id": "did:web:agent.example.com",
  "principal_id": "did:example:alice",
  "channel": {
    "type": "sms | email | whatsapp",
    "address": "tel:+15551234567",
    "nonce": "base64url",
    "expires_at": "2026-01-15T17:05:00Z",
    "render": {
      "title": "Short Title",
      "body": "Plain text body for SMS, email, etc."
    }
  },
  "links": {
    "acp_ref": "acp:order/xyz",
    "ap2_mandate": "ap2:mandate/abc",
    "a2a_thread": "a2a:thread/123",
    "mcp_session": "mcp:session/456"
  },
  "params": {},
  "created_at": "2026-01-15T17:00:00Z",
  "signature": "<detached JWS over JCS canonical payload>"
}
```
> **Important:** `principal_id` should not be a phone/email. Routables live in `channel.address` and MUST use valid URI schemes (`tel:`, `mailto:`, etc.). The entire body, including channel, MUST be covered by the JWS.

### 1.3 Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| **INFORM** | Agent → Human | Informational, fire-and-forget |
| **COLLECT** | Agent → Human | Get structured data |
| **AUTHORIZE** | Agent → Human | Get approval |
| **ESCALATE** | Agent → Human | Handoff to live agent |
| **RESULT** | Agent → Human | Agent response/outcome |
| **RESPONSE** | Human → Agent | Human reply |
| **ERROR** | Bidirectional | Unsuccessful request |

---

#### INFORM (One-Way FYI)

**Purpose:** Tell the human something. Fire-and-forget.

**Examples:** "Your order has shipped," "I've finished summarizing that document."

Payload:


```json
{
  "type": "INFORM",
  "params": {
    "topic": "receipt | progress | alert | result | exception"
  },
  "render": { "body": "Your order #123 has shipped." }
}
```

---

#### COLLECT (Get Data)

**Purpose:** Gather one or more fields of data from the human.

**Examples:** "Which of these 3 options do you want?", "What date should I book the flight for?"

```json
{
  "type": "COLLECT",
  "render": { "body": "Please provide your info for the appointment." },
  "ttl_sec": 900,
  "components": [
    { "type": "TEXT", "name": "full_name", "label": "Full Name" },
    { "type": "SELECT", "name": "slot", "label": "Pick a time", "options": [
      { "value": "tue_2pm", "label": "Tue 2pm" },
      { "value": "wed_9am", "label": "Wed 9am" }
    ]}
  ]
}
```

---

#### AUTHORIZE (Get Approval)

**Purpose:** Gate a specific, high-stakes action. Get a simple "Approve / Decline" answer.

**Examples:** "Authorize me to delete 3 files?", "Confirm booking this non-refundable flight?"

```json
{
  "type": "AUTHORIZE",
  "render": { "body": "Authorize agent to delete 3 unused files?" },
  "ttl_sec": 300,
  "assurance": {
    "level": "HIGH",
    "required_factors": ["passkey.webauthn.v1", "otp.v1"]
  },
  "explanation_bundle": {
    "why": "This action is irreversible."
  }
}
```

---

#### ESCALATE (Handoff)

**Purpose:** Transfer the human to a different channel, typically a live person.

**Example:** "Do you want to talk to a support agent now?"

```json
{
  "type": "ESCALATE",
  "render": { "body": "Connecting you to the billing department..." },
  "params": {
    "targets": ["voice:tel:+18001234567", "chat:flex:queue/support"]
  }
}
```

---

#### RESULT (Agent Response)

**Purpose:** The agent's final response/outcome after action completion.

```json
{
  "type": "RESULT",
  "responds_to": "<message_id of the AUTHORIZE>",
  "render": { "body": "Your purchase is complete. Order #12345." },
  "params": {
    "status": "EXECUTED",
    "result_data": {
      "acp_order_id": "acp:order/xyz123",
      "tracking": "1Z..."
    }
  }
}
```

---

#### RESPONSE (Human Reply)

**Purpose:** The Human reply to an intent, containing their decision and cryptographic evidence.

```json
{
  "type": "RESPONSE",
  "responds_to": "<message_id of the original intent>",
  "interaction_id": "int-456",
  "status": "ANSWERED",
  "decision": "APPROVE",
  "decided_at": "2026-01-19T12:05:00Z",
  "data": {
    "full_name": "Jane Doe",
    "slot": "Wed 9am"
  },
  "evidence": {
    "factor": "passkey.webauthn.v1",
    "proof": { ... }
  },
  "signature": "<JWS signed by gateway>"
}
```

See Section 1.11 for RESPONSE signing requirements.

---

#### ERROR (Failure Notification)

**Purpose:** Indicate that a request could not be processed or completed.

**Examples:** "Request expired," "Invalid principal," "Channel unavailable"

```json
{
  "type": "ERROR",
  "responds_to": "<original_message_id>",
  "error": {
    "code": "ERR.EXPIRED",
    "message": "Request expired before response received"
  },
  "timestamp": "2026-01-15T17:10:00Z"
}
```

**Common Error Codes:**
| Code | Description |
|------|-------------|
| `ERR.EXPIRED` | TTL elapsed before human responded |
| `ERR.INVALID_REQUEST` | Malformed or missing required fields |
| `ERR.INVALID_PRINCIPAL` | Unknown or invalid principal_id |
| `ERR.CHANNEL_UNAVAILABLE` | No channel could deliver the message |
| `ERR.CONFLICT` | Interaction already in terminal state |
| `ERR.REPLAY_REJECTED` | Request failed replay protection (duplicate message_id, stale timestamp, or invalid nonce) |
| `ERR.RATE_LIMITED` | Too many requests; retry after the duration specified in `retry_after_sec` |

Gateways MAY implement rate limiting to prevent abuse. Rate-limited requests receive `ERR.RATE_LIMITED` with a `retry_after_sec` field indicating when to retry.

---

### 1.4 Discovery (/.well-known/a2h)

Agents SHOULD NOT assume a gateway's capabilities. The `/.well-known/a2h` document allows an agent to discover supported features, channels, and security policies before sending a message.

A gateway serving `agent.example.com` would expose this at `https://agent.example.com/.well-known/a2h`.

```json
{
  "a2h_supported": ["1.0"],
  "channels": ["sms", "email", "push", "wallet", "voice", "chat"],
  "factors": ["passkey.webauthn.v1", "push.v1", "otp.v1", "voice_ivr.v1", "email_link.v1"],
  "max_ttl_sec": 1800,
  "locales": ["en-US"],
  "jwks_uri": "https://{domain}/.well-known/jwks.json",
  "quiet_hours": { "start": "22:00", "end": "07:00", "tz": "America/Denver" },
  "limits": { "max_single_usd": 500, "daily_usd": 1500 }
}
```

### 1.5 Profiles (Protocol Extension)

A Profile is an optional, versioned schema that adds use-case-specific fields to a base message type. It allows A2H to remain generic while supporting complex, specific flows.

Agents and Gateways negotiate profiles. If an Agent sends a `profile: "foo.v1"` that the Gateway (from its `/.well-known/`) doesn't support, the Gateway MUST reject the message. This ensures the Agent has read and understands the `.well-known` endpoint.

> **Note:** Concrete profile definitions (e.g., `transaction.v1`, `healthcare.consent.v1`) are deferred to a future version of this specification. Future profiles may also support delegation (Alice delegates approval authority to Bob) and multi-approval policies (N-of-M approvers required).

### 1.6 State Machine

- `WAITING_INPUT` is the only state that accepts a RESPONSE message.
- The `ttl_sec` timer starts upon entering `WAITING_INPUT`.
- A RESPONSE arriving after `EXPIRED` MUST be rejected with `ERR.EXPIRED`.

```mermaid
stateDiagram-v2
    [*] --> PENDING: Agent creates message

    PENDING --> SENT: send()
    SENT --> WAITING_INPUT: ack()

    WAITING_INPUT --> ANSWERED: response()
    WAITING_INPUT --> EXPIRED: timeout (ttl_sec)
    WAITING_INPUT --> CANCELLED: cancel()

    PENDING --> FAILED: delivery_error()
    SENT --> FAILED: delivery_error()
    WAITING_INPUT --> FAILED: delivery_error()

    ANSWERED --> [*]
    EXPIRED --> [*]
    CANCELLED --> [*]
    FAILED --> [*]

    note right of WAITING_INPUT
        Only state that accepts
        RESPONSE messages.
        TTL timer active.
    end note

    note right of EXPIRED
        Late RESPONSE rejected
        with ERR.EXPIRED
    end note

    note right of CANCELLED
        Agent cancelled via
        POST /v1/cancel/{id}
    end note

    note right of FAILED
        All channels failed
        ERR.DELIVERY_FAILED
    end note
```

### 1.7 API Endpoints Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/a2h` | GET | Discover gateway capabilities |
| `/v1/intent` | POST | Send an A2H intent message |
| `/v1/status/{interactionId}` | GET | Query interaction status |
| `/v1/cancel/{interactionId}` | POST | Cancel a pending interaction |
| `/v1/nonce` | GET | Request a one-time nonce for replay protection (optional) |

#### Cancel Endpoint

**POST /v1/cancel/{interactionId}**

Cancel a pending interaction before the human responds. Only works when interaction is in `WAITING_INPUT` state.

**Success Response (200):**
```json
{
  "success": true,
  "message": "Interaction cancelled",
  "state": "CANCELLED"
}
```

**Error Response (409 Conflict):**
```json
{
  "error": "ERR.CONFLICT",
  "message": "Interaction already responded"
}
```

---

### 1.8 Authentication

#### 1.8.1 Overview

A2H Gateways SHOULD authenticate callers before processing requests. The protocol does not mandate a specific authentication mechanism—gateways are free to implement authentication appropriate to their deployment context.

> **Note:** Callers may be AI agents, backend services, or other systems. The term "agent" is used throughout this spec, but the protocol does not restrict who may send A2H messages.

#### 1.8.2 Recommended Approaches

Gateways SHOULD support one or more of the following industry-standard methods:

| Method | Complexity | Best For |
|--------|------------|----------|
| **API Keys** | Low | Development, self-hosted, simple integrations |
| **OAuth 2.0 Bearer Tokens** | Medium | Multi-tenant hosted gateways |
| **Mutual TLS (mTLS)** | High | Enterprise zero-trust environments |

The protocol does not define scopes or permission models—these are implementation details left to the gateway operator.

#### 1.8.3 API Key Authentication

For simplicity, gateways MAY support static API keys via a namespaced header:

```http
POST /v1/intent HTTP/1.1
Host: gateway.example.com
X-A2H-API-Key: a2h_live_abc123...
Content-Type: application/json
```

API keys SHOULD be:
- Provisioned out-of-band (admin console, CLI, environment variable)
- Rotatable without downtime
- Scoped to specific principals if the gateway supports multi-tenancy

> **Note:** Ensure proxies forward the `X-A2H-API-Key` header—many strip custom headers by default.

#### 1.8.4 OAuth 2.0 Authentication

For hosted or multi-tenant deployments, gateways MAY support OAuth 2.0:

```http
POST /v1/intent HTTP/1.1
Host: gateway.example.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Content-Type: application/json
```

Gateways implementing OAuth SHOULD advertise endpoints in discovery (see 1.8.7).

#### 1.8.5 No Authentication (Development Only)

For local development and POC scenarios, gateways MAY operate without authentication.

> **Warning:** Unauthenticated gateways MUST NOT be exposed to public networks.

#### 1.8.6 Agent Registration

Gateways SHOULD provide a mechanism for registering agents before they send messages. Registration enables:

- Audit trail attribution
- Rate limiting per agent
- Principal consent ("allow this agent to contact me")

However, registration is not required by the protocol. Gateways MAY accept messages from unregistered callers, particularly in single-tenant or development deployments.

#### 1.8.7 Discovery

Gateways SHOULD advertise supported authentication methods in `/.well-known/a2h`:

```json
{
  "a2h_supported": ["1.0"],
  "auth": {
    "methods": ["api_key", "oauth2"],
    "oauth2": {
      "token_endpoint": "https://gateway.example.com/oauth/token"
    }
  },
  "channels": ["sms", "email", "push"],
  ...
}
```

#### 1.8.8 Identity in Message Payload

The `agent_id` field in the message envelope identifies the logical sender:

```json
{
  "agent_id": "did:web:booking-agent.example.com",
  ...
}
```

If the gateway authenticates callers, it SHOULD verify that the `agent_id` matches the authenticated identity. Mismatches MAY be rejected or logged depending on gateway policy.

> **Future Consideration:** The relationship between transport-level authentication and payload-level `agent_id` may be refined in future versions.

---

### 1.9 Principal Addressing

#### 1.9.1 Overview

A2H messages are addressed to a **principal** (the human recipient) via two fields:

- `principal_id`: A stable, non-routable identifier for the human (e.g., `did:example:alice`, an OIDC `sub`, or an application-specific ID)
- `channel.address`: The routable delivery address (e.g., `tel:+15551234567`, `mailto:alice@example.com`)

Identity is separate from routing: `principal_id` is *who*, `channel.address` is *where*.

#### 1.9.2 Address Provision

Agents SHOULD provide both `principal_id` and `channel.address` in intent requests:

```json
{
  "principal_id": "did:example:alice",
  "channel": {
    "type": "sms",
    "address": "tel:+15551234567"
  }
}
```

The gateway delivers to `channel.address`. Agents are responsible for obtaining addresses (from user profile, CRM, etc.).

#### 1.9.3 Channel Verification

Gateways SHOULD verify that the `channel.address` belongs to the claimed `principal_id` before delivering sensitive messages (particularly AUTHORIZE intents).

Verification methods include:
- **OTP Challenge:** Send a one-time code to the address; principal confirms receipt
- **Link Confirmation:** Send a unique link; principal clicks to confirm
- **Out-of-Band Verification:** Address verified through external identity provider

Unverified channels MAY be used for low-stakes messages (INFORM, RESULT). For `assurance.level: "HIGH"`, gateways SHOULD require verified channels.

#### 1.9.4 Conflict Resolution

If cached/verified bindings differ from agent-provided `channel.address`, gateway behavior is implementation-defined. Gateways MAY prefer verified binding, trust agent, reject with `ERR.INVALID_REQUEST`, or prompt re-verification.

#### 1.9.5 Multiple Channels

A principal may be reachable via multiple channels (SMS, email, push). When multiple channels are available:

- Agents MAY specify a preferred channel via `channel.type`
- Gateways MAY override based on principal preferences, delivery success rates, or quiet hours
- Channel failover behavior is implementation-defined (see Section 1.13 for guidance)

#### 1.9.6 Privacy Considerations

The `principal_id` SHOULD NOT contain personally identifiable information (PII). Use opaque identifiers rather than email addresses or phone numbers as the principal ID.

```json
// Good: opaque identifier
{ "principal_id": "usr_abc123" }

// Avoid: PII as identifier
{ "principal_id": "alice@example.com" }
```

Channel addresses necessarily contain PII (phone numbers, emails). Agents should handle this data according to applicable privacy regulations.

---

### 1.10 Replay Protection

#### 1.10.1 Overview

A2H messages may be intercepted and replayed by attackers. Gateways MUST implement protections against:

- **Intent replay:** Attacker replays a valid AUTHORIZE request to spam the principal
- **Approval link replay:** Attacker reuses an approval URL after the principal has responded
- **Response replay:** Attacker replays a RESPONSE to trick the agent

#### 1.10.2 Intent Idempotency

Gateways MUST implement idempotency based on the `message_id` field:

- If a request arrives with a `message_id` seen within the idempotency window, the gateway MUST return the original `interaction_id` rather than creating a duplicate interaction.
- The default idempotency window SHOULD be 1 hour.
- Gateways MAY allow configuration of the idempotency window.
- Gateways SHOULD include `"duplicate": true` in responses to duplicate requests.

```json
// Response to duplicate request
{
  "interaction_id": "original-interaction-id",
  "state": "WAITING_INPUT",
  "duplicate": true
}
```

Gateways SHOULD advertise their idempotency window in discovery:

```json
{
  "replay_protection": {
    "idempotency_window_sec": 3600,
    "timestamp_tolerance_sec": 300,
    "nonce_endpoint": "/v1/nonce"
  }
}
```

#### 1.10.3 Timestamp Validation

Gateways SHOULD validate `created_at` and reject requests more than 5 minutes old or in the future. Rejected requests return `ERR.REPLAY_REJECTED`.

#### 1.10.4 Nonce-Based Protection

For additional security, gateways MAY implement nonce-based replay protection:

1. Agent requests a one-time nonce: `GET /v1/nonce`
2. Gateway returns nonce with expiry
3. Agent includes nonce in the intent request
4. Gateway validates and marks nonce as used
5. Replayed requests with same nonce are rejected

#### 1.10.5 Approval Link Protection

Approval links (URLs sent to principals) MUST be protected against replay:

- Each link MUST contain a unique, unguessable token
- Links MUST be single-use: once the principal responds (approve or decline), the link is invalidated
- Links MUST expire when the interaction TTL expires
- Requests to expired or used links MUST return an appropriate error (not silently succeed)

#### 1.10.6 Agent-Side Validation

Agents SHOULD implement their own replay protection:

- Track processed `interaction_id` values to avoid duplicate processing
- Verify that `responds_to` in RESPONSE matches the original `message_id`
- Reject RESPONSE messages for unknown or already-processed interactions
- Set reasonable timeouts when polling for responses

---

### 1.11 RESPONSE Signing & Evidence

#### 1.11.1 Overview

RESPONSE messages contain the human's decision and must be cryptographically verifiable. The protocol uses a layered approach:

1. **Gateway signature:** The gateway signs the entire RESPONSE message
2. **Factor evidence:** Factor-specific proof of human authentication

This provides both gateway attestation (universal) and human proof (factor-dependent).

#### 1.11.2 Gateway Signature

Gateways SHOULD sign all RESPONSE messages using JWS (JSON Web Signature):

```json
{
  "type": "RESPONSE",
  "responds_to": "msg-123",
  "interaction_id": "int-456",
  "decision": "APPROVE",
  "decided_at": "2026-01-19T12:05:00Z",
  "evidence": { ... },
  "signature": "eyJhbGciOiJSUzI1NiIs..."
}
```

The `signature` field contains a detached JWS signature over the canonical JSON representation of the message (excluding the `signature` field itself).

Gateways that sign responses SHOULD advertise their public key via JWKS:

```json
// In /.well-known/a2h
{
  "jwks_uri": "https://gateway.example.com/.well-known/jwks.json"
}
```

#### 1.11.3 Evidence Structure

The `evidence` field contains factor-specific proof of human authentication. All evidence objects MUST include a `factor` field identifying the authentication method:

```json
{
  "evidence": {
    "factor": "<factor_type>",
    "proof": { ... }
  }
}
```

**Common factor types:**

| Factor | Description |
|--------|-------------|
| `passkey.webauthn.v1` | WebAuthn/FIDO2 passkey authentication |
| `otp.sms.v1` | SMS one-time password |
| `otp.email.v1` | Email one-time password |
| `push.v1` | Push notification approval |
| `voice.ivr.v1` | Voice IVR keypress confirmation |

#### 1.11.4 Passkey Evidence (WebAuthn)

For passkey authentication, the evidence contains the WebAuthn assertion:

```json
{
  "evidence": {
    "factor": "passkey.webauthn.v1",
    "proof": {
      "credentialId": "base64url...",
      "clientDataJSON": "base64url...",
      "authenticatorData": "base64url...",
      "signature": "base64url...",
      "userHandle": "base64url..."
    }
  }
}
```

**Challenge Binding Requirement:**

For passkey authentication, the WebAuthn challenge MUST bind to the specific interaction. The `clientDataJSON.challenge` MUST contain or derive from the `interaction_id`.

This ensures the human's cryptographic signature is bound to the specific approval request, preventing signature reuse across interactions.

```javascript
// Example challenge generation
const challenge = base64url(sha256(interaction_id + nonce));
```

#### 1.11.5 OTP Evidence

For OTP-based authentication, the evidence contains verification attestation:

```json
{
  "evidence": {
    "factor": "otp.sms.v1",
    "proof": {
      "verified_at": "2026-01-19T12:05:00Z",
      "delivery_channel": "tel:+15551234567",
      "attempts": 1
    }
  }
}
```

> **Note:** OTP evidence does not contain cryptographic proof from the human—it is the gateway's attestation that verification succeeded. Trust relies on the gateway signature.

#### 1.11.6 Push Evidence

For push-based approval:

```json
{
  "evidence": {
    "factor": "push.v1",
    "proof": {
      "approved_at": "2026-01-19T12:05:00Z",
      "device_id": "device-abc123",
      "app_version": "2.1.0"
    }
  }
}
```

#### 1.11.7 Agent Verification

Agents receiving RESPONSE messages:

- **MUST** verify that `responds_to` matches their original `message_id`
- **MUST** verify the gateway signature (if present) using the gateway's published JWKS
- **MAY** verify the evidence for additional assurance, particularly for passkey where cryptographic verification is possible

```javascript
async function verifyResponse(response, originalMessageId, gatewayJwks) {
  if (response.responds_to !== originalMessageId) throw new Error('Mismatch');
  if (response.signature && !await verifyJWS(response, gatewayJwks)) {
    throw new Error('Invalid signature');
  }
  return true;
}
```

#### 1.11.8 Audit Bundle

For high-value transactions, agents MAY construct an audit bundle containing:

```json
{
  "audit_bundle": {
    "interaction_id": "int-456",
    "request_jws": "<JWS of original intent message>",
    "response_jws": "<JWS of RESPONSE message>",
    "evidence": { ... },
    "timestamp": "2026-01-19T12:05:00Z"
  }
}
```

---

### 1.12 Webhook Callbacks

#### 1.12.1 Overview

Agents can receive real-time notifications via webhook callback URL. Webhooks are optional—polling `/v1/status/{interactionId}` remains available as fallback.

#### 1.12.2 Registering a Webhook

Agents provide a callback configuration in the intent request:

```json
{
  "type": "AUTHORIZE",
  "message_id": "msg-123",
  "principal_id": "did:example:alice",
  "callback": {
    "url": "https://agent.example.com/a2h/webhook",
    "secret": "whsec_abc123def456..."
  },
  ...
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `callback.url` | Yes | HTTPS URL to receive the webhook |
| `callback.secret` | Yes | Shared secret for signature verification |

The `callback.url` MUST use HTTPS. Gateways SHOULD reject HTTP URLs.

#### 1.12.3 Webhook Delivery

When the human responds, the gateway POSTs the RESPONSE to the callback URL:

```http
POST /a2h/webhook HTTP/1.1
Host: agent.example.com
Content-Type: application/json
X-A2H-Signature: t=1705667100,v1=5d4f3a2b1c...
X-A2H-Delivery-ID: del-789

{
  "type": "RESPONSE",
  "interaction_id": "int-456",
  "responds_to": "msg-123",
  "decision": "APPROVE",
  "decided_at": "2026-01-19T12:05:00Z",
  "evidence": { ... },
  "signature": "..."
}
```

**Headers:**

| Header | Description |
|--------|-------------|
| `X-A2H-Signature` | Signature for verification (see 1.12.4) |
| `X-A2H-Delivery-ID` | Unique ID for this delivery attempt (for idempotency) |

#### 1.12.4 Webhook Signature Verification

To prevent spoofing, gateways sign webhook payloads using the agent-provided secret.

**Signature format:**
```
X-A2H-Signature: t=<timestamp>,v1=<signature>
```

**Signature computation:**
```javascript
const timestamp = Math.floor(Date.now() / 1000);
const payload = `${timestamp}.${requestBody}`;
const signature = hmac_sha256(webhook_secret, payload);
// Result: t=1705667100,v1=5d4f3a2b1c...
```

**Agent verification:**
```javascript
function verifyWebhook(request, secret) {
  const [tPart, vPart] = request.headers['x-a2h-signature'].split(',');
  const timestamp = parseInt(tPart.split('=')[1]);
  const expectedSig = vPart.split('=')[1];

  // Reject stale timestamps (>5 min)
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) throw new Error('Stale');

  // Verify HMAC
  const computedSig = hmac_sha256(secret, `${timestamp}.${request.body}`);
  if (!secureCompare(computedSig, expectedSig)) throw new Error('Invalid sig');
  return true;
}
```

#### 1.12.5 Retry Policy

If webhook delivery fails (network error, non-2xx response), the gateway retries with exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 10 seconds |
| 3 | 60 seconds |
| 4 (final) | 5 minutes |

The default retry count is 3 (plus initial attempt = 4 total attempts). Gateways MAY allow configuration of retry behavior.

**Success criteria:** HTTP 2xx response within 30 seconds.

**Failure handling:** If all retries fail, the interaction is marked `webhook_failed: true` and agents can fall back to polling.

#### 1.12.6 Agent Response

Agents SHOULD respond to webhooks promptly with a 2xx status code:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"received": true}
```

The response body is ignored—only the status code matters for delivery confirmation.

#### 1.12.7 Idempotency

Agents SHOULD handle duplicate webhook deliveries gracefully. Use the `X-A2H-Delivery-ID` header to deduplicate:

```javascript
const deliveryId = request.headers['x-a2h-delivery-id'];
if (processedDeliveries.has(deliveryId)) {
  return res.status(200).json({ received: true, duplicate: true });
}
processedDeliveries.add(deliveryId);
// Process the webhook...
```

#### 1.12.8 Discovery

Gateways supporting webhooks SHOULD advertise this in discovery:

```json
{
  "webhooks": {
    "supported": true,
    "retry_attempts": 3,
    "timeout_sec": 30
  }
}
```

#### 1.12.9 Polling Fallback

Agents that cannot receive webhooks MAY omit the `callback` field and poll `/v1/status/{interactionId}` until state is `ANSWERED` or `EXPIRED`. Gateways MUST support polling regardless of webhook availability.

---

### 1.13 Channel Selection & Failover

#### 1.13.1 Overview

A2H supports multiple delivery channels (SMS, email, WhatsApp, push, voice). The agent controls channel selection—the gateway delivers to the channel specified by the agent.

#### 1.13.2 Agent-Controlled Channel Selection

Agents specify the delivery channel in the intent request:

```json
{
  "type": "AUTHORIZE",
  "principal_id": "did:example:alice",
  "channel": {
    "type": "sms",
    "address": "tel:+15551234567"
  },
  ...
}
```

The gateway attempts delivery to the specified channel. If the agent needs to try a different channel, they are responsible for sending a new request.

#### 1.13.3 Optional Fallback Channels

Agents MAY specify fallback channels for the gateway to try if the primary channel fails:

```json
{
  "channel": {
    "type": "sms",
    "address": "tel:+15551234567",
    "fallback": [
      {
        "type": "email",
        "address": "mailto:alice@example.com"
      },
      {
        "type": "whatsapp",
        "address": "tel:+15551234567"
      }
    ]
  }
}
```

**Fallback behavior:**
- The `fallback` array is optional
- If provided, the gateway tries channels in order after the primary fails
- Fallback is attempted only after the primary channel's retries are exhausted
- Each fallback channel gets its own retry attempts

#### 1.13.4 Delivery Retry Policy

When delivery to a channel fails, the gateway retries before moving to the next fallback (if any):

| Failure Type | Behavior |
|--------------|----------|
| **Transient** (network timeout, rate limit, temporary error) | Retry up to 3 times with exponential backoff |
| **Permanent** (invalid address, unsubscribed, blocked) | No retry, immediate failover or failure |

**Default retry schedule:**

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 10 seconds |
| 3 | 30 seconds |
| 4 (final) | 2 minutes |

Gateways MAY allow configuration of retry behavior. The retry count SHOULD match the webhook retry count (default: 3) for consistency.

#### 1.13.5 Delivery Failure

If delivery fails on all channels, the interaction transitions to `FAILED` with `ERR.DELIVERY_FAILED`. The agent decides next steps: retry different channel, notify user through other means, or abort.

#### 1.13.6 Channel Availability

Gateways advertise supported channels in discovery (see Section 1.4):

```json
{
  "channels": ["sms", "email", "whatsapp", "push", "voice"]
}
```

Agents SHOULD check gateway capabilities before sending requests with specific channels.

#### 1.13.7 Quiet Hours

Gateways MAY enforce quiet hours during which certain channels (e.g., SMS, voice) are suppressed. If blocked, gateway MAY reject with `ERR.QUIET_HOURS` or defer until quiet hours end.

---

## 2. Conceptual Design

### 2.1 System Context

This diagram shows how the A2H Gateway fits into the wider Agent ecosystem as the central human-in-the-loop component.

```mermaid
flowchart TB
    subgraph External["External Systems"]
        ACP["ACP<br/>(Agentic Commerce Protocol)"]
        AP2["AP2<br/>(Agents-to-Payments)"]
        MCP["MCP Server<br/>(Tools & Context)"]
        A2A["A2A<br/>(Agent-to-Agent)"]
    end

    subgraph Channels["Delivery Channels"]
        SMS["SMS"]
        Email["Email"]
        Push["Push"]
        Voice["Voice"]
        WhatsApp["WhatsApp"]
    end

    Human["👤 Principal<br/>(Human User)"]
    Agent["🤖 AI Agent"]
    Gateway["A2H Gateway<br/>━━━━━━━━━━━━━<br/>Human-in-the-Loop<br/>Communication Hub"]

    Agent -->|"INFORM, COLLECT,<br/>AUTHORIZE, ESCALATE"| Gateway
    Gateway -->|"RESPONSE"| Agent

    Gateway --> SMS
    Gateway --> Email
    Gateway --> Push
    Gateway --> Voice
    Gateway --> WhatsApp

    SMS --> Human
    Email --> Human
    Push --> Human
    Voice --> Human
    WhatsApp --> Human

    Agent <-.->|"commerce flows"| ACP
    Agent <-.->|"payment mandates"| AP2
    Agent <-.->|"tools & context"| MCP
    Agent <-.->|"agent collaboration"| A2A

    style Gateway fill:#4A90D9,stroke:#2E5A8B,color:#fff
    style Agent fill:#9B59B6,stroke:#7D3C98,color:#fff
    style Human fill:#27AE60,stroke:#1E8449,color:#fff
```

### 2.2 C4 Container Diagram (A2H Gateway, Level 2)

Zooms into the Gateway, showing its internal service decomp

```mermaid
flowchart TB
    subgraph Gateway["A2H Gateway"]
        direction TB

        API["API Layer<br/>━━━━━━━━━━<br/>REST/gRPC Endpoints<br/>/v1/intent"]

        subgraph Core["Core Services"]
            Router["Message Router<br/>━━━━━━━━━━<br/>Intent dispatch &<br/>channel selection"]
            State["State Manager<br/>━━━━━━━━━━<br/>Interaction lifecycle<br/>& TTL handling"]
            Auth["Auth Service<br/>━━━━━━━━━━<br/>WebAuthn, OTP,<br/>Passkey verification"]
        end

        subgraph Adapters["Channel Adapters"]
            SMSAdapter["SMS<br/>Adapter"]
            EmailAdapter["Email<br/>Adapter"]
            PushAdapter["Push<br/>Adapter"]
            VoiceAdapter["Voice<br/>Adapter"]
        end

        subgraph Observability["Observability"]
            Audit["Audit Log<br/>& Evidence Store"]
        end

        Store[("Interaction<br/>Store<br/>━━━━━━━━━━<br/>State, Evidence,<br/>JWS Signatures")]
    end

    Agent["🤖 AI Agent"] -->|"A2H Messages"| API
    API --> Router
    Router --> State
    Router --> Auth
    State --> Store
    Auth --> Store

    Router --> SMSAdapter
    Router --> EmailAdapter
    Router --> PushAdapter
    Router --> VoiceAdapter

    Auth --> Audit

    SMSAdapter -->|"tel:"| Human["👤 Human"]
    EmailAdapter -->|"mailto:"| Human
    PushAdapter -->|"push:"| Human
    VoiceAdapter -->|"voice:"| Human

    style Gateway fill:#f5f5f5,stroke:#333
    style Core fill:#E8F4FD,stroke:#4A90D9
    style Adapters fill:#FDF2E9,stroke:#E67E22
    style Observability fill:#E8F8F5,stroke:#1ABC9C
    style Store fill:#FCF3CF,stroke:#F1C40F
```


### 2.3 Full End-to-End Flow

```mermaid
sequenceDiagram
    autonumber
    participant Agent as 🤖 AI Agent
    participant Gateway as A2H Gateway
    participant Channel as Channel Adapter<br/>(SMS/Email/Push)
    participant Human as 👤 Principal

    Note over Agent,Human: AUTHORIZE Flow (e.g., Payment Approval)

    Agent->>Gateway: POST /v1/intent<br/>{type: "AUTHORIZE", assurance: "HIGH"}
    activate Gateway

    Gateway->>Gateway: Validate message & JWS signature
    Gateway->>Gateway: Create interaction ticket
    Gateway->>Gateway: State → SENT

    Gateway-->>Agent: 202 Accepted<br/>{interaction_id, state: "SENT"}

    Gateway->>Channel: Route message to channel
    activate Channel
    Gateway->>Gateway: State → WAITING_INPUT
    Gateway->>Gateway: Start TTL timer

    Channel->>Human: Deliver approval request<br/>(SMS link / Push notification)
    deactivate Channel

    Note over Human: Human reviews request

    Human->>Gateway: Click approval link<br/>GET /decide?ticket=...
    activate Gateway
    Gateway->>Human: Serve WebAuthn UI
    deactivate Gateway

    Human->>Gateway: Authenticate with Passkey
    activate Gateway
    Gateway->>Gateway: Verify WebAuthn assertion
    Gateway->>Gateway: State → ANSWERED
    Gateway->>Gateway: Store evidence (JWS)

    Gateway-->>Human: ✓ Approval confirmed
    deactivate Gateway

    Note over Agent,Gateway: Agent polls or receives callback

    Agent->>Gateway: GET /v1/status/{ticket}
    Gateway-->>Agent: RESPONSE<br/>{decision: "APPROVE", evidence: {...}}
    deactivate Gateway

    Note over Agent: Agent proceeds with action<br/>(e.g., execute payment via AP2)

    Agent->>Gateway: POST /v1/intent<br/>{type: "RESULT"}
    Gateway->>Channel: Deliver receipt
    Channel->>Human: "Your purchase is complete"
```

---

## 3. Interoperable Elements

### 3.1 MCP Tooling

To make this simple for agents, the A2H Gateway exposes a set of canonical tools via MCP:

| Tool | Behavior | Use Case |
|------|----------|----------|
| `human_inform(payload: INFORM)` | Asynchronous/Fire-and-Forget | Notifications, receipts, and exceptions that don't require a reply |
| `human_collect(payload: COLLECT) -> RESPONSE` | Blocking. Halts the agent until the human provides data or the request expires | Gather structured data from the user |
| `human_authorize(payload: AUTHORIZE) -> RESPONSE` | Blocking. Halts the agent until the human approves or denies | Get explicit consent for any action |
| `human_escalate(payload: ESCALATE) -> RESPONSE` | Blocking. Halts the agent until the handoff to a live channel is acknowledged | Transfer the user to human support |
| `human_send_result(payload: RESULT)` | Asynchronous/Fire-and-Forget | Sending final receipts/outcomes after an action is complete |

### 3.2 ACP / AP2

These protocols are not core to A2H. They are integrated at the agent level when a relevant profile is used.

1. An Agent builds an AUTHORIZE message.
2. It adds `profile: "transaction.v1"` to the payload.
3. It adds the relevant `acp_ref` and `ap2_mandate` to the links object.
4. When it receives the `RESPONSE(decision=APPROVE)`, it constructs an `audit_bundle`.
5. This `audit_bundle` is attached to the AP2 payment capture or ACP order metadata.

The `audit_bundle` provides the cryptographic proof of consent:

```json
{
  "a2h_interaction_id": "int-...",
  "a2h_request_jws": "<JWS of the original AUTHORIZE message>",
  "a2h_response_jws": "<JWS of the human's RESPONSE message>"
}
```

This bundle cryptographically links the intent (the AUTHORIZE request) to the consent (the RESPONSE) and the observability record (the `trace_id`), providing a robust, non-repudiable audit trail for the transaction.

---

## 4. Demo

A runnable proof-of-concept demonstrating the AUTHORIZE flow with WebAuthn/Passkey authentication is available in the `demo/` folder.

### Quick Start

```bash
cd demo
npm install
npm start
```

In another terminal:

```bash
cd demo
bash agent.sh
```

Then open the approval link printed in the server console.

### What the Demo Shows

- **Agent sends AUTHORIZE intent** via `POST /v1/intent`
- **Gateway generates approval link** with single-use nonce
- **Human approves with passkey** (Touch ID, Face ID, or security key)
- **Gateway returns RESPONSE** with WebAuthn evidence

> **Note:** This POC has no authentication and uses in-memory storage. See Sections 1.8-1.10 for production security requirements.

### OpenClaw Integration Example

To see how A2H could work in an autonomous agent context, we've included a conceptual demo showing how [OpenClaw](https://github.com/openclaw/openclaw) could integrate with A2H for cryptographic tool approval.

```bash
cd examples/openclaw-integration
npm install
npm start          # Terminal 1: Start A2H Gateway
node openclaw-simulator.js  # Terminal 2: Run the demo
```

This demonstrates how OpenClaw's existing `exec` tool approval (`ask: "on-miss"`) could be complemented by A2H-based approval (`ask: "a2h"`) for:

- **Out-of-band delivery:** Approval request via SMS while conversation is on Telegram
- **Risk-based assurance:** Passkey for `rm *`, OTP for `git push`, link click for safe commands
- **Cryptographic evidence:** JWS-signed proof attached to audit log

The key insight: OpenClaw's channels handle *conversation*. A2H handles *consent*. They're complementary.

---

## 5. Roadmap

### Protocol Layers

A2H is designed as a layered protocol, allowing incremental adoption and evolution:

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 2 (Future): Authority & Policy                        │
│  ├── Standing approvals ("approve all flights <$500")        │
│  ├── Delegation ("Bob can approve for Alice")                │
│  ├── Revocation ("cancel all pending approvals")             │
│  └── Scope boundaries ("agent can only access calendar")     │
├─────────────────────────────────────────────────────────────┤
│  LAYER 1 (v1.0): Delivery & Evidence                         │
│  ├── AUTHORIZE: Consent gate with cryptographic proof        │
│  ├── INFORM: Status notification (fire-and-forget)           │
│  ├── COLLECT: Structured input gathering                     │
│  ├── ESCALATE: Human handoff                                 │
│  └── RESULT: Outcome reporting                               │
├─────────────────────────────────────────────────────────────┤
│  FOUNDATION: Channel Abstraction                             │
│  └── SMS, Email, WhatsApp, Push, Voice, Web                  │
└─────────────────────────────────────────────────────────────┘
```

**Layer 1 (This Specification)** provides the foundation: channel-agnostic delivery, cryptographic evidence of consent, and the core intent primitives. This is sufficient for most agent-to-human communication needs today.

**Layer 2 (Future)** will address the harder problems of autonomous agents: standing policies, delegation chains, revocation, and scope boundaries. These primitives require real-world validation before standardization and will be specified in future versions.

### v1.1 (Next)

- Formalize all JSON Schemas (including for evidence types)
- Implement the "Profiles" concept
- Add OpenTelemetry and CloudEvents bindings
- Publish a reference implementation of the A2H Gateway with full observability hooks
- Agent framework integrations (OpenClaw, LangGraph, CrewAI)

### v1.2 (Layer 2 Foundation)

- POLICY primitive: Standing approvals with conditions
- REVOKE primitive: Cancel pending or standing approvals
- Policy expiration and lifecycle management

### v2.0 (Full Authority Model)

- DELEGATE primitive: Authority transfer between principals
- SCOPE primitive: Agent capability boundaries
- Multi-party approval (N-of-M)
- Delegation chains and audit trails


