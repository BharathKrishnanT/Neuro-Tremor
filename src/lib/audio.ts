class AudioFeedbackService {
  private audioCtx: AudioContext | null = null;

  private init() {
    // Only initialize upon first user interaction
    if (!this.audioCtx) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          this.audioCtx = new AudioContextClass();
        }
      } catch (e) {
        console.warn('AudioContext not supported');
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  private playTone(frequency: number, type: OscillatorType, duration: number, volume: number) {
    try {
      this.init();
      if (!this.audioCtx) return;

      const osc = this.audioCtx.createOscillator();
      const gainNode = this.audioCtx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(frequency, this.audioCtx.currentTime);

      gainNode.gain.setValueAtTime(volume, this.audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);

      osc.connect(gainNode);
      gainNode.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + duration);
    } catch (e) {
      console.warn('Audio feedback failed', e);
    }
  }

  public playStartRecording() {
    this.playTone(440, 'sine', 0.15, 0.1); // A4
    setTimeout(() => this.playTone(880, 'sine', 0.3, 0.1), 150); // A5
  }

  public playStopRecording() {
    this.playTone(880, 'sine', 0.15, 0.1); // A5
    setTimeout(() => this.playTone(440, 'sine', 0.3, 0.1), 150); // A4
  }

  public playThresholdCrossed(intensity: string) {
    // Different feedback based on crossing into different regions
    if (intensity === 'Severe') {
      this.playTone(300, 'triangle', 0.2, 0.1);
      setTimeout(() => this.playTone(300, 'triangle', 0.3, 0.1), 250);
    } else if (intensity === 'Moderate') {
      this.playTone(400, 'sine', 0.3, 0.05);
    } else if (intensity === 'Mild') {
      this.playTone(500, 'sine', 0.2, 0.03);
    }
  }
}

export const audioFeedback = new AudioFeedbackService();
