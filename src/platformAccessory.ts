import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { ElectraSmartPlatform } from './platform.js';

type ElectraHvacMode = 'COOL' | 'HEAT' | 'AUTO';

const HOMEKIT_MIN_TARGET_TEMPERATURE = 16;
const HOMEKIT_MAX_TARGET_TEMPERATURE = 30;
const DEFAULT_TARGET_TEMPERATURE = 24;
const HOMEKIT_MIN_CURRENT_TEMPERATURE = -270;
const HOMEKIT_MAX_CURRENT_TEMPERATURE = 100;
const DEFAULT_CURRENT_TEMPERATURE = 22;

interface ElectraStatus {
  oper?: {
    AC_MODE?: string;
    SPT?: string;
    FANSPD?: string;
    CLEAR_FILT?: string;
  };
  diag?: {
    I_RAT?: string | number;
    I_ON_OFF_STAT?: string;
    MAIN_PWR_STATUS?: string;
    O_SYS_PWR?: string;
  };
}

export class ElectraPlatformAccessory {
  private service: Service;
  private dryService?: Service;
  private fanModeService?: Service;
  // Cache to store the last status and avoid "Slow to respond" warnings
  private lastStatus: ElectraStatus | null = null;
  private requestedActiveState: boolean | null = null;
  private requestedTargetMode: ElectraHvacMode | null = null;
  // Track the last telemetry error to avoid spamming logs
  private lastTelemetryErrorMessage?: string;
  private lastTelemetryErrorCount = 0;

