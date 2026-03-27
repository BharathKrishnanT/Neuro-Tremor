#include <Wire.h>
#include <ICM20948_WE.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// --- Pin Definitions (ESP32-C3 Mini) ---
#define SDA_PIN 3
#define SCL_PIN 4
#define ADO_PIN 2   // Set to HIGH for Address 0x69
#define FSR_PIN 0   // Analog Input for Force Sensor

#define ICM20948_ADDR 0x69 

// --- BLE Configuration ---
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

ICM20948_WE myIMU = ICM20948_WE(ICM20948_ADDR);
BLECharacteristic* pCharacteristic = NULL;
bool deviceConnected = false;

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) { deviceConnected = true; };
    void onDisconnect(BLEServer* pServer) { 
      deviceConnected = false; 
      pServer->getAdvertising()->start(); 
    }
};

void setup() {
  Serial.begin(115200);
  
  // 1. Pin Configuration
  pinMode(ADO_PIN, OUTPUT);
  digitalWrite(ADO_PIN, HIGH); // Select I2C Address 0x69
  
  // 2. I2C Initialization
  Wire.begin(SDA_PIN, SCL_PIN);
  
  // 3. IMU Initialization
  if (!myIMU.init()) {
    Serial.println("IMU Initialization Failed!");
    Serial.println("Check wiring: SDA->3, SCL->4, AD0->2");
    while(1);
  }
  
  // Settings for Tremor Detection
  myIMU.setAccRange(ICM20948_ACC_RANGE_2G);
  myIMU.setAccDLPF(ICM20948_DLPF_6); 

  // 4. BLE Initialization
  BLEDevice::init("NeuroTremor_Node_C3");
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());
  
  BLEService *pService = pServer->createService(SERVICE_UUID);
  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ | 
                      BLECharacteristic::PROPERTY_NOTIFY
                    );
  pCharacteristic->addDescriptor(new BLE2902());
  
  pService->start();
  pServer->getAdvertising()->start();
  
  Serial.println("System Ready");
}

void loop() {
  myIMU.readSensor();
  xyzFloat g; 
  myIMU.getGValues(&g); 
  
  // Read FSR (Analog 0-4095 on ESP32)
  int force = analogRead(FSR_PIN);

  // Format: X:0.00,Y:0.00,Z:0.00,F:0
  String payload = "X:" + String(g.x, 2) + 
                   ",Y:" + String(g.y, 2) + 
                   ",Z:" + String(g.z, 2) + 
                   ",F:" + String(force);

  Serial.println(payload);

  if (deviceConnected) {
    pCharacteristic->setValue(payload.c_str());
    pCharacteristic->notify(); 
  }

  delay(50); // 20Hz
}
