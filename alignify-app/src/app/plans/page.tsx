"use client";

import { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import firebase from "firebase/compat/app";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Plan type definition
interface WorkoutPlan {
  id: string;
  name: string;
  description: string;
  workoutCount: number;
  createdAt: any;
  imageUrl?: string;
}

export default function Plans() {
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { currentUser } = useAuth();
  const router = useRouter();

  // New plan form states
  const [planName, setPlanName] = useState("");
  const [planDescription, setPlanDescription] = useState("");
  const [workoutCount, setWorkoutCount] = useState(3);

  useEffect(() => {
    if (!currentUser) return;

    // Fetch user's workout plans from Firestore
    const fetchPlans = async () => {
      try {
        setLoading(true);
        const plansRef = db.collection('users').doc(currentUser.uid).collection('plans');
        const snapshot = await plansRef.orderBy('createdAt', 'desc').get();
        
        const plansList = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as WorkoutPlan[];
        
        setPlans(plansList);
      } catch (error) {
        console.error("Error fetching plans:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchPlans();
  }, [currentUser]);

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!currentUser) return;
    
    try {
      // Create new plan in Firestore
      const planData = {
        name: planName,
        description: planDescription,
        workoutCount: workoutCount,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        userId: currentUser.uid,
        imageUrl: "", // Will be updated after calibration
        workouts: [] // Will be populated during calibration
      };
      
      const plansRef = db.collection('users').doc(currentUser.uid).collection('plans');
      const newPlanRef = await plansRef.add(planData);
      
      setShowCreateModal(false);
      
      // Redirect to calibration page with the plan ID
      router.push(`/calibration?planId=${newPlanRef.id}&workoutCount=${workoutCount}`);
      
    } catch (error) {
      console.error("Error creating plan:", error);
    }
  };

  const resetForm = () => {
    setPlanName("");
    setPlanDescription("");
    setWorkoutCount(3);
  };

  return (
    <Layout>
      <div className="flex flex-col items-center pb-12">
        <div className="flex justify-between items-center w-full mb-6">
          <h1 className="text-2xl font-bold">Workout Plans</h1>
          <button 
            onClick={() => {
              resetForm();
              setShowCreateModal(true);
            }}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            Create New Plan
          </button>
        </div>
        
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="w-12 h-12 border-t-4 border-blue-500 border-solid rounded-full animate-spin"></div>
          </div>
        ) : plans.length === 0 ? (
          <div className="bg-white p-8 rounded-lg shadow-md w-full text-center">
            <h2 className="text-xl font-semibold mb-3">No Workout Plans Yet</h2>
            <p className="text-gray-600 mb-6">Create your first workout plan to get started.</p>
            <button 
              onClick={() => {
                resetForm();
                setShowCreateModal(true);
              }}
              className="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600"
            >
              Create Your First Plan
            </button>
          </div>
        ) : (
          <div className="bg-white p-6 rounded-lg shadow-md w-full">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {plans.map((plan) => (
                <div key={plan.id} className="bg-gray-50 border rounded-lg p-4 flex flex-col hover:shadow-md transition-shadow duration-200">
                  <div className="h-40 bg-gray-200 rounded mb-3 flex items-center justify-center overflow-hidden">
                    {plan.imageUrl ? (
                      <img 
                        src={plan.imageUrl} 
                        alt={plan.name} 
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <p className="text-gray-500">No Preview Image</p>
                    )}
                  </div>
                  <h3 className="font-semibold text-lg">{plan.name}</h3>
                  <p className="text-gray-600 text-sm mt-1 mb-3 flex-grow">
                    {plan.description || "No description provided."}
                  </p>
                  <p className="text-sm text-gray-500 mb-3">
                    {plan.workoutCount} {plan.workoutCount === 1 ? 'workout' : 'workouts'}
                  </p>
                  <div className="mt-auto">
                    <Link href={`/plans/${plan.id}`}>
                      <button className="bg-blue-500 text-white px-4 py-2 rounded w-full hover:bg-blue-600">
                        View Plan
                      </button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Create Plan Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden">
            <div className="bg-blue-500 text-white py-4 px-6">
              <h2 className="text-xl font-semibold">Create New Workout Plan</h2>
            </div>
            
            <form onSubmit={handleCreatePlan} className="p-6">
              <div className="mb-4">
                <label htmlFor="planName" className="block text-sm font-medium text-gray-700 mb-1">Plan Name</label>
                <input
                  id="planName"
                  type="text"
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="E.g., Morning Yoga Routine"
                  required
                />
              </div>
              
              <div className="mb-4">
                <label htmlFor="planDescription" className="block text-sm font-medium text-gray-700 mb-1">Description (Optional)</label>
                <textarea
                  id="planDescription"
                  value={planDescription}
                  onChange={(e) => setPlanDescription(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Brief description of your workout plan"
                  rows={3}
                />
              </div>
              
              <div className="mb-6">
                <label htmlFor="workoutCount" className="block text-sm font-medium text-gray-700 mb-1">Number of Workouts</label>
                <div className="flex items-center">
                  <button 
                    type="button"
                    onClick={() => setWorkoutCount(Math.max(1, workoutCount - 1))}
                    className="px-3 py-1 border border-gray-300 rounded-l bg-gray-100"
                  >
                    -
                  </button>
                  <input
                    id="workoutCount"
                    type="number"
                    min="1"
                    max="10"
                    value={workoutCount}
                    onChange={(e) => setWorkoutCount(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                    className="w-16 text-center py-1 border-t border-b"
                  />
                  <button 
                    type="button"
                    onClick={() => setWorkoutCount(Math.min(10, workoutCount + 1))}
                    className="px-3 py-1 border border-gray-300 rounded-r bg-gray-100"
                  >
                    +
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">You'll create reference poses for each workout</p>
              </div>
              
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Create & Start Calibration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
} 