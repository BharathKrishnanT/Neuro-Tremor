import { SensorData } from './serial';

class WiFiService {
  private ws: WebSocket | null = null;
  private onDataCallback: ((data: SensorData) => void) | null = null;
  private onErrorCallback: ((err: string) => void) | null = null;
  private onDisconnectCallback: (() => void) | null = null;
  
  // Default IP for ESP32 Access Point
  private ip = '192.168.4.1'; 
  private port = 81;

  async connect(ipAddress?: string) {
    if (ipAddress) {
      this.ip = ipAddress;
    }

    return new Promise<void>((resolve, reject) => {
      try {
        // NOTE: If the app is hosted on HTTPS, modern browsers will block
        // a connection to an insecure ws:// address due to Mixed Content policies.
        // For testing WiFi out of the box, we recommend running this app locally
        // via "npm run dev" or using localhost.
        this.ws = new WebSocket(`ws://${this.ip}:${this.port}/`);

        this.ws.onopen = () => {
          console.log("WebSocket connected to", this.ip);
          resolve();
        };

        this.ws.onmessage = (event) => {
          const data = event.data;
          this.parseData(data);
        };

        this.ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          if (this.onErrorCallback) this.onErrorCallback("WebSocket error. Ensure you are connected to the ESP32 WiFi network and your browser allows insecure websockets (mixed content).");
          reject(error);
        };

        this.ws.onclose = () => {
          console.log("WebSocket connection closed");
          if (this.onDisconnectCallback) this.onDisconnectCallback();
        };

      } catch (err: any) {
        reject(err);
      }
    });
  }

  private parseData(text: string) {
    try {
      if (text.includes('X:') && text.includes('Y:')) {
        const parts = text.split(',');
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

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  onData(callback: (data: SensorData) => void) {
    this.onDataCallback = callback;
  }

  onError(callback: (err: string) => void) {
    this.onErrorCallback = callback;
  }
  
  onDisconnect(callback: () => void) {
    this.onDisconnectCallback = callback;
  }
}

export const wifiService = new WiFiService();
