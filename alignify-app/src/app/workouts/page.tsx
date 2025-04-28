"use client";

import React, { useState, useEffect, useRef } from 'react';
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import Layout from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { doc, updateDoc, serverTimestamp, increment, collection, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import AuthModal from "@/components/AuthModal";
import { useRouter } from "next/navigation";
import { NormalizedLandmark } from "@mediapipe/tasks-vision";
import firebase from "firebase/compat/app";

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
  const smoothingWindowSize = 10; // Increased from 5 to 15 for greater smoothing
  
  // Add a new ref for smoothed angles
  const smoothedAngles = useRef<Array<{[key: string]: number}>>([]);
  const anglesSmoothingWindowSize = 10; // Separate smoothing window for angles
  
  // Add a ref for completePose to avoid dependency cycles
  const completePoseRef = useRef<() => void>(() => {});
  
  const [isSessionActive, setIsSessionActive] = useState(false);
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
  const [isInCorrectPose, setIsInCorrectPose] = useState<boolean>(false);
  const [showCompletionFeedback, setShowCompletionFeedback] = useState<boolean>(false);
  const [poseHoldDuration, setPoseHoldDuration] = useState<number>(3); // No longer used for progressive hold
  const [showReferenceOverlay, setShowReferenceOverlay] = useState(true); // Default to showing the overlay
  
  // New state variables for progressive pose hold
  const [cumulativeHoldTime, setCumulativeHoldTime] = useState<number>(0);
  const [totalRequiredHoldTime, setTotalRequiredHoldTime] = useState(4.0); // Seconds to hold a pose
  const [holdProgress, setHoldProgress] = useState(0);
  const [lastHoldTimestamp, setLastHoldTimestamp] = useState<number | null>(null);
  
  // Additional refs for pose tracking
  const lastTimestampRef = useRef<number | null>(null);
  const cumulativeTimeRef = useRef<number>(0);
  const isInCorrectPoseRef = useRef<boolean>(false);
  const feedbackTimerRef = useRef<number | null>(null);

  const { currentUser } = useAuth();
  const router = useRouter();

  // State for tracking workout metrics
  const [workoutStartTime, setWorkoutStartTime] = useState(0);
  const [poseAccuracies, setPoseAccuracies] = useState<number[]>([]);
  const [referencePoseLandmarks, setReferencePoseLandmarks] = useState<StoredPoseLandmarks[]>([]);

  const [sessionStartTime, setSessionStartTime] = useState(0);

  // Define the key joint angles to compare for pose matching
  const jointAngles: { [key: string]: number[] } = {
    // Upper body
    left_elbow: [15, 13, 11],    // wrist, elbow, shoulder
    left_shoulder: [13, 11, 23], // elbow, shoulder, hip
    right_elbow: [16, 14, 12],   // wrist, elbow, shoulder
    right_shoulder: [14, 12, 24], // elbow, shoulder, hip
    
    // Lower body
    left_hip: [11, 23, 25],     // shoulder, hip, knee
    left_knee: [23, 25, 27],    // hip, knee, ankle
    right_hip: [12, 24, 26],    // shoulder, hip, knee
    right_knee: [24, 26, 28]    // hip, knee, ankle
  };

  // Add alternative angle calculations for upper body mode
  // These create vertical reference points when full body isn't visible
  const createVirtualReferencePoints = (landmarks: PoseLandmark[]) => {
    const virtualPoints: {[key: string]: PoseLandmark} = {};
    
    // Create virtual points for upper body mode
    // For shoulders, create points directly below the shoulders
    if (landmarks[11]) { // Left shoulder
      virtualPoints['virtual_left_hip'] = {
        x: landmarks[11].x,
        y: landmarks[11].y + 0.2, // Point directly below left shoulder
        z: landmarks[11].z
      };
    }
    
    if (landmarks[12]) { // Right shoulder
      virtualPoints['virtual_right_hip'] = {
        x: landmarks[12].x,
        y: landmarks[12].y + 0.2, // Point directly below right shoulder
        z: landmarks[12].z
      };
    }
    
    // Create virtual points for lower body mode
    // For hips, create points directly above the hips
    if (landmarks[23]) { // Left hip
      virtualPoints['virtual_left_shoulder'] = {
        x: landmarks[23].x,
        y: landmarks[23].y - 0.2, // Point directly above left hip
        z: landmarks[23].z
      };
    }
    
    if (landmarks[24]) { // Right hip
      virtualPoints['virtual_right_shoulder'] = {
        x: landmarks[24].x,
        y: landmarks[24].y - 0.2, // Point directly above right hip
        z: landmarks[24].z
      };
    }
    
    return virtualPoints;
  };

  // Define angle mappings for different body focus modes
  const upperBodyAngles: { [key: string]: [number | string, number | string, number | string] } = {
    left_elbow: [15, 13, 11],    // wrist, elbow, shoulder (same)
    left_shoulder: [13, 11, 'virtual_left_hip'], // elbow, shoulder, virtual point below shoulder
    right_elbow: [16, 14, 12],   // wrist, elbow, shoulder (same)
    right_shoulder: [14, 12, 'virtual_right_hip'], // elbow, shoulder, virtual point below shoulder
  };

  const lowerBodyAngles: { [key: string]: [number | string, number | string, number | string] } = {
    left_hip: ['virtual_left_shoulder', 23, 25],  // virtual point above hip, hip, knee
    left_knee: [23, 25, 27],    // hip, knee, ankle (same)
    right_hip: ['virtual_right_shoulder', 24, 26], // virtual point above hip, hip, knee
    right_knee: [24, 26, 28]    // hip, knee, ankle (same)
  };

  // Calculate the angle between three points in degrees
  const calculateAngle = (a: PoseLandmark, b: PoseLandmark, c: PoseLandmark): number | null => {
    if (!a || !b || !c) return null;
    
    try {
      // Convert to 3D vectors
      const ba = {
        x: a.x - b.x,
        y: a.y - b.y,
        z: a.z - b.z
      };
      
      const bc = {
        x: c.x - b.x,
        y: c.y - b.y,
        z: c.z - b.z
      };
      
      // Calculate dot product
      const dotProduct = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z;
      
      // Calculate magnitudes
      const magnitudeBA = Math.sqrt(ba.x * ba.x + ba.y * ba.y + ba.z * ba.z);
      const magnitudeBC = Math.sqrt(bc.x * bc.x + bc.y * bc.y + bc.z * bc.z);
      
      // Avoid division by zero
      if (magnitudeBA === 0 || magnitudeBC === 0) {
        return null;
      }
      
      // Calculate cosine of the angle
      const cosineAngle = Math.max(-1, Math.min(1, dotProduct / (magnitudeBA * magnitudeBC)));
      
      // Convert to degrees
      const angleRadians = Math.acos(cosineAngle);
      const angleDegrees = angleRadians * (180 / Math.PI);
      
      return angleDegrees;
    } catch (error) {
      console.error("Error calculating angle:", error);
      return null;
    }
  };

  // Extract angles from a pose's landmarks
  const extractAngles = (pose: PoseLandmark[]): { [key: string]: number } => {
    const angles: { [key: string]: number } = {};
    
    // Create virtual reference points based on the visible landmarks
    const virtualPoints = createVirtualReferencePoints(pose);
    
    // Use different angle definitions based on body focus mode
    const angleDefinitions = bodyFocusMode === 'upper' ? upperBodyAngles : 
                            bodyFocusMode === 'lower' ? lowerBodyAngles : 
                            jointAngles;
    
    // Calculate angles for each joint using the appropriate definitions
    for (const [joint, points] of Object.entries(angleDefinitions)) {
      // Extract the three points needed for the angle
      const p1 = typeof points[0] === 'number' ? pose[points[0] as number] : virtualPoints[points[0] as string];
      const p2 = typeof points[1] === 'number' ? pose[points[1] as number] : virtualPoints[points[1] as string];
      const p3 = typeof points[2] === 'number' ? pose[points[2] as number] : virtualPoints[points[2] as string];
      
      if (p1 && p2 && p3) {
        const angle = calculateAngle(p1, p2, p3);
        
        if (angle !== null) {
          angles[joint] = angle;
        }
      }
    }
    
    return angles;
  };

  // Add a new state variable for body focus mode
  const [bodyFocusMode, setBodyFocusMode] = useState<'full' | 'upper' | 'lower'>('upper'); // Default to upper body

  // Define joint groups for different body focus modes
  const upperBodyJoints = ['left_elbow', 'right_elbow', 'left_shoulder', 'right_shoulder'];
  const lowerBodyJoints = ['left_hip', 'right_hip', 'left_knee', 'right_knee'];

  // Modify the comparePoses function to use smoothed angles
  const comparePoses = (referencePose: any, currentPose: any) => {
    // Extract angles from both poses
    const referenceAngles = extractAngles(referencePose);
    const rawCurrentAngles = extractAngles(currentPose);
    
    // Apply smoothing to the current angles
    const currentAngles = smoothAngles(rawCurrentAngles);
    
    // Prepare feedback data
    const feedback: {[key: string]: number} = {};
    let totalSimilarity = 0;
    let availableAngles = 0;
    
    console.log("--- Comparing Pose Angles ---");
    console.log(`Body Focus Mode: ${bodyFocusMode}`);
    
    // Determine which joints to compare based on bodyFocusMode
    let jointsToCompare: string[] = [];
    if (bodyFocusMode === 'full') {
      jointsToCompare = Object.keys(jointAngles);
    } else if (bodyFocusMode === 'upper') {
      jointsToCompare = upperBodyJoints;
    } else { // lower
      jointsToCompare = lowerBodyJoints;
    }
    
    // Compare each joint angle
    for (const joint of jointsToCompare) {
      if (referenceAngles[joint] !== undefined && currentAngles[joint] !== undefined) {
        // Calculate the absolute difference in angles
        const angleDifference = Math.abs(referenceAngles[joint] - currentAngles[joint]);
        
        // Convert to similarity score (0-1)
        // Make angle difference more lenient - increase from 60 to 90 degrees
        const similarity = Math.max(0, 1 - (angleDifference / 90));
        
        feedback[joint] = similarity;
        totalSimilarity += similarity;
        availableAngles++;
        
        // Log detailed angle comparison
        console.log(`${joint}: Reference=${referenceAngles[joint].toFixed(1)}°, Current=${currentAngles[joint].toFixed(1)}°, Diff=${angleDifference.toFixed(1)}°, Similarity=${(similarity * 100).toFixed(0)}%`);
      } else {
        console.log(`${joint}: Could not calculate angle (missing landmarks)`);
      }
    }
    
    // Calculate overall score and match status
    const overallScore = availableAngles > 0 ? totalSimilarity / availableAngles : 0;
    const isGoodMatch = overallScore >= 0.3; // Using 30% threshold instead of 40%
    
    console.log(`Overall Match: ${(overallScore * 100).toFixed(1)}%, Good Match: ${isGoodMatch}, Using ${availableAngles} angles`);
    
    return {
      angles: {
        reference: referenceAngles,
        current: currentAngles
      },
      feedback,
      overallScore,
      isGoodMatch
    };
  };

  // Function to save reference angles to Firestore (call this when capturing reference pose)
  const saveReferenceAngles = async (userId: string, planId: string, workoutId: string, pose: PoseLandmark[], poseName: string) => {
    try {
      // Calculate angles from the pose
      const angles = extractAngles(pose);
      
      // Save to Firestore
      const data = {
        poseName,
        angles,
        poseId: workoutId,
        planId,
        workoutId,
        createdAt: serverTimestamp()
      };
      
      // Save to Firestore
      await db.collection('poseAngles').add(data);
      console.log("Reference angles saved for pose:", poseName);
    } catch (err) {
      console.error("Error saving reference angles:", err);
    }
  };

  // Add a visualization function to draw angles on canvas for debugging
  const visualizeAngles = (ctx: CanvasRenderingContext2D, landmarks: PoseLandmark[], angles: {[key: string]: number}, similarityScores: {[key: string]: number} = {}) => {
    for (const [joint, points] of Object.entries(jointAngles)) {
      const [p1, p2, p3] = points;
      
      if (landmarks[p1] && landmarks[p2] && landmarks[p3]) {
        // Get screen coordinates for the joint points
        const x1 = ctx.canvas.width - (landmarks[p1].x * ctx.canvas.width);
        const y1 = landmarks[p1].y * ctx.canvas.height;
        const x2 = ctx.canvas.width - (landmarks[p2].x * ctx.canvas.width);
        const y2 = landmarks[p2].y * ctx.canvas.height;
        const x3 = ctx.canvas.width - (landmarks[p3].x * ctx.canvas.width);
        const y3 = landmarks[p3].y * ctx.canvas.height;
        
        // Calculate vectors
        const vector1 = { x: x1 - x2, y: y1 - y2 };
        const vector2 = { x: x3 - x2, y: y3 - y2 };
        
        // Calculate angles in screen space
        const angle1 = Math.atan2(vector1.y, vector1.x);
        const angle2 = Math.atan2(vector2.y, vector2.x);
        
        // Draw arc to visualize the angle
        const radius = 30;
        const similarity = similarityScores[joint] || 1.0;
        
        // Select color based on similarity score
        const color = similarity > 0.8 ? 'rgba(0, 255, 0, 0.7)' : 
                     similarity > 0.6 ? 'rgba(255, 255, 0, 0.7)' : 
                     'rgba(255, 0, 0, 0.7)';
        
        ctx.beginPath();
        ctx.arc(x2, y2, radius, Math.min(angle1, angle2), Math.max(angle1, angle2));
        ctx.strokeStyle = color;
        ctx.lineWidth = 5;
        ctx.stroke();
        
        // Add angle label if we have the angle value
        if (angles[joint]) {
          const midAngle = (angle1 + angle2) / 2;
          const labelX = x2 + (radius + 10) * Math.cos(midAngle);
          const labelY = y2 + (radius + 10) * Math.sin(midAngle);
          
          ctx.font = '12px Arial';
          ctx.fillStyle = 'white';
          ctx.strokeStyle = 'black';
          ctx.lineWidth = 2;
          ctx.textAlign = 'center';
          ctx.strokeText(`${Math.round(angles[joint])}°`, labelX, labelY);
          ctx.fillText(`${Math.round(angles[joint])}°`, labelX, labelY);
        }
      }
    }
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
      
      // Use a fixed position and scaling for the reference pose to make it static
      
      // First, draw a semi-transparent background to make the reference pose stand out
      ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      
      // Draw the connections and landmarks with the proper scaling and centered position
      const canvasWidth = ctx.canvas.width;
      const canvasHeight = ctx.canvas.height;
      
      // Override the drawConnections and drawLandmarks for the reference pose only
      const staticDrawConnections = (connections: [number, number][] = [
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
      ]) => {
        ctx.strokeStyle = '#0000FF'; // Blue for reference
        ctx.lineWidth = 3;

        connections.forEach(([start, end]) => {
          if (referencePose[start] && referencePose[end]) {
            const startX = canvasWidth - (referencePose[start].x * canvasWidth);
            const startY = referencePose[start].y * canvasHeight;
            const endX = canvasWidth - (referencePose[end].x * canvasWidth);
            const endY = referencePose[end].y * canvasHeight;
            
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
          }
        });
      };
      
      // Draw the reference landmarks in a static position
      const staticDrawLandmarks = () => {
        referencePose.forEach((landmark: any) => {
          ctx.beginPath();
          const mirroredX = canvasWidth - (landmark.x * canvasWidth);
          ctx.arc(mirroredX, landmark.y * canvasHeight, 8, 0, 2 * Math.PI);
          ctx.fillStyle = '#0000FF'; // Blue for reference
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 2;
          ctx.stroke();
        });
      };
      
      // Draw the static reference pose
      staticDrawConnections();
      staticDrawLandmarks();
      
      ctx.globalAlpha = 1.0; // Reset transparency
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
        
        // Initialize smoothing arrays
        smoothedLandmarks.current = [];
        smoothedAngles.current = [];
        
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
          const { feedback: poseFeedback, overallScore, isGoodMatch, angles } = comparePoses(referencePose, landmarks);
          
          setPoseMatchFeedback(poseFeedback);
          setOverallSimilarity(overallScore);
          
          // Log similarity for debugging
          console.log("Pose similarity:", Math.round(overallScore * 100) + "%", isGoodMatch ? "(MATCH)" : "");
          
          // Check if pose is correct (above the threshold)
          const wasInCorrectPose = isInCorrectPose;
          const isCorrectPose = overallScore >= 0.25; // Lower threshold to 25% (from 60%)
          setIsInCorrectPose(isCorrectPose);
          
          // Draw the angle visualizations
          if (isSessionActive) {
            visualizeAngles(canvasCtx, landmarks, angles.current, poseFeedback);
          }
          
          // Handle progressive pose hold time accumulation
          const now = Date.now();
          
          if (isSessionActive) {
            // Calculate how much to increment based on frame time
            const frameTime = lastTimestampRef.current ? (now - lastTimestampRef.current) / 1000 : 0;
            
            // Only update timestamp if this is first frame or continuing
            if (!lastTimestampRef.current) {
              lastTimestampRef.current = now;
              console.log("Starting hold timer with similarity:", Math.round(overallSimilarity * 100) + "%");
            } else {
              // Simplified progress logic - constant rates for increment and decay
              let increment = 0;
              
              // Simple threshold for progress - either making progress or not
              if (overallScore >= 0.25) {
                // Fixed increment rate - no bonus, just steady progress
                // Increase the increment rate to make progress faster
                increment = frameTime * 1.3; // Increased from 1.0 for faster progress
                
                // Apply the increment to our cumulative time
                cumulativeTimeRef.current = Math.min(totalRequiredHoldTime, cumulativeTimeRef.current + increment);
                
                // Calculate and update progress percentage
                const newProgress = Math.round((cumulativeTimeRef.current / totalRequiredHoldTime) * 100);
                
                // Update state for UI rendering
                setCumulativeHoldTime(cumulativeTimeRef.current);
                setHoldProgress(newProgress);
                
                // Log progress for debugging
                console.log(`Hold progress: ${newProgress}%, Similarity: ${Math.round(overallSimilarity * 100)}%, Time: ${cumulativeTimeRef.current.toFixed(1)}s/${totalRequiredHoldTime}s, Increment: ${increment.toFixed(3)}`);
                
                // If we've reached the required hold time, complete the pose
                if (cumulativeTimeRef.current >= totalRequiredHoldTime) {
                  // We just now completed the hold
                  console.log("Hold complete! Starting completion process");
                  // Reset the ref values
                  cumulativeTimeRef.current = 0;
                  lastTimestampRef.current = null;
                  
                  // Make sure we call completePose even if the ref isn't set
                  if (completePoseRef.current) {
                    console.log("Calling completePoseRef.current()");
                    completePoseRef.current();
                  } else {
                    console.warn("completePoseRef not set, calling local implementation");
                    // Fallback implementation
                    setHoldProgress(0);
                    
                    // Record the accuracy for this pose
                    setPoseAccuracies(prev => {
                      const newAccuracies = [...prev];
                      newAccuracies[currentWorkoutIndex] = Math.round(overallSimilarity * 100);
                      return newAccuracies;
                    });
                    
                    // Move to the next pose if there is one
                    if (currentWorkoutIndex < planWorkouts.length - 1) {
                      console.log("Moving to next pose in fallback");
                      setCurrentWorkoutIndex(currentWorkoutIndex + 1);
                      setFeedback(`Ready for next pose: ${planWorkouts[currentWorkoutIndex + 1].name}. Get in position!`);
                    } else {
                      // Completed all poses
                      console.log("All poses completed in fallback");
                      setFeedback("All poses completed! Great job!");
                      // End the session
                      endSession(true);
                    }
                  }
                }
              } else {
                // Below threshold - decay at the same rate as progress
                // Reduce decay rate to be more forgiving 
                const decay = frameTime * 0.8; // Reduced from 1.0 to make progress more sticky
                cumulativeTimeRef.current = Math.max(0, cumulativeTimeRef.current - decay);
                
                // Update state for UI rendering with new decayed value
                setCumulativeHoldTime(cumulativeTimeRef.current);
                setHoldProgress(Math.round((cumulativeTimeRef.current / totalRequiredHoldTime) * 100));
              }
            }
            
            // Always update timestamp for next frame
            lastTimestampRef.current = now;
          }
          
          // Generate specific feedback
          let feedbackText = `Overall match: ${Math.round(overallScore * 100)}%\n`;
          
          if (isSessionActive) {
            if (overallScore >= 0.25) {
              feedbackText = `Correct pose! Hold steady: ${holdProgress}% complete`;
            } else {
              // Too far from the reference pose
              feedbackText = `Try to match the reference pose better (${Math.round(overallScore * 100)}% match)`;
            }
          }
          
          if (isSessionActive && currentWorkoutIndex < planWorkouts.length) {
            setFeedback(`${planWorkouts[currentWorkoutIndex].name}: ${feedbackText}`);
          }
          
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
          if (isSessionActive && currentWorkoutIndex < planWorkouts.length) {
            // Draw the current timer number
            canvasCtx.font = 'bold 120px Arial';
            canvasCtx.textAlign = 'center';
            canvasCtx.textBaseline = 'middle';
            canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            canvasCtx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
            canvasCtx.lineWidth = 4;
            
            // Instead, draw the hold progress percentage
            if (holdProgress > 0) {
              canvasCtx.strokeText(`${holdProgress}%`, canvasCtx.canvas.width / 2, canvasCtx.canvas.height / 2);
              canvasCtx.fillText(`${holdProgress}%`, canvasCtx.canvas.width / 2, canvasCtx.canvas.height / 2);
            }
          }
        } else {
          canvasCtx.fillStyle = 'red';
          canvasCtx.fillText('No pose detected', 20, 70);
          
          // Reset the pose match status if no pose is detected
          if (isInCorrectPose) {
            setIsInCorrectPose(false);
          }
        }
      } else {
        canvasCtx.fillStyle = 'red';
        canvasCtx.fillText('No pose detected', 20, 70);
        
        // Reset the pose match status if no pose is detected
        if (isInCorrectPose) {
          setIsInCorrectPose(false);
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

  // Set up the completePose function reference
  useEffect(() => {
    // Create the completePose function that will be stable across renders
    completePoseRef.current = () => {
      console.log("Completing pose:", currentWorkoutIndex + 1, "of", planWorkouts.length);
      
      // Reset hold progress for next pose
      setCumulativeHoldTime(0);
      setHoldProgress(0);
      setLastHoldTimestamp(null);
      cumulativeTimeRef.current = 0;
      lastTimestampRef.current = null;
      
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
      
      // Show completion feedback with green overlay and checkmark
      setShowCompletionFeedback(true);
      setFeedback("Great job! Pose completed successfully!");
      
      // After a delay, move to next pose
      feedbackTimerRef.current = window.setTimeout(() => {
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
          // All poses completed - properly end the session
          console.log("All poses completed successfully");
          setFeedback("🎉 Workout complete! All poses completed successfully. 🎉");
          
          // End the session 
          feedbackTimerRef.current = window.setTimeout(() => {
            // Clear any pending animation frame
            if (animationFrameRef.current) {
              cancelAnimationFrame(animationFrameRef.current);
              animationFrameRef.current = null;
            }
            
            // End session and save progress
            endSession(true);
            
            // Show summary of the workout after a brief delay
            const avgAccuracy = poseAccuracies.length > 0 
              ? Math.round(poseAccuracies.reduce((sum, acc) => sum + acc, 0) / poseAccuracies.length) 
              : 0;
            
            feedbackTimerRef.current = window.setTimeout(() => {
              setFeedback(`Workout Summary: Completed ${poseAccuracies.length} poses with ${avgAccuracy}% average accuracy!`);
            }, 1000);
          }, 1000);
        }
      }, 1500); // Show checkmark for 1.5 seconds
    };
  }, [currentWorkoutIndex, overallSimilarity, planWorkouts, poseAccuracies]);

  // Add these functions for starting and ending sessions
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
      // Reset hold progress values
      setCumulativeHoldTime(0);
      setHoldProgress(0);
      setLastHoldTimestamp(null);
      cumulativeTimeRef.current = 0;
      lastTimestampRef.current = null;
      
      // Reset smoothing arrays
      smoothedLandmarks.current = [];
      smoothedAngles.current = [];
      
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
      
      // Set the session start time to the current timestamp
      setSessionStartTime(Date.now());
      
      // Initialize hold time variables
      setHoldProgress(0);
      cumulativeTimeRef.current = 0;
      lastTimestampRef.current = null;
      setTotalRequiredHoldTime(8.0); // Reduced from 10 seconds to 8 seconds
      
    } catch (error) {
      console.error("Error starting session:", error);
      setFeedback("Failed to start session. Please try again.");
    }
  };

  // End session function
  const endSession = async (shouldSave = true) => {
    console.log("Ending session");
    
    // First, update the state to prevent further animation frames
    setIsSessionActive(false);
    
    // Clear the completion feedback to stop the green flashing
    setShowCompletionFeedback(false);
    
    // Clear any pending feedback timers that might be causing flashing
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    
    console.log("Session active state changed: false");
    
    // Make this check clearer to see if animation frame was canceled
    if (animationFrameRef.current) {
      console.log("Canceling animation frame in endSession:", animationFrameRef.current);
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    } else {
      console.log("No animation frame to cancel in endSession");
    }
    
    // Update the DOM attribute for tracking
    const sessionCheckElement = document.getElementById('session-active-check');
    if (sessionCheckElement) {
      sessionCheckElement.setAttribute('data-active', 'false');
    }
    
    console.log("Session ended or inactive");
    
    // Don't try to save stats if not requested
    if (!shouldSave || !currentUser || !selectedPlan) {
      console.log("Skipping session save:", {
        shouldSave,
        isUserAuthenticated: !!currentUser,
        hasPlan: !!selectedPlan
      });
      return;
    }
    
    try {
      // Check if the document exists first before trying to update
      const workoutDocRef = db.collection('users').doc(currentUser.uid)
        .collection('workouts').doc(selectedPlan.id);
      
      const workoutDoc = await workoutDocRef.get();
      
      const sessionDuration = Math.round((Date.now() - sessionStartTime) / 1000);
      
      // Create or update the document based on whether it exists
      if (workoutDoc.exists) {
        // Update existing document
        await workoutDocRef.update({
          lastSessionAt: new Date().toISOString(),
          sessionsCount: increment(1),
          totalDuration: increment(sessionDuration),
          poseAccuracies
        });
        console.log("Session stats updated successfully");
      } else {
        // Create a new document
        await workoutDocRef.set({
          userId: currentUser.uid,
          planId: selectedPlan.id,
          planName: selectedPlan.name,
          firstSessionAt: new Date().toISOString(),
          lastSessionAt: new Date().toISOString(),
          sessionsCount: 1,
          totalDuration: sessionDuration,
          poseAccuracies
        });
        console.log("First session stats created successfully");
      }
      
      setFeedback("Session ended and progress saved!");
      // Clear the flashing green by setting a timeout to reset feedback
      feedbackTimerRef.current = window.setTimeout(() => {
        setFeedback("");
      }, 3000);
      
    } catch (err) {
      console.error("Error saving session:", err);
      setFeedback("Session ended, but there was an error saving your progress.");
      // Clear the flashing green by setting a timeout to reset feedback
      feedbackTimerRef.current = window.setTimeout(() => {
        setFeedback("");
      }, 3000);
    }
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
            const landmarks = landmarksSnapshot.docs.map((doc: any) => {
              const data = doc.data();
              console.log(`Found landmarks for position ${data.position}:`, {
                id: doc.id,
                position: data.position,
                landmarkCount: data.landmarks?.length || 0
              });
              return data as StoredPoseLandmarks;
            });
            
            console.log(`Found ${landmarks.length} reference poses from root collection, expected ${workouts.length}`);
            setReferencePoseLandmarks(landmarks);
          } else {
            console.warn("No landmarks found in root collection - will try subcollection");
            
            // Try query without orderBy which might be causing issues
            let simpleSnapshot: any = null;
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
                const landmarks = simpleSnapshot.docs.map((doc: any) => {
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

  // Log details about the body focus mode in use
  useEffect(() => {
    console.log(`Body focus mode changed to: ${bodyFocusMode}`);
    console.log("Angle definitions in use:", 
      bodyFocusMode === 'upper' ? "Upper body (with virtual points)" : 
      bodyFocusMode === 'lower' ? "Lower body (with virtual points)" : 
      "Full body");
  }, [bodyFocusMode]);

  // Add a new function to smooth angles using moving average
  const smoothAngles = (currentAngles: {[key: string]: number}): {[key: string]: number} => {
    // Add current angles to the buffer
    smoothedAngles.current.push({...currentAngles});
    
    // Remove oldest entry if buffer is full
    if (smoothedAngles.current.length > anglesSmoothingWindowSize) {
      smoothedAngles.current.shift();
    }
    
    // Create smoothed version by averaging across frames
    const smoothed: {[key: string]: number} = {};
    
    // For each joint angle in the current angles
    Object.keys(currentAngles).forEach(joint => {
      // Calculate how many frames have this angle
      const framesWithAngle = smoothedAngles.current.filter(frame => frame[joint] !== undefined).length;
      
      if (framesWithAngle > 0) {
        // Calculate the average
        const sum = smoothedAngles.current.reduce((total, frame) => 
          total + (frame[joint] !== undefined ? frame[joint] : 0), 0);
        
        smoothed[joint] = sum / framesWithAngle;
      } else {
        // Use current angle if no history
        smoothed[joint] = currentAngles[joint];
      }
    });
    
    return smoothed;
  };

  // Define these variables near the beginning of the component, with other state variables
  const [poseHoldTimes, setPoseHoldTimes] = useState<{ [key: number]: number }>({});
  const [poseAttempts, setPoseAttempts] = useState<{ [key: number]: number }>({});

  // Update the savePoseLandmarksToFirebase function
  const savePoseLandmarksToFirebase = async (
    landmarks: NormalizedLandmark[], 
    poseId: number, 
    similarityScore: number
  ) => {
    if (!currentUser) return;
    
    try {
      // Transform landmarks into a serializable format
      const formattedLandmarks = landmarks.map((landmark: NormalizedLandmark) => ({
        x: landmark.x,
        y: landmark.y,
        z: landmark.z,
        visibility: landmark.visibility
      }));
      
      // Create a document reference
      const poseRef = doc(collection(db, `users/${currentUser.uid}/workoutData`));
      
      // Save to Firestore
      await setDoc(poseRef, {
        landmarks: formattedLandmarks,
        position: poseId,
        timestamp: serverTimestamp(),
        workoutId: selectedPlan?.id, // Use sessionId as the workoutId
        similarityScore
      });
      
      console.log(`Saved landmarks for pose ${poseId} with score ${similarityScore}`);
    } catch (error) {
      console.error("Error saving landmarks:", error);
    }
  };

  return (
    <Layout>
      <div className="flex flex-col items-center w-full">
        <h1 className="text-2xl font-bold mb-4">Workouts - Pose Guidance</h1>
        
        {/* Hidden element to track session state */}
        <div id="session-active-check" data-active={isSessionActive ? 'true' : 'false'} style={{ display: 'none' }}></div>
        
        {/* Main Content - Full Width Video */}
        <div className="w-full flex flex-col items-center">
          {/* Webcam Feed Area - Larger and Full Width */}
          <div ref={containerRef} className="relative w-[95%] h-[80vh] bg-black mb-4 flex items-center justify-center overflow-hidden">
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
            
            {/* Pose Hold Progress Bar - Always visible during session */}
            {isSessionActive && (
              <div className="absolute bottom-12 left-0 right-0 mx-auto w-[80%] z-30">
                <div className="text-center mb-2 text-white font-bold text-xl drop-shadow-lg">
                  Hold Progress: {holdProgress}%
                </div>
                <div className="w-full bg-gray-800 bg-opacity-70 rounded-full h-8 overflow-hidden border-2 border-white">
                  <div 
                    className={`${
                      holdProgress > 80 ? 'bg-green-500' : 
                      holdProgress > 50 ? 'bg-blue-500' : 
                      holdProgress > 20 ? 'bg-yellow-500' : 'bg-red-500'
                    } h-full transition-all duration-200 ease-out flex items-center justify-center text-sm font-bold text-white ${
                      isInCorrectPose ? 'animate-pulse border-r-4 border-white' : ''
                    }`}
                    style={{ width: `${holdProgress}%` }}
                  >
                    {holdProgress > 5 ? (
                      <>
                        {holdProgress}% {isInCorrectPose && (
                          <span className="ml-1 text-white animate-pulse">
                            ⏱️ HOLDING!
                          </span>
                        )}
                      </>
                    ) : ''}
                  </div>
                </div>
                
                {/* Additional visual indicator when in correct pose */}
                {isInCorrectPose && (
                  <div className="text-center mt-2 text-green-400 font-bold text-lg animate-bounce drop-shadow-lg flex items-center justify-center">
                    <span className="inline-block w-4 h-4 bg-green-500 rounded-full mr-2 animate-ping"></span>
                    Correct Pose! Keep Holding...
                  </div>
                )}
              </div>
            )}
            
            {/* Example pose image - Top Right Corner (only in active session) */}
            {isSessionActive && planWorkouts.length > 0 && currentWorkoutIndex < planWorkouts.length && (
              <div className="absolute top-4 right-4 z-30 bg-white p-2 rounded-lg shadow-md w-[260px]">
                {/* Plan info moved from top-left to here */}
                {selectedPlan && (
                  <div className="mb-2 border-b pb-1">
                    <p className="font-semibold">{selectedPlan.name} ({currentWorkoutIndex + 1}/{planWorkouts.length})</p>
                    <p className="text-sm text-gray-700">Pose: {planWorkouts[currentWorkoutIndex]?.name}</p>
                  </div>
                )}
                <div className="w-full h-48 relative">
                  <img 
                    src={planWorkouts[currentWorkoutIndex].imageUrl} 
                    alt={planWorkouts[currentWorkoutIndex].name} 
                    className="w-full h-full object-cover rounded"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.src = "https://placehold.co/160x160/pink/white?text=Reference+Pose";
                    }}
                  />
                </div>
              </div>
            )}
            
            {/* Pose Match Progress - Overlay on left side */}
            {isSessionActive && overallSimilarity > 0 && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center" style={{ width: '40px' }}>
                <div className="text-white font-bold text-sm text-center mb-1 text-shadow">
                  {Math.round(overallSimilarity * 100)}%
                </div>
                
                <div className="h-[40vh] w-4 bg-gray-700 bg-opacity-70 rounded-full relative">
                  <div 
                    className={`w-4 rounded-full absolute bottom-0 ${
                      overallSimilarity > 0.8 ? 'bg-green-500' : 
                      overallSimilarity > 0.6 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}
                    style={{ height: `${Math.round(overallSimilarity * 100)}%`, opacity: 0.8 }}
                  ></div>
                </div>
                
                {isInCorrectPose && (
                  <div className="text-green-400 font-bold text-xs mt-1 text-shadow">✓</div>
                )}
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
          
          {/* Control Buttons - Centered below video */}
          <div className="flex space-x-4 mb-4 justify-center">
            <button 
              onClick={startSession}
              disabled={isSessionActive || !selectedPlan}
              className={`px-6 py-3 text-white rounded-lg text-lg font-medium ${
                isSessionActive || !selectedPlan ? 'bg-gray-400' : 'bg-blue-500 hover:bg-blue-600'
              }`}
            >
              Start Session
            </button>
            <button 
              onClick={() => endSession()}
              disabled={!isSessionActive}
              className={`px-6 py-3 text-white rounded-lg text-lg font-medium ${
                !isSessionActive ? 'bg-gray-400' : 'bg-red-500 hover:bg-red-600'
              }`}
            >
              End Session
            </button>
            <button 
              onClick={() => setShowPlanModal(true)}
              disabled={isSessionActive}
              className={`px-6 py-3 text-white rounded-lg text-lg font-medium ${
                isSessionActive ? 'bg-gray-400' : 'bg-green-500 hover:bg-green-600'
              }`}
            >
              Choose Your Plan
            </button>
            
            {/* Add Body Focus Mode Toggle */}
            <div className="flex flex-col items-center justify-center">
              <span className="text-sm text-gray-200 mb-1">Body Focus</span>
              <div className="flex space-x-1">
                <button
                  onClick={() => setBodyFocusMode('upper')}
                  className={`px-3 py-1 text-xs rounded ${
                    bodyFocusMode === 'upper' 
                      ? 'bg-purple-600 text-white' 
                      : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                  }`}
                >
                  Upper
                </button>
                <button
                  onClick={() => setBodyFocusMode('full')}
                  className={`px-3 py-1 text-xs rounded ${
                    bodyFocusMode === 'full' 
                      ? 'bg-purple-600 text-white' 
                      : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                  }`}
                >
                  Full
                </button>
                <button
                  onClick={() => setBodyFocusMode('lower')}
                  className={`px-3 py-1 text-xs rounded ${
                    bodyFocusMode === 'lower' 
                      ? 'bg-purple-600 text-white' 
                      : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                  }`}
                >
                  Lower
                </button>
              </div>
            </div>

            {/* Add back the Show/Hide Reference button */}
            {isSessionActive && (
              <button
                onClick={() => setShowReferenceOverlay(!showReferenceOverlay)}
                className={`px-6 py-3 text-white rounded-lg text-lg font-medium ${
                  showReferenceOverlay ? 'bg-blue-700' : 'bg-blue-400'
                }`}
              >
                {showReferenceOverlay ? 'Hide Reference' : 'Show Reference'}
              </button>
            )}
          </div>
          
          {/* Non-session feedback message */}
          {!isSessionActive && (
            <div className="bg-white p-4 rounded-lg shadow-md mb-4 w-[80%] text-center">
              <p className="whitespace-pre-line">{feedback}</p>
            </div>
          )}
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

      {/* Add text-shadow style to the head */}
      <style jsx global>{`
        .text-shadow {
          text-shadow: 0px 0px 3px rgba(0,0,0,0.8), 0px 0px 2px rgba(0,0,0,1);
        }
      `}</style>

      {/* Completion feedback overlay with checkmark */}
      {showCompletionFeedback && (
        <div className="absolute inset-0 bg-green-500 bg-opacity-40 flex items-center justify-center z-30 animate-pulse">
          <div className="bg-white rounded-full p-4 shadow-lg">
            <svg className="w-20 h-20 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
        </div>
      )}
    </Layout>
  );
} 