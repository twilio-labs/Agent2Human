/**
 * SmsChannel - A2H channel implementation for SMS
 *
 * A minimal implementation for demonstration
 *
 * Channel Interface:
 *   - id: string                     - Channel identifier
 *   - capabilities: object           - What this channel can do
 *   - deliver(message, id): Promise  - Send message through channel
 *   - getStatus(id): object          - Get interaction status
 *   - processResponse(id, data)      - Handle user response (e.g., OTP reply)
 *   - canHandle(message): boolean    - Check if channel can handle message
 */

const crypto = require('crypto');

// Interaction states per A2H framework spec
const InteractionState = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  WAITING_INPUT: 'WAITING_INPUT',
  ANSWERED: 'ANSWERED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED'
};

class SmsChannel {
  constructor(provider) {
    this.id = 'sms';
    this.name = 'SMS Channel';
    this.provider = provider;

    // In-memory interaction store (use Redis/DB in production)
    this.interactions = new Map();

    // Channel capabilities
    this.capabilities = {
      factors: ['sms.otp.v1'],
      messageTypes: ['AUTHORIZE', 'INFORM', 'COLLECT'],
      hasUI: false,
      hasAsync: true,
      minTTL: 60,
      maxTTL: 600
    };
  }

  /**
   * Check if this channel can handle the message
   */
  canHandle(message) {
    // Check message type
    if (!this.capabilities.messageTypes.includes(message.type)) {
      return false;
    }

    // For AUTHORIZE, check if required factor is supported
    if (message.type === 'AUTHORIZE') {
      const requiredFactors = message.assurance?.required_factors || [];
      const hasMatchingFactor = requiredFactors.some(f =>
        this.capabilities.factors.includes(f)
      );
      if (requiredFactors.length > 0 && !hasMatchingFactor) {
        return false;
      }
    }

    // Check if we have a phone number for this principal
    const phone = this.provider.getPhoneNumber(message.principal_id);
    return !!phone;
  }

  /**
   * Deliver message through SMS
   */
  async deliver(message, interactionId) {
    const phone = this.provider.getPhoneNumber(message.principal_id);
    if (!phone) {
      throw new Error(`No phone number for principal: ${message.principal_id}`);
    }

    // Create interaction record
    const interaction = {
      id: interactionId,
      state: InteractionState.PENDING,
      message,
      phone,
      createdAt: Date.now(),
      expiresAt: Date.now() + (message.ttl_sec || 300) * 1000,
      otp: null,
      response: null
    };

    // Generate OTP for AUTHORIZE
    if (message.type === 'AUTHORIZE') {
      interaction.otp = this.generateOTP();
    }

    this.interactions.set(interactionId, interaction);

    // Build SMS body
    const smsBody = this.buildSmsBody(message, interaction.otp);

    // Send via provider
    try {
      const result = await this.provider.send(phone, smsBody);
      interaction.state = InteractionState.SENT;
      interaction.deliveryInfo = result;

      console.log(`[SmsChannel] Delivered to ${this.maskPhone(phone)}`);
      console.log(`[SmsChannel] Interaction: ${interactionId}`);
      if (interaction.otp) {
        console.log(`[SmsChannel] OTP: ${interaction.otp} (for demo visibility)`);
      }

      return {
        success: true,
        interactionId,
        state: interaction.state
      };
    } catch (e) {
      interaction.state = InteractionState.FAILED;
      interaction.error = e.message;
      throw e;
    }
  }

  /**
   * Get current status of an interaction
   */
  getStatus(interactionId) {
    const interaction = this.interactions.get(interactionId);
    if (!interaction) {
      return { state: 'NOT_FOUND' };
    }

    // Check expiry
    if (interaction.state !== InteractionState.ANSWERED &&
        Date.now() > interaction.expiresAt) {
      interaction.state = InteractionState.EXPIRED;
    }

    return {
      interactionId,
      state: interaction.state,
      response: interaction.response
    };
  }

  /**
   * Process incoming response (OTP reply from user)
   */
  processResponse(interactionId, data) {
    const interaction = this.interactions.get(interactionId);
    if (!interaction) {
      return { valid: false, error: 'Interaction not found' };
    }

    // Check expiry
    if (Date.now() > interaction.expiresAt) {
      interaction.state = InteractionState.EXPIRED;
      return { valid: false, error: 'Interaction expired' };
    }

    // For AUTHORIZE, validate OTP
    if (interaction.message.type === 'AUTHORIZE') {
      const providedOtp = (data.otp || data.Body || '').toString().trim();
      const valid = providedOtp === interaction.otp;

      if (valid) {
        interaction.state = InteractionState.ANSWERED;
        interaction.response = {
          decision: 'APPROVE',
          evidence: {
            factor: 'sms.otp.v1',
            proof: {
              phone_number_hash: this.hashPhone(interaction.phone),
              timestamp: new Date().toISOString(),
              otp_verified: true
            }
          }
        };
        console.log(`[SmsChannel] ✓ OTP verified for ${interactionId}`);
      } else {
        console.log(`[SmsChannel] ✗ Invalid OTP for ${interactionId}`);
      }

      return {
        valid,
        response: valid ? interaction.response : null
      };
    }

    // For COLLECT, just store the response
    if (interaction.message.type === 'COLLECT') {
      interaction.state = InteractionState.ANSWERED;
      interaction.response = {
        data: data.Body || data.text || data
      };
      return { valid: true, response: interaction.response };
    }

    return { valid: false, error: 'Unexpected message type' };
  }

  /**
   * Find interaction by phone number (for webhook lookup)
   */
  findByPhone(phone) {
    // Normalize phone number
    const normalized = phone.replace(/\D/g, '');

    for (const [id, interaction] of this.interactions) {
      const interactionPhone = interaction.phone.replace(/\D/g, '');
      if (interactionPhone === normalized &&
          interaction.state === InteractionState.SENT) {
        return id;
      }
    }
    return null;
  }

  // --- Helper methods ---

  generateOTP() {
    return crypto.randomInt(100000, 999999).toString();
  }

  buildSmsBody(message, otp) {
    const body = message.render?.body || 'A2H Request';

    if (message.type === 'AUTHORIZE' && otp) {
      return `${body}\n\nYour approval code: ${otp}\nReply with this code to approve.`;
    }

    if (message.type === 'COLLECT') {
      return `${body}\n\nReply with your answer.`;
    }

    return body;
  }

  maskPhone(phone) {
    if (!phone || phone.length < 6) return '***';
    return phone.slice(0, 3) + '***' + phone.slice(-2);
  }

  hashPhone(phone) {
    return 'sha256:' + crypto.createHash('sha256')
      .update(phone)
      .digest('hex')
      .slice(0, 16);
  }
}

module.exports = { SmsChannel, InteractionState };
