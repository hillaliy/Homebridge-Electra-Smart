/* eslint-disable indent */
import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { ElectraSmartPlatform } from './platform.js';

export class ElectraPlatformAccessory {
  private service: Service;
  private dryService: Service;
  private fanModeService: Service;
  private filterService: Service;

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
    if (!this.platform.config.hideDryMode) {
      this.dryService =
        this.accessory.getService('Dry Mode') ||
        this.accessory.addService(
          this.platform.Service.Switch,
          'Dry Mode',
          'dry-mode-switch',
        );

      this.dryService
        .getCharacteristic(this.platform.Characteristic.On)
        .onSet(async value =>
          value ? await this.setCustomMode('DRY') : await this.setActive(0),
        );
    } else {
      // If user wants it hidden, remove the service if it exists
      const existingDry = this.accessory.getService('Dry Mode');
      if (existingDry) {
        this.accessory.removeService(existingDry);
      }
    }

    // 3. FAN MODE Switch
    if (!this.platform.config.hideFanMode) {
      this.fanModeService =
        this.accessory.getService('Fan Mode') ||
        this.accessory.addService(
          this.platform.Service.Switch,
          'Fan Mode',
          'fan-mode-switch',
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

    // 4. FILTER Changne Indicator
    this.filterService =
      this.accessory.getService('Filter Change Indicator') ||
      this.accessory.addService(
        this.platform.Service.FilterMaintenance,
        'Filter Change Indicator',
        'filter-change-indicator',
      );

    // GROUPING: Linking services tells the Home App they belong together
    this.service.addLinkedService(this.dryService);
    this.service.addLinkedService(this.fanModeService);
    this.service.addLinkedService(this.filterService);

    // --- Characteristic Bindings ---
    this.service
      .getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .onGet(this.getActive.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .onGet(this.getCurrentState.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .onSet(this.setTargetState.bind(this))
      .onGet(this.getTargetState.bind(this));

    this.service
      .getCharacteristic(
        this.platform.Characteristic.CoolingThresholdTemperature,
      )
      .setProps({ minStep: 1, minValue: 16, maxValue: 30 })
      .onSet(this.setTargetTemperature.bind(this))
      .onGet(this.getTargetTemperature.bind(this));

    this.service
      .getCharacteristic(
        this.platform.Characteristic.HeatingThresholdTemperature,
      )
      .setProps({ minStep: 1, minValue: 16, maxValue: 30 })
      .onSet(this.setTargetTemperature.bind(this))
      .onGet(this.getTargetTemperature.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({ minStep: 25, minValue: 0, maxValue: 100 })
      .onSet(this.setRotationSpeed.bind(this))
      .onGet(this.getRotationSpeed.bind(this));

    // this.service
    //   .getCharacteristic(this.platform.Characteristic.SwingMode)
    //   .onSet(this.setSwingMode.bind(this))
    //   .onGet(this.getSwingMode.bind(this));

    this.dryService
      .getCharacteristic(this.platform.Characteristic.On)
      .onSet(async value =>
        value ? await this.setCustomMode('DRY') : await this.setActive(0),
      );

    this.fanModeService
      .getCharacteristic(this.platform.Characteristic.On)
      .onSet(async value =>
        value ? await this.setCustomMode('FAN') : await this.setActive(0),
      );

    this.filterService
      .getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
      .onGet(this.getFilterStatus.bind(this));

    /*
    POLLING:
    Poll every 30 seconds (30000ms). // ToDo: Make interval configurable.
    Electra's servers might temporarily block IP if they see too many requests.
    30–60 seconds is usually the "sweet spot" for responsiveness versus stability.
    */
    const pollInterval =
      ((this.platform.config.pollInterval as number) || 30) * 1000;
    setInterval(() => this.pollDeviceStatus(), pollInterval);
  }

  // HELPER: The library lacks getDeviceStatus, so we filter getDevices
  private async getDeviceStatus() {
    try {
      const deviceId = this.accessory.context.device.id;
      const telemetry = await this.platform.client?.getTelemetry(deviceId);
      this.platform.log.debug(
        `[${this.accessory.context.device.name}] Live Telemetry:`,
        telemetry,
      );

      return {
        oper: telemetry?.OPER,
        diag: telemetry?.DIAG_L2,
      };
    } catch (error) {
      this.platform.log.error('Failed to fetch telemetry:', error);
      return undefined;
    }
  }

  // --- Handlers ---
  async setActive(value: CharacteristicValue) {
    try {
      if (value === this.platform.Characteristic.Active.ACTIVE) {
        await this.platform.client?.setMode(
          this.accessory.context.device.id,
          'COOL',
        );
      } else {
        await this.platform.client?.setMode(
          this.accessory.context.device.id,
          'STBY',
        );
      }
      this.platform.log.info(`Set Active to: ${value}`);
    } catch (error) {
      this.platform.log.error('Failed to set Active state:', error);
    }
  }

  async getActive(): Promise<CharacteristicValue> {
    const status = await this.getDeviceStatus();
    this.platform.log.debug('Active State:', status?.oper?.AC_MODE);
    return status?.oper?.AC_MODE === 'STBY' ? 0 : 1;
  }

  async getCurrentState(): Promise<CharacteristicValue> {
    const status = await this.getDeviceStatus();
    this.platform.log.debug('Current State:', status?.oper?.AC_MODE);
    switch (status?.oper?.AC_MODE) {
      case 'COOL':
        return this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
      case 'HEAT':
        return this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
      case 'AUTO':
      case 'FAN':
      case 'DRY':
        return this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
      default:
        return this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
    }
  }

  async getCurrentTemperature(): Promise<CharacteristicValue> {
    const status = await this.getDeviceStatus();
    this.platform.log.debug('Current Temperature:', status?.diag?.I_RAT);
    return status?.diag?.I_RAT || 22;
  }

  async setTargetTemperature(value: CharacteristicValue) {
    await this.platform.client?.setTemperature(
      this.accessory.context.device.id,
      value as number,
    );
    this.platform.log.info(`Set Target Temperature to: ${value}`);
  }

  async getTargetTemperature(): Promise<CharacteristicValue> {
    const status = await this.getDeviceStatus();
    this.platform.log.debug('Target Temperature:', status?.oper?.SPT);
    return status?.oper?.SPT || 24;
  }

  async setTargetState(value: CharacteristicValue) {
    let mode: 'COOL' | 'HEAT' | 'AUTO' = 'AUTO';
    switch (value) {
      case this.platform.Characteristic.TargetHeaterCoolerState.COOL:
        mode = 'COOL';
        break;
      case this.platform.Characteristic.TargetHeaterCoolerState.HEAT:
        mode = 'HEAT';
        break;
      case this.platform.Characteristic.TargetHeaterCoolerState.AUTO:
        mode = 'AUTO';
        break;
    }
    await this.platform.client?.setMode(this.accessory.context.device.id, mode);
    // If we switch to Heat/Cool/Auto, turn off Dry/Fan switches
    this.dryService.updateCharacteristic(
      this.platform.Characteristic.On,
      false,
    );
    this.fanModeService.updateCharacteristic(
      this.platform.Characteristic.On,
      false,
    );
    this.platform.log.info(`Changing mode to: ${mode}`);
  }

  async getTargetState(): Promise<CharacteristicValue> {
    const status = await this.getDeviceStatus();
    this.platform.log.debug('Target State:', status?.oper?.AC_MODE);
    switch (status?.oper?.AC_MODE) {
      case 'COOL':
        return this.platform.Characteristic.TargetHeaterCoolerState.COOL;
      case 'HEAT':
        return this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
      case 'AUTO':
        return this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
      default:
        return this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
    }
  }

  async setRotationSpeed(value: CharacteristicValue) {
    const speed = value as number;
    let electraSpeed: 'AUTO' | 'HIGH' | 'MED' | 'LOW' = 'AUTO';
    if (speed > 75) {
      electraSpeed = 'HIGH';
    } else if (speed > 45) {
      electraSpeed = 'MED';
    } else if (speed > 10) {
      electraSpeed = 'LOW';
    }
    await this.platform.client?.setFanSpeed(
      this.accessory.context.device.id,
      electraSpeed,
    );
    this.platform.log.info(`Set Rotation Speed to: ${electraSpeed}`);
  }

  async getRotationSpeed(): Promise<CharacteristicValue> {
    const status = await this.getDeviceStatus();
    this.platform.log.debug('Rotation Speed:', status?.oper?.FANSPD);
    switch (status?.oper?.FANSPD) {
      case 'HIGH':
        return 100;
      case 'MED':
        return 50;
      case 'LOW':
        return 25;
      default:
        return 0;
    }
  }

  // async setSwingMode(value: CharacteristicValue) {
  //   const isSwingOn =
  //     value === this.platform.Characteristic.SwingMode.SWING_ENABLED;

  //   this.platform.log.info(
  //     `Setting Swing Mode to: ${isSwingOn ? 'ON' : 'OFF'}`,
  //   );

  //   await this.platform.client?.sendCommand(this.accessory.context.device.id, {
  //     SWING: isSwingOn ? 'ON' : 'OFF',
  //   } as any);
  // }

  // async getSwingMode(): Promise<CharacteristicValue> {
  //   const status = await this.getDeviceStatus();
  //   const swingState = status?.oper?.V_SWING;

  //   this.platform.log.debug('Current Swing State:', swingState);

  //   return swingState === 'ON'
  //     ? this.platform.Characteristic.SwingMode.SWING_ENABLED
  //     : this.platform.Characteristic.SwingMode.SWING_DISABLED;
  // }

  async setCustomMode(mode: 'DRY' | 'FAN') {
    try {
      await this.platform.client?.setMode(
        this.accessory.context.device.id,
        mode,
      );
      this.dryService.updateCharacteristic(
        this.platform.Characteristic.On,
        mode === 'DRY',
      );
      this.fanModeService.updateCharacteristic(
        this.platform.Characteristic.On,
        mode === 'FAN',
      );
      this.service.updateCharacteristic(this.platform.Characteristic.Active, 1);
      this.platform.log.info(`Set mode to: ${mode}`);
    } catch (error) {
      this.platform.log.error(`Failed to set ${mode} mode:`, error);
    }
  }

  async getFilterStatus(): Promise<CharacteristicValue> {
    const status = await this.getDeviceStatus();
    this.platform.log.debug('Filter Status:', status?.oper?.CLEAR_FILT);
    const needsCleaning = status?.oper?.CLEAR_FILT === 'ON';
    if (needsCleaning) {
      this.platform.log.info(
        'Filter cleaning detected! Sending auto-reset command...',
      );
      this.platform.client
        ?.sendCommand(this.accessory.context.device.id, {
          CLEAR_FILT: 'OFF',
        } as Record<string, string>)
        .catch(error => this.platform.log.error('Auto-reset failed:', error));

      return this.platform.Characteristic.FilterChangeIndication.CHANGE_FILTER;
    }

    return this.platform.Characteristic.FilterChangeIndication.FILTER_OK;
  }

  async pollDeviceStatus() {
    try {
      const status = await this.getDeviceStatus();
      if (!status) {
        return;
      }

      this.service.updateCharacteristic(
        this.platform.Characteristic.Active,
        status.oper?.AC_MODE === 'STBY' ? 0 : 1,
      );
      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentHeaterCoolerState,
        status.oper?.AC_MODE === 'COOL'
          ? this.platform.Characteristic.CurrentHeaterCoolerState.COOLING
          : status.oper?.AC_MODE === 'HEAT'
            ? this.platform.Characteristic.CurrentHeaterCoolerState.HEATING
            : status.oper?.AC_MODE === 'AUTO'
              ? this.platform.Characteristic.CurrentHeaterCoolerState.IDLE
              : this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE,
      );
      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        status.diag?.I_RAT as string,
      );
      let targetState =
        this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
      if (status.oper?.AC_MODE === 'COOL') {
        targetState = this.platform.Characteristic.TargetHeaterCoolerState.COOL;
      }
      if (status.oper?.AC_MODE === 'HEAT') {
        targetState = this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
      }
      this.service.updateCharacteristic(
        this.platform.Characteristic.TargetHeaterCoolerState,
        targetState,
      );
      this.service.updateCharacteristic(
        this.platform.Characteristic.CoolingThresholdTemperature,
        status.oper?.SPT as string,
      );
      this.service.updateCharacteristic(
        this.platform.Characteristic.HeatingThresholdTemperature,
        status.oper?.SPT as string,
      );

      let rotationSpeed = 0;
      switch (status.oper?.FANSPD) {
        case 'HIGH':
          rotationSpeed = 100;
          break;
        case 'MED':
          rotationSpeed = 50;
          break;
        case 'LOW':
          rotationSpeed = 25;
          break;
        default:
          rotationSpeed = 0;
      }
      this.service.updateCharacteristic(
        this.platform.Characteristic.RotationSpeed,
        rotationSpeed,
      );

      this.dryService?.updateCharacteristic(
        this.platform.Characteristic.On,
        status.oper?.AC_MODE === 'DRY',
      );
      this.fanModeService?.updateCharacteristic(
        this.platform.Characteristic.On,
        status.oper?.AC_MODE === 'FAN',
      );
      this.filterService.updateCharacteristic(
        this.platform.Characteristic.FilterChangeIndication,
        status.oper?.CLEAR_FILT === 'ON'
          ? this.platform.Characteristic.FilterChangeIndication.CHANGE_FILTER
          : this.platform.Characteristic.FilterChangeIndication.FILTER_OK,
      );
    } catch (error) {
      this.platform.log.error('Polling error:', error);
    }
  }
}
