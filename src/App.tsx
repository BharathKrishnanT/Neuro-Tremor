import React, { useState, useEffect, useRef, useCallback } from 'react';
import { serialService, SensorData } from './lib/serial';
import { bleService } from './lib/ble';
import { wifiService } from './lib/wifi';
import { mobileSensorService } from './lib/mobileSensors';
import { mlService } from './lib/mlService';
import { audioFeedback } from './lib/audio';
import { exportService } from './lib/exportService';
import { LiveChart } from './components/LiveChart';
import { TremorAnalysis } from './components/TremorAnalysis';
import { DatasetUploader } from './components/DatasetUploader';
import { DatasetSummary } from './components/DatasetSummary';
import { RecoveryTrendChart } from './components/RecoveryTrendChart';
import { TouchPadCanvas } from './components/TouchPadCanvas';
import { Activity, Bluetooth, Cable, Play, Square, Save, Trash2, Settings, ExternalLink, AlertCircle, Upload, TrendingUp, Pause, Smartphone, FileText, LogIn, LogOut, Wifi, Target, Sun, Moon } from 'lucide-react';
import { generateClinicalReport } from './lib/reportGenerator';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { auth, db, signInWithGoogle, logOut, collection, doc, setDoc, onSnapshot, query, where, orderBy, deleteDoc } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

