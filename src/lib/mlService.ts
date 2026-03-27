import * as tf from '@tensorflow/tfjs';
import { SensorData } from './serial';

export interface TremorFeatures {
  rms: number;
  frequency: number;
  avgForce: number;
  variance: number;
}

export class TremorMLService {
  private model: tf.LayersModel | null = null;
  private isModelLoaded = false;

  /**
   * Load the TensorFlow.js model exported from your Colab notebook.
   * To use your actual model:
   * 1. Export your Keras/TF model to TFJS format in Colab:
   *    !pip install tensorflowjs
   *    !tensorflowjs_converter --input_format keras model.h5 /content/tfjs_model
   * 2. Host the model.json and .bin files (e.g., in the /public folder of this app)
   * 3. Call loadModel('/tfjs_model/model.json')
   */
  async loadModel(modelUrl: string = '/model/model.json') {
    try {
      console.log('Attempting to load ML model from:', modelUrl);
      // Uncomment the line below when you have your actual model files hosted
      // this.model = await tf.loadLayersModel(modelUrl);
      this.isModelLoaded = true;
      return true;
    } catch (error) {
      console.warn('ML model not found at URL. Using heuristic fallback.', error);
      this.isModelLoaded = false;
      return false;
    }
  }

  /**
   * Extract features from a window of sensor data.
   * This should match the preprocessing steps used in your Colab notebook.
   */
  extractFeatures(dataWindow: SensorData[]): TremorFeatures {
    if (dataWindow.length < 10) {
      return { rms: 0, frequency: 0, avgForce: 0, variance: 0 };
    }

    const magnitudes = dataWindow.map(d => Math.sqrt(d.ax * d.ax + d.ay * d.ay + d.az * d.az));
    const mean = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;
    const variance = magnitudes.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / magnitudes.length;
    const rms = Math.sqrt(variance);

    let zeroCrossings = 0;
    for (let i = 1; i < magnitudes.length; i++) {
      if ((magnitudes[i] - mean) * (magnitudes[i - 1] - mean) < 0) {
        zeroCrossings++;
      }
    }

    const durationSec = (dataWindow[dataWindow.length - 1].timestamp - dataWindow[0].timestamp) / 1000;
    const frequency = durationSec > 0 ? (zeroCrossings / 2) / durationSec : 0;

    const avgForce = dataWindow.reduce((acc, d) => acc + d.fsr, 0) / dataWindow.length;

    return { rms, frequency, avgForce, variance };
  }

  /**
   * Run inference using the loaded model or a fallback heuristic.
   * Returns a severity score (0 to 4).
   */
  async predictSeverity(features: TremorFeatures): Promise<number> {
    if (this.isModelLoaded && this.model) {
      try {
        // Adjust the input tensor shape to match your Colab model's expected input
        const inputTensor = tf.tensor2d([[
          features.rms,
          features.frequency,
          features.avgForce,
          features.variance
        ]]);

        const prediction = this.model.predict(inputTensor) as tf.Tensor;
        const scoreData = await prediction.data();
        
        inputTensor.dispose();
        prediction.dispose();
        
        // Assuming the model outputs a single continuous value or class probability
        return scoreData[0]; 
      } catch (error) {
        console.error('Inference error, falling back to heuristic:', error);
        return this.heuristicPrediction(features);
      }
    } else {
      return this.heuristicPrediction(features);
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

    // Increased sensitivity (lowered thresholds)
    if (features.rms > 0.05) severity = 1;
    if (features.rms > 0.2) severity = 2;
    if (features.rms > 0.6) severity = 3;
    if (features.rms > 1.2) severity = 4;

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
