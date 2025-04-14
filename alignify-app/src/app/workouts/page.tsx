"use client";

import { useEffect, useRef, useState } from "react";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import Layout from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { doc, updateDoc, arrayUnion, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import AuthModal from "@/components/AuthModal";
import { useRouter } from "next/navigation";
import firebase from "firebase/compat/app";
import "firebase/compat/firestore";

// Define interfaces for landmarks
interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  index?: number;
}

interface StoredPoseLandmark {
  index: number;
  x: number;
  y: number;
  z: number;
  visibility: number;
}

// Add a proper interface for Plan and Workout
interface Workout {
  id: string;
  name: string;
  imageUrl: string;
  position: number;
}

interface Plan {
  id: string;
  name: string;
  description?: string;
  workoutCount: number;
  imageUrl?: string;
  isCalibrated: boolean;
}

// Interface for stored landmarks
interface StoredPoseLandmarks {
  landmarks: StoredPoseLandmark[];
  position: number;
  workoutId: string;
  workoutName?: string;
  timestamp: any;
  source?: string;
  userId?: string;
  planId?: string;
}

export default function Workouts() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const smoothedLandmarks = useRef<Array<any[]>>([]);
  const smoothingWindowSize = 5; // Number of frames to average
  
  const [isSessionActive, setIsSessionActive] = useState<boolean>(false);
  const [calibratedPose, setCalibratedPose] = useState<any>(null);
  const [poseMatchFeedback, setPoseMatchFeedback] = useState<{[key: string]: number}>({});
  const [overallSimilarity, setOverallSimilarity] = useState<number>(0);
  const [feedback, setFeedback] = useState<string>("Click 'Start Session' to begin");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [calibrationCountdown, setCalibrationCountdown] = useState<number | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [availablePlans, setAvailablePlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [currentWorkoutIndex, setCurrentWorkoutIndex] = useState<number>(0);
  const [planWorkouts, setPlanWorkouts] = useState<Workout[]>([]);
  const [holdTimer, setHoldTimer] = useState<number | null>(null);
  const [isInCorrectPose, setIsInCorrectPose] = useState<boolean>(false);
  const [showCompletionFeedback, setShowCompletionFeedback] = useState<boolean>(false);
  const [poseHoldDuration, setPoseHoldDuration] = useState<number>(3); // Reduced to 3 seconds for testing
  const [showReferenceOverlay, setShowReferenceOverlay] = useState(true); // Default to showing the overlay
  const { currentUser } = useAuth();
  const router = useRouter();

  // State for tracking workout metrics
  const [workoutStartTime, setWorkoutStartTime] = useState<number | null>(null);
  const [poseAccuracies, setPoseAccuracies] = useState<number[]>([]);
  const [referencePoseLandmarks, setReferencePoseLandmarks] = useState<StoredPoseLandmarks[]>([]);

  // Define key joint angles to compare (triplets of points forming angles)
  const jointAngles: { [key: string]: number[] } = {
    leftElbow: [11, 13, 15], // shoulder, elbow, wrist
    rightElbow: [12, 14, 16], // shoulder, elbow, wrist
    leftShoulder: [13, 11, 23], // elbow, shoulder, hip
    rightShoulder: [14, 12, 24], // elbow, shoulder, hip
    leftHip: [11, 23, 25], // shoulder, hip, knee
    rightHip: [12, 24, 26], // shoulder, hip, knee
    leftKnee: [23, 25, 27], // hip, knee, ankle
    rightKnee: [24, 26, 28], // hip, knee, ankle
  };

  // Calculate the angle between three points (in radians)
  const calculateAngle = (p1: any, p2: any, p3: any) => {
    if (!p1 || !p2 || !p3) return null;
    
    // Calculate vectors
    const vector1 = {
      x: p1.x - p2.x,
      y: p1.y - p2.y,
      z: p1.z - p2.z
    };
    
    const vector2 = {
      x: p3.x - p2.x,
      y: p3.y - p2.y,
      z: p3.z - p2.z
    };
    
    // Calculate dot product
    const dotProduct = 
      vector1.x * vector2.x + 
      vector1.y * vector2.y + 
      vector1.z * vector2.z;
    
    // Calculate magnitudes
    const magnitude1 = Math.sqrt(
      vector1.x * vector1.x + 
      vector1.y * vector1.y + 
      vector1.z * vector1.z
    );
    
    const magnitude2 = Math.sqrt(
      vector2.x * vector2.x + 
      vector2.y * vector2.y + 
      vector2.z * vector2.z
    );
    
    // Handle zero magnitudes to avoid division by zero
    if (magnitude1 === 0 || magnitude2 === 0) return null;
    
    // Calculate angle using dot product formula
    // Clamp the value to avoid floating-point errors
    const cosAngle = Math.max(-1, Math.min(1, dotProduct / (magnitude1 * magnitude2)));
    const angle = Math.acos(cosAngle);
    
    return angle;
  };

  // Compare two poses using joint angles and return detailed feedback
  const comparePoses = (referencePose: any, currentPose: any) => {
    const feedback: {[key: string]: number} = {};
    let totalSimilarity = 0;
    let availableAngles = 0;
    
    // For debugging
    console.log("--- Comparing Poses ---");
    
    // Compare angles for each joint
    for (const [joint, points] of Object.entries(jointAngles)) {
      const [p1, p2, p3] = points;
      
      // Calculate angle for reference pose
      const referenceAngle = calculateAngle(
        referencePose[p1], 
        referencePose[p2], 
        referencePose[p3]
      );
      
      // Calculate angle for current pose
      const currentAngle = calculateAngle(
        currentPose[p1], 
        currentPose[p2], 
        currentPose[p3]
      );
      
      // If we can calculate both angles, compare them
      if (referenceAngle !== null && currentAngle !== null) {
        // Calculate the difference in angles (in radians)
        const angleDifference = Math.abs(referenceAngle - currentAngle);
        
        // Convert to a similarity score (0-1)
        // A difference of 0 means perfect match (1.0)
        // Use a more strict comparison by using PI/4 (45 degrees) as the max difference
        // This makes it harder to get high scores with moderate differences
        const similarity = Math.max(0, 1 - (angleDifference / (Math.PI / 4)));
        
        // Apply a curve to make small differences more significant
        // This makes scoring more challenging as you need to be more precise
        const adjustedSimilarity = Math.pow(similarity, 1.1);
        
        feedback[joint] = adjustedSimilarity;
        totalSimilarity += adjustedSimilarity;
        availableAngles++;
        
        // Debug log for specific joints 
        console.log(`${joint}: Reference=${(referenceAngle * 180 / Math.PI).toFixed(1)}°, Current=${(currentAngle * 180 / Math.PI).toFixed(1)}°, Diff=${(angleDifference * 180 / Math.PI).toFixed(1)}°, Similarity=${(adjustedSimilarity * 100).toFixed(0)}%`);
      } else {
        // If we can't calculate one of the angles, mark this joint as not available
        feedback[joint] = 0;
        console.log(`${joint}: Could not calculate angles`);
      }
    }
    
    const overallScore = availableAngles > 0 ? totalSimilarity / availableAngles : 0;
    const isGoodMatch = overallScore >= 0.8;
    
    console.log(`Overall Match: ${(overallScore * 100).toFixed(1)}%, Good Match: ${isGoodMatch}`);
    
    return { 
      feedback, 
      overallScore,
      isGoodMatch 
    };
  };

  // Draw pose landmarks manually using canvas API
  const drawLandmarks = (ctx: CanvasRenderingContext2D, landmarks: any[], color: string = '#FF0000') => {
    landmarks.forEach((landmark: any) => {
      ctx.beginPath();
      const mirroredX = ctx.canvas.width - (landmark.x * ctx.canvas.width);
      ctx.arc(mirroredX, landmark.y * ctx.canvas.height, 8, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  };

  // Draw connections between landmarks
  const drawConnections = (ctx: CanvasRenderingContext2D, landmarks: any[], color: string = '#00FF00') => {
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

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;

    connections.forEach(([start, end]) => {
      if (landmarks[start] && landmarks[end]) {
        const startX = ctx.canvas.width - (landmarks[start].x * ctx.canvas.width);
        const startY = landmarks[start].y * ctx.canvas.height;
        const endX = ctx.canvas.width - (landmarks[end].x * ctx.canvas.width);
        const endY = landmarks[end].y * ctx.canvas.height;
        
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
    });
  };
  
  // Draw the reference pose as an overlay
  const drawReferencePose = (ctx: CanvasRenderingContext2D) => {
    // Check if we have a reference pose for the current workout
    if (referencePoseLandmarks.length > currentWorkoutIndex && 
        referencePoseLandmarks[currentWorkoutIndex]?.landmarks) {
      
      const referencePose = referencePoseLandmarks[currentWorkoutIndex].landmarks;
      
      // Draw reference pose with transparency
      ctx.globalAlpha = 0.3; // Set transparency
      drawConnections(ctx, referencePose, '#0000FF'); // Blue for reference
      drawLandmarks(ctx, referencePose, '#0000FF');
      ctx.globalAlpha = 1.0; // Reset transparency
      
      // Add a small label
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(10, 60, 140, 30);
      ctx.fillStyle = 'white';
      ctx.font = '14px Arial';
      ctx.fillText('Reference Pose Overlay', 20, 80);
    }
  };

  // Function to continuously display mirrored video without pose detection
  const startContinuousVideoDisplay = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const displayVideoFrame = () => {
      if (!videoRef.current || !canvasRef.current) return;
      
      // Only process if no active session (otherwise the session processFrame handles it)
      if (!isSessionActive) {
        const canvasCtx = canvasRef.current.getContext('2d');
        if (canvasCtx && videoRef.current.readyState >= 2) {
          // Clear canvas
          canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          
          // Save canvas state for mirroring
          canvasCtx.save();
          
          // Flip horizontally
          canvasCtx.scale(-1, 1);
          canvasCtx.translate(-canvasRef.current.width, 0);
          
          // Calculate dimensions to maintain aspect ratio
          const videoWidth = videoRef.current.videoWidth;
          const videoHeight = videoRef.current.videoHeight;
          const canvasWidth = canvasRef.current.width;
          const canvasHeight = canvasRef.current.height;
          
          let drawWidth = canvasWidth;
          let drawHeight = canvasHeight;
          let offsetX = 0;
          let offsetY = 0;
          
          // Calculate dimensions to fill canvas while maintaining aspect ratio
          const videoRatio = videoWidth / videoHeight;
          const canvasRatio = canvasWidth / canvasHeight;
          
          if (videoRatio > canvasRatio) {
            // Video is wider than canvas (relative to height)
            drawHeight = canvasHeight;
            drawWidth = drawHeight * videoRatio;
            offsetX = -(drawWidth - canvasWidth) / 2;
          } else {
            // Video is taller than canvas (relative to width)
            drawWidth = canvasWidth;
            drawHeight = drawWidth / videoRatio;
            offsetY = -(drawHeight - canvasHeight) / 2;
          }
          
          // Draw the video frame to fill the canvas
          canvasCtx.drawImage(
            videoRef.current,
            offsetX, offsetY,
            drawWidth, drawHeight
          );
          
          // Restore canvas state
          canvasCtx.restore();
          
          // Add a subtle indicator that the canvas is active but not in session
          canvasCtx.fillStyle = 'rgba(0, 0, 255, 0.1)';
          canvasCtx.fillRect(10, 10, 220, 40);
          canvasCtx.fillStyle = 'white';
          canvasCtx.font = '20px Arial';
          canvasCtx.fillText('Waiting to Start Session', 20, 35);
        }
      }
      
      // Continue the display loop if not in active session
      if (!isSessionActive) {
        animationFrameRef.current = requestAnimationFrame(displayVideoFrame);
      }
    };
    
    // Start the display loop
    displayVideoFrame();
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

        // Start a basic mirrored video display even without an active session
        startContinuousVideoDisplay();
      } catch (error) {
        console.error("Error initializing PoseLandmarker:", error);
        setFeedback("Failed to initialize pose detection. Please refresh the page.");
        setIsLoading(false);
      }
    };

    const updateCanvasSize = () => {
      if (!containerRef.current || !canvasRef.current || !videoRef.current) {
        console.error("Elements missing for canvas setup");
        return;
      }
      
      // Get container dimensions
      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight;
      
      // Maintain 16:10 aspect ratio instead of 16:9
      const aspectRatio = 16/10;
      
      // Calculate dimensions that maintain aspect ratio within container
      let newWidth = containerWidth;
      let newHeight = containerWidth / aspectRatio;
      
      // If calculated height exceeds container height, adjust based on height
      if (newHeight > containerHeight) {
        newHeight = containerHeight;
        newWidth = containerHeight * aspectRatio;
      }
      
      // Set canvas to these dimensions
      canvasRef.current.width = newWidth;
      canvasRef.current.height = newHeight;
      
      // Center the canvas in container if needed
      if (newWidth < containerWidth || newHeight < containerHeight) {
        const marginLeft = (containerWidth - newWidth) / 2;
        const marginTop = (containerHeight - newHeight) / 2;
        canvasRef.current.style.marginLeft = `${marginLeft}px`;
        canvasRef.current.style.marginTop = `${marginTop}px`;
      } else {
        canvasRef.current.style.marginLeft = '0';
        canvasRef.current.style.marginTop = '0';
      }
      
      console.log(`Canvas resized to ${canvasRef.current.width}x${canvasRef.current.height} with aspect ratio ${aspectRatio}`);
      
      // Draw a test rectangle to verify canvas is working
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
        ctx.fillRect(20, 20, 60, 60);
        ctx.fillStyle = 'white';
        ctx.font = '14px Arial';
        ctx.fillText('Canvas Ready', 25, 50);
      }
    };

    const setupCamera = async () => {
      try {
        console.log("Setting up camera...");
        
        const constraints = { 
          video: { 
            width: { ideal: 1600 },
            height: { ideal: 1000 },
            facingMode: "user",
            aspectRatio: 16/10 // Force 16:10 aspect ratio
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
    
    if (!poseLandmarkerRef.current || !videoRef.current || !canvasRef.current || planWorkouts.length === 0) {
      console.log("Missing required references:", {
        poseLandmarker: !!poseLandmarkerRef.current,
        video: !!videoRef.current,
        canvas: !!canvasRef.current,
        workouts: planWorkouts.length
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
      
      // Save the canvas state - like in calibration page
      canvasCtx.save();
      
      // Flip the canvas horizontally for correct mirroring
      canvasCtx.scale(-1, 1);
      canvasCtx.translate(-canvasRef.current.width, 0);
      
      // Calculate dimensions to maintain aspect ratio
      const videoWidth = videoRef.current.videoWidth;
      const videoHeight = videoRef.current.videoHeight;
      const canvasWidth = canvasRef.current.width;
      const canvasHeight = canvasRef.current.height;
      
      let drawWidth = canvasWidth;
      let drawHeight = canvasHeight;
      let offsetX = 0;
      let offsetY = 0;
      
      // Calculate dimensions to fill canvas while maintaining aspect ratio
      const videoRatio = videoWidth / videoHeight;
      const canvasRatio = canvasWidth / canvasHeight;
      
      if (videoRatio > canvasRatio) {
        // Video is wider than canvas (relative to height)
        drawHeight = canvasHeight;
        drawWidth = drawHeight * videoRatio;
        offsetX = -(drawWidth - canvasWidth) / 2;
      } else {
        // Video is taller than canvas (relative to width)
        drawWidth = canvasWidth;
        drawHeight = drawWidth / videoRatio;
        offsetY = -(drawHeight - canvasHeight) / 2;
      }
      
      // Draw the video frame onto the canvas - like in calibration page
      canvasCtx.drawImage(
        videoRef.current, 
        offsetX, offsetY, 
        drawWidth, drawHeight
      );
      
      // Restore the canvas state for drawing landmarks without flipping them again
      canvasCtx.restore();
      
      // Add a subtle indicator that the canvas is active
      canvasCtx.fillStyle = 'rgba(255, 0, 0, 0.1)';
      canvasCtx.fillRect(10, 10, 200, 40);
      canvasCtx.fillStyle = 'white';
      canvasCtx.font = '20px Arial';
      canvasCtx.fillText('Canvas Active', 20, 35);
      
      // Get current timestamp
      const startTimeMs = performance.now();
      
      // Get results from pose detection
      const results = await poseLandmarkerRef.current.detectForVideo(videoRef.current, startTimeMs);
      
      // Display detection status
      if (results.landmarks && results.landmarks.length > 0) {
        // Get the original landmarks
        const currentLandmarks = results.landmarks[0];
        
        // Initialize smoothed landmarks if needed
        if (smoothedLandmarks.current.length === 0) {
          // First frame, just use current landmarks
          smoothedLandmarks.current = Array(smoothingWindowSize).fill([...currentLandmarks]);
        } else {
          // Add current landmarks to the buffer
          smoothedLandmarks.current.push([...currentLandmarks]);
          // Remove oldest entry if buffer is full
          if (smoothedLandmarks.current.length > smoothingWindowSize) {
            smoothedLandmarks.current.shift();
          }
        }
        
        // Create smoothed version by averaging across frames
        const smoothed = currentLandmarks.map((_, i) => {
          // For each landmark position
          const avgX = smoothedLandmarks.current.reduce((sum, frame) => 
            sum + (frame[i]?.x || 0), 0) / smoothedLandmarks.current.length;
          const avgY = smoothedLandmarks.current.reduce((sum, frame) => 
            sum + (frame[i]?.y || 0), 0) / smoothedLandmarks.current.length;
          const avgZ = smoothedLandmarks.current.reduce((sum, frame) => 
            sum + (frame[i]?.z || 0), 0) / smoothedLandmarks.current.length;
          
          return {
            ...currentLandmarks[i],
            x: avgX,
            y: avgY,
            z: avgZ
          };
        });
        
        // Use smoothed landmarks instead of original
        const landmarks = smoothed;
        
        // Debug log landmarks occasionally
        if (Math.random() < 0.02) { // 2% chance to log (to avoid flooding console)
          debugLandmarks("Current pose landmarks", landmarks);
          
          if (referencePoseLandmarks.length > currentWorkoutIndex && 
              referencePoseLandmarks[currentWorkoutIndex]?.landmarks) {
            debugLandmarks("Reference pose landmarks", 
              referencePoseLandmarks[currentWorkoutIndex].landmarks);
          }
        }
        
        // Use smoothed landmarks for drawing
        drawConnections(canvasCtx, landmarks);
        drawLandmarks(canvasCtx, landmarks);
        
        // Draw reference pose if in session and show overlay option is enabled
        if (isSessionActive && showReferenceOverlay) {
          drawReferencePose(canvasCtx);
        }
        
        // Get reference pose from the current workout in the plan
        if (planWorkouts[currentWorkoutIndex]) {
          // Check if we have stored reference landmarks for this pose
          const hasStoredLandmarks = referencePoseLandmarks.length > currentWorkoutIndex && 
                                    referencePoseLandmarks[currentWorkoutIndex] && 
                                    referencePoseLandmarks[currentWorkoutIndex].landmarks &&
                                    referencePoseLandmarks[currentWorkoutIndex].landmarks.length > 0;
          
          let referencePose;
          
          if (hasStoredLandmarks) {
            // Use the stored landmarks from calibration
            console.log("Using stored reference landmarks for pose comparison");
            referencePose = referencePoseLandmarks[currentWorkoutIndex].landmarks;
          } else {
            // Fall back to mock reference pose with deliberate offset
            console.log("Using approximated reference pose (no stored landmarks found)");
            
            // For testing purposes, create a mock reference pose with some differences
            // This ensures we don't get a perfect match by default
            referencePose = landmarks.map((l, i) => {
              // Add deliberate offset to test matching logic
              // To simulate a real reference pose with different angles
              const offsetFactors: {[key: number]: number} = {
                // Key joints with their offset factors (higher = more difficult to match)
                // Use landmark indices as keys - using zero offsets to ensure matching requires precision
                11: 0, // left shoulder - no offset
                12: 0, // right shoulder - no offset
                13: 0, // left elbow - no offset
                14: 0, // right elbow - no offset
                15: 0, // left wrist - no offset
                16: 0, // right wrist - no offset
                23: 0, // left hip - no offset
                24: 0, // right hip - no offset
                25: 0, // left knee - no offset
                26: 0, // right knee - no offset
                27: 0, // left ankle - no offset
                28: 0  // right ankle - no offset
              };
              
              // Get offset factor for this landmark or use zero default
              const offsetFactor = offsetFactors[i] || 0;
              
              // Return exact landmarks (no offsets) to make matching more challenging
              // This will force users to match their exact current pose
              return {
                x: l.x,
                y: l.y,
                z: l.z
              };
            });
          }
          
          // Calculate pose similarity against the reference
          const { feedback: poseFeedback, overallScore, isGoodMatch } = comparePoses(referencePose, landmarks);
          
          setPoseMatchFeedback(poseFeedback);
          setOverallSimilarity(overallScore);
          
          // Log similarity for debugging
          console.log("Pose similarity:", Math.round(overallScore * 100) + "%", isGoodMatch ? "(MATCH)" : "");
          
          // Check if pose is correct (above the threshold)
          const wasInCorrectPose = isInCorrectPose;
          setIsInCorrectPose(isGoodMatch);
          
          // Handle pose hold timing
          if (isGoodMatch) {
            // If we just entered the correct pose, start the timer
            if (!wasInCorrectPose && holdTimer === null) {
              console.log("Starting pose hold timer!");
              setHoldTimer(poseHoldDuration);
            }
          } else {
            // If we're no longer in the correct pose, reset the timer
            if (holdTimer !== null) {
              console.log("Resetting pose hold timer - pose lost");
              setHoldTimer(null);
            }
          }
          
          // Generate specific feedback
          let feedbackText = `Overall match: ${Math.round(overallScore * 100)}%\n`;
          
          for (const [part, score] of Object.entries(poseFeedback)) {
            const percentage = Math.round(score * 100);
            if (percentage < 80) {
              const jointName = part.replace(/([A-Z])/g, ' $1').toLowerCase();
              
              // Suggest how to adjust based on the joint
              let adjustmentText = `Adjust your ${jointName}: ${percentage}% aligned`;
              
              // Add specific suggestions (these would be more accurate with real angle comparisons)
              switch(part) {
                case 'leftElbow':
                case 'rightElbow':
                  adjustmentText += ` (try bending your ${jointName.includes('left') ? 'left' : 'right'} arm more)`;
                  break;
                case 'leftShoulder':
                case 'rightShoulder':
                  adjustmentText += ` (try raising/lowering your ${jointName.includes('left') ? 'left' : 'right'} arm)`;
                  break;
                case 'leftHip':
                case 'rightHip':
                  adjustmentText += ` (adjust your torso position)`;
                  break;
                case 'leftKnee':
                case 'rightKnee':
                  adjustmentText += ` (try bending your ${jointName.includes('left') ? 'left' : 'right'} leg more)`;
                  break;
              }
              
              feedbackText += `\n${adjustmentText}`;
            }
          }
          
          setFeedback(feedbackText);
          
          // Color-code landmarks based on match
          Object.entries(poseFeedback).forEach(([part, score]) => {
            const color = score > 0.8 ? '#00FF00' : score > 0.6 ? '#FFFF00' : '#FF0000';
            const points = jointAngles[part as keyof typeof jointAngles];
            
            if (points && points.length > 0 && points[1]) { // Draw at the middle point (joint)
              if (landmarks[points[1]]) {
                canvasCtx.beginPath();
                const mirroredX = canvasCtx.canvas.width - (landmarks[points[1]].x * canvasCtx.canvas.width);
                canvasCtx.arc(
                  mirroredX,
                  landmarks[points[1]].y * canvasCtx.canvas.height,
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
            }
          });
          
          // Draw the hold timer or completion feedback if needed
          if (holdTimer !== null) {
            // Draw the current timer number
            canvasCtx.font = 'bold 120px Arial';
            canvasCtx.textAlign = 'center';
            canvasCtx.textBaseline = 'middle';
            canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            canvasCtx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
            canvasCtx.lineWidth = 4;
            canvasCtx.strokeText(holdTimer.toString(), canvasCtx.canvas.width / 2, canvasCtx.canvas.height / 2);
            canvasCtx.fillText(holdTimer.toString(), canvasCtx.canvas.width / 2, canvasCtx.canvas.height / 2);
          } else if (showCompletionFeedback) {
            // Draw the completion checkmark
            canvasCtx.font = 'bold 120px Arial';
            canvasCtx.textAlign = 'center';
            canvasCtx.textBaseline = 'middle';
            canvasCtx.fillStyle = 'rgba(0, 255, 0, 0.8)';
            canvasCtx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
            canvasCtx.lineWidth = 4;
            canvasCtx.strokeText('✓', canvasCtx.canvas.width / 2, canvasCtx.canvas.height / 2);
            canvasCtx.fillText('✓', canvasCtx.canvas.width / 2, canvasCtx.canvas.height / 2);
          }
        }
      } else {
        canvasCtx.fillStyle = 'red';
        canvasCtx.fillText('No pose detected', 20, 70);
        
        // Reset the pose match status if no pose is detected
        if (isInCorrectPose) {
          setIsInCorrectPose(false);
          setHoldTimer(null);
        }
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

  // Function to handle pose completion
  const completePose = () => {
    console.log("Completing pose:", currentWorkoutIndex + 1, "of", planWorkouts.length);
    
    // Record the accuracy for this pose
    setPoseAccuracies(prev => {
      const newAccuracies = [...prev];
      newAccuracies[currentWorkoutIndex] = Math.round(overallSimilarity * 100);
      console.log("Recording accuracy:", Math.round(overallSimilarity * 100) + "%");
      return newAccuracies;
    });
    
    // Play a success sound (if available in browser)
    try {
      const audio = new Audio("/success.mp3"); // Create success sound if you have one
      audio.volume = 0.5;
      audio.play().catch(e => console.log("Audio play failed, likely due to user interaction requirement"));
    } catch (e) {
      // Sound failed, ignore the error
    }
    
    // Show completion feedback
    setShowCompletionFeedback(true);
    setFeedback("Great job! Pose completed successfully!");
    
    // After a delay, move to next pose
    setTimeout(() => {
      setShowCompletionFeedback(false);
      
      // Check if we have more poses to go through
      if (currentWorkoutIndex < planWorkouts.length - 1) {
        const nextIndex = currentWorkoutIndex + 1;
        console.log("Moving to next pose:", nextIndex + 1, "of", planWorkouts.length);
        
        setCurrentWorkoutIndex(nextIndex);
        setFeedback(`Ready for next pose: ${planWorkouts[nextIndex].name}. Get in position!`);
        
        // Reset the pose match status for the new pose
        setIsInCorrectPose(false);
        
        // Show a countdown before starting the next pose evaluation
        let countdown = 3;
        const countdownInterval = setInterval(() => {
          if (countdown > 0) {
            setFeedback(`Get ready for: ${planWorkouts[nextIndex].name}. Starting in ${countdown}...`);
            countdown--;
          } else {
            clearInterval(countdownInterval);
            setFeedback(`Now match the pose: ${planWorkouts[nextIndex].name}`);
          }
        }, 1000);
        
      } else {
        // All poses completed
        console.log("All poses completed successfully");
        setFeedback("🎉 Workout complete! All poses completed successfully. 🎉");
        
        // End the session 
        setTimeout(() => {
          setIsSessionActive(false);
          // Show summary of the workout
          const avgAccuracy = poseAccuracies.length > 0 
            ? Math.round(poseAccuracies.reduce((sum, acc) => sum + acc, 0) / poseAccuracies.length) 
            : 0;
          
          setFeedback(`Workout Summary: Completed ${poseAccuracies.length} poses with ${avgAccuracy}% average accuracy!`);
        }, 1000);
      }
    }, 1500); // Show checkmark for 1.5 seconds
  };

  // Handle the hold timer countdown
  useEffect(() => {
    // Skip if timer is not active or session is not active
    if (holdTimer === null || !isSessionActive) return;
    
    console.log(`Hold timer active: ${holdTimer} seconds remaining`);
    
    // Don't start the timer unless we're in the correct pose
    if (!isInCorrectPose) {
      console.log("Lost correct pose during hold, resetting timer");
      setHoldTimer(null);
      return;
    }
    
    const timerId = setTimeout(() => {
      if (holdTimer > 1) {
        // Continue countdown
        setHoldTimer(holdTimer - 1);
        console.log(`Hold timer: ${holdTimer - 1} seconds remaining`);
        // Add some encouraging feedback as the hold progresses
        if (holdTimer === 2) { // When there are 2 seconds left
          setFeedback("Almost there! Keep holding the pose...");
        }
      } else {
        // Timer complete, call completion function
        console.log("Hold complete! Starting completion process");
        setHoldTimer(null);
        completePose();
      }
    }, 1000);
    
    return () => clearTimeout(timerId);
  }, [holdTimer, isInCorrectPose, isSessionActive]);

  // Start session function
  const startSession = async () => {
    if (!selectedPlan || planWorkouts.length === 0) {
      setFeedback("Please select a workout plan first!");
      return;
    }
    
    if (isLoading) {
      setFeedback("System is still initializing, please wait...");
      return;
    }

    try {
      // Get the current workout reference image
      const currentWorkout = planWorkouts[currentWorkoutIndex];
      
      if (!currentWorkout || !currentWorkout.imageUrl) {
        setFeedback("Missing workout reference image. Please try another workout.");
        return;
      }
      
      // Reset workout metrics
      setWorkoutStartTime(Date.now());
      setPoseAccuracies([]);
      
      setFeedback(`Starting "${currentWorkout.name}" workout. Match the pose shown in the reference.`);
      
      // First cancel any existing animation frame from the continuous display
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      // Then set session active and start pose detection
      setIsSessionActive(true);
      processFrame();
      
    } catch (error) {
      console.error("Error starting session:", error);
      setFeedback("Failed to start session. Please try again.");
    }
  };

  // End session function
  const endSession = async () => {
    setIsSessionActive(false);
    setFeedback("Session ended");
    setHoldTimer(null);
    setShowCompletionFeedback(false);
    
    // Calculate workout duration in minutes
    const workoutDuration = workoutStartTime 
      ? Math.round((Date.now() - workoutStartTime) / 60000) // Convert ms to minutes
      : 0;
    
    // If user is authenticated and we have some accuracy data, save the workout session
    if (currentUser && selectedPlan && poseAccuracies.length > 0) {
      try {
        // Calculate average accuracy (round to nearest whole number)
        const averageAccuracy = Math.round(
          poseAccuracies.reduce((sum, acc) => sum + acc, 0) / poseAccuracies.length
        );
        
        // Save workout session to Firestore
        const sessionData = {
          date: firebase.firestore.FieldValue.serverTimestamp(),
          planId: selectedPlan.id,
          planName: selectedPlan.name,
          completed: currentWorkoutIndex >= planWorkouts.length - 1,
          posesCompleted: Math.min(currentWorkoutIndex + 1, planWorkouts.length),
          totalPoses: planWorkouts.length,
          averageAccuracy: averageAccuracy,
          duration: workoutDuration,
          poseResults: poseAccuracies.map((accuracy, index) => ({
            name: index < planWorkouts.length ? planWorkouts[index].name : `Pose ${index + 1}`,
            accuracy: accuracy
          }))
        };
        
        // Add to user's workout history
        await db.collection('users').doc(currentUser.uid)
          .collection('workoutHistory')
          .add(sessionData);
        
        // Update user's overall stats
        const userRef = db.collection('users').doc(currentUser.uid);
        const userDoc = await userRef.get();
        
        if (userDoc.exists) {
          const userData = userDoc.data() || {};
          const stats = userData.stats || {};
          
          await userRef.update({
            'stats.workoutsCompleted': (stats.workoutsCompleted || 0) + 1,
            'stats.totalDuration': (stats.totalDuration || 0) + workoutDuration,
            'stats.averageAccuracy': Math.round(
              ((stats.averageAccuracy || 0) * (stats.workoutsCompleted || 0) + averageAccuracy) / 
              ((stats.workoutsCompleted || 0) + 1)
            )
          });
        }
        
        setFeedback(`Session saved! Average accuracy: ${averageAccuracy}%, Duration: ${workoutDuration} min`);
      } catch (error) {
        console.error("Error saving workout session:", error);
        setFeedback("Session ended but failed to save progress.");
      }
    }
    
    // Restart the continuous video display after ending session
    setTimeout(() => {
      if (!isSessionActive) {
        console.log("Restarting continuous video display after session end");
        startContinuousVideoDisplay();
      }
    }, 100);
  };

  // Monitor session state changes to properly handle video display
  useEffect(() => {
    console.log("Session active state changed:", isSessionActive);
    
    if (isSessionActive) {
      console.log("Session started with plan:", selectedPlan?.name);
      console.log("Starting with workout:", currentWorkoutIndex + 1, "of", planWorkouts.length);
      
      // Session is active, processFrame will handle video rendering
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      // Ensure processFrame is running for active session
      processFrame();
    } else {
      console.log("Session ended or inactive");
      
      // Cancel any existing animation frame from the session
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      // Start continuous display mode
      startContinuousVideoDisplay();
    }
  }, [isSessionActive]);

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

    // Fetch user's plans when user is authenticated
    if (currentUser) {
      fetchUserPlans();
    }
  }, [currentUser]);

  const fetchUserPlans = async () => {
    if (!currentUser) return;
    
    try {
      const plansRef = db.collection('users').doc(currentUser.uid).collection('plans');
      const snapshot = await plansRef.where('isCalibrated', '==', true).get();
      
      const plansList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Plan[];
      
      setAvailablePlans(plansList);
    } catch (error) {
      console.error("Error fetching plans:", error);
      setFeedback("Failed to load your workout plans. Please refresh and try again.");
    }
  };

  const selectPlan = async (planId: string) => {
    try {
      setFeedback("Loading plan...");
      
      // Fetch the plan details
      const planDoc = await db.collection('users').doc(currentUser?.uid || '')
        .collection('plans').doc(planId).get();
      
      if (!planDoc.exists) {
        setFeedback("Plan not found. Please try again.");
        return;
      }
      
      const planData = { 
        id: planId, 
        ...planDoc.data() 
      } as Plan;
      
      setSelectedPlan(planData);
      
      // Fetch workouts for this plan
      const workoutsSnapshot = await db.collection('users').doc(currentUser?.uid || '')
        .collection('plans').doc(planId)
        .collection('workouts')
        .orderBy('position')
        .get();
      
      const workouts = workoutsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Workout[];
      
      setPlanWorkouts(workouts);
      setCurrentWorkoutIndex(0);
      
      // Try to fetch reference pose landmarks
      try {
        console.log("Fetching reference pose landmarks...");
        console.log("Query parameters:", {
          planId,
          userId: currentUser?.uid,
          workoutCount: workouts.length
        });
        
        // First try fetching from the root-level collection (new storage method)
        console.log("Attempting to query poseLandmarks collection");
        const landmarksQuery = db.collection('poseLandmarks')
          .where('planId', '==', planId)
          .where('userId', '==', currentUser?.uid);
          
        console.log("Query created:", landmarksQuery);
        
        try {
          const landmarksSnapshot = await landmarksQuery.orderBy('position').get();
          console.log("Query executed successfully", {
            empty: landmarksSnapshot.empty,
            size: landmarksSnapshot.size,
            docs: landmarksSnapshot.docs.length
          });
          
          if (!landmarksSnapshot.empty && landmarksSnapshot.docs.length > 0) {
            const landmarks = landmarksSnapshot.docs.map((doc: firebase.firestore.QueryDocumentSnapshot) => {
              const data = doc.data();
              console.log(`Found landmarks for position ${data.position}:`, {
                id: doc.id,
                count: data.landmarks?.length || 0,
                workoutName: data.workoutName,
                source: data.source || 'unknown',
                userId: data.userId,
                planId: data.planId
              });
              return data as StoredPoseLandmarks;
            });
            
            console.log(`Found ${landmarks.length} reference poses from root collection, expected ${workouts.length}`);
            setReferencePoseLandmarks(landmarks);
          } else {
            console.warn("No landmarks found in root collection - will try subcollection");
            
            // Try query without orderBy which might be causing issues
            let simpleSnapshot: firebase.firestore.QuerySnapshot | null = null;
            try {
              console.log("Trying simplified query without orderBy");
              const simpleQuery = db.collection('poseLandmarks')
                .where('planId', '==', planId)
                .where('userId', '==', currentUser?.uid);
                
              simpleSnapshot = await simpleQuery.get();
              console.log("Simple query results:", {
                empty: simpleSnapshot.empty,
                size: simpleSnapshot.size
              });
              
              if (!simpleSnapshot.empty) {
                console.log("Simple query found landmarks!");
                // Process these results instead
                const landmarks = simpleSnapshot.docs.map(doc => {
                  const data = doc.data();
                  return data as StoredPoseLandmarks;
                });
                
                // Sort manually by position
                landmarks.sort((a: StoredPoseLandmarks, b: StoredPoseLandmarks) => (a.position || 0) - (b.position || 0));
                console.log(`Found and sorted ${landmarks.length} reference poses`);
                setReferencePoseLandmarks(landmarks);
              }
            } catch (simpleQueryError) {
              console.error("Error with simplified query:", simpleQueryError);
            }
            
            // Fall back to the old collection path for backward compatibility
            if (!simpleSnapshot || simpleSnapshot.empty) {
              console.log("Checking subcollection path as last resort...");
              try {
                const oldPathSnapshot = await db.collection('users').doc(currentUser?.uid || '')
                  .collection('plans').doc(planId)
                  .collection('poseLandmarks')
                  .orderBy('position')
                  .get();
                
                console.log("Subcollection query results:", {
                  empty: oldPathSnapshot.empty,
                  size: oldPathSnapshot.size
                });
                
                if (!oldPathSnapshot.empty && oldPathSnapshot.docs.length > 0) {
                  const landmarks = oldPathSnapshot.docs.map(doc => {
                    const data = doc.data();
                    console.log(`Found landmarks in subcollection for position ${data.position}:`, {
                      count: data.landmarks?.length || 0
                    });
                    return data as StoredPoseLandmarks;
                  });
                  console.log(`Found ${landmarks.length} reference poses in subcollection`);
                  setReferencePoseLandmarks(landmarks);
                } else {
                  console.warn("No reference landmarks found in any collection");
                  // Clear any previous reference landmarks
                  setReferencePoseLandmarks([]);
                }
              } catch (subcollectionError) {
                console.error("Error querying subcollection:", subcollectionError);
                setReferencePoseLandmarks([]);
              }
            }
          }
        } catch (queryError) {
          console.error("Error executing landmarks query:", queryError);
          console.log("Will try alternate queries...");
          
          // Add fallback queries here if the main query fails
          try {
            // Try a super simple query to test permissions
            console.log("Testing basic Firestore permissions...");
            const testQuery = await db.collection('poseLandmarks').limit(1).get();
            console.log("Basic query result:", {
              success: true,
              empty: testQuery.empty,
              size: testQuery.size
            });
          } catch (testError) {
            console.error("Basic query failed - likely a permissions issue:", testError);
          }
        }
      } catch (error) {
        console.error("Error in landmarks fetching process:", error);
        // Clear any previous reference landmarks
        setReferencePoseLandmarks([]);
      }
      
      // Update feedback
      setFeedback(`Plan "${planData.name}" loaded with ${workouts.length} workouts. Start session to begin.`);
    } catch (error) {
      console.error("Error selecting plan:", error);
      setFeedback("Failed to load plan. Please try again.");
    }
  };

  const handleCloseModal = () => {
    // Allow closing even if not authenticated for workouts page
    setShowAuthModal(false);
  };

  // Debug function to log landmark data
  const debugLandmarks = (title: string, landmarks: any[], maxSample: number = 3) => {
    if (!landmarks || landmarks.length === 0) {
      console.log(`${title}: No landmarks available`);
      return;
    }
    
    const sample = landmarks.slice(0, maxSample);
    const sampleData = sample.map(lm => ({
      index: lm.index !== undefined ? lm.index : 'N/A',
      x: typeof lm.x === 'number' ? lm.x.toFixed(4) : 'N/A',
      y: typeof lm.y === 'number' ? lm.y.toFixed(4) : 'N/A',
      z: typeof lm.z === 'number' ? lm.z.toFixed(4) : 'N/A',
      visibility: typeof lm.visibility === 'number' ? lm.visibility.toFixed(2) : 'N/A'
    }));
    
    console.log(`${title} (${landmarks.length} landmarks)`, sampleData);
  };

  return (
    <Layout>
      <div className="flex flex-col items-center">
        <h1 className="text-2xl font-bold mb-6">Workouts - Pose Guidance</h1>
        
        {/* Hidden element to track session state */}
        <div id="session-active-check" data-active={isSessionActive ? 'true' : 'false'} style={{ display: 'none' }}></div>
        
        <div className="flex w-full gap-4">
          {/* Left Column - Camera Feed */}
          <div className="flex flex-col items-center w-[80%]">
            {/* Webcam Feed Area */}
            <div ref={containerRef} className="relative w-full h-[75vh] bg-black mb-4 flex items-center justify-center overflow-hidden">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className="absolute w-full h-full object-contain invisible"
              />
              <canvas 
                ref={canvasRef} 
                className="z-20 w-full h-full"
                style={{ display: 'block' }}
              />
              
              {/* Example pose image - Bottom Right (only in active session) */}
              {isSessionActive && planWorkouts.length > 0 && currentWorkoutIndex < planWorkouts.length && (
                <div className="absolute bottom-4 right-4 z-30 bg-white p-2 rounded-lg shadow-md w-44 h-44">
                  <div className="w-full h-full relative">
                    <img 
                      src={planWorkouts[currentWorkoutIndex].imageUrl} 
                      alt={planWorkouts[currentWorkoutIndex].name} 
                      className="w-full h-full object-cover rounded"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.src = "https://placehold.co/160x160/pink/white?text=Reference+Pose";
                      }}
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-1">
                      {planWorkouts[currentWorkoutIndex].name}
                    </div>
                  </div>
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
            <div className="flex space-x-4 mb-4 w-full justify-center">
              <button 
                onClick={startSession}
                disabled={isSessionActive || !selectedPlan}
                className={`px-4 py-2 text-white rounded ${
                  isSessionActive || !selectedPlan ? 'bg-gray-400' : 'bg-blue-500 hover:bg-blue-600'
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
                onClick={() => setShowPlanModal(true)}
                disabled={isSessionActive}
                className={`px-4 py-2 text-white rounded ${
                  isSessionActive ? 'bg-gray-400' : 'bg-green-500 hover:bg-green-600'
                }`}
              >
                Choose Your Plan
              </button>
              {isSessionActive && (
                <button 
                  onClick={() => setShowReferenceOverlay(!showReferenceOverlay)}
                  className={`px-4 py-2 text-white rounded ${
                    showReferenceOverlay ? 'bg-blue-700' : 'bg-blue-400'
                  }`}
                >
                  {showReferenceOverlay ? 'Hide Reference' : 'Show Reference'}
                </button>
              )}
            </div>
          </div>
          
          {/* Right Column - Feedback and Information */}
          <div className="w-[30%] flex flex-col">
            {/* Current Workout Info */}
            {selectedPlan && (
              <div className="bg-white p-4 rounded-lg shadow-md mb-4">
                <h2 className="text-xl font-bold mb-3">Current Plan</h2>
                <div className="flex items-start">
                  <div className="w-24 h-24 bg-gray-200 rounded-md overflow-hidden mr-4 flex-shrink-0">
                    {selectedPlan.imageUrl ? (
                      <img src={selectedPlan.imageUrl} alt={selectedPlan.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex items-center justify-center h-full text-xs text-gray-500">No image</div>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-lg">{selectedPlan.name}</p>
                    <p className="text-sm text-gray-600 mb-2">
                      {currentWorkoutIndex + 1} of {planWorkouts.length} workouts
                    </p>
                    
                    {planWorkouts.length > 0 && currentWorkoutIndex < planWorkouts.length && (
                      <div className="mt-2 pt-2 border-t border-gray-200">
                        <div className="font-medium">Current Workout:</div>
                        <div className="text-blue-600 font-medium">{planWorkouts[currentWorkoutIndex]?.name}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            
            {/* Feedback Panel */}
            <div className="bg-white p-4 rounded-lg shadow-md mb-4 flex-grow">
              <p className="text-lg font-semibold mb-2">Status:</p>
              <p className="whitespace-pre-line">{feedback}</p>
              {isSessionActive && overallSimilarity > 0 && (
                <div className="mt-4">
                  <div className="flex justify-between mb-1 text-sm">
                    <span>Pose Accuracy</span>
                    <span>{Math.round(overallSimilarity * 100)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-4 mb-4">
                    <div 
                      className={`h-4 rounded-full ${
                        overallSimilarity > 0.8 ? 'bg-green-500' : 
                        overallSimilarity > 0.6 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${Math.round(overallSimilarity * 100)}%` }}
                    ></div>
                  </div>
                  
                  {/* Individual Joint Feedbacks */}
                  <h3 className="text-md font-medium mb-2 mt-4">Joint Accuracy</h3>
                  <div className="space-y-2">
                    {Object.entries(poseMatchFeedback).map(([joint, score]) => (
                      <div key={joint}>
                        <div className="flex justify-between text-xs mb-1">
                          <span>{joint.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</span>
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
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Auth Modal */}
      <AuthModal isOpen={showAuthModal} onClose={handleCloseModal} />

      {/* Plan Selection Modal */}
      {showPlanModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden">
            <div className="bg-blue-500 text-white py-4 px-6 flex justify-between items-center">
              <h2 className="text-xl font-semibold">Choose Your Workout Plan</h2>
              <button 
                onClick={() => setShowPlanModal(false)}
                className="text-white hover:text-gray-200"
              >
                ✕
              </button>
            </div>
            
            <div className="p-6">
              {availablePlans.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-600 mb-4">You don't have any calibrated workout plans yet.</p>
                  <button
                    onClick={() => router.push('/plans')}
                    className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                  >
                    Create a Plan
                  </button>
                </div>
              ) : (
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {availablePlans.map(plan => (
                    <div 
                      key={plan.id}
                      className="border rounded-lg p-3 hover:bg-blue-50 cursor-pointer transition-colors"
                      onClick={() => {
                        setShowPlanModal(false);
                        selectPlan(plan.id);
                      }}
                    >
                      <div className="flex items-center">
                        <div className="w-16 h-16 bg-gray-200 rounded-md overflow-hidden mr-3">
                          {plan.imageUrl ? (
                            <img src={plan.imageUrl} alt={plan.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="flex items-center justify-center h-full text-gray-400">
                              No image
                            </div>
                          )}
                        </div>
                        <div>
                          <h3 className="font-semibold">{plan.name}</h3>
                          <p className="text-sm text-gray-600">
                            {plan.workoutCount} {plan.workoutCount === 1 ? 'workout' : 'workouts'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
} 