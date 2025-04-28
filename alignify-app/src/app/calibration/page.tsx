"use client";

import React, { useState, useEffect, useRef, ChangeEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/contexts/AuthContext';
import { FilesetResolver, PoseLandmarker, NormalizedLandmark as MediaPipeNormalizedLandmark } from '@mediapipe/tasks-vision';
import { db, storage } from '@/lib/firebase';
import { getAuth, User } from 'firebase/auth';
import { useAuthState } from 'react-firebase-hooks/auth';
import { v4 as uuidv4 } from 'uuid';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, setDoc, serverTimestamp, collection, addDoc, getDoc, updateDoc, query, where, getDocs, updateDoc as firestoreUpdateDoc } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { uploadString } from 'firebase/storage';
import toast from 'react-hot-toast';

// Define interface for MediaPipe pose landmark
interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

// Define our own interface matching MediaPipe's normalized landmark structure
interface LocalNormalizedLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

// Define interfaces for landmark data
interface SimpleLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

// Define interface for stored landmarks collection
interface StoredPoseLandmarks {
  landmarks: StoredPoseLandmark[];
  position: number;
  workoutId: string;
  timestamp: Date;
  userId: string;
  planId: string;
}

// Define interface for stored pose landmarks
interface StoredPoseLandmark {
  index: number;
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

interface Exercise {
  id: string;
  name: string;
  description?: string;
}

interface WorkoutPlan {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  userId: string;
  exercises: Exercise[];
  createdAt: any;
}

export default function CalibrationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planId = searchParams.get('planId');
  const { currentUser } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>("");
  const [planDetails, setPlanDetails] = useState<any>(null);
  const [workoutCount, setWorkoutCount] = useState(3);
  const [currentStep, setCurrentStep] = useState(1);
  const [workoutName, setWorkoutName] = useState("");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isMPReady, setIsMPReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const imagePoseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const smoothedLandmarks = useRef<Array<any[]>>([]);
  const smoothingWindowSize = 5;
  
  // Load plan details on mount
  useEffect(() => {
    if (!planId || !currentUser) {
      console.log("Initial auth check:", {
        planId,
        isUserAuthenticated: !!currentUser,
        userId: currentUser?.uid
      });
      
      if (!planId) {
        setError("Missing plan ID in URL parameters");
        setLoading(false);
      } else if (!currentUser) {
        setError("You must be signed in to use this feature");
        setLoading(false);
      }
      
      return;
    }
    
    const fetchPlanDetails = async () => {
      try {
        console.log("Fetching plan details for:", {
          planId,
          userId: currentUser.uid
        });
        
        const docRef = db.collection('users').doc(currentUser.uid)
          .collection('plans').doc(planId);
        
        const doc = await docRef.get();
        
        if (doc.exists) {
          console.log("Plan details found:", doc.data());
          setPlanDetails(doc.data());
          if (doc.data()?.workoutCount) {
            setWorkoutCount(doc.data()?.workoutCount);
          }
        } else {
          console.error("Plan document not found");
          setError("Plan not found");
        }
        
        setLoading(false);
      } catch (err) {
        console.error("Error fetching plan:", err);
        setError("Failed to fetch plan details");
        setLoading(false);
      }
    };
    
    fetchPlanDetails();
  }, [planId, currentUser]);
  
