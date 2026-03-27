import { SensorData } from './serial';

class MobileSensorService {
  private onDataCallback: ((data: SensorData) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private isListening = false;

  async requestPermission(): Promise<boolean> {
    // iOS 13+ requires explicit permission for DeviceMotion
    if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
      try {
        const response = await (DeviceMotionEvent as any).requestPermission();
        return response === 'granted';
      } catch (error) {
        console.error("Permission request failed", error);
        return false;
      }
    }
    // Android and older iOS don't require explicit permission
    return true;
  }

  async start() {
    if (this.isListening) return;

    const hasPermission = await this.requestPermission();
    if (!hasPermission) {
      throw new Error("Permission to access motion sensors was denied.");
    }

    window.addEventListener('devicemotion', this.handleMotion);
    window.addEventListener('deviceorientation', this.handleOrientation);
    this.isListening = true;
  }

  stop() {
    window.removeEventListener('devicemotion', this.handleMotion);
    window.removeEventListener('deviceorientation', this.handleOrientation);
    this.isListening = false;
  }

  private lastOrientation = { alpha: 0, beta: 0, gamma: 0 };

  private handleOrientation = (event: DeviceOrientationEvent) => {
    this.lastOrientation = {
      alpha: event.alpha || 0,
      beta: event.beta || 0,
      gamma: event.gamma || 0
    };
  };

  private handleMotion = (event: DeviceMotionEvent) => {
    if (!this.onDataCallback) return;

    const acc = event.accelerationIncludingGravity;
    const rot = event.rotationRate;

    const sensorData: SensorData = {
      timestamp: Date.now(),
      ax: Number(acc?.x) || 0,
      ay: Number(acc?.y) || 0,
      az: Number(acc?.z) || 0,
      gx: Number(rot?.alpha) || 0,
      gy: Number(rot?.beta) || 0,
      gz: Number(rot?.gamma) || 0,
      mx: Number(this.lastOrientation.alpha) || 0,
      my: Number(this.lastOrientation.beta) || 0,
      mz: Number(this.lastOrientation.gamma) || 0,
      fsr: 0 // No force sensor on mobile
    };

    this.onDataCallback(sensorData);
  };

  onData(callback: (data: SensorData) => void) {
    this.onDataCallback = callback;
  }

  onError(callback: (error: string) => void) {
    this.onErrorCallback = callback;
  }
}

export const mobileSensorService = new MobileSensorService();
