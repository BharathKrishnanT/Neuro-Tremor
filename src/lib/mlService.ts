import * as tf from '@tensorflow/tfjs';
import { SensorData } from './serial';

export interface TremorFeatures {
  rms: number;
  frequency: number;
  avgForce: number;
  variance: number;
}

const WINDOW_SIZE = 40; // 2 seconds at 20Hz
const CHANNELS = 6; // ax, ay, az, gx, gy, gz

export class TremorMLService {
  private model: tf.LayersModel | null = null;
  private isModelLoaded = false;
  private isTraining = false;

  /**
   * Initialize the CNN model. Loads from IndexedDB if available,
   * otherwise builds a new model.
   */
  async initModel() {
    try {
      this.model = await tf.loadLayersModel('indexeddb://tremor-cnn-model');
      this.isModelLoaded = true;
      console.log('Loaded existing CNN model from IndexedDB');
      
      this.model.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'sparseCategoricalCrossentropy',
        metrics: ['accuracy']
      });
      return true;
    } catch (error) {
      console.log('Creating new CNN model for continuous learning');
      this.model = this.buildCNN();
      this.isModelLoaded = true;
      return true;
    }
  }

  private buildCNN(): tf.LayersModel {
    const model = tf.sequential();
    
    model.add(tf.layers.conv1d({
      filters: 16,
      kernelSize: 3,
      activation: 'relu',
      inputShape: [WINDOW_SIZE, CHANNELS]
    }));
    model.add(tf.layers.maxPooling1d({ poolSize: 2 }));
    
    model.add(tf.layers.conv1d({
      filters: 32,
      kernelSize: 3,
      activation: 'relu'
    }));
    model.add(tf.layers.maxPooling1d({ poolSize: 2 }));
    
    model.add(tf.layers.flatten());
    model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
    model.add(tf.layers.dropout({ rate: 0.5 }));
    // 4 classes: Normal (0), Mild (1), Moderate (2), Severe (3)
    model.add(tf.layers.dense({ units: 4, activation: 'softmax' }));

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'sparseCategoricalCrossentropy',
      metrics: ['accuracy']
    });

    return model;
  }

  /**
   * Extract features from a window of sensor data.
   * This should match the preprocessing steps used in your Colab notebook.
   */
  extractFeatures(dataWindow: SensorData[]): TremorFeatures {
    if (dataWindow.length < 10) {
      return { rms: 0, frequency: 0, avgForce: 0, variance: 0 };
    }

    // 1. Calculate the mean vector (DC component / Gravity or static posture)
    const meanX = dataWindow.reduce((acc, d) => acc + d.ax, 0) / dataWindow.length;
    const meanY = dataWindow.reduce((acc, d) => acc + d.ay, 0) / dataWindow.length;
    const meanZ = dataWindow.reduce((acc, d) => acc + d.az, 0) / dataWindow.length;

    // 2. Isolate dynamic acceleration (AC component / Tremor) by subtracting the mean
    const dynamicMagnitudes = dataWindow.map(d => 
      Math.sqrt(Math.pow(d.ax - meanX, 2) + Math.pow(d.ay - meanY, 2) + Math.pow(d.az - meanZ, 2))
    );

    // 3. Calculate RMS of the dynamic acceleration
    const sumSquared = dynamicMagnitudes.reduce((acc, val) => acc + (val * val), 0);
    const variance = sumSquared / dynamicMagnitudes.length;
    const rms = Math.sqrt(variance);

    // 4. Calculate Frequency using zero-crossings on the dynamic magnitude
    const meanDynMag = dynamicMagnitudes.reduce((a, b) => a + b, 0) / dynamicMagnitudes.length;
    let zeroCrossings = 0;
    for (let i = 1; i < dynamicMagnitudes.length; i++) {
      if ((dynamicMagnitudes[i] - meanDynMag) * (dynamicMagnitudes[i - 1] - meanDynMag) < 0) {
        zeroCrossings++;
      }
    }

    const durationSec = (dataWindow[dataWindow.length - 1].timestamp - dataWindow[0].timestamp) / 1000;
    const frequency = durationSec > 0 ? (zeroCrossings / 2) / durationSec : 0;

    const avgForce = dataWindow.reduce((acc, d) => acc + d.fsr, 0) / dataWindow.length;

    return { rms, frequency, avgForce, variance };
  }

  private prepareTensor(dataWindow: SensorData[]): tf.Tensor3D | null {
    if (dataWindow.length < WINDOW_SIZE) return null;
    const slice = dataWindow.slice(-WINDOW_SIZE);
    const values = slice.map(d => [d.ax, d.ay, d.az, d.gx, d.gy, d.gz]);
    return tf.tensor3d([values], [1, WINDOW_SIZE, CHANNELS]);
  }

  /**
   * Run inference using the loaded CNN model or a fallback heuristic.
   * Returns a severity score (0 to 4).
   */
  async predictSeverity(dataWindow: SensorData[], features: TremorFeatures): Promise<number> {
    if (this.isModelLoaded && this.model) {
      const inputTensor = this.prepareTensor(dataWindow);
      if (inputTensor) {
        try {
          const prediction = this.model.predict(inputTensor) as tf.Tensor;
          const scoreData = await prediction.data();
          
          inputTensor.dispose();
          prediction.dispose();
          
          // Expected value calculation: 0*p0 + 1*p1 + 2*p2 + 3*p3
          let expectedValue = 0;
          for (let i = 0; i < 4; i++) {
            expectedValue += i * scoreData[i];
          }
          // Scale 0-3 to 0-4 range to match heuristic
          return expectedValue * (4/3);
        } catch (error) {
          console.error('Inference error, falling back to heuristic:', error);
          if (inputTensor) inputTensor.dispose();
          return this.heuristicPrediction(features);
        }
      }
    }
    return this.heuristicPrediction(features);
  }

  /**
   * Train the CNN model on a recorded session to enable continuous learning.
   */
  async trainOnSession(sessionData: SensorData[], severityLabel: string) {
    if (!this.model || sessionData.length < WINDOW_SIZE) return;
    if (this.isTraining) return;
    
    this.isTraining = true;
    console.log(`Training CNN on new session data. Label: ${severityLabel}`);

    let labelIdx = 0;
    if (severityLabel === 'Mild') labelIdx = 1;
    if (severityLabel === 'Moderate') labelIdx = 2;
    if (severityLabel === 'Severe') labelIdx = 3;

    try {
      const inputs: number[][][] = [];
      const labels: number[] = [];

      // Slide window by 10 samples (0.5s) to augment data
      const step = 10;
      for (let i = 0; i <= sessionData.length - WINDOW_SIZE; i += step) {
        const slice = sessionData.slice(i, i + WINDOW_SIZE);
        const values = slice.map(d => [d.ax, d.ay, d.az, d.gx, d.gy, d.gz]);
        inputs.push(values);
        labels.push(labelIdx);
      }

      if (inputs.length === 0) {
        this.isTraining = false;
        return;
      }

      const xs = tf.tensor3d(inputs, [inputs.length, WINDOW_SIZE, CHANNELS]);
      const ys = tf.tensor1d(labels, 'int32');

      await this.model.fit(xs, ys, {
        epochs: 5,
        batchSize: 8,
        shuffle: true
      });

      xs.dispose();
      ys.dispose();

      await this.model.save('indexeddb://tremor-cnn-model');
      console.log('Model trained and saved successfully!');
    } catch (error) {
      console.error('Error training model:', error);
    } finally {
      this.isTraining = false;
    }
  }

  /**
   * A heuristic fallback to simulate the ML model's behavior.
   * Maps features to a 0-4 severity scale (similar to UPDRS).
   */
  public heuristicPrediction(features: TremorFeatures): number {
    // Parkinson's resting tremor is typically 4-6 Hz
    const isParkinsonianFreq = features.frequency >= 3.5 && features.frequency <= 7.0;
    
    let severity = 0;

    // Medically accurate thresholds for pure dynamic tremor acceleration RMS (m/s^2)
    // Normal hand jitter is typically 0.0 - 2.0 m/s^2.
    if (features.rms > 2.0) severity = 1; // Mild tremor
    if (features.rms > 3.0) severity = 2; // Moderate tremor
    if (features.rms > 4.0) severity = 3; // Severe tremor
    if (features.rms > 5.0) severity = 4; // Very severe

    // Boost severity if frequency matches typical Parkinson's tremor (3-7 Hz)
    if (isParkinsonianFreq && severity > 0 && severity < 4) {
      severity += 1; 
    }

    // Reduce severity if grip force is high (distinguishes action tremor from resting tremor)
    if (features.avgForce > 2000 && severity > 1) {
      severity -= 1;
    }

    // Ensure severity is within 0-4 range
    return Math.max(0, Math.min(4, severity));
  }

  /**
   * Maps severity score to disease stage (Stage 1, 2, 3)
   */
  public getStage(severity: number): string {
    if (severity === 0) return 'Normal';
    if (severity <= 1.5) return 'Stage 1';
    if (severity <= 3) return 'Stage 2';
    return 'Stage 3';
  }
}

export const mlService = new TremorMLService();
