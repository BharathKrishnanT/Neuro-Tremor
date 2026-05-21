export class DataStreamExportService {
  private fileHandle: any = null;
  private writableStream: any = null;
  private format: 'csv' | 'json' = 'csv';
  public isWriting = false;
  private durationTimeout: NodeJS.Timeout | null = null;
  private onStopCallback: (() => void) | null = null;

  async startStreaming(format: 'csv' | 'json', durationSeconds?: number, onStop?: () => void) {
    try {
      this.format = format;
      this.onStopCallback = onStop || null;
      
      // Fallback for browsers without File System Access API
      if (!('showSaveFilePicker' in window)) {
        throw new Error("File System Access API not supported in this browser. Please use Chrome/Edge.");
      }

      this.fileHandle = await (window as any).showSaveFilePicker({
        suggestedName: `tremor_data_${new Date().toISOString().replace(/:/g, '-')}.${format}`,
        types: [{
          description: format === 'csv' ? 'CSV File' : 'JSON File',
          accept: format === 'csv' ? { 'text/csv': ['.csv'] } : { 'application/json': ['.json'] },
        }],
      });
      this.writableStream = await this.fileHandle.createWritable();
      
      if (format === 'csv') {
        await this.writableStream.write("timestamp,ax,ay,az,gx,gy,gz\n");
      } else {
        await this.writableStream.write("[\n");
      }
      this.isWriting = true;

      if (durationSeconds && durationSeconds > 0) {
        this.durationTimeout = setTimeout(() => {
          this.stopStreaming();
        }, durationSeconds * 1000);
      }

    } catch (e) {
      console.error("Failed to start file stream", e);
      this.isWriting = false;
      throw e;
    }
  }

  async writeData(data: any) {
    if (!this.isWriting || !this.writableStream) return;
    
    try {
      if (this.format === 'csv') {
        const line = `${data.timestamp},${data.ax},${data.ay},${data.az},${data.gx},${data.gy},${data.gz}\n`;
        await this.writableStream.write(line);
      } else {
        const line = JSON.stringify(data) + ",\n";
        await this.writableStream.write(line);
      }
    } catch (e) {
       console.error("Failed to write to stream", e);
    }
  }

  async stopStreaming() {
    if (!this.isWriting || !this.writableStream) return;
    this.isWriting = false;

    if (this.durationTimeout) {
      clearTimeout(this.durationTimeout);
      this.durationTimeout = null;
    }

    try {
      if (this.format === 'json') {
        // Close JSON array
        await this.writableStream.write("{}\n]");
      }
      await this.writableStream.close();
    } catch (e) {
      console.error("Failed to close stream", e);
    }
    this.writableStream = null;
    this.fileHandle = null;

    if (this.onStopCallback) {
      this.onStopCallback();
    }
  }
}

export const exportService = new DataStreamExportService();
