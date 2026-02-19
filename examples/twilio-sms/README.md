# A2H + Twilio SMS Example

> **Note:** This is a demonstration of the A2H protocol's channel abstraction. It uses in-memory storage, simplified state management, and is not intended for production use.

This example demonstrates A2H's channel abstraction using Twilio SMS for OTP-based authorization.

## Quick Start (Virtual Phone Testing)

Test locally using [Twilio Virtual Phone](https://console.twilio.com/us1/develop/sms/try-it-out/virtual-phone) - no carrier approvals or ngrok needed.

```bash
# 1. Install dependencies
npm install

# 2. Start the A2H Gateway (Terminal 1)
npm start

# 3. Run the agent simulator (Terminal 2)
node agent-simulator.js

# 4. Check Twilio Console for the SMS
#    Go to: Messaging > Virtual Phone
#    You'll see the OTP message

# 5. Simulate the reply (Terminal 3)
#    Copy the OTP from the console/Virtual Phone and run:
node simulate-reply.js <OTP>
```

## What this demonstrates

1. **Channel abstraction** - SMS channel implements BaseChannel interface
2. **Provider pattern** - TwilioProvider handles Twilio API specifics
3. **OTP authorization** - AUTHORIZE intent sends OTP via SMS, user replies to approve
4. **Webhook handling** - Twilio sends SMS replies to our webhook

## Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│   Agent     │────▶│   A2H Gateway   │────▶│   Twilio    │
└─────────────┘     │                 │     └─────────────┘
                    │  ┌───────────┐  │            │
                    │  │SmsChannel │  │            │
                    │  └───────────┘  │            ▼
                    │        │        │     ┌─────────────┐
                    │        ▼        │     │  User SMS   │
                    │  ┌───────────┐  │     └─────────────┘
                    │  │ Twilio    │  │            │
                    │  │ Provider  │  │            │
                    │  └───────────┘  │◀───────────┘
                    └─────────────────┘   (webhook reply)
```

## Prerequisites

- Node.js >= 18
- Twilio account with Account SID, Auth Token, and phone number

## Testing with Virtual Phone (Recommended)

The [Twilio Virtual Phone](https://console.twilio.com/us1/develop/sms/try-it-out/virtual-phone) lets you test without carrier approvals or webhook setup.

### How it works

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│   Agent     │────▶│   A2H Gateway   │────▶│   Twilio    │
└─────────────┘     └─────────────────┘     └─────────────┘
                                                   │
                                                   ▼
                           ┌─────────────────────────────────────┐
                           │  Twilio Console > Virtual Phone     │
                           │  ┌─────────────────────────────┐    │
                           │  │ Your approval code: 847291  │    │
                           │  │ Reply with this code...     │    │
                           │  └─────────────────────────────┘    │
                           └─────────────────────────────────────┘
                                           │
                    ┌──────────────────────┘
                    ▼
┌─────────────────────────────────────┐
│  simulate-reply.js 847291           │  (simulates webhook)
└─────────────────────────────────────┘
```

### Steps

**Terminal 1 - Start Gateway:**
```bash
npm install
npm start
```

**Terminal 2 - Run Agent:**
```bash
node agent-simulator.js
# Note the OTP shown in Terminal 1 (e.g., 847291)
```

**Terminal 3 - Simulate Reply:**
```bash
node simulate-reply.js 847291
```

You can also see the SMS in Twilio Console: **Messaging > Virtual Phone**

## Testing with Webhook (Full Flow)

For the complete flow where Twilio sends replies to your webhook:

### 1. Start the gateway

```bash
npm start
```

### 2. Start zrok (or ngrok)

```bash
zrok share public localhost:3002
# Copy the https URL (e.g., https://abc123.share.zrok.io)
```

### 3. Configure Twilio webhook

In [Twilio Console → Phone Numbers → Active Numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming):
1. Click your number
2. Scroll to **Messaging Configuration**
3. Set "A message comes in" to: `https://YOUR_ZROK_URL/webhook/sms`
4. Click **Save configuration**

### 4. Run the demo

**Terminal 1:** Gateway already running

**Terminal 2:**
```bash
node agent-simulator.js
```

**Terminal 3 (or Virtual Phone UI):**
```bash
# Reply via API with the OTP
curl "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Messages.json" \
  -X POST \
  --data-urlencode "To=$TWILIO_PHONE_NUMBER" \
  --data-urlencode "From=$USER_PHONE" \
  --data-urlencode "Body=<OTP_CODE>" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN"
```

Or reply from the [Virtual Phone UI](https://console.twilio.com/us1/develop/sms/try-it-out/virtual-phone).

## How it works

### 1. Agent sends AUTHORIZE request

```json
{
  "type": "AUTHORIZE",
  "principal_id": "did:example:alice",
  "assurance": {
    "level": "MEDIUM",
    "required_factors": ["sms.otp.v1"]
  }
}
```

### 2. SmsChannel generates OTP and sends via Twilio

```
To: +1555123456
Your approval code is: 847291
Reply with this code to approve.
```

### 3. User replies with OTP

```
847291
```

### 4. Webhook receives reply, validates OTP

### 5. Gateway returns RESPONSE with evidence

```json
{
  "decision": "APPROVE",
  "evidence": {
    "type": "sms.otp.v1",
    "phone_number_hash": "sha256:abc123...",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

## Files

```
twilio-sms/
├── server.js              # A2H Gateway
├── channels/
│   └── SmsChannel.js      # SMS channel implementation
├── providers/
│   └── TwilioProvider.js  # Twilio API adapter
├── agent-simulator.js     # Test agent
├── .env.example           # Environment template
└── README.md
```

## Channel Interface (simplified)

```javascript
class BaseChannel {
  // Required
  get id() {}           // 'sms', 'email', etc.
  get capabilities() {} // { factors: ['sms.otp.v1'], messageTypes: [...] }

  async deliver(message, interactionId) {}
  async getStatus(interactionId) {}
  async processResponse(interactionId, data) {}
  canHandle(message) {}
}
```

## Provider Interface (simplified)

```javascript
class SmsProvider {
  async send(to, body) {}
  async healthCheck() {}
  getPhoneNumber(principalId) {}
}
```

## Assurance Levels

| Level | Factor | Use Case |
|-------|--------|----------|
| HIGH | `passkey.webauthn.v1` | Destructive ops (see openclaw-integration example) |
| MEDIUM | `sms.otp.v1` | This example - significant actions |
| LOW | `link.click.v1` | Simple confirmations |

