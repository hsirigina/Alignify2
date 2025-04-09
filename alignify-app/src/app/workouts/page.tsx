'use client';

import { useEffect, useRef, useState } from "react";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

export default function Workouts() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  const [isSessionActive, setIsSessionActive] = useState<boolean>(false);
  const [calibratedPose, setCalibratedPose] = useState<any>(null);
  const [poseMatchFeedback, setPoseMatchFeedback] = useState<{[key: string]: number}>({});
  const [overallSimilarity, setOverallSimilarity] = useState<number>(0);
  const [feedback, setFeedback] = useState<string>("Click 'Start Session' to begin");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [calibrationCountdown, setCalibrationCountdown] = useState<number | null>(null);

  // Define body part landmarks mapping
  const bodyParts: { [key: string]: number[] } = {
    leftArm: [11, 13, 15],
    rightArm: [12, 14, 16],
    leftLeg: [23, 25, 27],
    rightLeg: [24, 26, 28],
    torso: [11, 12, 23, 24]
  };

  // Compare two poses and return detailed feedback
  const comparePoses = (calibratedPose: any, currentPose: any) => {
    const feedback: {[key: string]: number} = {};
    let totalSimilarity = 0;
    let pointsCount = 0;

    // Compare each body part
    for (const [part, points] of Object.entries(bodyParts)) {
      let partSimilarity = 0;
      points.forEach((point) => {
        if (calibratedPose[point] && currentPose[point]) {
          const distance = Math.sqrt(
            Math.pow(calibratedPose[point].x - currentPose[point].x, 2) +
            Math.pow(calibratedPose[point].y - currentPose[point].y, 2) +
            Math.pow(calibratedPose[point].z - currentPose[point].z, 2)
          );
          partSimilarity += 1 - Math.min(distance, 1);
          pointsCount++;
        }
      });
      feedback[part] = partSimilarity / points.length;
      totalSimilarity += partSimilarity;
    }

    const overallScore = totalSimilarity / pointsCount;
    return { feedback, overallScore };
  };

  // Draw landmarks function
  const drawLandmarks = (ctx: CanvasRenderingContext2D, landmarks: any) => {
    landmarks.forEach((landmark: any) => {
      ctx.beginPath();
      const mirroredX = ctx.canvas.width - (landmark.x * ctx.canvas.width);
      ctx.arc(mirroredX, landmark.y * ctx.canvas.height, 8, 0, 2 * Math.PI);
      ctx.fillStyle = '#FF0000';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  };

  // Draw connections function
  const drawConnections = (ctx: CanvasRenderingContext2D, landmarks: any) => {
    const connections = [
      // Torso
      [11, 12], [12, 24], [24, 23], [23, 11],
      // Left arm
      [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],
      // Right arm
      [12, 14], [14, 16], [16, 18], [16, 20], [16, 22],
      // Left leg
      [23, 25], [25, 27], [27, 29], [27, 31],
      // Right leg
      [24, 26], [26, 28], [28, 30], [28, 32]
    ];

    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 4;

    connections.forEach(([start, end]) => {
      if (landmarks[start] && landmarks[end]) {
        const startX = ctx.canvas.width - (landmarks[start].x * ctx.canvas.width);
        const endX = ctx.canvas.width - (landmarks[end].x * ctx.canvas.width);
        
        ctx.beginPath();
        ctx.moveTo(startX, landmarks[start].y * ctx.canvas.height);
        ctx.lineTo(endX, landmarks[end].y * ctx.canvas.height);
        ctx.stroke();
      }
    });
  };

  // Process frame function
  const processFrame = async () => {
    if (!poseLandmarkerRef.current || !videoRef.current || !canvasRef.current) {
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }

    const canvasCtx = canvasRef.current.getContext('2d');
    if (!canvasCtx) {
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }

    try {
      // Clear canvas first
      canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      
      const startTimeMs = performance.now();
      const results = await poseLandmarkerRef.current.detectForVideo(videoRef.current, startTimeMs);
      
      if (results.landmarks && results.landmarks.length > 0) {
        const landmarks = results.landmarks[0];
        
        // Draw connections and landmarks
        drawConnections(canvasCtx, landmarks);
        drawLandmarks(canvasCtx, landmarks);
        
        // Calculate pose similarity if calibrated
        if (calibratedPose) {
          const { feedback: poseFeedback, overallScore } = comparePoses(calibratedPose, landmarks);
          setPoseMatchFeedback(poseFeedback);
          setOverallSimilarity(overallScore);
          
          // Generate specific feedback
          let feedbackText = `Overall match: ${Math.round(overallScore * 100)}%\n`;
          for (const [part, score] of Object.entries(poseFeedback)) {
            const percentage = Math.round(score * 100);
            if (percentage < 80) {
              feedbackText += `\nAdjust your ${part.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${percentage}% aligned`;
            }
          }
          setFeedback(feedbackText);
        }
      }
    } catch (error) {
      console.error("Error during pose detection:", error);
    }

    if (isSessionActive) {
      animationFrameRef.current = requestAnimationFrame(processFrame);
    }
  };

  // Start session function
  const startSession = async () => {
    if (!calibratedPose) {
      setFeedback("Please calibrate a pose first!");
      return;
    }
    setIsSessionActive(true);
    setFeedback("Session started - matching against calibrated pose");
    
    // Start the pose detection loop
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    processFrame();
  };

  // End session function
  const endSession = () => {
    setIsSessionActive(false);
    setFeedback("Session ended");
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  };

  // Calibrate pose function
  const calibratePose = async () => {
    if (isLoading) {
      setFeedback("System is still initializing, please wait...");
      return;
    }
    
    if (!poseLandmarkerRef.current || !videoRef.current) {
      setFeedback("Cannot calibrate - pose detection not ready");
      return;
    }
    
    // Start countdown from 3
    setCalibrationCountdown(3);
    
    // Countdown logic
    for (let i = 3; i > 0; i--) {
      setCalibrationCountdown(i);
      setFeedback(`Hold your pose! Calibrating in ${i} seconds...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    setCalibrationCountdown(null);
    
    try {
      const results = await poseLandmarkerRef.current.detectForVideo(videoRef.current, performance.now());
      
      if (results.landmarks && results.landmarks.length > 0) {
        setCalibratedPose(results.landmarks[0]);
        setPoseMatchFeedback({});
        setOverallSimilarity(0);
        setFeedback("✅ Pose calibrated! Start the session to begin receiving feedback.");
      } else {
        setFeedback("❌ Calibration failed - no pose detected. Please try again.");
      }
    } catch (error) {
      console.error("Error during calibration:", error);
      setFeedback("❌ Calibration failed - an error occurred");
    }
  };

  // Initialize MediaPipe and camera
  useEffect(() => {
    let mounted = true;

    const initializePoseLandmarker = async () => {
      try {
        setIsLoading(true);
        
        // Initialize MediaPipe FilesetResolver
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm"
        );
        
        if (!mounted) return;
        
        // Create PoseLandmarker
        const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        
        if (!mounted) return;
        
        poseLandmarkerRef.current = poseLandmarker;
        setIsLoading(false);
      } catch (error) {
        console.error("Error initializing PoseLandmarker:", error);
        setFeedback("Failed to initialize pose detection. Please refresh the page.");
        setIsLoading(false);
      }
    };

    const setupCamera = async () => {
      try {
        const constraints = {
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user"
          }
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (!mounted || !videoRef.current) return;
        
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        
        // Update canvas size after video loads
        if (containerRef.current && canvasRef.current) {
          const containerWidth = containerRef.current.clientWidth;
          const containerHeight = containerRef.current.clientHeight;
          canvasRef.current.width = containerWidth;
          canvasRef.current.height = containerHeight;
        }
      } catch (error) {
        console.error("Error accessing webcam:", error);
        setFeedback("Camera access denied. Please allow camera access and refresh the page.");
      }
    };

    // Initialize everything
    (async () => {
      await initializePoseLandmarker();
      if (mounted) {
        await setupCamera();
      }
    })();

    // Cleanup function
    return () => {
      mounted = false;
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Workout Session</h1>
      
      <div className="flex gap-6">
        {/* Left side - Video feed */}
        <div className="flex-1">
          <div ref={containerRef} className="relative aspect-video bg-black rounded-lg overflow-hidden">
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className="absolute w-full h-full object-cover z-10 transform scale-x-[-1]"
            />
            <canvas 
              ref={canvasRef} 
              className="absolute w-full h-full z-20"
              style={{ backgroundColor: 'rgba(0,0,0,0.1)' }}
            />
            
            {/* Calibration countdown overlay */}
            {calibrationCountdown && (
              <div className="absolute inset-0 flex items-center justify-center z-30">
                <div className="bg-black bg-opacity-50 rounded-full w-32 h-32 flex items-center justify-center">
                  <span className="text-6xl text-white font-bold">{calibrationCountdown}</span>
                </div>
              </div>
            )}
            
            {/* Loading indicator */}
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center z-30 bg-black bg-opacity-50 text-white">
                <div className="text-center">
                  <div className="mb-2">Loading pose detection...</div>
                  <div className="w-16 h-16 border-t-4 border-blue-500 border-solid rounded-full animate-spin mx-auto"></div>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="mt-4 flex justify-center space-x-4">
            <button 
              onClick={startSession}
              disabled={isSessionActive || !calibratedPose}
              className={`px-6 py-3 text-white rounded-lg ${
                isSessionActive || !calibratedPose ? 'bg-gray-400' : 'bg-blue-500 hover:bg-blue-600'
              }`}
            >
              Start Session
            </button>
            <button 
              onClick={endSession}
              disabled={!isSessionActive}
              className={`px-6 py-3 text-white rounded-lg ${
                !isSessionActive ? 'bg-gray-400' : 'bg-red-500 hover:bg-red-600'
              }`}
            >
              End Session
            </button>
            <button 
              onClick={calibratePose}
              disabled={isSessionActive}
              className={`px-6 py-3 text-white rounded-lg ${
                isSessionActive ? 'bg-gray-400' : 'bg-green-500 hover:bg-green-600'
              }`}
            >
              Calibrate Pose
            </button>
          </div>
        </div>

        {/* Right side - Feedback panel */}
        <div className="w-80">
          <div className="bg-white p-6 rounded-lg shadow-md h-full">
            <h2 className="text-xl font-bold mb-4">Pose Feedback</h2>
            <p className="whitespace-pre-line mb-4">{feedback}</p>
            {isSessionActive && overallSimilarity > 0 && (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="font-medium">Overall Match</span>
                    <span>{Math.round(overallSimilarity * 100)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-4">
                    <div 
                      className={`h-4 rounded-full transition-all ${
                        overallSimilarity > 0.8 ? 'bg-green-500' : 
                        overallSimilarity > 0.6 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${Math.round(overallSimilarity * 100)}%` }}
                    ></div>
                  </div>
                </div>
                
                {Object.entries(poseMatchFeedback).map(([part, score]) => (
                  <div key={part}>
                    <div className="flex justify-between mb-1">
                      <span className="font-medium">{part.replace(/([A-Z])/g, ' $1').trim()}</span>
                      <span>{Math.round(score * 100)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${
                          score > 0.8 ? 'bg-green-500' : 
                          score > 0.6 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${Math.round(score * 100)}%` }}
                      ></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
} 