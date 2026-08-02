import { SensorData } from './serial';

export const BLE_SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
export const BLE_CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";
export const BLE_BATTERY_SERVICE_UUID = "battery_service";
export const BLE_BATTERY_CHARACTERISTIC_UUID = "battery_level";

class BLEService {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private batteryCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private onDataCallback: ((data: SensorData) => void) | null = null;
  private onBatteryCallback: ((level: number) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private isConnecting: boolean = false;

  getDeviceName(): string | undefined {
    return this.device?.name;
  }

  async connect() {
    if (!("bluetooth" in navigator)) {
      throw new Error("Web Bluetooth API not supported in this browser.");
    }

    try {
      this.isConnecting = true;
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_SERVICE_UUID] }],
        optionalServices: [BLE_BATTERY_SERVICE_UUID]
      });

      this.device.addEventListener('gattserverdisconnected', this.onDisconnected.bind(this));

      try {
        if (!this.device.gatt!.connected) {
          this.server = await this.device.gatt!.connect();
        } else {
          this.server = this.device.gatt!;
        }
        
        // Wait extremely briefly. Often Chrome triggers disconnected event in 300-500ms
        // If it throws during getPrimaryService, we'll catch it.
        const service = await this.server.getPrimaryService(BLE_SERVICE_UUID);
        this.characteristic = await service.getCharacteristic(BLE_CHARACTERISTIC_UUID);
        
        try {
          const batteryService = await this.server.getPrimaryService(BLE_BATTERY_SERVICE_UUID);
          this.batteryCharacteristic = await batteryService.getCharacteristic(BLE_BATTERY_CHARACTERISTIC_UUID);
          
          const batteryValue = await this.batteryCharacteristic.readValue();
          const batteryLevel = batteryValue.getUint8(0);
          if (this.onBatteryCallback) this.onBatteryCallback(batteryLevel);
          
          await this.batteryCharacteristic.startNotifications();
          this.batteryCharacteristic.addEventListener('characteristicvaluechanged', this.handleBatteryNotification.bind(this));
        } catch (batteryError) {
          console.warn("Battery service not available on this device", batteryError);
        }
      } catch (e: any) {
        console.error("BLE initial connection error", e);
        try {
          if (this.device.gatt?.connected) this.device.gatt.disconnect();
        } catch (err) {}
        throw e;
      }

      await this.characteristic!.startNotifications();
      this.characteristic!.addEventListener('characteristicvaluechanged', this.handleNotifications.bind(this));
      
      this.isConnecting = false;
      return true;
    } catch (error) {
      this.isConnecting = false;
      console.error("BLE Connection failed", error);
      throw error;
    }
  }

  async disconnect() {
    this.isConnecting = false;
    if (this.device && this.device.gatt?.connected) {
      this.device.gatt.disconnect();
    }
  }

  private onDisconnected() {
    if (this.isConnecting) return; // Do not trigger UI error if we are actively managing connection retries
    if (this.onErrorCallback) {
      this.onErrorCallback("Device disconnected - If using ESP32, please check that you have flashed the latest firmware with the MTU fix.");
    }
  }

  private handleBatteryNotification(event: Event) {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    const batteryLevel = value.getUint8(0);
    if (this.onBatteryCallback) this.onBatteryCallback(batteryLevel);
  }

  private handleNotifications(event: Event) {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;

    const decoder = new TextDecoder('utf-8');
    const line = decoder.decode(value);
    this.parseLine(line);
  }

  private parseLine(line: string) {
    try {
      const trimmed = line.trim();
      if (!trimmed) return;
      
      // Expected format: X:0.00,Y:0.00,Z:0.00,F:0
      if (trimmed.includes('X:') && trimmed.includes('Y:')) {
         const parts = trimmed.split(',');
         const data: any = {};
         parts.forEach(p => {
           const [key, val] = p.split(':');
           if (key && val) data[key.trim()] = Number(val);
         });
         
         if ('X' in data && 'Y' in data && 'Z' in data) {
           const sensorData: SensorData = {
             timestamp: Date.now(),
             ax: (Number(data.X) || 0) * 0.00981,
             ay: (Number(data.Y) || 0) * 0.00981,
             az: (Number(data.Z) || 0) * 0.00981,
             gx: Number(data.GX) || 0,
             gy: Number(data.GY) || 0,
             gz: Number(data.GZ) || 0,
             mx: Number(data.MX) || 0,
             my: Number(data.MY) || 0,
             mz: Number(data.MZ) || 0,
             fsr: Number(data.F) || 0
           };
           if (this.onDataCallback) this.onDataCallback(sensorData);
         }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  onData(callback: (data: SensorData) => void) {
    this.onDataCallback = callback;
  }

  onBattery(callback: (level: number) => void) {
    this.onBatteryCallback = callback;
  }

  onError(callback: (error: string) => void) {
    this.onErrorCallback = callback;
  }
}

export const bleService = new BLEService();