  constructor(
    private readonly platform: ElectraSmartPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const options = this.platform.config.options ?? {};
    const persisted = this.accessory.context.lastTargetMode;
    if (
      persisted === 'COOL' ||
      persisted === 'HEAT' ||
      persisted === 'AUTO'
    ) {
      this.requestedTargetMode = persisted;
    }
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
    if (!options.hideDryMode) {
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
    if (!options.hideFanMode) {
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
      .onGet(() => this.getActiveState());

    // Current Mode (Cooling/Heating/Idle)
    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .onGet(this.getCurrentState.bind(this));

    // Current Temperature (Room)
    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(() => this.getCurrentTemperature());

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
      .setProps({
        minStep: 1,
        minValue: HOMEKIT_MIN_TARGET_TEMPERATURE,
        maxValue: HOMEKIT_MAX_TARGET_TEMPERATURE,
      })
      .updateValue(DEFAULT_TARGET_TEMPERATURE)
      .onSet(this.setTargetTemperature.bind(this))
      .onGet(() => {
        return this.getHomeKitTargetTemperature();
      });

    // Heating Temp Setpoint
    this.service
      .getCharacteristic(
        this.platform.Characteristic.HeatingThresholdTemperature,
      )
      .setProps({
        minStep: 1,
        minValue: HOMEKIT_MIN_TARGET_TEMPERATURE,
        maxValue: HOMEKIT_MAX_TARGET_TEMPERATURE,
      })
      .updateValue(DEFAULT_TARGET_TEMPERATURE)
      .onSet(this.setTargetTemperature.bind(this))
      .onGet(() => {
        return this.getHomeKitTargetTemperature();
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
    const pollInterval = ((options.pollInterval as number) || 60) * 1000;
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
        this.platform.log.debug(
          `[${this.accessory.displayName}] Session expired, reinitializing client...`,
        );
        // Reinitialize the client to get a fresh SID
        await this.platform.initializeElectraSmartClient();
        // Don't log the error again since it was a session expiration issue
        return null;
      }

      // Dedupe and shorten error logging to avoid spamming logs with full objects
      if (this.lastTelemetryErrorMessage === errorMessage) {
        this.lastTelemetryErrorCount += 1;
        // Log only every 10 occurrences to keep logs readable
        if (this.lastTelemetryErrorCount % 10 === 1) {
          this.platform.log.warn(
            `[${this.accessory.displayName}] Telemetry fetch failed: ${errorMessage} (repeated ${this.lastTelemetryErrorCount} times)`,
          );
        } else {
          this.platform.log.debug(
            `[${this.accessory.displayName}] Telemetry fetch failed (suppressed): ${errorMessage}`,
          );
        }
      } else {
        this.lastTelemetryErrorMessage = errorMessage;
        this.lastTelemetryErrorCount = 1;
        this.platform.log.warn(
          `[${this.accessory.displayName}] Failed to fetch telemetry: ${errorMessage}`,
        );
      }

      return null;
    }
  }

  // Logic Helpers (Using lastStatus cache)
  private getActiveState(): CharacteristicValue {
    const onOffState = this.lastStatus?.diag?.I_ON_OFF_STAT;
    if (onOffState === 'ON') {
      return 1;
    }
    if (onOffState === 'OFF') {
      return 0;
    }

    const mode = this.lastStatus?.oper?.AC_MODE;
    return mode && mode !== 'STBY' ? 1 : 0;
  }

  private getCurrentState(): CharacteristicValue {
    if (this.getActiveState() === 0) {
      return this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
    }

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
    const preferred =
      this.requestedTargetMode ??
      this.targetModeFromOper(this.lastStatus?.oper?.AC_MODE);
    return this.targetStateCharacteristicForMode(preferred ?? 'AUTO');
  }

  private targetModeFromOper(
    acMode?: string,
  ): ElectraHvacMode | null {
    if (acMode === 'COOL' || acMode === 'HEAT' || acMode === 'AUTO') {
      return acMode;
    }
    return null;
  }

  private targetStateCharacteristicForMode(
    mode: ElectraHvacMode,
  ): CharacteristicValue {
    const Target = this.platform.Characteristic.TargetHeaterCoolerState;
    if (mode === 'COOL') {
      return Target.COOL;
    }
    if (mode === 'HEAT') {
      return Target.HEAT;
    }
    return Target.AUTO;
  }

  private targetModeFromCharacteristicValue(
    value: CharacteristicValue,
  ): ElectraHvacMode | null {
    const Target = this.platform.Characteristic.TargetHeaterCoolerState;
    const modes: Record<number, ElectraHvacMode> = {
      [Target.COOL]: 'COOL',
      [Target.HEAT]: 'HEAT',
      [Target.AUTO]: 'AUTO',
    };
    return modes[value as number] ?? null;
  }

  /** Mode to use when powering on; HomeKit may set Active before TargetHeaterCoolerState. */
  private resolvePowerOnMode(): ElectraHvacMode {
    if (this.requestedTargetMode) {
      return this.requestedTargetMode;
    }

    const targetCharacteristic = this.service.getCharacteristic(
      this.platform.Characteristic.TargetHeaterCoolerState,
    );
    const fromCharacteristic = this.targetModeFromCharacteristicValue(
      targetCharacteristic.value as CharacteristicValue,
    );
    if (fromCharacteristic) {
      return fromCharacteristic;
    }

    const fromLastStatus = this.targetModeFromOper(
      this.lastStatus?.oper?.AC_MODE,
    );
    if (fromLastStatus) {
      return fromLastStatus;
    }

    return 'AUTO';
  }

  private persistTargetMode(mode: ElectraHvacMode) {
    if (this.accessory.context.lastTargetMode === mode) {
      return;
    }
    this.accessory.context.lastTargetMode = mode;
    this.platform.api.updatePlatformAccessories([this.accessory]);
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

  private getCurrentTemperature(): number {
    const rawTemperature = Number(this.lastStatus?.diag?.I_RAT);
    if (!Number.isFinite(rawTemperature)) {
      return DEFAULT_CURRENT_TEMPERATURE;
    }

    const temperature =
      rawTemperature > HOMEKIT_MAX_CURRENT_TEMPERATURE
        ? rawTemperature / 10
        : rawTemperature;

    return temperature >= HOMEKIT_MIN_CURRENT_TEMPERATURE &&
      temperature <= HOMEKIT_MAX_CURRENT_TEMPERATURE
      ? temperature
      : DEFAULT_CURRENT_TEMPERATURE;
  }

  private getHomeKitTargetTemperature(): number {
    const targetTemperature = parseInt(
      this.lastStatus?.oper?.SPT ?? DEFAULT_TARGET_TEMPERATURE.toString(),
      10,
    );

    if (Number.isNaN(targetTemperature)) {
      return DEFAULT_TARGET_TEMPERATURE;
    }

    return this.clampTargetTemperature(targetTemperature);
  }

  private clampTargetTemperature(targetTemperature: number): number {
    return Math.min(
      HOMEKIT_MAX_TARGET_TEMPERATURE,
      Math.max(HOMEKIT_MIN_TARGET_TEMPERATURE, targetTemperature),
    );
  }

  // SET Handlers
  async setActive(value: CharacteristicValue) {
    const active = value === 1;
    this.requestedActiveState = active;

    if (active) {
      const mode = this.resolvePowerOnMode();

      this.platform.log.debug(
        `[${this.accessory.displayName}] Turning ON AC using requested mode: ${mode}`,
      );

      await this.platform.client?.setMode(
        this.accessory.context.device.id,
        mode,
      );

      this.platform.log.info(
        `[${this.accessory.displayName}] AC Active set to: ${mode}`,
      );
    } else {
      await this.platform.client?.setMode(
        this.accessory.context.device.id,
        'STBY',
      );

      this.platform.log.info(
        `[${this.accessory.displayName}] AC Active set to: STBY`,
      );
    }

    setTimeout(() => this.pollDeviceStatus(), 2000);
  }

  async setTargetTemperature(value: CharacteristicValue) {
    const targetTemperature = this.clampTargetTemperature(value as number);

    await this.platform.client?.setTemperature(
      this.accessory.context.device.id,
      targetTemperature,
    );
    this.platform.log.info(
      `[${this.accessory.displayName}] Target temperature set to: ${targetTemperature}`,
    );
  }

  async setTargetState(value: CharacteristicValue) {
    const mode = this.targetModeFromCharacteristicValue(value) ?? 'AUTO';

    this.requestedTargetMode = mode;
    this.persistTargetMode(mode);

    this.platform.log.debug(
      `[${this.accessory.displayName}] HomeKit requested target mode: ${mode}`,
    );

    const activeRequested =
      this.requestedActiveState ??
      ((this.service.getCharacteristic(this.platform.Characteristic.Active)
        .value as number) === 1);

    // When HomeKit sets Active before TargetHeaterCoolerState, setActive may have
    // already powered on with AUTO; apply the correct mode once target is known.
    // Do not send a mode while HomeKit has just requested Active=0. The telemetry
    // cache can still report the old mode until the next poll and would otherwise
    // immediately undo the standby command.
    if (activeRequested) {
      await this.platform.client?.setMode(
        this.accessory.context.device.id,
        mode,
      );
      this.platform.log.info(
        `[${this.accessory.displayName}] Target state set to: ${mode}`,
      );
    }
  }

  async setRotationSpeed(value: CharacteristicValue) {
    const speed = value as number;
    const electraSpeed =
      speed > 75 ? 'HIGH' : speed > 45 ? 'MED' : speed > 10 ? 'LOW' : 'AUTO';
    await this.platform.client?.setFanSpeed(
      this.accessory.context.device.id,
      electraSpeed,
    );
    this.platform.log.info(
      `[${this.accessory.displayName}] Fan speed set to: ${electraSpeed}`,
    );
  }

  async setCustomMode(mode: 'DRY' | 'FAN') {
    await this.platform.client?.setMode(this.accessory.context.device.id, mode);
    this.platform.log.info(
      `[${this.accessory.displayName}] Custom mode set to: ${mode}`,
    );
    setTimeout(() => this.pollDeviceStatus(), 2000);
  }

  // POLLING: Update status and Push to HomeKit
  async pollDeviceStatus() {
    const status = await this.getDeviceStatusFromCloud();
    if (!status) {
      return;
    }

    this.lastStatus = status;
    this.requestedActiveState = null;
    this.logStatusSnapshot(status);

    // Push updates to Homebridge immediately
    this.service.updateCharacteristic(
      this.platform.Characteristic.Active,
      this.getActiveState(),
    );
    this.service.updateCharacteristic(
      this.platform.Characteristic.CurrentTemperature,
      this.getCurrentTemperature(),
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
      this.getHomeKitTargetTemperature(),
    );
    this.service.updateCharacteristic(
      this.platform.Characteristic.HeatingThresholdTemperature,
      this.getHomeKitTargetTemperature(),
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

  private logStatusSnapshot(status: ElectraStatus) {
    this.platform.log.debug(
      `[${this.accessory.displayName}] Telemetry snapshot: ` +
        `AC_MODE=${status.oper?.AC_MODE ?? 'unknown'}, ` +
        `I_ON_OFF_STAT=${status.diag?.I_ON_OFF_STAT ?? 'unknown'}, ` +
        `MAIN_PWR_STATUS=${status.diag?.MAIN_PWR_STATUS ?? 'unknown'}, ` +
        `O_SYS_PWR=${status.diag?.O_SYS_PWR ?? 'unknown'}, ` +
        `SPT=${status.oper?.SPT ?? 'unknown'}, ` +
        `I_RAT=${status.diag?.I_RAT ?? 'unknown'}`,
    );
  }
}
