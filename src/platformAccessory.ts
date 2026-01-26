import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { ElectraSmartPlatform } from './platform.js';

interface ElectraStatus {
  oper?: {
    AC_MODE?: string;
    SPT?: string;
    FANSPD?: string;
    CLEAR_FILT?: string;
    V_SWING?: string;
  };
  diag?: {
    I_RAT?: string | number;
  };
}

export class ElectraPlatformAccessory {
  private service: Service;
  private dryService?: Service;
  private fanModeService?: Service;
  // Cache to store the last status and avoid "Slow to respond" warnings
  private lastStatus: ElectraStatus | null = null;

  constructor(
    private readonly platform: ElectraSmartPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // Accessory Information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.Characteristic.Manufacturer,
        accessory.context.device.providerName || 'Electra',
      )
      .setCharacteristic(
        this.platform.Characteristic.Model,
        accessory.context.device.manufactor || 'Smart AC',
      )
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        accessory.context.device.sn as string,
      )
      .setCharacteristic(
        this.platform.Characteristic.FirmwareRevision,
        this.accessory.context.device.fmVersion || '1.0.0',
      );

    // 1. Main AC Service
    this.service =
      this.accessory.getService(this.platform.Service.HeaterCooler) ||
      this.accessory.addService(this.platform.Service.HeaterCooler);

    // 2. DRY MODE Switch
    if (!this.platform.config.options.hideDryMode) {
      this.dryService =
        this.accessory.getService('Dry Mode') ||
        this.accessory.addService(
          this.platform.Service.Switch,
          'Dry Mode',
          'dry-mode-switch',
        );
      this.dryService.setCharacteristic(
        this.platform.Characteristic.Name,
        'Dry Mode',
      );
      this.dryService
        .getCharacteristic(this.platform.Characteristic.On)
        .onSet(async value =>
          value ? await this.setCustomMode('DRY') : await this.setActive(0),
        );
    } else {
      const existingDry = this.accessory.getService('Dry Mode');
      if (existingDry) {
        this.accessory.removeService(existingDry);
      }
    }

    // 3. FAN MODE Switch
    if (!this.platform.config.options.hideFanMode) {
      this.fanModeService =
        this.accessory.getService('Fan Mode') ||
        this.accessory.addService(
          this.platform.Service.Switch,
          'Fan Mode',
          'fan-mode-switch',
        );
      this.fanModeService.setCharacteristic(
        this.platform.Characteristic.Name,
        'Fan Mode',
      );
      this.fanModeService
        .getCharacteristic(this.platform.Characteristic.On)
        .onSet(async value =>
          value ? await this.setCustomMode('FAN') : await this.setActive(0),
        );
    } else {
      const existingFan = this.accessory.getService('Fan Mode');
      if (existingFan) {
        this.accessory.removeService(existingFan);
      }
    }

    // Link Services to Main Service
    if (this.dryService) {
      this.service.addLinkedService(this.dryService);
    }
    if (this.fanModeService) {
      this.service.addLinkedService(this.fanModeService);
    }

    // Characteristic Bindings (Using Cache for all GETs)

    // Active State
    this.service
      .getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .onGet(() => (this.lastStatus?.oper?.AC_MODE === 'STBY' ? 0 : 1));

    // Current Mode (Cooling/Heating/Idle)
    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .onGet(this.getCurrentState.bind(this));

    // Current Temperature (Room)
    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(() => {
        const temp = this.lastStatus?.diag?.I_RAT;
        return temp ? parseFloat(temp.toString()) : 22;
      });

    // Target Mode (Auto/Cool/Heat)
    this.service
      .getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .onSet(this.setTargetState.bind(this))
      .onGet(this.getTargetState.bind(this));

    // Cooling Temp Setpoint
    this.service
      .getCharacteristic(
        this.platform.Characteristic.CoolingThresholdTemperature,
      )
      .setProps({ minStep: 1, minValue: 16, maxValue: 30 })
      .updateValue(24)
      .onSet(this.setTargetTemperature.bind(this))
      .onGet(() => {
        const temp = this.lastStatus?.oper?.SPT;
        return temp ? parseInt(temp, 10) : 24;
      });

    // Heating Temp Setpoint
    this.service
      .getCharacteristic(
        this.platform.Characteristic.HeatingThresholdTemperature,
      )
      .setProps({ minStep: 1, minValue: 16, maxValue: 30 })
      .updateValue(24)
      .onSet(this.setTargetTemperature.bind(this))
      .onGet(() => {
        const temp = this.lastStatus?.oper?.SPT;
        return temp ? parseInt(temp, 10) : 24;
      });

    // Fan Speed
    this.service
      .getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({ minStep: 25, minValue: 0, maxValue: 100 })
      .onSet(this.setRotationSpeed.bind(this))
      .onGet(this.getRotationSpeed.bind(this));

    // Filter Indication
    this.service
      .getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
      .onGet(() => (this.lastStatus?.oper?.CLEAR_FILT === 'ON' ? 1 : 0));

    this.service
      .getCharacteristic(this.platform.Characteristic.FilterLifeLevel)
      .onGet(() => (this.lastStatus?.oper?.CLEAR_FILT === 'ON' ? 0 : 100));

    this.service
      .getCharacteristic(this.platform.Characteristic.ResetFilterIndication)
      .onSet(async value => {
        if (value === 1) {
          this.platform.log.info('Resetting filter status for AC...');
          await this.platform.client?.sendCommand(
            this.accessory.context.device.id,
            { CLEAR_FILT: 'OFF' },
          );
          setTimeout(() => this.pollDeviceStatus(), 2000);
        }
      });

    // Start Polling
    const pollInterval =
      ((this.platform.config.options.pollInterval as number) || 60) * 1000;
    setInterval(() => this.pollDeviceStatus(), pollInterval);

    // Initial fetch to fill the cache
    this.pollDeviceStatus();
  }

  // HELPER: Fetch from Cloud
  private async getDeviceStatusFromCloud() {
    try {
      const telemetry = await this.platform.client?.getTelemetry(
        this.accessory.context.device.id,
      );
      return { oper: telemetry?.OPER, diag: telemetry?.DIAG_L2 };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check if it's a SID expiration error (status code 1)
      if (errorMessage.includes('Invalid status code returned from API (1)')) {
        this.platform.log.warn(
          'Session expired, attempting to reinitialize client...',
        );
        // Reinitialize the client to get a fresh SID
        await this.platform.initializeElectraSmartClient();
      }

      this.platform.log.error('Failed to fetch telemetry:', error);
      return null;
    }
  }

  // Logic Helpers (Using lastStatus cache)
  private getCurrentState(): CharacteristicValue {
    const mode = this.lastStatus?.oper?.AC_MODE;
    if (mode === 'COOL') {
      return this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
    }
    if (mode === 'HEAT') {
      return this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
    }
    return this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
  }

  private getTargetState(): CharacteristicValue {
    const mode = this.lastStatus?.oper?.AC_MODE;
    if (mode === 'COOL') {
      return this.platform.Characteristic.TargetHeaterCoolerState.COOL;
    }
    if (mode === 'HEAT') {
      return this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
    }
    return this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
  }

  private getRotationSpeed(): CharacteristicValue {
    const speed = this.lastStatus?.oper?.FANSPD;
    if (speed === 'HIGH') {
      return 100;
    }
    if (speed === 'MED') {
      return 50;
    }
    if (speed === 'LOW') {
      return 25;
    }
    return 0;
  }

  // SET Handlers
  async setActive(value: CharacteristicValue) {
    const mode = value === 1 ? 'COOL' : 'STBY';
    await this.platform.client?.setMode(this.accessory.context.device.id, mode);
    this.platform.log.info(`AC Active set to: ${mode}`);
    setTimeout(() => this.pollDeviceStatus(), 2000);
  }

  async setTargetTemperature(value: CharacteristicValue) {
    await this.platform.client?.setTemperature(
      this.accessory.context.device.id,
      value as number,
    );
    this.platform.log.info(`Target temperature set to: ${value}`);
  }

  async setTargetState(value: CharacteristicValue) {
    const modes: Record<
      number,
      'COOL' | 'HEAT' | 'AUTO' | 'DRY' | 'FAN' | 'STBY'
    > = {
      [this.platform.Characteristic.TargetHeaterCoolerState.COOL]: 'COOL',
      [this.platform.Characteristic.TargetHeaterCoolerState.HEAT]: 'HEAT',
      [this.platform.Characteristic.TargetHeaterCoolerState.AUTO]: 'AUTO',
    };

    const mode = modes[value as number] || 'AUTO';

    this.platform.log.info(`Target state set to: ${mode}`);

    await this.platform.client?.setMode(this.accessory.context.device.id, mode);
  }

  async setRotationSpeed(value: CharacteristicValue) {
    const speed = value as number;
    const electraSpeed =
      speed > 75 ? 'HIGH' : speed > 45 ? 'MED' : speed > 10 ? 'LOW' : 'AUTO';
    await this.platform.client?.setFanSpeed(
      this.accessory.context.device.id,
      electraSpeed,
    );
  }

  async setCustomMode(mode: 'DRY' | 'FAN') {
    await this.platform.client?.setMode(this.accessory.context.device.id, mode);
    setTimeout(() => this.pollDeviceStatus(), 2000);
  }

  // POLLING: Update status and Push to HomeKit
  async pollDeviceStatus() {
    const status = await this.getDeviceStatusFromCloud();
    if (!status) {
      return;
    }

    this.lastStatus = status;

    // Push updates to Homebridge immediately
    this.service.updateCharacteristic(
      this.platform.Characteristic.Active,
      status.oper?.AC_MODE === 'STBY' ? 0 : 1,
    );
    this.service.updateCharacteristic(
      this.platform.Characteristic.CurrentTemperature,
      parseFloat(status.diag?.I_RAT?.toString() || '22'),
    );
    this.service.updateCharacteristic(
      this.platform.Characteristic.CurrentHeaterCoolerState,
      this.getCurrentState(),
    );
    this.service.updateCharacteristic(
      this.platform.Characteristic.TargetHeaterCoolerState,
      this.getTargetState(),
    );
    this.service.updateCharacteristic(
      this.platform.Characteristic.RotationSpeed,
      this.getRotationSpeed(),
    );
    this.service.updateCharacteristic(
      this.platform.Characteristic.FilterChangeIndication,
      status.oper?.CLEAR_FILT === 'ON' ? 1 : 0,
    );
    this.service.updateCharacteristic(
      this.platform.Characteristic.CoolingThresholdTemperature,
      parseInt(status.oper?.SPT || '24', 10),
    );
    this.service.updateCharacteristic(
      this.platform.Characteristic.HeatingThresholdTemperature,
      parseInt(status.oper?.SPT || '24', 10),
    );

    this.dryService?.updateCharacteristic(
      this.platform.Characteristic.On,
      status.oper?.AC_MODE === 'DRY',
    );
    this.fanModeService?.updateCharacteristic(
      this.platform.Characteristic.On,
      status.oper?.AC_MODE === 'FAN',
    );
  }
}
