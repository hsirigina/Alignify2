"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import Link from "next/link";

interface Workout {
  id: string;
  name: string;
  imageUrl: string;
  position: number;
}

export default function PlanDetails() {
  const params = useParams();
  const router = useRouter();
  const { currentUser } = useAuth();
  const [plan, setPlan] = useState<any>(null);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const planId = params.planId as string;

  useEffect(() => {
    if (!currentUser) return;

    const fetchPlanDetails = async () => {
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
        
        // Fetch workouts for this plan
        const workoutsRef = planRef.collection('workouts');
        const workoutsSnapshot = await workoutsRef.orderBy('position').get();
        
        const workoutsList = workoutsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Workout[];
        
        setWorkouts(workoutsList);
        setLoading(false);
      } catch (err) {
        console.error("Error fetching plan details:", err);
        setError("Failed to load plan details");
        setLoading(false);
      }
    };

    fetchPlanDetails();
  }, [currentUser, planId]);

  const startWorkout = (workoutId: string) => {
    router.push(`/workout?planId=${planId}&workoutId=${workoutId}`);
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

  if (error || !plan) {
    return (
      <Layout>
        <div className="bg-red-50 p-4 rounded-md border border-red-200 text-red-700 mb-6">
          {error || "Plan not found"}
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
        {/* Plan Header */}
        <div className="flex flex-col md:flex-row gap-6 mb-8">
          <div className="md:w-1/3">
            <div className="aspect-square bg-gray-200 rounded-lg overflow-hidden">
              {plan.imageUrl ? (
                <img 
                  src={plan.imageUrl} 
                  alt={plan.name} 
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-500">
                  No Image
                </div>
              )}
            </div>
          </div>
          
          <div className="md:w-2/3">
            <div className="flex justify-between items-start">
              <h1 className="text-2xl font-bold mb-2">{plan.name}</h1>
              <Link href="/plans">
                <button className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200">
                  Back to Plans
                </button>
              </Link>
            </div>
            
            <p className="text-gray-600 mb-4">
              {plan.description || "No description provided."}
            </p>
            
            <div className="flex flex-wrap gap-3 mb-4">
              <div className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                {plan.workoutCount} {plan.workoutCount === 1 ? 'workout' : 'workouts'}
              </div>
              
              {plan.isCalibrated && (
                <div className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                  Calibrated
                </div>
              )}
            </div>
            
            <div>
              <h2 className="text-lg font-semibold mb-2">Start a Workout</h2>
              <p className="text-gray-600 text-sm mb-4">
                Select a workout below to begin. Your form will be measured against your reference poses.
              </p>
              
              {!plan.isCalibrated && (
                <div className="bg-yellow-50 p-4 rounded-md border border-yellow-200 text-yellow-700 mb-4">
                  <p className="font-semibold">Plan Not Calibrated</p>
                  <p className="text-sm">You need to set up reference poses for your workouts.</p>
                  <button 
                    onClick={() => router.push(`/calibration?planId=${planId}&workoutCount=${plan.workoutCount}`)}
                    className="mt-2 px-4 py-1 bg-yellow-200 rounded text-yellow-800 text-sm hover:bg-yellow-300"
                  >
                    Complete Calibration
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Workouts Grid */}
        {workouts.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {workouts.map((workout) => (
              <div key={workout.id} className="bg-white rounded-lg shadow hover:shadow-md transition-shadow duration-200 overflow-hidden">
                <div className="aspect-video relative bg-gray-200">
                  {workout.imageUrl ? (
                    <img 
                      src={workout.imageUrl} 
                      alt={workout.name} 
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-500">
                      No Image
                    </div>
                  )}
                  <div className="absolute top-2 left-2 px-2 py-1 bg-black bg-opacity-50 text-white text-xs rounded">
                    Workout {workout.position}
                  </div>
                </div>
                
                <div className="p-4">
                  <h3 className="font-semibold text-lg mb-2">{workout.name}</h3>
                  
                  <button
                    onClick={() => startWorkout(workout.id)}
                    className="w-full bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                    disabled={!plan.isCalibrated}
                  >
                    Start Workout
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-gray-50 p-6 rounded-lg border border-gray-200 text-center mb-8">
            <h3 className="text-lg font-semibold mb-2">No Workouts Available</h3>
            <p className="text-gray-600 mb-4">
              {plan.isCalibrated 
                ? "No workouts found for this plan."
                : "Complete the calibration process to set up workouts for this plan."}
            </p>
            {!plan.isCalibrated && (
              <button 
                onClick={() => router.push(`/calibration?planId=${planId}&workoutCount=${plan.workoutCount}`)}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Start Calibration
              </button>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
} 