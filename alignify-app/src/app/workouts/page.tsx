"use client";

import { useEffect, useRef, useState } from "react";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import Layout from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { doc, updateDoc, arrayUnion, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import AuthModal from "@/components/AuthModal";

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
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { currentUser } = useAuth();

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

  // Draw pose landmarks manually using canvas API
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

  // Draw connections between landmarks
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

  useEffect(() => {
    let mounted = true;
    console.log("Component initialized");
    
    const initializePoseLandmarker = async () => {
      try {
        console.log("Initializing MediaPipe...");
        setIsLoading(true);
        
        // Initialize MediaPipe FilesetResolver
        console.log("Creating FilesetResolver...");
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm"
        );
        
        if (!mounted) return;
        console.log("FilesetResolver created successfully");
        
        // Create PoseLandmarker with specific model path
        console.log("Creating PoseLandmarker...");
        const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU" // Use GPU for better performance
          },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        
        if (!mounted) return;
        
        // Test the poseLandmarker to make sure it works
        console.log("Testing PoseLandmarker methods:", Object.keys(poseLandmarker));
        
        // Store the poseLandmarker
        poseLandmarkerRef.current = poseLandmarker;
        console.log("PoseLandmarker initialized successfully");
        setIsLoading(false);
        
        // Draw a test shape on the canvas to verify it's working
        if (canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) {
            ctx.fillStyle = 'purple';
            ctx.fillRect(100, 100, 100, 100);
            console.log("Drew test rectangle during initialization");
          }
        }
      } catch (error) {
        console.error("Error initializing PoseLandmarker:", error);
        setFeedback("Failed to initialize pose detection. Please refresh the page.");
        setIsLoading(false);
      }
    };

    const updateCanvasSize = () => {
      if (containerRef.current && canvasRef.current && videoRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const containerHeight = containerRef.current.clientHeight;
        
        // Set canvas dimensions to match container
        canvasRef.current.width = containerWidth;
        canvasRef.current.height = containerHeight;
        
        console.log(`Canvas resized to ${containerWidth}x${containerHeight}`);
      }
    };

    const setupCamera = async () => {
      try {
        console.log("Setting up camera...");
        
        const constraints = { 
          video: { 
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user"
          } 
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (!mounted) return;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          
          // Wait for the video to be loaded
          await new Promise<boolean>((resolve) => {
            if (!videoRef.current) {
              resolve(false);
              return;
            }
            
            videoRef.current.onloadedmetadata = () => {
              if (!mounted) {
                resolve(false);
                return;
              }
              
              if (videoRef.current) {
                console.log("Video metadata loaded");
                videoRef.current.play()
                  .then(() => {
                    console.log("Video playing");
                    updateCanvasSize();
                    resolve(true);
                  })
                  .catch(err => {
                    console.error("Error playing video:", err);
                    resolve(false);
                  });
              } else {
                resolve(false);
              }
            };
          });
          
          console.log("Camera setup complete");
        }
      } catch (error) {
        console.error("Error accessing webcam:", error);
        setFeedback("Camera access denied. Please allow camera access and refresh the page.");
      }
    };

    // Handle window resize
    window.addEventListener('resize', updateCanvasSize);
    
    // Initialize everything
    (async () => {
      await initializePoseLandmarker();
      if (mounted) {
        await setupCamera();
        
        // Test drawing on canvas
        setTimeout(() => {
          if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
              console.log("Drawing test rectangle on canvas");
              ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
              ctx.fillRect(50, 50, 200, 200);
              ctx.strokeStyle = 'white';
              ctx.lineWidth = 5;
              ctx.strokeRect(50, 50, 200, 200);
              ctx.font = '20px Arial';
              ctx.fillStyle = 'white';
              ctx.fillText('Canvas Test', 80, 130);
            } else {
              console.error("Could not get canvas context for test drawing");
            }
          } else {
            console.error("Canvas ref not available for test drawing");
          }
        }, 1000);
      }
    })();

    return () => {
      console.log("Cleaning up resources");
      mounted = false;
      
      // Stop animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      // Stop camera stream
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
      
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, []);

  const processFrame = async () => {
    // Force the function to act as if the session is active during the first call
    const forceActive = true;
    
    if (!forceActive && !isSessionActive) {
      console.log("Session not active, skipping frame processing");
      return;
    }
    
    console.log("Processing frame with session active:", isSessionActive);
    
    if (!poseLandmarkerRef.current || !videoRef.current || !canvasRef.current) {
      console.log("Missing required references:", {
        poseLandmarker: !!poseLandmarkerRef.current,
        video: !!videoRef.current,
        canvas: !!canvasRef.current
      });
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }
    
    const canvasCtx = canvasRef.current.getContext('2d');
    if (!canvasCtx) {
      console.log("Failed to get canvas context");
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }
    
    // Make sure video is ready
    if (videoRef.current.readyState < 2) {
      console.log("Video not ready yet, readyState:", videoRef.current.readyState);
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }
    
    try {
      // Clear canvas first
      canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      
      // Draw frame count for debugging
      const frameCount = animationFrameRef.current || 0;
      canvasCtx.font = '20px Arial';
      canvasCtx.fillStyle = 'lime';
      canvasCtx.fillText(`Frame: ${frameCount}`, 20, 30);
      
      // Always draw a test rectangle to verify canvas is working
      canvasCtx.strokeStyle = 'cyan';
      canvasCtx.lineWidth = 4;
      canvasCtx.strokeRect(20, 50, 100, 100);
      
      // Get current timestamp
      const startTimeMs = performance.now();
      
      // Get results from pose detection
      const results = await poseLandmarkerRef.current.detectForVideo(videoRef.current, startTimeMs);
      
      // Display detection status
      if (results.landmarks && results.landmarks.length > 0) {
        canvasCtx.fillStyle = 'lime';
        canvasCtx.fillText(`Detected ${results.landmarks[0].length} landmarks`, 20, 70);
        
        // Draw detections
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
          
          // Color-code landmarks based on match
          Object.entries(poseFeedback).forEach(([part, score]) => {
            const color = score > 0.8 ? '#00FF00' : score > 0.6 ? '#FFFF00' : '#FF0000';
            const points = bodyParts[part as keyof typeof bodyParts];
            points.forEach(point => {
              if (landmarks[point]) {
                canvasCtx.beginPath();
                const mirroredX = canvasCtx.canvas.width - (landmarks[point].x * canvasCtx.canvas.width);
                canvasCtx.arc(
                  mirroredX,
                  landmarks[point].y * canvasCtx.canvas.height,
                  10,
                  0,
                  2 * Math.PI
                );
                canvasCtx.fillStyle = color;
                canvasCtx.fill();
                canvasCtx.strokeStyle = '#FFFFFF';
                canvasCtx.lineWidth = 2;
                canvasCtx.stroke();
              }
            });
          });
        }
      } else {
        canvasCtx.fillStyle = 'red';
        canvasCtx.fillText('No pose detected', 20, 70);
      }
    } catch (error) {
      console.error("Error during pose detection:", error);
      
      // Still draw something to verify canvas works
      canvasCtx.fillStyle = 'red';
      canvasCtx.fillRect(150, 50, 50, 50);
      canvasCtx.font = '16px Arial';
      canvasCtx.fillStyle = 'white';
      canvasCtx.fillText('Error!', 155, 80);
    }
    
    // Continue the detection loop only if the session is active
    // Use a direct check instead of relying on the state
    if (document.getElementById('session-active-check')?.getAttribute('data-active') === 'true' || isSessionActive) {
      console.log("Requesting next animation frame");
      animationFrameRef.current = requestAnimationFrame(processFrame);
    } else {
      console.log("Session ended, not requesting next frame");
    }
  };

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

  const endSession = async () => {
    setIsSessionActive(false);
    setFeedback("Session ended");

    // If user is authenticated and we have accuracy data, save the workout
    if (currentUser && overallSimilarity > 0) {
      try {
        // Calculate the workout duration in minutes
        const durationMinutes = Math.floor(Math.random() * 30) + 15; // Just a placeholder for now
        
        // Save workout to Firestore
        const userRef = doc(db, 'users', currentUser.uid);
        
        // Check if user document exists
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
          // Update the existing document with new workout
          await updateDoc(userRef, {
            workouts: arrayUnion({
              date: serverTimestamp(),
              accuracy: Math.round(overallSimilarity * 100),
              duration: durationMinutes,
              name: "Yoga Session",
            }),
            'stats.workoutsCompleted': userDoc.data().stats?.workoutsCompleted + 1 || 1,
            'stats.averageAccuracy': Math.round(
              ((userDoc.data().stats?.averageAccuracy || 0) * 
              (userDoc.data().stats?.workoutsCompleted || 0) + 
              Math.round(overallSimilarity * 100)) / 
              ((userDoc.data().stats?.workoutsCompleted || 0) + 1)
            ),
          });
        } else {
          // Create a new user document
          await setDoc(userRef, {
            uid: currentUser.uid,
            email: currentUser.email,
            displayName: currentUser.displayName,
            createdAt: serverTimestamp(),
            workouts: [{
              date: serverTimestamp(),
              accuracy: Math.round(overallSimilarity * 100),
              duration: durationMinutes,
              name: "Yoga Session",
            }],
            plans: [],
            stats: {
              workoutsCompleted: 1,
              plansCompleted: 0,
              averageAccuracy: Math.round(overallSimilarity * 100),
            },
          });
        }
        
        setFeedback("Session ended and progress saved!");
      } catch (error) {
        console.error("Error saving workout:", error);
        setFeedback("Session ended but failed to save progress.");
      }
    }
  };

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

  // Update the DOM element when session state changes
  useEffect(() => {
    const sessionCheckElement = document.getElementById('session-active-check');
    if (sessionCheckElement) {
      sessionCheckElement.setAttribute('data-active', isSessionActive ? 'true' : 'false');
    }
  }, [isSessionActive]);

  useEffect(() => {
    // Show auth modal if user is not authenticated
    if (!currentUser) {
      setShowAuthModal(true);
    }
  }, [currentUser]);

  const handleCloseModal = () => {
    // Allow closing even if not authenticated for workouts page
    setShowAuthModal(false);
  };

  return (
    <Layout>
      <div className="flex flex-col items-center">
        <h1 className="text-2xl font-bold mb-6">Workouts - Pose Guidance</h1>
        
        <div className="flex w-full">
          <div className="flex flex-col items-center w-full">
            {/* Hidden element to track session state */}
            <div id="session-active-check" data-active={isSessionActive ? 'true' : 'false'} style={{ display: 'none' }}></div>
            
            {/* Webcam Feed Area */}
            <div ref={containerRef} className="relative w-full h-[70vh] bg-black mb-4">
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
              
              {/* Example pose image */}
              {isSessionActive && (
                <div className="absolute bottom-4 right-4 z-30 bg-white p-2 rounded-lg shadow-md w-44 h-44">
                  <img 
                    src="/pose-example.png" 
                    alt="Example pose" 
                    className="w-full h-full object-cover rounded"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.src = "https://placehold.co/160x160/pink/white?text=Example+Pose";
                    }}
                  />
                </div>
              )}
              
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
            
            {/* Control Buttons */}
            <div className="flex space-x-4 mb-4">
              <button 
                onClick={startSession}
                disabled={isSessionActive || !calibratedPose}
                className={`px-4 py-2 text-white rounded ${
                  isSessionActive || !calibratedPose ? 'bg-gray-400' : 'bg-blue-500 hover:bg-blue-600'
                }`}
              >
                Start Session
              </button>
              <button 
                onClick={endSession}
                disabled={!isSessionActive}
                className={`px-4 py-2 text-white rounded ${
                  !isSessionActive ? 'bg-gray-400' : 'bg-red-500 hover:bg-red-600'
                }`}
              >
                End Session
              </button>
              <button 
                onClick={calibratePose}
                disabled={isSessionActive}
                className={`px-4 py-2 text-white rounded ${
                  isSessionActive ? 'bg-gray-400' : 'bg-green-500 hover:bg-green-600'
                }`}
              >
                Calibrate Pose
              </button>
            </div>
            
            {/* Feedback Panel */}
            <div className="bg-white p-4 rounded-lg shadow-md w-full">
              <p className="text-lg font-semibold mb-2">Status:</p>
              <p className="whitespace-pre-line">{feedback}</p>
              {isSessionActive && overallSimilarity > 0 && (
                <div className="mt-2">
                  <div className="w-full bg-gray-200 rounded-full h-4">
                    <div 
                      className={`h-4 rounded-full ${
                        overallSimilarity > 0.8 ? 'bg-green-500' : 
                        overallSimilarity > 0.6 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${Math.round(overallSimilarity * 100)}%` }}
                    ></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Auth Modal */}
      <AuthModal isOpen={showAuthModal} onClose={handleCloseModal} />
    </Layout>
  );
} 