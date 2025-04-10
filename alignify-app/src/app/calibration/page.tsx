"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import firebase from "firebase/compat/app";
import "firebase/compat/storage";
import "firebase/compat/firestore";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

export default function Calibration() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { currentUser } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Get plan ID and workout count from URL parameters
  const planId = searchParams.get("planId");
  const workoutCount = parseInt(searchParams.get("workoutCount") || "1");

  // State for the calibration process
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(1);
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [workoutName, setWorkoutName] = useState("");
  const [plan, setPlan] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(10);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isMPReady, setIsMPReady] = useState(false);

  // Draw pose landmarks
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

  // Initialize webcam and plan
  useEffect(() => {
    if (!planId || !currentUser) {
      router.push("/plans");
      return;
    }

    // Fetch plan details
    const fetchPlan = async () => {
      try {
        const planDoc = await db.collection('users').doc(currentUser.uid)
          .collection('plans').doc(planId).get();
        
        if (!planDoc.exists) {
          throw new Error("Plan not found");
        }

        setPlan(planDoc.data());
      } catch (err) {
        console.error("Error fetching plan:", err);
        setError("Failed to load plan details");
      }
    };

    fetchPlan();

    // Initialize MediaPipe
    const initializeMediaPipe = async () => {
      try {
        console.log("Initializing MediaPipe...");
        
        // Initialize MediaPipe FilesetResolver
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm"
        );
        
        console.log("FilesetResolver created successfully");
        
        // Create PoseLandmarker with specific model path
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
        
        // Store the poseLandmarker
        poseLandmarkerRef.current = poseLandmarker;
        console.log("PoseLandmarker initialized successfully");
        setIsMPReady(true);
      } catch (error) {
        console.error("Error initializing PoseLandmarker:", error);
        setCameraError("Failed to initialize pose detection. Please refresh the page.");
      }
    };

    initializeMediaPipe();
    
    return () => {
      // Stop animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [planId, currentUser, router]);

  // Separate useEffect for camera initialization
  useEffect(() => {
    if (loading && !isMPReady) return;

    const initCamera = async () => {
      try {
        if (!videoRef.current) return;
        
        setCameraError(null);
        
        // Stop any existing stream
        if (videoRef.current.srcObject) {
          const stream = videoRef.current.srcObject as MediaStream;
          stream.getTracks().forEach(track => track.stop());
        }
        
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user" 
          }
        });
        
        videoRef.current.srcObject = stream;
        // Add event listener for when video is ready
        videoRef.current.onloadedmetadata = () => {
          if (videoRef.current) {
            videoRef.current.play().catch(e => {
              console.error("Error playing video:", e);
              setCameraError("Could not start video playback");
            });
            
            // Start the pose detection when video starts playing
            if (isMPReady && !capturedImage) {
              startPoseDetection();
            }
            
            setLoading(false);
          }
        };
      } catch (err) {
        console.error("Error accessing camera:", err);
        setCameraError("Camera access is required for calibration. Please allow camera access and reload this page.");
        setLoading(false);
      }
    };

    initCamera();

    // Cleanup
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [loading, isMPReady, capturedImage]);

  const processFrame = async () => {
    if (!poseLandmarkerRef.current || !videoRef.current || !canvasRef.current || capturedImage) {
      return;
    }
    
    const canvasCtx = canvasRef.current.getContext('2d');
    if (!canvasCtx) {
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }
    
    // Make sure video is ready
    if (videoRef.current.readyState < 2) {
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }
    
    try {
      // Clear canvas first
      canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      
      // Set canvas dimensions if they're not already set
      if (canvasRef.current.width !== videoRef.current.videoWidth || 
          canvasRef.current.height !== videoRef.current.videoHeight) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
      }
      
      // Draw video frame first (mirrored)
      canvasCtx.save();
      canvasCtx.translate(canvasRef.current.width, 0);
      canvasCtx.scale(-1, 1);
      canvasCtx.drawImage(
        videoRef.current, 
        0, 0, 
        canvasRef.current.width, 
        canvasRef.current.height
      );
      canvasCtx.restore();
      
      // Get current timestamp
      const startTimeMs = performance.now();
      
      // Get results from pose detection
      const results = await poseLandmarkerRef.current.detectForVideo(videoRef.current, startTimeMs);
      
      // Draw pose landmarks if available
      if (results.landmarks && results.landmarks.length > 0) {
        const landmarks = results.landmarks[0];
        drawConnections(canvasCtx, landmarks);
        drawLandmarks(canvasCtx, landmarks);
      }
    } catch (error) {
      console.error("Error during pose detection:", error);
    }
    
    // Continue the detection loop if not capturing
    if (!isCapturing && !capturedImage) {
      animationFrameRef.current = requestAnimationFrame(processFrame);
    }
  };

  const startPoseDetection = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    processFrame();
  };

  const captureImage = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    setIsCapturing(true);
    setCountdown(10); // Reset countdown to 10 seconds
    
    // Continue pose detection during countdown
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    startPoseDetection();
    
    // Countdown for 10 seconds before capture
    const countdownInterval = setInterval(() => {
      setCountdown(prev => {
        const newCount = prev - 1;
        
        if (newCount <= 0) {
          clearInterval(countdownInterval);
          
          // Stop animation frame before capture
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
          }
          
          // Capture image from canvas (which already has pose landmarks drawn)
          const imageDataUrl = canvasRef.current?.toDataURL('image/png') || null;
          setCapturedImage(imageDataUrl);
          setIsCapturing(false);
          return 0;
        }
        
        return newCount;
      });
    }, 1000);
  };

  const retakeImage = () => {
    setCapturedImage(null);
    
    // Restart the camera and pose detection
    setTimeout(() => {
      if (isMPReady) {
        startPoseDetection();
      }
    }, 500);
  };

  const saveWorkout = async () => {
    if (!planId || !currentUser || !capturedImage || !workoutName) return;
    
    try {
      setLoading(true);
      
      // Upload image to Firebase Storage
      if (!firebase.storage) {
        throw new Error("Firebase storage module not found");
      }
      
      const storage = firebase.storage();
      const storageRef = storage.ref();
      const imageRef = storageRef.child(`users/${currentUser.uid}/plans/${planId}/workouts/workout_${currentStep}.png`);
      
      // Convert data URL to blob
      const response = await fetch(capturedImage);
      const blob = await response.blob();
      
      // Upload the image
      const uploadTask = await imageRef.put(blob);
      const imageUrl = await uploadTask.ref.getDownloadURL();
      
      // Save workout to Firestore
      const workoutData = {
        name: workoutName,
        imageUrl: imageUrl,
        position: currentStep,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      
      const workoutsRef = db.collection('users').doc(currentUser.uid)
        .collection('plans').doc(planId)
        .collection('workouts');
      
      await workoutsRef.add(workoutData);
      
      // If this is the first workout, use it as the plan thumbnail
      if (currentStep === 1) {
        await db.collection('users').doc(currentUser.uid)
          .collection('plans').doc(planId)
          .update({ imageUrl: imageUrl });
      }
      
      // Move to next step or finish
      if (currentStep < workoutCount) {
        setCurrentStep(currentStep + 1);
        setCapturedImage(null);
        setWorkoutName("");
        setLoading(false);
        
        // Restart pose detection for the next step
        setTimeout(() => {
          if (isMPReady) {
            startPoseDetection();
          }
        }, 500);
      } else {
        // Update plan with completion status
        await db.collection('users').doc(currentUser.uid)
          .collection('plans').doc(planId)
          .update({ isCalibrated: true });
        
        // Redirect to plan details page
        router.push(`/plans/${planId}`);
      }
    } catch (err) {
      console.error("Error saving workout:", err);
      setError("Failed to save workout");
      setLoading(false);
    }
  };

  if (loading && !isMPReady) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-[calc(100vh-200px)]">
          <div className="w-16 h-16 border-t-4 border-blue-500 border-solid rounded-full animate-spin"></div>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="bg-red-50 p-4 rounded-md border border-red-200 text-red-700 mb-6">
          {error}
        </div>
        <button
          onClick={() => router.push("/plans")}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Return to Plans
        </button>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Calibrate Your Workout Plan</h1>
          <p className="text-gray-600">
            Capture reference poses for your workouts. These will be used to measure your form during exercises.
          </p>
        </div>

        <div className="mb-6 bg-blue-50 p-4 rounded-md border border-blue-200">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">
              Step {currentStep} of {workoutCount}
            </h2>
            <div className="text-sm text-gray-500">
              {Math.round((currentStep / workoutCount) * 100)}% Complete
            </div>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div 
              className="bg-blue-500 h-2.5 rounded-full" 
              style={{ width: `${(currentStep / workoutCount) * 100}%` }}
            ></div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md mb-6">
          <div className="mb-4">
            <label htmlFor="workoutName" className="block text-sm font-medium text-gray-700 mb-1">
              Workout Name
            </label>
            <input
              id="workoutName"
              type="text"
              value={workoutName}
              onChange={(e) => setWorkoutName(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="E.g., Downward Dog, Mountain Climbers"
              required
            />
          </div>

          <div className="relative">
            {cameraError ? (
              <div className="w-full h-[400px] bg-red-50 rounded-md flex items-center justify-center p-4">
                <div className="text-center text-red-600">
                  <p className="font-bold mb-2">Camera Access Error</p>
                  <p>{cameraError}</p>
                  <button 
                    onClick={() => window.location.reload()}
                    className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    Retry Camera Access
                  </button>
                </div>
              </div>
            ) : (
              <>
                {!capturedImage ? (
                  <div className="relative w-full h-[400px]">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="absolute top-0 left-0 w-full h-full rounded-md object-cover"
                      style={{ transform: "scaleX(-1)" }} // Mirror horizontally
                    />
                    
                    <canvas
                      ref={canvasRef}
                      className="absolute top-0 left-0 w-full h-full rounded-md"
                    />
                    
                    {isCapturing && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white">
                        <div className="text-center">
                          <div className="text-6xl font-bold mb-2">{countdown}</div>
                          <p>Hold your pose steady</p>
                        </div>
                      </div>
                    )}
                    
                    <button
                      onClick={captureImage}
                      disabled={isCapturing}
                      className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-blue-500 text-white px-6 py-2 rounded-full hover:bg-blue-600 disabled:bg-blue-300"
                    >
                      {isCapturing ? "Capturing..." : "Capture Reference Pose"}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="w-full h-[400px] rounded-md overflow-hidden">
                      <img
                        src={capturedImage}
                        alt="Captured pose"
                        className="w-full h-full object-contain"
                      />
                    </div>
                    
                    <div className="flex space-x-3 mt-4">
                      <button
                        onClick={retakeImage}
                        className="flex-1 bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300"
                      >
                        Retake Photo
                      </button>
                      
                      <button
                        onClick={saveWorkout}
                        disabled={!workoutName}
                        className="flex-1 bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 disabled:bg-green-300"
                      >
                        {currentStep < workoutCount ? "Save & Continue" : "Complete Calibration"}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div className="text-center text-sm text-gray-500">
          <p>
            Make sure you are in a well-lit area and your entire body is visible in the frame.
            Strike and hold the perfect form for the exercise you want to track.
          </p>
        </div>
      </div>
    </Layout>
  );
} 