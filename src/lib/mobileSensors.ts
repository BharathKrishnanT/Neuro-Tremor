import { SensorData } from './serial';

class MobileSensorService {
  private onDataCallback: ((data: SensorData) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private isListening = false;
  private pollingInterval: NodeJS.Timeout | null = null;

  private lastMotion = { ax: 0, ay: 0, az: 0, gx: 0, gy: 0, gz: 0 };
  private lastOrientation = { alpha: 0, beta: 0, gamma: 0 };
  
  // Smoothing factor for low-pass filter (0.0 to 1.0). Lower = smoother/less sensitive.
  private smoothingFactor = 0.15;

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

    // Start a continuous polling loop at 20Hz (50ms) to match ESP pen behavior
    this.pollingInterval = setInterval(() => {
      this.emitData();
    }, 50);
  }

  stop() {
    window.removeEventListener('devicemotion', this.handleMotion);
    window.removeEventListener('deviceorientation', this.handleOrientation);
    this.isListening = false;
    
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private handleOrientation = (event: DeviceOrientationEvent) => {
    const newAlpha = event.alpha || 0;
    const newBeta = event.beta || 0;
    const newGamma = event.gamma || 0;

    this.lastOrientation = {
      alpha: this.lastOrientation.alpha + this.smoothingFactor * (newAlpha - this.lastOrientation.alpha),
      beta: this.lastOrientation.beta + this.smoothingFactor * (newBeta - this.lastOrientation.beta),
      gamma: this.lastOrientation.gamma + this.smoothingFactor * (newGamma - this.lastOrientation.gamma)
    };
  };

  private handleMotion = (event: DeviceMotionEvent) => {
    const acc = event.accelerationIncludingGravity;
    const rot = event.rotationRate;

    const newAx = Number(acc?.x) || 0;
    const newAy = Number(acc?.y) || 0;
    const newAz = Number(acc?.z) || 0;
    const newGx = Number(rot?.alpha) || 0;
    const newGy = Number(rot?.beta) || 0;
    const newGz = Number(rot?.gamma) || 0;

    // Apply low-pass filter to smooth out jitter and reduce extreme sensitivity
    this.lastMotion = {
      ax: this.lastMotion.ax + this.smoothingFactor * (newAx - this.lastMotion.ax),
      ay: this.lastMotion.ay + this.smoothingFactor * (newAy - this.lastMotion.ay),
      az: this.lastMotion.az + this.smoothingFactor * (newAz - this.lastMotion.az),
      gx: this.lastMotion.gx + this.smoothingFactor * (newGx - this.lastMotion.gx),
      gy: this.lastMotion.gy + this.smoothingFactor * (newGy - this.lastMotion.gy),
      gz: this.lastMotion.gz + this.smoothingFactor * (newGz - this.lastMotion.gz)
    };
  };

  private emitData = () => {
    if (!this.onDataCallback) return;

    const sensorData: SensorData = {
      timestamp: Date.now(),
      ax: this.lastMotion.ax,
      ay: this.lastMotion.ay,
      az: this.lastMotion.az,
      gx: this.lastMotion.gx,
      gy: this.lastMotion.gy,
      gz: this.lastMotion.gz,
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
