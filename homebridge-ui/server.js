import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import { Client } from 'electra-smart-js-client';

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    this.onRequest('/request-otp', async payload => {
      if (!payload || !payload.phone) {
        return { success: false, message: 'Phone number missing in request' };
      }

      try {
        const phoneNumber = String(payload.phone).trim();

        // Use the static method to send OTP
        const imei = await Client.sendOTPRequest(phoneNumber);

        return { success: true, imei };
      } catch (error) {
        return { success: false, message: error.message };
      }
    });

    this.onRequest('/verify-otp', async payload => {
      try {
        const phoneNumber = String(payload.phone).trim();
        const otp = String(payload.otp).trim();

        // Use the static method to verify OTP and get token
        const res = await Client.getOTPToken({
          imei: payload.imei,
          phone: phoneNumber,
          otp,
        });

        return {
          success: true,
          token: res.token,
          imei: res.imei,
        };
      } catch (e) {
        throw new Error(e.message || 'Verification failed.');
      }
    });

    this.ready();
  }
}

(() => new UiServer())();
