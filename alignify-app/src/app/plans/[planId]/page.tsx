"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import Link from "next/link";
import firebase from "firebase/compat/app";

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

export default function PlanDetails() {
  const params = useParams();
  const router = useRouter();
  const { currentUser } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteWorkoutConfirm, setShowDeleteWorkoutConfirm] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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
        
        // Cast the data to match our Plan interface
        const planData = planDoc.data();
        setPlan({ 
          id: planDoc.id, 
          name: planData?.name || '', 
          description: planData?.description || '',
          workoutCount: planData?.workoutCount || 0,
          imageUrl: planData?.imageUrl,
          isCalibrated: planData?.isCalibrated || false
        });
        
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

  // Add delete plan function
  const deletePlan = async () => {
    if (!currentUser || !planId || isDeleting) return;
    
    try {
      setIsDeleting(true);
      
      // Reference to the plan
      const planRef = db.collection('users').doc(currentUser.uid)
        .collection('plans').doc(planId);
      
      // First, delete all workouts in the plan
      const workoutsRef = planRef.collection('workouts');
      const workoutsSnapshot = await workoutsRef.get();
      
      // Delete workout documents in a batch
      const batch = db.batch();
      workoutsSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      // Delete pose landmarks
      const landmarksRef = planRef.collection('poseLandmarks');
      const landmarksSnapshot = await landmarksRef.get();
      landmarksSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      
      // Finally, delete the plan document itself
      await planRef.delete();
      
      // Redirect to plans page
      router.push('/plans');
    } catch (error) {
      console.error("Error deleting plan:", error);
      setError("Failed to delete plan. Please try again.");
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  // Add delete workout function
  const deleteWorkout = async (workoutId: string) => {
    if (!currentUser || !planId || isDeleting) return;
    
    try {
      setIsDeleting(true);
      
      // Reference to the workout
      const workoutRef = db.collection('users').doc(currentUser.uid)
        .collection('plans').doc(planId)
        .collection('workouts').doc(workoutId);
      
      // Reference to the associated landmark data
      const landmarksRef = db.collection('users').doc(currentUser.uid)
        .collection('plans').doc(planId)
        .collection('poseLandmarks');
      
      // Find and delete the associated landmark document
      const landmarksSnapshot = await landmarksRef.where('workoutId', '==', workoutId).get();
      
      // Delete in a batch
      const batch = db.batch();
      landmarksSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      // Delete the workout document
      batch.delete(workoutRef);
      
      // Update the plan to decrease workout count
      const planRef = db.collection('users').doc(currentUser.uid)
        .collection('plans').doc(planId);
      
      batch.update(planRef, {
        workoutCount: firebase.firestore.FieldValue.increment(-1)
      });
      
      await batch.commit();
      
      // Update local state
      setWorkouts(prevWorkouts => prevWorkouts.filter(w => w.id !== workoutId));
      setPlan(prevPlan => {
        if (!prevPlan) return null;
        return {
          ...prevPlan,
          workoutCount: prevPlan.workoutCount - 1
        };
      });
      
      setShowDeleteWorkoutConfirm(null);
      setIsDeleting(false);
    } catch (error) {
      console.error("Error deleting workout:", error);
      setError("Failed to delete workout. Please try again.");
      setIsDeleting(false);
      setShowDeleteWorkoutConfirm(null);
    }
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
              <div className="flex space-x-2">
                <Link href="/plans">
                  <button className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200">
                    Back to Plans
                  </button>
                </Link>
                <button 
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                >
                  Delete Plan
                </button>
              </div>
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
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-semibold text-lg">{workout.name}</h3>
                    <button 
                      onClick={() => setShowDeleteWorkoutConfirm(workout.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                  
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

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden">
            <div className="bg-red-500 text-white py-4 px-6">
              <h2 className="text-xl font-semibold">Delete Plan?</h2>
            </div>
            
            <div className="p-6">
              <p className="mb-6">Are you sure you want to delete this plan? This action cannot be undone and will remove all associated workouts and calibration data.</p>
              
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  onClick={deletePlan}
                  className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                  disabled={isDeleting}
                >
                  {isDeleting ? "Deleting..." : "Delete Plan"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Workout Delete Confirmation Modal */}
      {showDeleteWorkoutConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden">
            <div className="bg-red-500 text-white py-4 px-6">
              <h2 className="text-xl font-semibold">Delete Workout?</h2>
            </div>
            
            <div className="p-6">
              <p className="mb-6">Are you sure you want to delete this workout? This action cannot be undone and will remove the workout and its calibration data.</p>
              
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowDeleteWorkoutConfirm(null)}
                  className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  onClick={() => showDeleteWorkoutConfirm && deleteWorkout(showDeleteWorkoutConfirm)}
                  className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                  disabled={isDeleting}
                >
                  {isDeleting ? "Deleting..." : "Delete Workout"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
} 