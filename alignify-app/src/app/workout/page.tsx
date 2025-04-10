"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";

export default function WorkoutPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { currentUser } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Get plan ID and workout ID from URL parameters
  const planId = searchParams.get("planId");
  const workoutId = searchParams.get("workoutId");

  // State for the workout session
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workout, setWorkout] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [score, setScore] = useState<number | null>(null);

  useEffect(() => {
    if (!planId || !workoutId || !currentUser) {
      router.push("/plans");
      return;
    }

    const fetchWorkoutData = async () => {
      try {
        setLoading(true);
        
        // Fetch plan data
        const planRef = db.collection('users').doc(currentUser.uid)
          .collection('plans').doc(planId);
          
        const planDoc = await planRef.get();
        
        if (!planDoc.exists) {
          setError("Plan not found");
          setLoading(false);
          return;
        }
        
        setPlan({ id: planDoc.id, ...planDoc.data() });
        
        // Fetch specific workout
        const workoutDoc = await planRef.collection('workouts').doc(workoutId).get();
        
        if (!workoutDoc.exists) {
          setError("Workout not found");
          setLoading(false);
          return;
        }
        
        setWorkout({ id: workoutDoc.id, ...workoutDoc.data() });
        setLoading(false);
      } catch (err) {
        console.error("Error fetching workout data:", err);
        setError("Failed to load workout data");
        setLoading(false);
      }
    };

    fetchWorkoutData();
  }, [planId, workoutId, currentUser, router]);

  // Initialize camera when data is loaded
  useEffect(() => {
    if (loading || !workout) return;

    const initCamera = async () => {
      try {
        if (!videoRef.current) return;
        
        setCameraError(null);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" }
        });
        
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          if (videoRef.current) {
            videoRef.current.play().catch(e => {
              console.error("Error playing video:", e);
              setCameraError("Could not start video playback");
            });
          }
        };
      } catch (err) {
        console.error("Error accessing camera:", err);
        setCameraError("Camera access is required for workout tracking. Please allow camera access and reload this page.");
      }
    };

    initCamera();

    // Cleanup function
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [loading, workout]);

  const startWorkout = () => {
    setIsActive(true);
    // In a real implementation, this is where you would:
    // 1. Start the ML model for pose detection
    // 2. Begin comparing the live video feed to the reference pose
    // 3. Calculate and display alignment scores
    
    // For now, we'll just simulate a score
    setTimeout(() => {
      const randomScore = 70 + Math.floor(Math.random() * 20); // Random score between 70-90
      setScore(randomScore);
    }, 3000);
  };

  const endWorkout = () => {
    setIsActive(false);
    // In a real implementation, you'd save the workout results to Firestore
  };

  if (loading) {
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
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">{workout?.name || "Workout"}</h1>
          <button
            onClick={() => router.push(`/plans/${planId}`)}
            className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200"
          >
            Back to Plan
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Reference Pose */}
          <div className="bg-white p-4 rounded-lg shadow-md">
            <h2 className="text-lg font-semibold mb-2">Reference Pose</h2>
            <div className="aspect-video bg-gray-200 rounded-md overflow-hidden">
              {workout?.imageUrl ? (
                <img 
                  src={workout.imageUrl} 
                  alt={workout.name} 
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-500">
                  No Reference Image
                </div>
              )}
            </div>
          </div>

          {/* Live Camera Feed */}
          <div className="bg-white p-4 rounded-lg shadow-md">
            <h2 className="text-lg font-semibold mb-2">Your Pose</h2>
            {cameraError ? (
              <div className="aspect-video bg-red-50 rounded-md flex items-center justify-center p-4">
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
              <div className="aspect-video bg-black rounded-md overflow-hidden relative">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                
                {isActive && score !== null && (
                  <div className="absolute top-2 right-2 px-3 py-1 rounded-full bg-white shadow">
                    <span className="font-bold text-lg" style={{ color: score > 80 ? 'green' : score > 60 ? 'orange' : 'red' }}>
                      {score}%
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md mb-6">
          <h2 className="text-lg font-semibold mb-4">Workout Controls</h2>
          
          <div className="flex gap-4">
            {!isActive ? (
              <button
                onClick={startWorkout}
                disabled={!!cameraError}
                className="flex-1 bg-green-500 text-white px-4 py-3 rounded-md hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Start Workout
              </button>
            ) : (
              <button
                onClick={endWorkout}
                className="flex-1 bg-red-500 text-white px-4 py-3 rounded-md hover:bg-red-600"
              >
                End Workout
              </button>
            )}
          </div>

          {isActive && (
            <div className="mt-4 p-4 bg-blue-50 rounded-md">
              <p className="font-medium">
                Try to match the reference pose as closely as possible.
              </p>
              <p className="mt-2 text-sm text-gray-600">
                The system will analyze your form and provide a score based on your alignment with the reference pose.
              </p>
            </div>
          )}
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-lg font-semibold mb-4">Instructions</h2>
          <ol className="list-decimal pl-5 space-y-2">
            <li>Position yourself so your full body is visible in the camera</li>
            <li>Make sure you're in a well-lit area</li>
            <li>Try to match the reference pose as closely as possible</li>
            <li>Hold the pose steady for accurate measurement</li>
            <li>The higher your alignment score, the better your form matches the reference</li>
          </ol>
        </div>
      </div>
    </Layout>
  );
} 