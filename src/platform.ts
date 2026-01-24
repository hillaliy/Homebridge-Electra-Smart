import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { ElectraPlatformAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

import { Client } from 'electra-smart-js-client';

export class ElectraSmartPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  public client: Client | null = null;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.log.debug('Finished initializing platform:', this.config.name);

    // Initialize client and discover devices
    this.api.on('didFinishLaunching', async () => {
      this.log.debug('Executed didFinishLaunching callback');

      const success = await this.initializeElectraSmartClient();
      if (success) {
        await this.discoverDevices();
      } else {
        this.log.error(
          'Discovery aborted due to client initialization failure.',
        );
      }
    });
  }

  // Required by Homebridge to restore cached accessories
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  // Initializes the Electra Smart Client with provided credentials
  private async initializeElectraSmartClient(): Promise<boolean> {
    try {
      const { imei, token } = this.config;

      if (!imei || !token) {
        this.log.error(
          'Missing IMEI or Token in config. Please update your settings in the Homebridge UI.',
        );
        return false;
      }

      this.client = new Client({ imei, token });
      this.log.info('Electra Smart Client initialized successfully');
      return true;
    } catch (error) {
      this.log.error('Failed to initialize Electra Smart Client:', error);
      return false;
    }
  }

  // Main discovery logic
  async discoverDevices() {
    if (!this.client) {
      return;
    }

    try {
      this.log.info('Fetching devices from Electra Smart cloud...');
      const devices = await this.client.getDevices();

      if (!devices || devices.length === 0) {
        this.log.warn('No devices found on your Electra account.');
        return;
      }

      this.log.info(`Discovered ${devices.length} device(s)`);

      for (const device of devices) {
        const uuid = this.api.hap.uuid.generate(device.id.toString());
        const existingAccessory = this.accessories.get(uuid);

        if (existingAccessory) {
          this.log.info(
            'Restoring existing accessory from cache:',
            existingAccessory.displayName,
          );
          existingAccessory.context.device = device;
          this.api.updatePlatformAccessories([existingAccessory]);
          new ElectraPlatformAccessory(this, existingAccessory);
        } else {
          this.log.info('Adding new accessory:', device.name);
          const accessory = new this.api.platformAccessory(device.name, uuid);
          accessory.context.device = device;
          new ElectraPlatformAccessory(this, accessory);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
            accessory,
          ]);
        }

        this.discoveredCacheUUIDs.push(uuid);
      }

      // Cleanup Orphaned Accessories
      this.accessories.forEach((accessory, uuid) => {
        if (!this.discoveredCacheUUIDs.includes(uuid)) {
          this.log.info(
            'Removing accessory no longer present in Electra account:',
            accessory.displayName,
          );
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
            accessory,
          ]);
        }
      });
    } catch (error) {
      this.log.error(
        'An error occurred during device discovery. Check your internet connection and API token.',
      );
      this.log.debug('Discovery Error Detail:', error);
    }
  }
}
