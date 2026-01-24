import {
  HomebridgePluginUiServer,
  RequestError,
} from '@homebridge/plugin-ui-utils';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 1. Get the actual directory of THIS file (homebridge-ui folder)
const __dirname = dirname(fileURLToPath(import.meta.url));

// 2. Create a require function that looks at your plugin's root
// We go up one level from 'homebridge-ui' to find 'node_modules'
const require = createRequire(import.meta.url);

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    this.client = null;

    try {
      // Try to resolve the client class
      const electra = require('electra-smart-js-client');
      const ElectraClass = electra.ElectraSmartClient || electra;
      this.client = new ElectraClass();
    } catch (error) {
      // If that fails, try an absolute path from the plugin root
      try {
        const rootPath = join(
          __dirname,
          '..',
          'node_modules',
          'electra-smart-js-client',
        );
        const electra = require(rootPath);
        const ElectraClass = electra.ElectraSmartClient || electra;
        this.client = new ElectraClass();
      } catch (error) {
        this.client = null;
      }
    }

    this.imei = this.generateIMEI();
    this.onRequest('/request-otp', this.handleRequestOtp.bind(this));
    this.onRequest('/verify-otp', this.handleVerifyOtp.bind(this));
    this.ready();
  }

  async handleRequestOtp({ phone }) {
    if (!this.client) {
      throw new RequestError(
        'Library resolution failed. Please ensure "electra-smart-js-client" is in your package.json dependencies.',
      );
    }
    try {
      await this.client.requestOtp(phone, this.imei);
      return { success: true };
    } catch (error) {
      throw new RequestError(`Electra API Error: ${error.message}`);
    }
  }

  async handleVerifyOtp({ phone, otp }) {
    try {
      const res = await this.client.verifyOtp(phone, otp, this.imei);
      return { imei: this.imei, token: res.token };
    } catch (error) {
      throw new RequestError(error.message || 'Invalid code');
    }
  }

  generateIMEI() {
    return (
      '2b95' +
      Math.floor(10000000000 + Math.random() * 90000000000)
        .toString()
        .substring(0, 11)
    );
  }
}

new UiServer();
