import React, { useRef, useEffect, useState } from 'react';
import { SensorData } from '../lib/serial';
import { Maximize2, Minimize2 } from 'lucide-react';

export function TouchPadCanvas({ onData, mode = 'touch', onTouchUpdate }: { onData: (data: SensorData) => void, mode?: 'touch' | 'combined', onTouchUpdate?: (x: number, y: number, pressure: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  const lastPos = useRef<{x: number, y: number, t: number} | null>(null);
  const lastVel = useRef<{vx: number, vy: number, ax: number, ay: number} | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const drawGrid = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 500; i++) {
        const angle = 0.1 * i;
        const x = w / 2 + (1 + angle) * Math.cos(angle) * (w > 1000 ? 8 : 5);
        const y = h / 2 + (1 + angle) * Math.sin(angle) * (w > 1000 ? 8 : 5);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.fillStyle = '#666';
      ctx.font = '14px Inter';
      ctx.textAlign = 'center';
      ctx.fillText('Trace the spiral or draw freely', w / 2, 30);
    };

    const handleResize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      
      // Only resize if substantially different to avoid jitter
      if (Math.abs(canvas.width - rect.width) > 5 || Math.abs(canvas.height - rect.height) > 5) {
        canvas.width = rect.width;
        canvas.height = rect.height;
        
        const ctx = canvas.getContext('2d');
        if (ctx) drawGrid(ctx, canvas.width, canvas.height);
      }
    };

    const observer = new ResizeObserver(() => {
      handleResize();
    });

    if (canvas.parentElement) {
      observer.observe(canvas.parentElement);
    }
    
    // Initial draw
    handleResize();

    return () => observer.disconnect();
  }, [isFullscreen]);

  const getCanvasCoordinates = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: e.nativeEvent.offsetX * scaleX,
      y: e.nativeEvent.offsetY * scaleY
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    lastPos.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    lastVel.current = { vx: 0, vy: 0, ax: 0, ay: 0 };
    
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
    
    // Calculate raw acceleration
    const rawAx = (vx - lastVel.current.vx) / dt;
    const rawAy = (vy - lastVel.current.vy) / dt;
    
    // Apply low-pass filter to smooth out pixel-jitter noise
    const smoothing = 0.2; 
    const ax = lastVel.current.vx === 0 ? rawAx : (lastVel.current.ax || 0) * (1 - smoothing) + rawAx * smoothing;
    const ay = lastVel.current.vy === 0 ? rawAy : (lastVel.current.ay || 0) * (1 - smoothing) + rawAy * smoothing;

    // Send the simulated sensor data
    const pressure = e.pressure !== undefined ? e.pressure * 4095 : 2048;
    
    const { x, y } = getCanvasCoordinates(e);

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
        touchX: x,
        touchY: y
      });
    } else if (onTouchUpdate) {
      onTouchUpdate(x, y, pressure);
    }

    // Update drawing
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    lastPos.current = { x: e.clientX, y: e.clientY, t: now };
    lastVel.current = { vx, vy, ax, ay };
  };

  const handlePointerUp = () => {
    setIsDrawing(false);
    lastPos.current = null;
    lastVel.current = null;
  };

  return (
    <div className={
      isFullscreen
        ? "fixed inset-0 z-50 bg-zinc-950 p-6 flex flex-col"
        : "bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-8 flex flex-col"
    }>
      <div className="mb-4 flex justify-between items-start flex-shrink-0">
        <div>
          <h2 className="text-lg font-medium text-white">Touch Pad / Pen Analytics</h2>
          <p className="text-zinc-400 text-sm">Use your mouse, trackpad, or digital pen to draw in the canvas below. The system will measure microscopic variations in acceleration as you draw.</p>
        </div>
        <button
          onClick={() => setIsFullscreen(!isFullscreen)}
          className="p-2 text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors flex-shrink-0 ml-4"
          title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
        >
          {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
        </button>
      </div>
      <div className={`w-full ${isFullscreen ? 'flex-1' : 'h-80'} bg-zinc-950 rounded-xl overflow-hidden border border-zinc-800 cursor-crosshair min-h-0 relative`}>
        <canvas
          ref={canvasRef}
          width={800}
          height={320}
          className="w-full h-full touch-none block"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>
      <div className="mt-4 flex justify-end flex-shrink-0">
        <button 
          onClick={() => {
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d');
            if (ctx && canvas) {
              const w = canvas.width;
              const h = canvas.height;
              ctx.clearRect(0, 0, w, h);
              
              // Redraw spiral
              ctx.strokeStyle = '#333';
              ctx.lineWidth = 1;
              ctx.beginPath();
              for (let i = 0; i < 500; i++) {
                const angle = 0.1 * i;
                const x = w / 2 + (1 + angle) * Math.cos(angle) * (w > 1000 ? 8 : 5);
                const y = h / 2 + (1 + angle) * Math.sin(angle) * (w > 1000 ? 8 : 5);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }
              ctx.stroke();
              
              ctx.fillStyle = '#666';
              ctx.font = '14px Inter';
              ctx.textAlign = 'center';
              ctx.fillText('Trace the spiral or draw freely', w / 2, 30);
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