  // Initialize MediaPipe and webcam on mount
  useEffect(() => {
    let mounted = true;
    let stream: MediaStream | null = null;
    
    const initMediaPipe = async () => {
      try {
        // Initialize FilesetResolver
        console.log("Initializing MediaPipe and camera...");
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm"
        );
        
        if (!mounted) return;
        
        // Initialize PoseLandmarker for video
        console.log("Initializing PoseLandmarker for video with options:", {
          modelPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate: "GPU",
          runningMode: "VIDEO"
        });
        
        poseLandmarkerRef.current = await PoseLandmarker.createFromOptions(
          vision,
          {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
              delegate: "GPU"
            },
            runningMode: "VIDEO",
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
            outputSegmentationMasks: false
          }
        );
        
        // Also initialize a separate PoseLandmarker for static images
        console.log("Initializing separate PoseLandmarker for static images");
        try {
          imagePoseLandmarkerRef.current = await PoseLandmarker.createFromOptions(
            vision,
            {
              baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
                delegate: "GPU"
              },
              runningMode: "IMAGE",
              numPoses: 1,
              minPoseDetectionConfidence: 0.5,
              minPosePresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
              outputSegmentationMasks: false
            }
          );
          console.log("Image PoseLandmarker initialized successfully");
        } catch (imageInitErr) {
          console.error("Failed to initialize image PoseLandmarker:", imageInitErr);
        }
        
        if (!mounted) return;
        setIsMPReady(true);
        console.log("MediaPipe initialized successfully");
        
        // Now initialize the camera separately
        await initCamera();
      } catch (err: any) {
        console.error("Error initializing MediaPipe:", err);
        setCameraError(err.message || "Error initializing MediaPipe");
        setLoading(false);
      }
    };
    
    const initCamera = async () => {
      if (!mounted) return;
      
      try {
        console.log("Initializing camera...");
        // First make sure any existing stream is properly cleaned up
        if (videoRef.current?.srcObject) {
          const oldStream = videoRef.current.srcObject as MediaStream;
          oldStream.getTracks().forEach(track => track.stop());
          videoRef.current.srcObject = null;
          // Brief pause to let cleanup happen
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        if (!mounted) return;
        
        // Request camera with specific constraints
        const constraints = {
          video: {
            facingMode: "user",
            width: { ideal: 1600 },
            height: { ideal: 1000 },
            aspectRatio: 16/10 // Force 16:10 aspect ratio to match workouts page
          }
        };
        
        console.log("Requesting camera access with constraints:", constraints);
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (!mounted || !videoRef.current) return;
        
        // Set the stream to the video element
        videoRef.current.srcObject = stream;
        console.log("Stream assigned to video element");
        
        // Clear any previous event handlers
        videoRef.current.onloadedmetadata = null;
        videoRef.current.onplaying = null;
        
        // Set up event handlers
        videoRef.current.onloadedmetadata = () => {
          console.log("Video metadata loaded, dimensions:", 
            videoRef.current?.videoWidth, "x", videoRef.current?.videoHeight);
          
          if (!mounted || !videoRef.current) return;
          
          // Play the video after metadata is loaded
          videoRef.current.play().then(() => {
            console.log("Video playing successfully");
            if (!mounted) return;
            
            // Only set up canvas and start detection after video is actually playing
            setupCanvas();
            startPoseDetection();
            setLoading(false);
          }).catch(e => {
            console.error("Error playing video:", e);
            setCameraError("Could not start video playback. Please check camera permissions and try again.");
            setLoading(false);
          });
        };
        
        // Handle errors
        videoRef.current.onerror = (e) => {
          console.error("Video element error:", e);
          setCameraError("Video element encountered an error. Please refresh and try again.");
          setLoading(false);
        };
      } catch (err: any) {
        console.error("Error accessing camera:", err);
        setCameraError(err.message || "Error accessing camera");
        setLoading(false);
      }
    };
    
    // Start the initialization process
    initMediaPipe();
    
    // Cleanup function
    return () => {
      console.log("Cleaning up camera resources...");
      mounted = false;
      
      // Stop the camera stream
      if (stream) {
        stream.getTracks().forEach(track => {
          console.log("Stopping camera track:", track.kind, track.id);
          track.stop();
        });
      }
      
      // Stop any ongoing animation frames
      if (animationFrameRef.current) {
        console.log("Cancelling animation frame:", animationFrameRef.current);
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      // Clear the video element
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.onloadedmetadata = null;
        videoRef.current.onplaying = null;
        videoRef.current.onerror = null;
      }
      
      // Clear any MediaPipe resources
      if (poseLandmarkerRef.current) {
        console.log("Closing MediaPipe video landmarker resources");
        poseLandmarkerRef.current.close();
      }
      
      if (imagePoseLandmarkerRef.current) {
        console.log("Closing MediaPipe image landmarker resources");
        imagePoseLandmarkerRef.current.close();
      }
    };
  }, []);
  
  // Clean up animation frame on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);
  
  const setupCanvas = () => {
    if (!videoRef.current || !canvasRef.current) {
      console.error("Video or canvas element not available for setup");
      return;
    }
    
    // Wait for video to be fully loaded with dimensions
    if (videoRef.current.readyState < 2) {
      console.log("Video not ready for canvas setup, will retry");
      setTimeout(setupCanvas, 100);
      return;
    }
    
    // Get the container dimensions (if we're rendering within a container)
    const containerWidth = canvasRef.current.parentElement?.clientWidth || window.innerWidth;
    const containerHeight = canvasRef.current.parentElement?.clientHeight || window.innerHeight;
    
    // Maintain 16:10 aspect ratio exactly like in workouts page
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
    
    console.log(`Canvas resized to ${canvasRef.current.width}x${canvasRef.current.height} with aspect ratio ${aspectRatio}`);
    
    // Draw a test rectangle to verify canvas is working
    const ctx = canvasRef.current.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
      ctx.fillRect(20, 20, 60, 60);
      ctx.fillStyle = 'white';
      ctx.font = '14px Arial';
      ctx.fillText('Canvas Ready', 25, 50);
    } else {
      console.error("Could not get canvas context");
    }
  };

  // Draw pose landmarks manually using canvas API
  const drawLandmarks = (ctx: CanvasRenderingContext2D, landmarks: StoredPoseLandmark[]) => {
    landmarks.forEach((landmark) => {
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
  const drawConnections = (ctx: CanvasRenderingContext2D, landmarks: StoredPoseLandmark[]) => {
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
    ctx.lineWidth = 3;

    connections.forEach(([start, end]) => {
      // Find landmarks by index
      const startLandmark = landmarks.find(lm => lm.index === start);
      const endLandmark = landmarks.find(lm => lm.index === end);
      
      if (startLandmark && endLandmark) {
        const startX = ctx.canvas.width - (startLandmark.x * ctx.canvas.width);
        const startY = startLandmark.y * ctx.canvas.height;
        const endX = ctx.canvas.width - (endLandmark.x * ctx.canvas.width);
        const endY = endLandmark.y * ctx.canvas.height;
        
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
    });
  };
  
  const processFrame = async () => {
    if (!videoRef.current || !canvasRef.current || !poseLandmarkerRef.current) {
      // If essential elements are missing, keep the loop running anyway
      console.log("Essential elements missing for pose detection, will retry");
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }

    // Check if video is ready and has valid dimensions
    if (videoRef.current.readyState < 2 || 
        videoRef.current.videoWidth <= 0 || 
        videoRef.current.videoHeight <= 0) {
      console.log("Video not ready yet or has invalid dimensions, waiting...");
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }

    try {
      const canvasCtx = canvasRef.current.getContext('2d');
      if (!canvasCtx) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }
      
      // Clear the canvas first
      canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      
      // Save the canvas state
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
      
      // Draw the video frame onto the canvas - exactly like in workouts page
      canvasCtx.drawImage(
        videoRef.current, 
        offsetX, offsetY, 
        drawWidth, drawHeight
      );
      
      // Restore the canvas state for drawing landmarks without flipping them again
      canvasCtx.restore();
      
      // Draw a test rectangle and text
      canvasCtx.fillStyle = 'rgba(255, 0, 0, 0.1)';
      canvasCtx.fillRect(10, 10, 200, 40);
      canvasCtx.fillStyle = 'white';
      canvasCtx.font = '20px Arial';
      canvasCtx.fillText('Canvas Active', 20, 35);
      
      // Get current timestamp
      const startTimeMs = performance.now();
      
      // Make sure video dimensions are valid before detection
      if (videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
        // Get results from pose detection
        const results = await poseLandmarkerRef.current.detectForVideo(videoRef.current, startTimeMs);
        
        // Draw pose landmarks if available
        if (results.landmarks && results.landmarks.length > 0) {
          const currentLandmarks = results.landmarks[0].map((landmark, index) => ({
            index,
            x: landmark.x,
            y: landmark.y,
            z: landmark.z,
            visibility: landmark.visibility || 0
          }));
          
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
          const smoothed = currentLandmarks.map((landmark, i) => {
            // For each landmark position
            const avgX = smoothedLandmarks.current.reduce((sum, frame) => 
              sum + (frame[i]?.x || 0), 0) / smoothedLandmarks.current.length;
            const avgY = smoothedLandmarks.current.reduce((sum, frame) => 
              sum + (frame[i]?.y || 0), 0) / smoothedLandmarks.current.length;
            const avgZ = smoothedLandmarks.current.reduce((sum, frame) => 
              sum + (frame[i]?.z || 0), 0) / smoothedLandmarks.current.length;
            const avgVisibility = smoothedLandmarks.current.reduce((sum, frame) => 
              sum + (frame[i]?.visibility || 0), 0) / smoothedLandmarks.current.length;
            
            return {
              index: i,
              x: avgX,
              y: avgY,
              z: avgZ,
              visibility: avgVisibility
            };
          });
          
          // Use smoothed landmarks for drawing
          drawConnections(canvasCtx, smoothed as StoredPoseLandmark[]);
          drawLandmarks(canvasCtx, smoothed as StoredPoseLandmark[]);
          
          // Log number of landmarks for debugging
          if (isCapturing) {
            console.log(`Detected ${smoothed.length} pose landmarks during capture`);
          }
        }
      } else {
        console.warn("Invalid video dimensions, skipping pose detection");
      }
    } catch (error) {
      console.error("Error during pose detection:", error);
      // Don't let errors stop the animation loop
    }
    
    // CRITICAL: only stop the animation loop when we have a captured image
    // AND we're not in the middle of a transition between steps
    if (capturedImage && !isSubmitting) {
      console.log("Stopping animation loop - image captured");
    } else {
      // Continue the animation loop
      animationFrameRef.current = requestAnimationFrame(processFrame);
    }
  };

  const startPoseDetection = () => {
    console.log("Starting pose detection animation loop");
    
    // Always cancel any existing animation frame first
    if (animationFrameRef.current) {
      console.log("Canceling existing animation frame:", animationFrameRef.current);
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Add a DOM attribute to help track state (redundancy mechanism)
    if (videoRef.current) {
      videoRef.current.setAttribute('data-detection-active', 'true');
    }
    
    // Make sure video is playing
    if (videoRef.current && videoRef.current.paused) {
      console.log("Video was paused, attempting to play");
      videoRef.current.play().catch(e => {
        console.error("Error playing video in startPoseDetection:", e);
      });
    }
    
    // Start a new animation frame
    console.log("Requesting new animation frame for pose detection");
    animationFrameRef.current = requestAnimationFrame(processFrame);
  };

  const captureImage = () => {
    if (!videoRef.current || !canvasRef.current) {
      console.error("Video or canvas not available for capture");
      return;
    }
    
    // Prevent multiple capturing sessions
    if (isCapturing) {
      console.warn("Already capturing, ignoring request");
      return;
    }
    
    console.log("Starting image capture with countdown");
    setIsCapturing(true);
    setCountdown(10); // Reset countdown to 10 seconds
    
    // Make sure video is playing and pose detection is active
    if (videoRef.current.paused) {
      console.log("Video was paused, playing before capture");
      videoRef.current.play().catch(err => 
        console.error("Error playing video for capture:", err)
      );
    }
    
    // Ensure the animation frame is running
    console.log("Ensuring pose detection is running during countdown");
    startPoseDetection();
    
    // Countdown for 10 seconds before capture
    const countdownInterval = setInterval(() => {
      setCountdown(prev => {
        const newCount = prev - 1;
        
        if (newCount <= 0) {
          console.log("Countdown complete, capturing image");
          clearInterval(countdownInterval);
          
          try {
            // Make sure we have the latest frame
            if (!canvasRef.current) {
              throw new Error("Canvas not available at capture time");
            }
            
            // Capture image from canvas (which already has pose landmarks drawn)
            const imageDataUrl = canvasRef.current.toDataURL('image/png');
            if (!imageDataUrl || imageDataUrl === 'data:,') {
              throw new Error("Failed to capture image data from canvas");
            }
            
            console.log("Image captured successfully");
            setCapturedImage(imageDataUrl);
            
            // Stop the animation frame now that we have an image
            if (animationFrameRef.current) {
              console.log("Stopping animation frame after capture");
              cancelAnimationFrame(animationFrameRef.current);
              animationFrameRef.current = null;
            }
            
            // Indicate capture is complete
            setIsCapturing(false);
          } catch (error) {
            console.error("Error during image capture:", error);
            setIsCapturing(false);
            // If there was an error capturing, we should keep the animation frame running
            if (!animationFrameRef.current) {
              startPoseDetection();
            }
          }
          
          return 0;
        }
        
        // Force refresh the animation frame periodically during countdown
        // to ensure it doesn't stall
        if (newCount % 3 === 0) {
          console.log(`Refreshing animation frame at countdown ${newCount}`);
          startPoseDetection();
        }
        
        return newCount;
      });
    }, 1000);
  };

  const retakeImage = async () => {
    console.log("Retaking image, cleaning up previous state");
    
    // Prevent multiple simultaneous retake attempts
    if (isCapturing) {
      console.warn("Already capturing, ignoring retake request");
      return;
    }
    
    // Cancel any ongoing animation frames
    if (animationFrameRef.current) {
      console.log("Canceling animation frame for retake:", animationFrameRef.current);
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Clear the captured image
    setCapturedImage(null);
    
    try {
      // Restart the video feed completely
      console.log("Restarting video feed for retake");
      const success = await restartVideo();
      
      if (success) {
        console.log("Video feed successfully restarted for retake");
        
        // Setup canvas for the new video feed
        setupCanvas();
        
        // Start pose detection again
        console.log("Restarting pose detection");
        startPoseDetection();
      } else {
        console.error("Failed to restart video feed for retake");
        setCameraError("Failed to restart camera. Please refresh the page and try again.");
      }
    } catch (error) {
      console.error("Error during retake:", error);
      setCameraError("An error occurred while retaking the image. Please refresh and try again.");
    }
  };

  // Moving to the next step in calibration
  const moveToNextStep = async (nextStep: number) => {
    console.log(`Preparing to move to step ${nextStep} of ${workoutCount}`);
    
    // Set loading state
    setLoading(true);
    
    try {
      // Update state first
      setCurrentStep(nextStep);
      
      // Clear captured image
      setCapturedImage(null);
      
      // Reset important states
      setIsCapturing(false);
      setCountdown(10);
      
      // Draw a simple message on canvas to indicate transition
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          ctx.fillStyle = 'white';
          ctx.font = '24px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('Setting up next step...', canvasRef.current.width/2, canvasRef.current.height/2);
        }
      }
      
      // We DO need to restart the video stream here for the next step
      console.log("Explicitly restarting video feed for next step");
      
      // Stop any existing animation frame - we'll restart it after video is ready
      if (animationFrameRef.current) {
        console.log("Canceling animation frame before restart:", animationFrameRef.current);
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      // Restart the video - this is critical for step transitions
      const videoRestarted = await restartVideo();
      
      if (videoRestarted) {
        console.log("Video successfully restarted for next step");
        
        // Re-setup the canvas
        setupCanvas();
        
        // Start pose detection again
        startPoseDetection();
      } else {
        console.error("Failed to restart video for next step");
        // Try a fallback approach - just reinitialize the camera directly
        console.log("Attempting fallback camera initialization");
        
        try {
          // Stop any existing streams
          if (videoRef.current?.srcObject) {
            const oldStream = videoRef.current.srcObject as MediaStream;
            oldStream.getTracks().forEach(track => track.stop());
            videoRef.current.srcObject = null;
          }
          
          // Request a new stream
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: "user",
              width: { ideal: 1280 },
              height: { ideal: 720 }
            }
          });
          
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play().catch(err => {
              console.error("Error playing video in fallback:", err);
              throw err;
            });
            
            // Setup canvas and start detection
            setupCanvas();
            startPoseDetection();
          }
        } catch (err) {
          console.error("Fallback camera initialization failed:", err);
          setCameraError("Failed to initialize camera. Please refresh and try again.");
        }
      }
      
      // Reset loading and submitting state
      setLoading(false);
      setIsSubmitting(false);
    } catch (error) {
      console.error("Error moving to next step:", error);
      setCameraError("An error occurred while moving to the next step. Please refresh and try again.");
      setLoading(false);
      setIsSubmitting(false);
    }
  };

  const saveWorkout = async () => {
    console.log("saveWorkout called");
    
    if (!planId || !currentUser || !capturedImage || !workoutName || isSubmitting) {
      console.error("Missing required data for saving workout", {
        planId, currentUser: !!currentUser, capturedImage: !!capturedImage,
        workoutName, isSubmitting
      });
      return;
    }

    setIsSubmitting(true);
    console.log("Starting to save workout");

    try {
      // Upload image to Firebase Storage
      const storageRef = ref(storage, `workouts/${currentUser.uid}/${planId}/${Date.now()}.jpg`);
      const snapshot = await uploadString(storageRef, capturedImage, 'data_url');
      const photoURL = await getDownloadURL(snapshot.ref);
      
      console.log("Image uploaded successfully, URL:", photoURL);

      // Prepare workout data for Firestore
      const workoutData = {
        name: workoutName,
        userId: currentUser.uid,
        planId,
        photoURL,
        createdAt: new Date().toISOString(),
      };

      // Save workout to Firestore
      const workoutRef = await addDoc(collection(db, 'workouts'), workoutData);
      console.log("Workout saved to Firestore, ID:", workoutRef.id);

      // Save landmarks if available
      if (poseLandmarkerRef.current && smoothedLandmarks.current.length > 0) {
        console.log("Saving landmarks for pose comparison");
        const landmarks = smoothedLandmarks.current[smoothedLandmarks.current.length - 1];
        
        if (landmarks && landmarks.length > 0) {
          // Format landmarks into a Firebase-friendly format
          // Ensure we're creating simple serializable objects with only necessary properties
          const formattedLandmarks = landmarks.map((landmark: {
            index: number;
            x: number;
            y: number;
            z: number;
            visibility?: number;
          }) => ({
            index: landmark.index,
            x: landmark.x,
            y: landmark.y,
            z: landmark.z,
            visibility: landmark.visibility || 1.0
          }));

          await addDoc(collection(db, 'landmarks'), {
            workoutId: workoutRef.id,
            userId: currentUser.uid,
            planId,
            position: currentStep,
            landmarks: formattedLandmarks,
            createdAt: new Date().toISOString(),
          });
          
          console.log("Landmarks saved successfully");
        } else {
          console.warn("No landmarks detected to save");
        }
      } else {
        console.warn("No pose landmarker results available");
      }

      // If this is the first workout, update the plan thumbnail
      const plansQuery = query(
        collection(db, 'plans'),
        where('id', '==', planId),
        where('userId', '==', currentUser.uid)
      );
      
      const planSnapshot = await getDocs(plansQuery);
      
      if (!planSnapshot.empty) {
        const planDoc = planSnapshot.docs[0];
        const planData = planDoc.data();
        
        if (!planData.thumbnailURL) {
          await firestoreUpdateDoc(doc(db, 'plans', planDoc.id), {
            thumbnailURL: photoURL
          });
          console.log("Plan thumbnail updated");
        }
      }

      toast.success(`Workout "${workoutName}" saved successfully!`);
      
      // If we have more steps, go to the next one
      if (currentStep < workoutCount - 1) {
        moveToNextStep(currentStep + 1);
      } else {
        console.log("Calibration complete! Redirecting to plan details");
        // Otherwise, we're done with calibration
        await firestoreUpdateDoc(doc(db, 'plans', planId), {
          isCalibrated: true
        });
        router.push(`/plans/${planId}`);
      }
    } catch (error) {
      console.error("Error saving workout:", error);
      toast.error("Failed to save workout. Please try again.");
    }
    
    setIsSubmitting(false);
  };

  // Function to explicitly restart the video element
  const restartVideo = async () => {
    console.log("Attempting to restart video feed");
    
    if (!videoRef.current) {
      console.error("Video element not available");
      return false;
    }
    
    try {
      // First completely stop and clean up the existing stream
      if (videoRef.current.srcObject) {
        console.log("Cleaning up existing video stream");
        const existingStream = videoRef.current.srcObject as MediaStream;
        existingStream.getTracks().forEach(track => {
          console.log("Stopping track:", track.kind, track.readyState);
          track.stop();
        });
        
        // Clear the video source
        videoRef.current.srcObject = null;
        
        // Clear any existing event handlers
        videoRef.current.onloadedmetadata = null;
        videoRef.current.onplaying = null;
        videoRef.current.onerror = null;
        
        // Pause to let the browser clean up resources
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // Cancel any ongoing animation frames
      if (animationFrameRef.current) {
        console.log("Canceling animation frame:", animationFrameRef.current);
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      // Request a new camera stream with explicit constraints
      console.log("Requesting new camera stream");
      const constraints = {
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log("New stream obtained with tracks:", stream.getTracks().length);
      
      // Double check the video element is still available
      if (!videoRef.current) {
        console.error("Video element became unavailable");
        stream.getTracks().forEach(track => track.stop());
        return false;
      }
      
      // Assign the new stream to the video element
      videoRef.current.srcObject = stream;
      console.log("New stream assigned to video element");
      
      // Return a promise that resolves when the video is playing
      return new Promise<boolean>((resolve) => {
        if (!videoRef.current) {
          stream.getTracks().forEach(track => track.stop());
          resolve(false);
          return;
        }
        
        // Handle errors
        videoRef.current.onerror = (e) => {
          console.error("Video error during restart:", e);
          resolve(false);
        };
        
        // Use the loadedmetadata event to wait for the video to be ready
        videoRef.current.onloadedmetadata = () => {
          console.log("Video metadata loaded during restart");
          
          if (!videoRef.current) {
            stream.getTracks().forEach(track => track.stop());
            resolve(false);
            return;
          }
          
          // Set up Canvas as soon as metadata is loaded
          if (canvasRef.current) {
            console.log("Setting up canvas after video metadata loaded");
            canvasRef.current.width = videoRef.current.videoWidth;
            canvasRef.current.height = videoRef.current.videoHeight;
            
            // Draw loading message
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
              ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
              ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
              ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
              ctx.fillStyle = 'white';
              ctx.font = '20px Arial';
              ctx.textAlign = 'center';
              ctx.fillText('Starting camera...', canvasRef.current.width/2, canvasRef.current.height/2);
            }
          }
          
          // Wait a moment before playing to avoid browser artifacts
          setTimeout(() => {
            if (!videoRef.current) {
              stream.getTracks().forEach(track => track.stop());
              resolve(false);
              return;
            }
            
            // Now play the video
            videoRef.current.play()
              .then(() => {
                console.log("Video playing successfully after restart");
                
                // Set up canvas again with the final dimensions
                setupCanvas();
                
                // Start pose detection
                startPoseDetection();
                
                console.log("Video restart complete - pose detection started");
                setTimeout(() => resolve(true), 100); // Short delay to ensure rendering has started
              })
              .catch((error) => {
                console.error("Error playing video after restart:", error);
                resolve(false);
              });
          }, 200);
        };
        
        // Set a timeout in case the video never loads
        setTimeout(() => {
          console.warn("Video restart timed out after 5 seconds");
          resolve(false);
        }, 5000);
      });
    } catch (error) {
      console.error("Error restarting video:", error);
      return false;
    }
  };

  // Make sure we reset everything properly between calibration steps
  useEffect(() => {
    // Only run this effect if we're not already in the middle of capturing and don't have a captured image
    if (!isCapturing && !capturedImage && isMPReady) {
      console.log("Resetting pose detection for step", currentStep);
      
      // Cancel any existing animation frame first
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      // Make sure video is playing
      if (videoRef.current && videoRef.current.paused) {
        videoRef.current.play().catch(e => {
          console.error("Error auto-playing video:", e);
        });
      }
      
      // Check if video is ready, and if not, set up a polling mechanism
      const checkVideoAndSetup = () => {
        if (videoRef.current && videoRef.current.readyState >= 2 && 
            videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
          console.log("Video ready for step", currentStep, "- setting up canvas and detection");
          setupCanvas();
          startPoseDetection();
        } else {
          console.log("Video not ready yet for step", currentStep, "- will retry");
          setTimeout(checkVideoAndSetup, 100);
        }
      };
      
      // Short delay to make sure everything is ready
      setTimeout(checkVideoAndSetup, 100);
    }
  }, [capturedImage, isMPReady, currentStep, isCapturing]);

  // Cleanup on component unmount
  useEffect(() => {
    let mounted = true;
    
    return () => {
      mounted = false;
      console.log("Component unmounting, cleaning up resources");
      
      // Cancel any animation frames
      if (animationFrameRef.current) {
        console.log("Canceling animation frame on unmount");
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      // Stop the camera feed
      if (videoRef.current && videoRef.current.srcObject) {
        console.log("Stopping camera feed on unmount");
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => {
          console.log(`Stopping ${track.kind} track`);
          track.stop();
        });
        videoRef.current.srcObject = null;
      }
      
      // Clear any MediaPipe resources
      if (poseLandmarkerRef.current) {
        console.log("Closing MediaPipe video landmarker resources");
        poseLandmarkerRef.current.close();
      }
      
      if (imagePoseLandmarkerRef.current) {
        console.log("Closing MediaPipe image landmarker resources");
        imagePoseLandmarkerRef.current.close();
      }
    };
  }, []);

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
          <button 
            onClick={() => setError(null)} 
            className="ml-2 text-sm underline"
          >
            Dismiss
          </button>
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
            {workoutName === "" && capturedImage && (
              <p className="text-red-500 text-sm mt-1">
                Please enter a workout name before saving
              </p>
            )}
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
                        disabled={!workoutName || workoutName.trim() === "" || isSubmitting}
                        className="flex-1 bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 disabled:bg-green-300"
                      >
                        {isSubmitting ? "Saving..." : (currentStep < workoutCount ? "Save & Continue" : "Complete Calibration")}
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