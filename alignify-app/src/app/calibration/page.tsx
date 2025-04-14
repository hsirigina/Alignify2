"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/contexts/AuthContext';
import firebase from 'firebase/compat/app';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { db, storage } from '@/lib/firebase';

// Define a proper interface for landmarks at the top of the file
interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

interface StoredPoseLandmark {
  index: number;
  x: number;
  y: number;
  z: number;
  visibility: number;
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
            width: { ideal: 1280 },
            height: { ideal: 720 }
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
    
    // Set canvas dimensions to match video
    const videoWidth = videoRef.current.videoWidth || videoRef.current.clientWidth;
    const videoHeight = videoRef.current.videoHeight || videoRef.current.clientHeight;
    
    if (videoWidth <= 0 || videoHeight <= 0) {
      console.warn("Invalid video dimensions for canvas setup, will retry");
      setTimeout(setupCanvas, 100);
      return;
    }
    
    try {
      // Set canvas dimensions
      canvasRef.current.width = videoWidth;
      canvasRef.current.height = videoHeight;
      
      console.log(`Canvas dimensions set to ${canvasRef.current.width}x${canvasRef.current.height}`);
      
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
    } catch (err) {
      console.error("Error setting up canvas:", err);
    }
  };

  // Draw pose landmarks manually using canvas API
  const drawLandmarks = (ctx: CanvasRenderingContext2D, landmarks: any[]) => {
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
  const drawConnections = (ctx: CanvasRenderingContext2D, landmarks: any[]) => {
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
      
      // Draw the video frame onto the canvas
      canvasCtx.drawImage(
        videoRef.current, 
        0, 0, 
        canvasRef.current.width, 
        canvasRef.current.height
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
          
          // Use smoothed landmarks for drawing
          const landmarks = smoothed;
          
          drawConnections(canvasCtx, landmarks);
          drawLandmarks(canvasCtx, landmarks);
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
    
    // Don't cancel animation frame during retake - it should continue
    console.log("Clearing captured image for retake");
    
    // Clear the captured image
    setCapturedImage(null);
    
    // Brief pause to let state update
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Make sure animation is running
    if (!animationFrameRef.current) {
      console.log("No animation frame during retake, restarting detection");
      startPoseDetection();
    } else {
      console.log("Animation frame already running during retake");
    }
  };

  // Moving to the next step in calibration
  const moveToNextStep = async (nextStep: number) => {
    console.log(`Preparing to move to step ${nextStep} of ${workoutCount}`);
    
    try {
      // Update state first
      setCurrentStep(nextStep);
      
      // Clear captured image
      setCapturedImage(null);
      
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
        // Already handled in the restartVideo function
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
            videoRef.current.play().catch(err => {
              console.error("Error playing video in fallback:", err);
            });
          }
        } catch (err) {
          console.error("Fallback camera initialization failed:", err);
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
    // Add debugging to check required fields
    console.log("Save workout triggered with:", {
      planId,
      hasUser: !!currentUser,
      userId: currentUser?.uid,
      hasImage: !!capturedImage,
      imageLength: capturedImage ? capturedImage.substring(0, 20) + "..." : "null",
      workoutName,
      isSubmitting
    });
    
    if (!planId) {
      console.error("Missing planId");
      setError("Missing plan ID. Please try again.");
      return;
    }
    
    if (!currentUser) {
      console.error("No user is signed in");
      setError("You must be signed in to save workouts.");
      return;
    }
    
    if (!capturedImage) {
      console.error("No image captured");
      setError("Please capture an image before saving.");
      return;
    }
    
    if (!workoutName || workoutName.trim() === "") {
      console.error("Missing or empty workout name");
      setError("Please enter a workout name.");
      return;
    }
    
    if (isSubmitting) {
      console.warn("Already submitting, please wait...");
      return;
    }
    
    try {
      // Set submitting state to true to prevent multiple clicks
      setIsSubmitting(true);
      setLoading(true);
      
      console.log("Starting save process for workout " + currentStep);
      
      // Stop the animation frame during save to avoid race conditions
      if (animationFrameRef.current) {
        console.log("Stopping animation frame during save");
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      // Upload image to Firebase Storage
      if (!storage) {
        console.error("Firebase storage is not initialized");
        throw new Error("Firebase storage module not found");
      }
      
      // Verify Firebase storage is working properly
      console.log("Verifying Firebase storage", { 
        hasStorage: !!storage,
        hasRef: !!storage.ref,
        storageBucket: storage.app.options.storageBucket 
      });
      
      console.log("Uploading image to Firebase Storage");
      const storageRef = storage.ref();
      const imageRef = storageRef.child(`users/${currentUser.uid}/plans/${planId}/workouts/workout_${currentStep}.png`);
      
      // Convert data URL to blob
      const response = await fetch(capturedImage);
      const blob = await response.blob();
      
      // Upload the image
      const uploadTask = await imageRef.put(blob);
      const imageUrl = await uploadTask.ref.getDownloadURL();
      console.log("Image uploaded successfully, URL:", imageUrl.substring(0, 50) + "...");
      
      // Save workout to Firestore
      console.log("Saving workout data to Firestore");
      const workoutData = {
        name: workoutName,
        imageUrl: imageUrl,
        position: currentStep,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      
      const workoutsRef = db.collection('users').doc(currentUser.uid)
        .collection('plans').doc(planId)
        .collection('workouts');
      
      const workoutDoc = await workoutsRef.add(workoutData);
      console.log("Workout saved with ID:", workoutDoc.id);
      
      // EXTRACT LANDMARKS DIRECTLY HERE INSTEAD OF IN SEPARATE FUNCTION
      console.log("Starting landmark extraction process");
      
      try {
        // Create a new Image from capturedImage
        const img = new Image();
        
        // Define what happens when image loads
        await new Promise<void>((resolve, reject) => {
          img.onload = () => {
            console.log("Reference image loaded successfully:", {
              width: img.width, 
              height: img.height
            });
            resolve();
          };
          
          img.onerror = (err) => {
            console.error("Image failed to load:", err);
            reject(err);
          };
          
          // Set source to trigger loading
          img.src = capturedImage;
          
          // Add timeout in case image never loads
          setTimeout(() => {
            console.log("Image load timeout triggered");
            resolve();
          }, 2000);
        });
        
        // Create a temporary canvas
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width || 640;  // Fallback size if image dimensions are zero
        tempCanvas.height = img.height || 480;
        
        console.log("Created temp canvas with dimensions:", {
          width: tempCanvas.width,
          height: tempCanvas.height
        });
        
        const tempCtx = tempCanvas.getContext('2d');
        
        if (tempCtx) {
          // Draw the image to canvas
          tempCtx.drawImage(img, 0, 0);
          console.log("Drew image to temporary canvas");
          
          // Try to detect landmarks using IMAGE mode landmarker
          if (imagePoseLandmarkerRef.current) {
            try {
              console.log("Using IMAGE mode landmarker for detection");
              const results = await imagePoseLandmarkerRef.current.detect(tempCanvas);
              
              console.log("Detection results:", {
                hasResults: !!results,
                hasLandmarks: results?.landmarks ? true : false,
                landmarkCount: results?.landmarks?.[0]?.length || 0
              });
              
              if (results && results.landmarks && results.landmarks.length > 0) {
                // Format landmarks for storage using the defined interface
                const formattedLandmarks = results.landmarks[0].map((landmark, index: number): StoredPoseLandmark => {
                  // Use type assertion to ensure landmark is treated as PoseLandmark
                  const poseLandmark = landmark as PoseLandmark;
                  return {
                    index,
                    x: parseFloat(poseLandmark.x.toFixed(5)),
                    y: parseFloat(poseLandmark.y.toFixed(5)),
                    z: parseFloat(poseLandmark.z.toFixed(5)),
                    visibility: parseFloat((poseLandmark.visibility || 1).toFixed(5))
                  };
                });
                
                console.log(`Formatted ${formattedLandmarks.length} landmarks for storage`);
                
                // Store landmarks in Firestore
                const landmarksData = {
                  landmarks: formattedLandmarks,
                  position: currentStep,
                  workoutId: workoutDoc.id,
                  workoutName: workoutName,
                  planId: planId,
                  userId: currentUser.uid,
                  source: "image",
                  createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                
                // Save to root collection
                const landmarkDocRef = await db.collection('poseLandmarks').add(landmarksData);
                
                console.log("Saved landmarks to Firestore with ID:", landmarkDocRef.id);
                
                // Update workout with landmark reference
                await workoutDoc.update({
                  landmarksId: landmarkDocRef.id,
                  landmarksCount: formattedLandmarks.length
                });
                
                console.log("Updated workout with landmark reference");
              } else {
                console.warn("No landmarks detected in the image");
              }
            } catch (error) {
              console.error("Error during landmark detection:", error);
            }
          } else {
            console.warn("Image pose landmarker not initialized");
          }
        }
      } catch (landmarkError) {
        console.error("Error in landmark extraction process:", landmarkError);
        // Continue with the save process even if landmark extraction fails
      }
      
      // If this is the first workout, use it as the plan thumbnail
      if (currentStep === 1) {
        console.log("Setting plan thumbnail image");
        await db.collection('users').doc(currentUser.uid)
          .collection('plans').doc(planId)
          .update({ imageUrl: imageUrl });
      }
      
      // Move to next step or finish
      if (currentStep < workoutCount) {
        // Prepare for next step
        const nextStep = currentStep + 1;
        
        // First clear the state before moving to next step
        setCapturedImage(null);
        setWorkoutName("");
        
        console.log(`Moving to step ${nextStep} of ${workoutCount}`);
        await moveToNextStep(nextStep);
      } else {
        // All steps complete
        console.log("All calibration steps complete!");
        
        // Update plan with completion status
        await db.collection('users').doc(currentUser.uid)
          .collection('plans').doc(planId)
          .update({ isCalibrated: true });
        
        // Reset the submitting state before redirecting
        setIsSubmitting(false);
        
        // Redirect to plan details page
        console.log("Redirecting to plan details page");
        router.push(`/plans/${planId}`);
      }
    } catch (err: any) {
      console.error("Error saving workout:", err);
      setError("Failed to save workout: " + err.message);
      setLoading(false);
      setIsSubmitting(false);  // Reset submitting state on error
    }
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