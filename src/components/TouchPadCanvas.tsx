import React, { useRef, useEffect, useState } from 'react';
import { SensorData } from '../lib/serial';

export function TouchPadCanvas({ onData, mode = 'touch', onTouchUpdate }: { onData: (data: SensorData) => void, mode?: 'touch' | 'combined', onTouchUpdate?: (x: number, y: number, pressure: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  
  const lastPos = useRef<{x: number, y: number, t: number} | null>(null);
  const lastVel = useRef<{vx: number, vy: number} | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Optional: Draw guidelines like a spiral to trace
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 500; i++) {
      const angle = 0.1 * i;
      const x = canvas.width / 2 + (1 + angle) * Math.cos(angle) * 5;
      const y = canvas.height / 2 + (1 + angle) * Math.sin(angle) * 5;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = '#666';
    ctx.font = '14px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('Trace the spiral or draw freely', canvas.width / 2, 30);
  }, []);

  const getCanvasCoordinates = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    lastPos.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    lastVel.current = { vx: 0, vy: 0 };
    
    // Setup drawing
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      const { x, y } = getCanvasCoordinates(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !lastPos.current || !lastVel.current) return;
    
    const now = Date.now();
    const dt = (now - lastPos.current.t) / 1000; // seconds
    if (dt === 0) return;

    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    
    // Pixel to meter conversion (rough approx)
    const pxToMeter = 0.000264; 
    
    const vx = (dx * pxToMeter) / dt;
    const vy = (dy * pxToMeter) / dt;
    
    const ax = (vx - lastVel.current.vx) / dt;
    const ay = (vy - lastVel.current.vy) / dt;

    // Send the simulated sensor data
    const pressure = e.pressure !== undefined ? e.pressure * 1024 : 512;
    
    if (mode === 'touch') {
      onData({
        timestamp: now,
        ax: ax,
        ay: ay,
        az: 9.8, // Gravity
        gx: 0,
        gy: 0,
        gz: 0,
        mx: 0,
        my: 0,
        mz: 0,
        fsr: pressure,
        touchX: e.clientX,
        touchY: e.clientY
      });
    } else if (onTouchUpdate) {
      onTouchUpdate(e.clientX, e.clientY, pressure);
    }

    // Update drawing
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      const { x, y } = getCanvasCoordinates(e);
      ctx.lineTo(x, y);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    lastPos.current = { x: e.clientX, y: e.clientY, t: now };
    lastVel.current = { vx, vy };
  };

  const handlePointerUp = () => {
    setIsDrawing(false);
    lastPos.current = null;
    lastVel.current = null;
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-8">
      <div className="mb-4">
        <h2 className="text-lg font-medium text-white">Touch Pad / Pen Analytics</h2>
        <p className="text-zinc-400 text-sm">Use your mouse, trackpad, or digital pen to draw in the canvas below. The system will measure microscopic variations in acceleration as you draw.</p>
      </div>
      <div className="w-full h-80 bg-zinc-950 rounded-xl overflow-hidden border border-zinc-800 cursor-crosshair">
        <canvas
          ref={canvasRef}
          width={800}
          height={320}
          className="w-full h-full touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>
      <div className="mt-4 flex justify-end">
        <button 
          onClick={() => {
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d');
            if (ctx && canvas) {
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              
              // Redraw spiral
              ctx.strokeStyle = '#333';
              ctx.lineWidth = 1;
              ctx.beginPath();
              for (let i = 0; i < 500; i++) {
                const angle = 0.1 * i;
                const x = canvas.width / 2 + (1 + angle) * Math.cos(angle) * 5;
                const y = canvas.height / 2 + (1 + angle) * Math.sin(angle) * 5;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }
              ctx.stroke();
              
              ctx.fillStyle = '#666';
              ctx.font = '14px Inter';
              ctx.textAlign = 'center';
              ctx.fillText('Trace the spiral or draw freely', canvas.width / 2, 30);
            }
          }}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors rounded-lg text-sm font-medium"
        >
          Clear Canvas
        </button>
      </div>
    </div>
  );
}