export interface Session {
  id: string;
  userId: string;
  timestamp: number;
  duration: number;
  severity: string;
  stage: string;
  rms: number;
  frequency: number;
  data: SensorData[];
}

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionType, setConnectionType] = useState<'serial' | 'ble' | 'wifi' | 'sim' | 'mobile' | 'touch' | 'ble-touch' | 'serial-touch' | 'wifi-touch' | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [data, setData] = useState<SensorData[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedSessions, setRecordedSessions] = useState<Session[]>([]);
  const [permissionError, setPermissionError] = useState(false);
  const [mlSeverity, setMlSeverity] = useState<number>(0);
  const isInferenceRunning = useRef(false);
  const lastInferenceTime = useRef<number>(0);
  const [loadedDataset, setLoadedDataset] = useState<SensorData[] | null>(null);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [isPlayingDataset, setIsPlayingDataset] = useState(false);
  const [isPausedDataset, setIsPausedDataset] = useState(false);
  const [isPausedRealTime, setIsPausedRealTime] = useState(false);
  const isPausedRealTimeRef = useRef(false);

  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationTimeLeft, setCalibrationTimeLeft] = useState(0);
  const isCalibratingRef = useRef(false);
  const calibrationBuffer = useRef<{ax: number, ay: number, az: number, gx: number, gy: number, gz: number}[]>([]);
  const calibrationOffsets = useRef({ax: 0, ay: 0, az: 0, gx: 0, gy: 0, gz: 0});
  const calibrationTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    isPausedRealTimeRef.current = isPausedRealTime;
  }, [isPausedRealTime]);

  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isHighContrast, setIsHighContrast] = useState(() => {
    return document.documentElement.classList.contains('light-theme');
  });

  useEffect(() => {
    if (isHighContrast) {
      document.documentElement.classList.add('light-theme');
    } else {
      document.documentElement.classList.remove('light-theme');
    }
  }, [isHighContrast]);
  const [errorModal, setErrorModal] = useState<{title: string, message: string} | null>(null);
  const [confirmModal, setConfirmModal] = useState<{title: string, message: string, onConfirm: () => void} | null>(null);
  const [showPenModal, setShowPenModal] = useState(false);
  const [isStreamingExport, setIsStreamingExport] = useState(false);
  const [exportFormat, setExportFormat] = useState<'csv'|'json'>('csv');
  const [exportDuration, setExportDuration] = useState<number>(0);
  const latestTouchRef = useRef<{x: number, y: number} | null>(null);
  
  const simulationInterval = useRef<NodeJS.Timeout | null>(null);
  const playbackInterval = useRef<NodeJS.Timeout | null>(null);
  const uiUpdateInterval = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const recordingBuffer = useRef<SensorData[]>([]);
  const uiBuffer = useRef<SensorData[]>([]);
  const recordingStartTime = useRef<number>(0);

  // Data buffer limit
  const MAX_POINTS = 100;

  // Decouple high-frequency data from React state updates
  useEffect(() => {
    uiUpdateInterval.current = setInterval(() => {
      if (uiBuffer.current.length === 0) return;
      
      const newPoints = [...uiBuffer.current];
      uiBuffer.current = [];

      if (isPausedRealTimeRef.current) return;

      setData(prev => {
        const updated = [...prev, ...newPoints];
        if (updated.length > MAX_POINTS) {
          return updated.slice(updated.length - MAX_POINTS);
        }
        return updated;
      });
    }, 100); // Update UI at 10Hz

    return () => {
      if (uiUpdateInterval.current) clearInterval(uiUpdateInterval.current);
    };
  }, []);

  // Initialize ML Model
  useEffect(() => {
    mlService.initModel().then((success) => {
      if (success) {
        console.log("ML Model loaded successfully");
      }
    });
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Load sessions from Firestore
  useEffect(() => {
    if (!isAuthReady) return;
    if (!user) {
      setRecordedSessions([]);
      return;
    }

    const q = query(
      collection(db, 'sessions'),
      where('userId', '==', user.uid),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sessions: Session[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        try {
          sessions.push({
            id: data.id,
            userId: data.userId,
            timestamp: data.timestamp,
            duration: data.duration,
            severity: data.severity,
            stage: data.stage,
            rms: data.rms,
            frequency: data.frequency,
            data: JSON.parse(data.data)
          });
        } catch (e) {
          console.error("Failed to parse session data", e);
        }
      });
      setRecordedSessions(sessions);
    }, (error) => {
      console.error("Firestore Error: ", error);
    });

    return () => unsubscribe();
  }, [user, isAuthReady]);

  // Run ML Inference periodically
  useEffect(() => {
    if (data.length < 20) return;
    
    const now = Date.now();
    // Run inference frequently (every 50ms) to reduce latency
    if (now - lastInferenceTime.current < 50) return;
    
    lastInferenceTime.current = now;
    
    const runInference = async () => {
      if (isInferenceRunning.current) return;
      isInferenceRunning.current = true;
      try {
        const deviceType = connectionType === 'mobile' ? 'mobile' : 'pen';
        const features = mlService.extractFeatures(data, deviceType);
        const severity = await mlService.predictSeverity(data, features, deviceType);
        if (!Number.isNaN(severity)) {
          setMlSeverity(severity);
        }
      } catch (error) {
        console.error('Inference error:', error);
      } finally {
        isInferenceRunning.current = false;
      }
    };

    runInference();
  }, [data, connectionType]); // Run when data updates, throttled to 50ms

  // Metrics calculation
  const metrics = React.useMemo(() => {
    if (data.length < 10) return { rms: 0, frequency: 0, intensity: 'Normal', stage: 'Normal', recoveryRate: 0 };

    const deviceType = connectionType === 'mobile' ? 'mobile' : 'pen';
    const features = mlService.extractFeatures(data, deviceType);
    
    // Calculate immediate heuristic severity for zero-latency UI updates
    const immediateSeverity = mlService.heuristicPrediction(features, deviceType);
    
    // Use the immediate severity for the stage to ensure < 5ms latency
    const stage = mlService.getStage(immediateSeverity);
    
    let intensity = 'Normal';
    if (immediateSeverity >= 3) intensity = 'Severe';
    else if (immediateSeverity >= 2) intensity = 'Moderate';
    else if (immediateSeverity >= 1) intensity = 'Mild';

    // Calculate recovery rate compared to the very first session
    let recoveryRate = 0;
    if (recordedSessions.length > 0) {
      const firstSession = recordedSessions[recordedSessions.length - 1];
      if (firstSession.rms > 0 && !Number.isNaN(features.rms)) {
        // Recovery is positive if current RMS is lower than initial
        recoveryRate = ((firstSession.rms - features.rms) / firstSession.rms) * 100;
      }
    }

    return { 
      rms: Number.isNaN(features.rms) ? 0 : features.rms, 
      frequency: Number.isNaN(features.frequency) ? 0 : features.frequency, 
      intensity, 
      stage, 
      recoveryRate: Number.isNaN(recoveryRate) ? 0 : recoveryRate 
    };
  }, [data, recordedSessions, connectionType]);

  const [isIframe, setIsIframe] = useState(false);

  // Audio feedback for threshold crossing
  const previousIntensityRef = useRef<string>('Normal');
  useEffect(() => {
    if (metrics.intensity !== previousIntensityRef.current) {
      if ((metrics.intensity === 'Severe' && previousIntensityRef.current !== 'Severe') || 
          (metrics.intensity === 'Moderate' && previousIntensityRef.current === 'Mild') ||
          (metrics.intensity === 'Moderate' && previousIntensityRef.current === 'Normal')) {
        audioFeedback.playThresholdCrossed(metrics.intensity);
      }
      previousIntensityRef.current = metrics.intensity;
    }
  }, [metrics.intensity]);

  // Screen Wake Lock to keep mobile monitoring continuous
  useEffect(() => {
    let wakeLock: any = null;
    
    const requestWakeLock = async () => {
      if ('wakeLock' in navigator && isConnected) {
        try {
          wakeLock = await (navigator as any).wakeLock.request('screen');
          console.log('Wake Lock is active');
        } catch (err: any) {
          if (err.name === 'NotAllowedError') {
            console.warn('Wake Lock is not allowed in this environment (e.g., iframe without permission policy).');
          } else {
            console.warn(`Wake Lock error: ${err.name}, ${err.message}`);
          }
        }
      }
    };

    const releaseWakeLock = async () => {
      if (wakeLock !== null) {
        try {
          await wakeLock.release();
          wakeLock = null;
          console.log('Wake Lock is released');
        } catch (err) {
          console.error(err);
        }
      }
    };

    if (isConnected) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isConnected) {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [isConnected]);

  useEffect(() => {
    try {
      if (window.self !== window.top) {
        setIsIframe(true);
      }
    } catch (e) {
      setIsIframe(true);
    }
  }, []);

  const [hasGyro, setHasGyro] = useState(false);
  const [hasMag, setHasMag] = useState(false);

  const handleData = useCallback((newData: SensorData) => {
    let finalData = newData;

    if (isCalibratingRef.current) {
      calibrationBuffer.current.push({
        ax: newData.ax, ay: newData.ay, az: newData.az,
        gx: newData.gx, gy: newData.gy, gz: newData.gz
      });
    }

    // Apply baseline offsets
    finalData = {
      ...finalData,
      ax: finalData.ax - calibrationOffsets.current.ax,
      ay: finalData.ay - calibrationOffsets.current.ay,
      az: finalData.az - calibrationOffsets.current.az,
      gx: finalData.gx - calibrationOffsets.current.gx,
      gy: finalData.gy - calibrationOffsets.current.gy,
      gz: finalData.gz - calibrationOffsets.current.gz,
    };
    
    // Inject the latest touch coordinates from the canvas for any non-touch-only connection
    if (connectionType !== 'touch' && latestTouchRef.current) {
      finalData = {
        ...finalData,
        touchX: latestTouchRef.current.x,
        touchY: latestTouchRef.current.y
      };
    }

    uiBuffer.current.push(finalData);
    
    if (isRecording) {
      recordingBuffer.current.push(finalData);
    }
    
    if (exportService.isWriting) {
      exportService.writeData(finalData);
    }

    if (!hasGyro && (Math.abs(finalData.gx) > 0.01 || Math.abs(finalData.gy) > 0.01 || Math.abs(finalData.gz) > 0.01)) {
      setHasGyro(true);
    }
    if (!hasMag && (Math.abs(finalData.mx) > 0.01 || Math.abs(finalData.my) > 0.01 || Math.abs(finalData.mz) > 0.01)) {
      setHasMag(true);
    }
  }, [hasGyro, hasMag, isRecording, connectionType]);

  useEffect(() => {
    // Serial Listeners
    serialService.onData(handleData);
    serialService.onError((err) => {
      console.error("Serial Error:", err);
      setIsConnected(false);
      setConnectionType(null);
    });

    // BLE Listeners
    bleService.onData(handleData);
    bleService.onError((err) => {
      console.error("BLE Error:", err);
      setIsConnected(false);
      setConnectionType(null);
    });

    // WiFi Listeners
    wifiService.onData(handleData);
    wifiService.onError((err) => {
      console.error("WiFi Error:", err);
      setIsConnected(false);
      setConnectionType(null);
    });
    wifiService.onDisconnect(() => {
      setIsConnected(false);
      setConnectionType(null);
    });

    // Mobile Listeners
    mobileSensorService.onData(handleData);
    mobileSensorService.onError((err) => {
      console.error("Mobile Sensor Error:", err);
      setIsConnected(false);
      setConnectionType(null);
    });
  }, [handleData]);

  // Cleanup connections only on component unmount
  useEffect(() => {
    return () => {
      serialService.disconnect();
      bleService.disconnect();
      mobileSensorService.stop();
    };
  }, []);

  const connectSerial = async (combined: boolean = false) => {
    try {
      setPermissionError(false);
      await serialService.connect();
      setIsConnected(true);
      setConnectionType(combined ? 'serial-touch' : 'serial');
      setIsSimulating(false);
    } catch (err: any) {
      console.error(err);
      if (err.name === 'SecurityError' || err.message?.includes('permissions policy')) {
        setPermissionError(true);
      } else {
        alert("Failed to connect to serial device. " + err.message);
      }
    }
  };

  const connectWiFi = async (combined: boolean = false) => {
    try {
      setPermissionError(false);
      await wifiService.connect('192.168.4.1');
      setIsConnected(true);
      setConnectionType(combined ? 'wifi-touch' : 'wifi');
      setIsSimulating(false);
    } catch (err: any) {
      console.error(err);
      if (err.name === 'SecurityError' || err.message?.includes('mixed content')) {
        setPermissionError(true);
      } else {
        alert("Failed to connect to WiFi device. " + err.message);
      }
    }
  };

  const connectBLE = async (combined: boolean = false) => {
    try {
      setPermissionError(false);
      await bleService.connect();
      setIsConnected(true);
      setConnectionType(combined ? 'ble-touch' : 'ble');
      setIsSimulating(false);
    } catch (err: any) {
      console.error(err);
      if (err.name === 'SecurityError' || err.message?.includes('permissions policy')) {
        setPermissionError(true);
      } else {
        alert("Failed to connect via Bluetooth. " + err.message);
      }
    }
  };

  const connectMobile = async () => {
    try {
      setPermissionError(false);
      await mobileSensorService.start();
      setIsConnected(true);
      setConnectionType('mobile');
      setIsSimulating(false);
    } catch (err: any) {
      console.error(err);
      alert("Failed to access mobile sensors. " + err.message);
    }
  };

  const disconnect = async () => {
    if (connectionType && connectionType.includes('serial')) await serialService.disconnect();
    if (connectionType && connectionType.includes('ble')) await bleService.disconnect();
    if (connectionType && connectionType.includes('wifi')) wifiService.disconnect();
    if (connectionType === 'mobile') mobileSensorService.stop();
    if (isSimulating) {
      if (simulationInterval.current) clearInterval(simulationInterval.current);
      setIsSimulating(false);
    }
    stopDatasetPlayback();
    setIsConnected(false);
    setConnectionType(null);
  };

  const stopDatasetPlayback = useCallback(() => {
    if (playbackInterval.current) {
      clearInterval(playbackInterval.current);
      playbackInterval.current = null;
    }
    setIsPlayingDataset(false);
    setIsPausedDataset(false);
  }, []);

  const pauseDatasetPlayback = () => {
    if (playbackInterval.current) {
      clearInterval(playbackInterval.current);
      playbackInterval.current = null;
    }
    setIsPausedDataset(true);
  };

  const resumeDatasetPlayback = () => {
    if (!loadedDataset) return;
    setIsPausedDataset(false);
    
    let index = playbackIndex;
    playbackInterval.current = setInterval(() => {
      if (index < loadedDataset.length) {
        handleData(loadedDataset[index]);
        setPlaybackIndex(index);
        index++;
      } else {
        stopDatasetPlayback();
      }
    }, 5);
  };

  const startDatasetPlayback = (dataset: SensorData[]) => {
    if (isSimulating) {
      if (simulationInterval.current) clearInterval(simulationInterval.current);
      setIsSimulating(false);
    }
    stopDatasetPlayback();
    setData([]);
    setPlaybackIndex(0);
    setIsPlayingDataset(true);
    setIsPausedDataset(false);
    setIsConnected(true);
    setConnectionType('sim'); // Use 'sim' as a placeholder for dataset playback
    
    let index = 0;
    playbackInterval.current = setInterval(() => {
      if (index < dataset.length) {
        handleData(dataset[index]);
        setPlaybackIndex(index);
        index++;
      } else {
        stopDatasetPlayback();
      }
    }, 5); // 200Hz playback
  };

  const toggleSimulation = () => {
    if (isSimulating) {
      if (simulationInterval.current) clearInterval(simulationInterval.current);
      setIsSimulating(false);
      setIsConnected(false);
      setConnectionType(null);
    } else {
      setIsSimulating(true);
      setIsConnected(true);
      setConnectionType('sim');
      startTimeRef.current = Date.now();
      
      simulationInterval.current = setInterval(() => {
        const t = (Date.now() - startTimeRef.current) / 1000;
        // Simulate Parkinson's tremor (approx 5Hz) + some noise + gravity
        const tremor = Math.sin(t * 5 * Math.PI * 2) * 0.5; // 5Hz tremor
        const noise = (Math.random() - 0.5) * 0.1;
        
        const fakeData: SensorData = {
          timestamp: Date.now(),
          ax: tremor + noise,
          ay: noise + 0.2,
          az: 9.8 + noise, // Gravity
          gx: Math.cos(t * 5 * Math.PI * 2) * 20 + noise,
          gy: noise,
          gz: noise,
          mx: Math.sin(t) * 50,
          my: Math.cos(t) * 50,
          mz: noise * 10,
          fsr: Math.abs(Math.sin(t) * 500) + 100 // Fluctuating grip pressure
        };
        handleData(fakeData);
      }, 5); // 200Hz update rate
    }
  };

  const clearData = () => {
    setData([]);
  };

  const startCalibration = () => {
    if (isCalibratingRef.current || !isConnected) return;
    
    isCalibratingRef.current = true;
    setIsCalibrating(true);
    setCalibrationTimeLeft(3);
    calibrationBuffer.current = [];
    calibrationOffsets.current = { ax: 0, ay: 0, az: 0, gx: 0, gy: 0, gz: 0 }; // Reset during calibration to get raw values

    let timeLeft = 3;
    calibrationTimer.current = setInterval(() => {
      timeLeft -= 1;
      setCalibrationTimeLeft(timeLeft);
      if (timeLeft <= 0) {
        if (calibrationTimer.current) clearInterval(calibrationTimer.current);
        isCalibratingRef.current = false;
        setIsCalibrating(false);
        
        if (calibrationBuffer.current.length > 0) {
          const sum = calibrationBuffer.current.reduce((acc, val) => {
            acc.ax += val.ax; acc.ay += val.ay; acc.az += val.az;
            acc.gx += val.gx; acc.gy += val.gy; acc.gz += val.gz;
            return acc;
          }, {ax: 0, ay: 0, az: 0, gx: 0, gy: 0, gz: 0});
          
          const count = calibrationBuffer.current.length;
          calibrationOffsets.current = {
            ax: sum.ax / count, ay: sum.ay / count, az: sum.az / count,
            gx: sum.gx / count, gy: sum.gy / count, gz: sum.gz / count
          };
        }
      }
    }, 1000);
  };

  const exportSession = () => {
    if (data.length === 0) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tremor-session-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') {
        return; // User intentionally closed the popup, ignore
      }
      console.error("Sign in failed:", error);
      setErrorModal({
        title: "Sign In Failed",
        message: `Authentication failed: ${error.message}. If you are using a browser that blocks third-party cookies or popups, please try clicking "Open in New Tab" at the top right of the preview window.`
      });
    }
  };

  return (
    <div className="min-h-screen bg-black text-zinc-200 font-sans selection:bg-emerald-500/30">
      
      {/* Error Modal */}
      {errorModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-red-500/30 rounded-2xl max-w-md w-full p-6 shadow-2xl shadow-red-900/20">
            <div className="flex items-center space-x-3 mb-4 text-red-400">
              <AlertCircle size={32} />
              <h3 className="text-xl font-semibold">{errorModal.title}</h3>
            </div>
            <p className="text-zinc-300 mb-6 leading-relaxed">
              {errorModal.message}
            </p>
            <div className="flex space-x-3">
              <button 
                onClick={() => setErrorModal(null)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-yellow-500/30 rounded-2xl max-w-md w-full p-6 shadow-2xl shadow-yellow-900/20">
            <div className="flex items-center space-x-3 mb-4 text-yellow-400">
              <AlertCircle size={32} />
              <h3 className="text-xl font-semibold">{confirmModal.title}</h3>
            </div>
            <p className="text-zinc-300 mb-6 leading-relaxed">
              {confirmModal.message}
            </p>
            <div className="flex space-x-3">
              <button 
                onClick={() => setConfirmModal(null)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pen/Touch Input Selection Modal */}
      {showPenModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-purple-500/30 rounded-2xl max-w-md w-full p-6 shadow-2xl shadow-purple-900/20">
            <div className="flex items-center space-x-3 mb-4 text-purple-400">
              <FileText size={32} />
              <h3 className="text-xl font-semibold">Connect Pen or Touch Pad</h3>
            </div>
            <p className="text-zinc-300 mb-6 leading-relaxed">
              Choose your preferred input method to analyze tremors.
            </p>
            <div className="flex flex-col space-y-3">
              <button 
                onClick={() => {
                  setShowPenModal(false);
                  setIsConnected(true);
                  setConnectionType('touch');
                  setIsSimulating(false);
                  setData([]);
                  setConfirmModal({
                    title: "Touch Pad / Pen Mode",
                    message: "Draw spirals or lines in the white area below to analyze tremors using your connected touch pad, mouse, or digital pen.",
                    onConfirm: () => {}
                  });
                }}
                className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-medium transition-colors border border-zinc-700"
              >
                <div className="bg-zinc-700 p-2 rounded-lg">
                  <FileText size={20} className="text-zinc-300" />
                </div>
                <div className="text-left flex-1">
                  <div className="font-semibold">Use Device Touch Pad</div>
                  <div className="text-xs text-zinc-400 font-normal">Draw directly with mouse or OS pen</div>
                </div>
              </button>
              
              <button 
                onClick={() => {
                  setShowPenModal(false);
                  connectBLE();
                }}
                className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-medium transition-colors border border-zinc-700"
              >
                <div className="bg-blue-600/20 p-2 rounded-lg">
                  <Bluetooth size={20} className="text-blue-400" />
                </div>
                <div className="text-left flex-1">
                  <div className="font-semibold">Connect Custom ESP32 Pen</div>
                  <div className="text-xs text-zinc-400 font-normal">Connect custom hardware via Web Bluetooth</div>
                </div>
              </button>
              
              <button 
                onClick={() => {
                  setShowPenModal(false);
                  connectBLE(true);
                  setConfirmModal({
                    title: "Combined Mode Enabled (Bluetooth)",
                    message: "You are now using the ESP32 Pen with the Touch Pad via Bluetooth. Draw on the canvas using your paired custom pen to combine high-fidelity device sensors with precise spatial tracking.",
                    onConfirm: () => {}
                  });
                }}
                className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-white font-medium transition-colors border border-purple-500/50"
              >
                <div className="bg-purple-600/40 p-2 rounded-lg">
                  <div className="flex items-center space-x-1">
                    <Bluetooth size={16} className="text-purple-300" />
                    <FileText size={16} className="text-purple-300" />
                  </div>
                </div>
                <div className="text-left flex-1">
                  <div className="font-semibold text-purple-200">Combined Mode (Bluetooth)</div>
                  <div className="text-xs text-purple-300/80 font-normal">Use BLE ESP32 Pen + Touch Pad Canvas</div>
                </div>
              </button>
              
              <button 
                onClick={() => {
                  setShowPenModal(false);
                  connectSerial(true);
                  setConfirmModal({
                    title: "Combined Mode Enabled (USB)",
                    message: "You are now using the ESP32 Pen with the Touch Pad via USB. Draw on the canvas using your paired custom pen to combine high-fidelity device sensors with precise spatial tracking.",
                    onConfirm: () => {}
                  });
                }}
                className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-white font-medium transition-colors border border-purple-500/50"
              >
                <div className="bg-purple-600/40 p-2 rounded-lg">
                  <div className="flex items-center space-x-1">
                    <Cable size={16} className="text-purple-300" />
                    <FileText size={16} className="text-purple-300" />
                  </div>
                </div>
                <div className="text-left flex-1">
                  <div className="font-semibold text-purple-200">Combined Mode (USB)</div>
                  <div className="text-xs text-purple-300/80 font-normal">Use USB ESP32 Pen + Touch Pad Canvas</div>
                </div>
              </button>
              
              <button 
                onClick={() => setShowPenModal(false)}
                className="w-full mt-2 px-4 py-2.5 rounded-xl bg-transparent hover:bg-zinc-800 text-zinc-400 font-medium transition-colors border border-transparent"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Iframe Warning Banner */}
      {isIframe && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-2 text-center">
          <p className="text-sm text-yellow-200 flex items-center justify-center gap-2">
            <AlertCircle size={16} />
            <span>Hardware access is restricted in this preview.</span>
            <a 
              href={window.location.href} 
              target="_blank" 
              rel="noopener noreferrer"
              className="underline font-medium hover:text-white flex items-center gap-1"
            >
              Open in New Tab <ExternalLink size={12} />
            </a>
          </p>
        </div>
      )}

      {/* Permission Error Modal */}
      {permissionError && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-red-500/30 rounded-2xl max-w-md w-full p-6 shadow-2xl shadow-red-900/20">
            <div className="flex items-center space-x-3 mb-4 text-red-400">
              <AlertCircle size={32} />
              <h3 className="text-xl font-semibold">Connection Blocked</h3>
            </div>
            <p className="text-zinc-300 mb-6 leading-relaxed">
              The browser blocked access to USB/Bluetooth devices because this app is running inside a preview frame.
            </p>
            <div className="bg-zinc-950/50 rounded-lg p-4 mb-6 border border-zinc-800">
              <p className="text-sm text-zinc-400 mb-2">To fix this:</p>
              <ol className="list-decimal list-inside space-y-2 text-zinc-300 text-sm">
                <li>Click the <strong className="text-white">Open in New Tab</strong> button below</li>
                <li>Connect your device in the new window</li>
              </ol>
            </div>
            <div className="flex space-x-3">
              <button 
                onClick={() => setPermissionError(false)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium transition-colors"
              >
                Dismiss
              </button>
              <a 
                href={window.location.href} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors shadow-lg shadow-emerald-900/20"
              >
                <span>Open in New Tab</span>
                <ExternalLink size={16} />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center space-x-3 w-full sm:w-auto justify-between sm:justify-start">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <Activity className="text-black" size={20} />
              </div>
              <h1 className="text-lg font-semibold tracking-tight text-white">NeuroTremor</h1>
            </div>
            
            {/* Mobile-only status pill */}
            <div className={`sm:hidden flex items-center space-x-2 px-2 py-1 rounded-full text-[10px] font-medium border ${isConnected ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-500'}`} />
              <span>{isConnected ? (connectionType === 'mobile' ? 'MOBILE' : 'CONNECTED') : 'DISCONNECTED'}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center sm:justify-end gap-2 w-full sm:w-auto">
            {/* Desktop status pill */}
            <div className={`hidden sm:flex items-center space-x-2 px-3 py-1.5 rounded-full text-xs font-medium border ${isConnected ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-500'}`} />
              <span>{isConnected ? (isPlayingDataset ? 'PLAYING DATASET' : isSimulating ? 'SIMULATING' : (connectionType && connectionType.includes('touch')) ? 'COMBINED MODE' : connectionType === 'ble' ? 'CUSTOM BLE DEV' : connectionType === 'wifi' ? 'WIFI CONNECTED' : connectionType === 'mobile' ? 'MOBILE SENSORS' : 'USB CONNECTED') : 'DISCONNECTED'}</span>
            </div>

            {!isConnected ? (
              <div className="flex flex-wrap justify-center gap-2">
                <DatasetUploader 
                  onDataLoaded={(dataset) => {
                    setLoadedDataset(dataset);
                    startDatasetPlayback(dataset);
                  }}
                  onError={(msg) => setErrorModal({ title: "Dataset Error", message: msg })}
                />
                <button 
                  onClick={connectSerial}
                  className="flex items-center space-x-1.5 px-3 py-2 bg-white text-black rounded-lg hover:bg-zinc-200 transition-colors text-sm font-medium"
                  title="Connect via USB Cable"
                >
                  <Cable size={16} />
                  <span className="hidden md:inline">USB</span>
                </button>
                <button 
                  onClick={connectMobile}
                  className="flex items-center space-x-1.5 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors text-sm font-medium"
                  title="Use Mobile Sensors"
                >
                  <Smartphone size={16} />
                  <span className="hidden md:inline">Mobile</span>
                </button>
                <button 
                  onClick={() => setShowPenModal(true)}
                  className="flex items-center space-x-1.5 px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-500 transition-colors text-sm font-medium"
                  title="Connect Pen or Touch Pad"
                >
                  <FileText size={16} />
                  <span className="hidden md:inline">Pen/Touch</span>
                </button>
                <button 
                  onClick={toggleSimulation}
                  className="flex items-center space-x-1.5 px-3 py-2 bg-zinc-800 text-zinc-300 border border-zinc-700 rounded-lg hover:bg-zinc-700 transition-colors text-sm font-medium"
                  title="Run Demo Simulation"
                >
                  <Play size={16} />
                  <span className="hidden md:inline">Demo</span>
                </button>
              </div>
            ) : (
              <div className="flex space-x-2">
                {!isPlayingDataset && (
                  <button
                    onClick={startCalibration}
                    disabled={isCalibrating}
                    className={`flex items-center space-x-2 px-4 py-2 border rounded-lg transition-colors text-sm font-medium ${
                      isCalibrating ? 'bg-amber-500/20 border-amber-500/30 text-amber-500' : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700'
                    }`}
                  >
                    <Target size={16} className={isCalibrating ? 'animate-pulse' : ''} />
                    <span>{isCalibrating ? `Calibrating (${calibrationTimeLeft}s)` : 'Calibrate Baseline'}</span>
                  </button>
                )}
                <button 
                  onClick={disconnect}
                  className="flex items-center space-x-2 px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors text-sm font-medium"
                >
                  <Square size={16} />
                  <span>{isPlayingDataset ? 'Stop Playback' : isSimulating ? 'Stop Demo' : 'Disconnect'}</span>
                </button>
              </div>
            )}

            <div className="h-6 w-px bg-zinc-800 hidden sm:block mx-1"></div>

            <button
              onClick={() => setIsHighContrast(!isHighContrast)}
              className="flex items-center space-x-1.5 px-3 py-2 bg-zinc-800 text-zinc-300 border border-zinc-700 rounded-lg hover:bg-zinc-700 transition-colors text-sm font-medium"
              title={isHighContrast ? "Switch to Dark Mode" : "Switch to High Contrast Light Mode"}
            >
              {isHighContrast ? <Moon size={16} /> : <Sun size={16} />}
              <span className="hidden md:inline">{isHighContrast ? 'Dark' : 'Light'}</span>
            </button>

            {user ? (
              <button 
                onClick={logOut}
                className="flex items-center space-x-1.5 px-3 py-2 bg-zinc-800 text-zinc-300 border border-zinc-700 rounded-lg hover:bg-zinc-700 transition-colors text-sm font-medium"
                title="Sign Out"
              >
                <img src={user.photoURL || ''} alt="User" className="w-4 h-4 rounded-full" />
                <span className="hidden md:inline">Sign Out</span>
              </button>
            ) : (
              <button 
                onClick={handleSignIn}
                className="flex items-center space-x-1.5 px-3 py-2 bg-zinc-800 text-zinc-300 border border-zinc-700 rounded-lg hover:bg-zinc-700 transition-colors text-sm font-medium"
                title="Sign In with Google"
              >
                <LogIn size={16} />
                <span className="hidden md:inline">Sign In</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        
        {isPlayingDataset && loadedDataset && (
          <div className="mb-8 bg-zinc-900 border border-emerald-500/20 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">Dataset Playback Progress</span>
                <div className="text-xs text-zinc-500 mt-1">{playbackIndex + 1} / {loadedDataset.length} points</div>
              </div>
              <div className="flex space-x-2">
                {isPausedDataset ? (
                  <button 
                    onClick={resumeDatasetPlayback}
                    className="flex items-center space-x-2 px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors text-xs font-medium"
                  >
                    <Play size={14} />
                    <span>Resume</span>
                  </button>
                ) : (
                  <button 
                    onClick={pauseDatasetPlayback}
                    className="flex items-center space-x-2 px-3 py-1.5 bg-zinc-800 text-zinc-300 border border-zinc-700 rounded-lg hover:bg-zinc-700 transition-colors text-xs font-medium"
                  >
                    <Pause size={14} />
                    <span>Pause</span>
                  </button>
                )}
                <button 
                  onClick={stopDatasetPlayback}
                  className="flex items-center space-x-2 px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors text-xs font-medium"
                >
                  <Square size={14} />
                  <span>Stop</span>
                </button>
              </div>
            </div>
            <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
              <div 
                className="bg-emerald-500 h-full transition-all duration-300 ease-linear"
                style={{ width: `${((playbackIndex + 1) / loadedDataset.length) * 100}%` }}
              />
            </div>
          </div>
        )}

        {isPausedDataset && (
          <DatasetSummary 
            data={data} 
            title="Analysis of Data Analysed Until Pause"
            onPlay={resumeDatasetPlayback}
            onClear={() => {
              setLoadedDataset(null);
              stopDatasetPlayback();
            }}
          />
        )}

        {loadedDataset && !isPlayingDataset && (
          <DatasetSummary 
            data={loadedDataset} 
            onPlay={() => startDatasetPlayback(loadedDataset)}
            onClear={() => setLoadedDataset(null)}
          />
        )}

        {isConnected && connectionType !== 'sim' && data.length > 0 && (
          <div className="mb-8 bg-zinc-900 border border-blue-500/20 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-xs font-medium text-blue-400 uppercase tracking-wider">Real-Time Analysis Live</span>
                <div className="text-xs text-zinc-500 mt-1">Collecting data from {connectionType?.includes('touch') ? 'Touch Pad & Pen' : connectionType === 'mobile' ? 'Mobile' : 'Device'}</div>
              </div>
              <div className="flex space-x-2">
                {isPausedRealTime ? (
                  <button 
                    onClick={() => setIsPausedRealTime(false)}
                    className="flex items-center space-x-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors text-xs font-medium"
                  >
                    <Play size={14} />
                    <span>Resume</span>
                  </button>
                ) : (
                  <button 
                    onClick={() => setIsPausedRealTime(true)}
                    className="flex items-center space-x-2 px-3 py-1.5 bg-zinc-800 text-zinc-300 border border-zinc-700 rounded-lg hover:bg-zinc-700 transition-colors text-xs font-medium"
                  >
                    <Pause size={14} />
                    <span>Pause</span>
                  </button>
                )}
                <button 
                  onClick={() => {
                    setIsPausedRealTime(false);
                    setLoadedDataset(data);
                    disconnect();
                  }}
                  className="flex items-center space-x-2 px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors text-xs font-medium"
                >
                  <Square size={14} />
                  <span>Stop Analysis</span>
                </button>
              </div>
            </div>
            {isPausedRealTime && (
              <p className="text-xs text-zinc-400 mt-2 italic">Chart paused, but sensor stream is ongoing in background.</p>
            )}
          </div>
        )}

        {isConnected && isPausedRealTime && (
          <DatasetSummary 
            data={data} 
            title="Analysis of Data Analysed Until Pause"
            onPlay={() => setIsPausedRealTime(false)}
            onClear={() => {
               // Do nothing for clear during live
            }}
          />
        )}
        
        {/* Metrics */}
        <TremorAnalysis metrics={metrics} />

        {/* Recovery Trend Section */}
        <div className="mb-8">
          <RecoveryTrendChart sessions={recordedSessions} />
        </div>

        {isConnected && (
          <TouchPadCanvas 
            onData={handleData} 
            mode={connectionType === 'touch' ? 'touch' : 'combined'}
            onTouchUpdate={(x, y, pressure) => {
              latestTouchRef.current = { x, y };
            }}
          />
        )}

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="space-y-6">
            <LiveChart 
              title="Accelerometer (G-Force)" 
              data={data}
              dataKeys={[
                { key: 'ax', color: '#ef4444', name: 'X Axis' },
                { key: 'ay', color: '#22c55e', name: 'Y Axis' },
                { key: 'az', color: '#3b82f6', name: 'Z Axis' },
              ]}
              yDomain={[-2, 2]} // Assuming normalized Gs, usually around 1G (9.8m/s^2)
            />
            
            {hasGyro && (
              <LiveChart 
                title="Gyroscope (Deg/s)" 
                data={data}
                dataKeys={[
                  { key: 'gx', color: '#f97316', name: 'X Rotation' },
                  { key: 'gy', color: '#a855f7', name: 'Y Rotation' },
                  { key: 'gz', color: '#06b6d4', name: 'Z Rotation' },
                ]}
              />
            )}

            {hasMag && (
              <LiveChart 
                title="Magnetometer (uT)" 
                data={data}
                dataKeys={[
                  { key: 'mx', color: '#ec4899', name: 'X Mag' },
                  { key: 'my', color: '#8b5cf6', name: 'Y Mag' },
                  { key: 'mz', color: '#3b82f6', name: 'Z Mag' },
                ]}
              />
            )}
          </div>

          <div className="space-y-6">
             <LiveChart 
              title="Grip Pressure (FSR)" 
              data={data}
              dataKeys={[
                { key: 'fsr', color: '#eab308', name: 'Pressure' },
              ]}
              yDomain={[0, 4095]} // 12-bit ADC range for ESP32-S3
            />

            {/* Session Log / Controls */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 h-auto min-h-64 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-zinc-400 text-sm font-medium uppercase tracking-wider">Session Controls</h3>
                <div className="flex gap-2">
                  <button onClick={exportSession} className="text-zinc-500 hover:text-emerald-400 transition-colors" title="Export Session as JSON">
                    <Save size={16} />
                  </button>
                  <button onClick={clearData} className="text-zinc-500 hover:text-white transition-colors" title="Clear Graphs">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 flex flex-col md:flex-row gap-4">
                <div className="flex-1 flex flex-col items-center justify-center space-y-4 border-2 border-dashed border-zinc-800 rounded-lg bg-zinc-900/30 p-4">
                  {!isRecording ? (
                    <button 
                      onClick={() => {
                        audioFeedback.playStartRecording();
                        setIsRecording(true);
                        recordingBuffer.current = [];
                        recordingStartTime.current = Date.now();
                      }}
                      disabled={!isConnected}
                      className="group relative flex items-center justify-center w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-red-500/20"
                    >
                      <div className="absolute inset-0 rounded-full border-4 border-red-500/30 scale-110 group-hover:scale-125 transition-transform" />
                      <div className="w-6 h-6 bg-white rounded-sm" />
                    </button>
                  ) : (
                    <button 
                      onClick={() => {
                        audioFeedback.playStopRecording();
                        setIsRecording(false);
                        const duration = (Date.now() - recordingStartTime.current) / 1000;
                        const deviceType = connectionType === 'mobile' ? 'mobile' : 'pen';
                        const sessionFeatures = mlService.extractFeatures(recordingBuffer.current, deviceType);
                        
                        if (!user) {
                          setErrorModal({ title: "Sign In Required", message: "Please sign in to save sessions." });
                          recordingBuffer.current = [];
                          return;
                        }

                        const sessionId = crypto.randomUUID();
                        const newSession: Session = {
                          id: sessionId,
                          userId: user.uid,
                          timestamp: Date.now(),
                          duration: duration,
                          severity: metrics.intensity,
                          stage: metrics.stage,
                          rms: sessionFeatures.rms,
                          frequency: sessionFeatures.frequency,
                          data: [...recordingBuffer.current]
                        };
                        
                        setDoc(doc(db, 'sessions', sessionId), {
                          ...newSession,
                          data: JSON.stringify(newSession.data)
                        }).then(() => {
                          mlService.trainOnSession(newSession.data, newSession.severity);
                        }).catch(error => {
                          console.error("Error saving session", error);
                          setErrorModal({ title: "Save Error", message: "Failed to save session to cloud." });
                        });
                        
                        recordingBuffer.current = [];
                      }}
                      className="group relative flex items-center justify-center w-16 h-16 rounded-full bg-zinc-700 hover:bg-zinc-600 transition-all shadow-lg"
                    >
                      <Square className="text-white fill-current" size={24} />
                    </button>
                  )}
                  <p className="text-zinc-500 text-sm font-medium text-center">
                    {isRecording ? 'Recording Session...' : 'Record Cloud Session'}
                  </p>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center space-y-3 border-2 border-dashed border-zinc-800 rounded-lg bg-zinc-900/30 p-4">
                  {!isStreamingExport ? (
                    <>
                      <div className="flex gap-2 w-full max-w-[180px]">
                        <select 
                          className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-white"
                          value={exportFormat}
                          onChange={(e) => setExportFormat(e.target.value as 'csv'|'json')}
                          disabled={!isConnected}
                        >
                          <option value="csv">CSV</option>
                          <option value="json">JSON</option>
                        </select>
                        <select
                          className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-white"
                          value={exportDuration}
                          onChange={(e) => setExportDuration(Number(e.target.value))}
                          disabled={!isConnected}
                        >
                          <option value={0}>Continuous</option>
                          <option value={10}>10s</option>
                          <option value={30}>30s</option>
                          <option value={60}>1m</option>
                        </select>
                      </div>
                      <button 
                        onClick={async () => {
                          try {
                            await exportService.startStreaming(exportFormat, exportDuration, () => setIsStreamingExport(false));
                            setIsStreamingExport(true);
                          } catch (e: any) {
                            setErrorModal({ title: "Export Error", message: e.message || "Failed to start streaming." });
                          }
                        }}
                        disabled={!isConnected}
                        className="group relative flex items-center justify-center w-12 h-12 rounded-full bg-blue-500 hover:bg-blue-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20 mt-1"
                        title="Start Real-Time Export to File"
                      >
                        <Save className="text-white fill-current" size={18} />
                      </button>
                      <p className="text-zinc-500 text-sm font-medium text-center">Live File Stream</p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-center w-12 h-12 rounded-full border-4 border-blue-500/30 animate-pulse mt-[26px]">
                        <button 
                          onClick={() => {
                            exportService.stopStreaming();
                            setIsStreamingExport(false);
                          }}
                          className="flex items-center justify-center w-10 h-10 rounded-full bg-zinc-700 hover:bg-zinc-600 transition-all shadow-lg text-white"
                        >
                          <Square className="fill-current" size={16} />
                        </button>
                      </div>
                      <p className="text-blue-400 text-sm font-medium animate-pulse text-center">Writing {exportFormat.toUpperCase()}...</p>
                    </>
                  )}
                </div>
              </div>
              
              {recordedSessions.length > 0 && (
                <div className="mt-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-zinc-500 uppercase">Clinical Report History</h4>
                    <button 
                      onClick={async () => {
                        setConfirmModal({
                          title: "Clear All Sessions",
                          message: "Are you sure you want to delete all saved sessions? This action cannot be undone.",
                          onConfirm: async () => {
                            try {
                              for (const session of recordedSessions) {
                                await deleteDoc(doc(db, 'sessions', session.id));
                              }
                            } catch (error) {
                              console.error("Error clearing sessions", error);
                              setErrorModal({ title: "Delete Error", message: "Failed to clear some sessions." });
                            }
                          }
                        });
                      }}
                      className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors"
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="space-y-2">
                    {recordedSessions.map((session) => (
                      <div key={session.id} className="flex justify-between items-center bg-zinc-950/50 p-2.5 rounded-xl text-xs border border-zinc-800 group hover:border-zinc-700 transition-colors">
                        <div className="flex flex-col">
                          <span className="text-zinc-300 font-medium">{new Date(session.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          <span className="text-zinc-500 text-[10px]">{session.duration.toFixed(1)}s · {session.data.length} pts</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            session.severity === 'Severe' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 
                            session.severity === 'Moderate' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' : 
                            'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          }`}>
                            {session.severity}
                          </span>
                          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => generateClinicalReport(session)}
                              className="p-1.5 text-zinc-500 hover:text-blue-400 transition-colors"
                              title="Download Clinical Report (PDF)"
                            >
                              <FileText size={14} />
                            </button>
                            <button 
                              onClick={() => {
                                setLoadedDataset(session.data);
                                startDatasetPlayback(session.data);
                              }}
                              className="p-1.5 text-zinc-500 hover:text-emerald-400 transition-colors"
                              title="Replay Session"
                            >
                              <Play size={14} fill="currentColor" />
                            </button>
                            <button 
                              onClick={async () => {
                                try {
                                  await deleteDoc(doc(db, 'sessions', session.id));
                                } catch (error) {
                                  console.error("Error deleting session", error);
                                }
                              }}
                              className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors"
                              title="Delete Session"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="border-t border-zinc-800 pt-8 mt-8">
          <h4 className="text-zinc-400 font-medium mb-4">User Guide</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-zinc-500">
            <div className="space-y-2">
              <strong className="text-zinc-300 block">1. Hardware Setup</strong>
              <p>Attach the IMU/Force sensor device securely to your finger or pen. Ensure no loose wiring affects natural movement.</p>
              <div className="bg-zinc-900 p-3 rounded border border-zinc-800 mt-2">
                <p className="text-xs text-zinc-400">
                  Supported Inputs: ESP32 Custom Hardware (Serial/BLE/WiFi), Mobile Phone Sensors, Digital Pen / Mouse, or uploaded Dataset files.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <strong className="text-zinc-300 block">2. Establish Connection</strong>
              <p>Click the "Connect Devices" button at the top to select your preferred connection method. Allow necessary permissions and pair with your device.</p>
            </div>
            <div className="space-y-2">
              <strong className="text-zinc-300 block">3. Calibrate & Analyze</strong>
              <p>Hold the sensor completely still and click "Calibrate Baseline" to zero the offset. Perform standard tasks (like drawing spirals) while the app captures real-time tremor severity and frequency.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
