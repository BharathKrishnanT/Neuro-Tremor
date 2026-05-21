/*
 * NeuroTremor Multi-Sensor Telemetry System
 * Target: ESP32-S3 Super Mini
 * Sensors: ICM-20948 (9DOF) + Force Sensitive Resistor
 * Connections: USB Serial + Bluetooth Low Energy (BLE)
 * 
 * Required Libraries (Install via Library Manager):
 * - "SparkFun 9DoF IMU Breakout - ICM 20948"
 */

#include <Wire.h>
#include "ICM_20948.h" 
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

const int SDA_PIN = 9;
const int SCL_PIN = 8;
const int FSR_PIN = 2; 

ICM_20948_I2C myICM; 

// BLE Settings
#define SERVICE_UUID           "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID    "beb5483e-36e1-4688-b7f5-ea07361b26a8"

BLEServer* pServer = NULL;
BLECharacteristic* pCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;
unsigned long connectTime = 0;

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      connectTime = millis();
      Serial.println("BLE Client Connected");
    };

    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      Serial.println("BLE Client Disconnected");
    }
};

// EMA Filter configuration
float emaAlphaIMU = 0.2; // IMU smoothing factor (0.0 - 1.0, lower is smoother)
float emaAlphaFSR = 0.1; // FSR smoothing factor (heavy smoothing for electrical noise)

float f_ax = 0, f_ay = 0, f_az = 0;
float f_gx = 0, f_gy = 0, f_gz = 0;
float f_fsr = 0;
bool firstReading = true;

int fsrBaseline = 0;

void setup() {
  delay(2000);
  Serial.begin(115200);
  while (!Serial && millis() < 5000); // Optional wait for USB, timeout after 5s
  
  Serial.println("--- NeuroTremor Telemetry: Online ---");

  // I2C setup
  Wire.begin(SDA_PIN, SCL_PIN);
  myICM.begin(Wire, 1); // address 0x69
  
  if (myICM.status != ICM_20948_Stat_Ok) {
    Serial.println("ICM-20948 initialization failed.");
    while(1);
  }

  // Set FSR with pull-down to prevent floating readings when no force is applied
  pinMode(FSR_PIN, INPUT_PULLDOWN);
  analogReadResolution(12);

  // Calibrate FSR (read 100 times and average) to set the zero-force baseline
  Serial.print("Calibrating FSR (Please do not touch)...");
  long fsrSum = 0;
  for (int i = 0; i < 100; i++) {
    fsrSum += analogRead(FSR_PIN);
    delay(10);
  }
  fsrBaseline = fsrSum / 100;
  Serial.printf(" Done. Baseline: %d\n", fsrBaseline);

  // Initialize BLE
  BLEDevice::init("NeuroTremor Pen");
  // CRITICAL: Request higher MTU to support payloads > 20 bytes.
  // Without this, the ESP32-S3 BLE stack often crashes and disconnects when sending long strings
  BLEDevice::setMTU(512); 

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);
  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ   |
                      BLECharacteristic::PROPERTY_NOTIFY 
                    );
  pCharacteristic->addDescriptor(new BLE2902());
  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(false);
  pAdvertising->setMinPreferred(0x00);  // set value to 0x00 to not advertise this parameter
  BLEDevice::startAdvertising();

  Serial.println("Data streaming configured with BLE enabled...");
}

void loop() {
  // Handle BLE disconnect
  if (!deviceConnected && oldDeviceConnected) {
      delay(500); // Give the bluetooth stack the chance to get things ready
      pServer->startAdvertising(); // Restart advertising
      Serial.println("Start advertising");
      oldDeviceConnected = deviceConnected;
  }
  // Handle BLE connect
  if (deviceConnected && !oldDeviceConnected) {
      oldDeviceConnected = deviceConnected;
  }

  if (myICM.dataReady()) {
    myICM.getAGMT();
    
    // Re-enable pulldown just in case analogRead disabled it
    pinMode(FSR_PIN, INPUT_PULLDOWN);
    
    // Read raw FSR and apply baseline
    float rawFsr = analogRead(FSR_PIN) - fsrBaseline;
    if (rawFsr < 0) rawFsr = 0;

    if (firstReading) {
      f_ax = myICM.accX(); f_ay = myICM.accY(); f_az = myICM.accZ();
      f_gx = myICM.gyrX(); f_gy = myICM.gyrY(); f_gz = myICM.gyrZ();
      f_fsr = rawFsr;
      firstReading = false;
    } else {
      // Apply Exponential Moving Average (EMA) to smooth out raw IMU noise
      f_ax = (emaAlphaIMU * myICM.accX()) + ((1.0 - emaAlphaIMU) * f_ax);
      f_ay = (emaAlphaIMU * myICM.accY()) + ((1.0 - emaAlphaIMU) * f_ay);
      f_az = (emaAlphaIMU * myICM.accZ()) + ((1.0 - emaAlphaIMU) * f_az);
      
      f_gx = (emaAlphaIMU * myICM.gyrX()) + ((1.0 - emaAlphaIMU) * f_gx);
      f_gy = (emaAlphaIMU * myICM.gyrY()) + ((1.0 - emaAlphaIMU) * f_gy);
      f_gz = (emaAlphaIMU * myICM.gyrZ()) + ((1.0 - emaAlphaIMU) * f_gz);
      
      // Apply heavier smoothing to FSR to fix 50/60Hz electrical noise on floating pins
      f_fsr = (emaAlphaFSR * rawFsr) + ((1.0 - emaAlphaFSR) * f_fsr);
    }

    // Noise gate for FSR after smoothing (removes lingering low values)
    int finalFsr = (f_fsr < 300) ? 0 : (int)f_fsr;

    // Stream globally compatible key-value format
    String payload = "X:" + String(f_ax, 2) + 
                     ",Y:" + String(f_ay, 2) + 
                     ",Z:" + String(f_az, 2) + 
                     ",GX:" + String(f_gx, 2) + 
                     ",GY:" + String(f_gy, 2) + 
                     ",GZ:" + String(f_gz, 2) + 
                     ",MX:" + String(myICM.magX(), 2) + 
                     ",MY:" + String(myICM.magY(), 2) + 
                     ",MZ:" + String(myICM.magZ(), 2) + 
                     ",F:" + String(finalFsr);

    // Send payload over USB Serial
    Serial.println(payload);

    // Send payload over Bluetooth (if connected and stabilized)
    // We wait 3 seconds after connection before starting to stream
    // to prevent congesting the ESP32 BLE stack during GATT service discovery
    if (deviceConnected && (millis() - connectTime > 3000)) {
      pCharacteristic->setValue(payload.c_str());
      pCharacteristic->notify();
    }
  }
  delay(20);
}
