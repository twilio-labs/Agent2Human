/**
 * TwilioProvider - Adapts Twilio API to A2H provider interface
 *
 * A minimal implementation for demonstration
 */

const twilio = require('twilio');

class TwilioProvider {
  constructor(config) {
    this.id = 'twilio';
    this.name = 'Twilio SMS';

    // Initialize Twilio client
    this.client = twilio(config.accountSid, config.authToken);
    this.fromNumber = config.phoneNumber;

    // Parse contact mapping: "did:example:alice:+1234,did:example:bob:+5678"
    this.contactMap = this.parseContactMap(config.userPhoneMap || '');
  }

  /**
   * Parse USER_PHONE_MAP environment variable
   * Supports formats:
   *   - "principal:+phone,principal:+phone"
   *   - "principal=+phone,principal=+phone"
   */
  parseContactMap(mapString) {
    const map = new Map();
    if (!mapString) return map;

    const entries = mapString.split(',').map(s => s.trim()).filter(Boolean);
    for (const entry of entries) {
      // Support both : and = separators
      const separatorIndex = entry.lastIndexOf(':');
      const eqIndex = entry.lastIndexOf('=');
      const idx = Math.max(separatorIndex, eqIndex);

      if (idx > 0) {
        const principalId = entry.slice(0, idx).trim();
        const phone = entry.slice(idx + 1).trim();
        if (principalId && phone) {
          map.set(principalId, phone);
        }
      }
    }
    return map;
  }

  /**
   * Get phone number for a principal ID
   */
  getPhoneNumber(principalId) {
    return this.contactMap.get(principalId) || null;
  }

  /**
   * Send SMS via Twilio
   */
  async send(to, body) {
    const message = await this.client.messages.create({
      body,
      to,
      from: this.fromNumber
    });

    return {
      sid: message.sid,
      status: message.status,
      to: message.to,
      dateCreated: message.dateCreated
    };
  }

  /**
   * Health check - verify Twilio credentials work
   */
  async healthCheck() {
    try {
      await this.client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
      return true;
    } catch (e) {
      console.error('Twilio health check failed:', e.message);
      return false;
    }
  }

  /**
   * Validate incoming webhook is from Twilio
   */
  validateWebhook(signature, url, params) {
    return twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      signature,
      url,
      params
    );
  }
}

module.exports = { TwilioProvider };
