"use client";

import Layout from "@/components/Layout";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import AuthModal from "@/components/AuthModal";

// Define user data structure
interface UserData {
  displayName: string;
  email: string;
  createdAt: any;
  workouts: any[];
  plans: any[];
  stats: {
    workoutsCompleted: number;
    plansCompleted: number;
    averageAccuracy: number;
  };
}

export default function Profile() {
  const [activeTab, setActiveTab] = useState<'info' | 'stats' | 'history'>('info');
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { currentUser } = useAuth();

  useEffect(() => {
    async function fetchUserData() {
      try {
        // Check if user is authenticated
        if (!currentUser) {
          setShowAuthModal(true);
          setLoading(false);
          return;
        }
        
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          setUserData(userSnap.data() as UserData);
        } else {
          console.error('No user data found in Firestore');
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchUserData();
  }, [currentUser]);

  // Get join date string
  const getJoinDate = () => {
    if (!userData || !userData.createdAt) return 'N/A';
    
    try {
      const date = userData.createdAt.toDate();
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch (e) {
      return 'N/A';
    }
  };

  // Close modal handler (ensure we're authenticated)
  const handleCloseModal = () => {
    if (currentUser) {
      setShowAuthModal(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-screen">
          <div className="w-16 h-16 border-t-4 border-blue-500 border-solid rounded-full animate-spin"></div>
        </div>
      </Layout>
    );
  }

  if (!currentUser) {
    return (
      <Layout>
        <div className="text-center p-8">
          <h2 className="text-2xl font-bold mb-4">Sign in to view your profile</h2>
          <button
            onClick={() => setShowAuthModal(true)}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            Sign In
          </button>
          <AuthModal isOpen={showAuthModal} onClose={handleCloseModal} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          {/* Profile header */}
          <div className="relative">
            {/* Banner image */}
            <div className="h-40 bg-gradient-to-r from-blue-400 to-indigo-500"></div>
            
            {/* Profile picture */}
            <div className="absolute -bottom-16 left-8">
              <div className="w-32 h-32 bg-white rounded-full p-1.5">
                <div className="w-full h-full bg-gray-200 rounded-full flex items-center justify-center overflow-hidden">
                  {currentUser.photoURL ? (
                    <img src={currentUser.photoURL} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-16 h-16 text-gray-500">
                      <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              </div>
            </div>
            
            {/* Edit button */}
            <div className="absolute top-4 right-4">
              <Link href="/settings" className="bg-white text-gray-800 px-4 py-2 rounded-full shadow-md font-medium flex items-center space-x-1">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
                  <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
                </svg>
                <span>Edit</span>
              </Link>
            </div>
          </div>
          
          {/* Profile body */}
          <div className="pt-20 px-8 pb-8">
            <h1 className="text-2xl font-bold text-gray-800">
              {userData?.displayName || currentUser.displayName || 'User'}
            </h1>
            <p className="text-gray-600 mt-1">
              {currentUser.email} • Joined {getJoinDate()}
            </p>
            
            {/* Stats overview */}
            <div className="mt-6 flex space-x-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-800">
                  {userData?.stats?.workoutsCompleted || 0}
                </div>
                <div className="text-sm text-gray-600">Workouts</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-800">
                  {userData?.stats?.plansCompleted || 0}
                </div>
                <div className="text-sm text-gray-600">Plans</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-500">
                  {userData?.stats?.averageAccuracy || 0}%
                </div>
                <div className="text-sm text-gray-600">Accuracy</div>
              </div>
            </div>
            
            {/* Tabs */}
            <div className="mt-8 border-b">
              <div className="flex space-x-8">
                <button 
                  onClick={() => setActiveTab('info')}
                  className={`pb-4 px-1 font-medium ${
                    activeTab === 'info' 
                      ? 'text-blue-500 border-b-2 border-blue-500' 
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Profile Info
                </button>
                <button 
                  onClick={() => setActiveTab('stats')}
                  className={`pb-4 px-1 font-medium ${
                    activeTab === 'stats' 
                      ? 'text-blue-500 border-b-2 border-blue-500' 
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Stats
                </button>
                <button 
                  onClick={() => setActiveTab('history')}
                  className={`pb-4 px-1 font-medium ${
                    activeTab === 'history' 
                      ? 'text-blue-500 border-b-2 border-blue-500' 
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Workout History
                </button>
              </div>
            </div>
            
            {/* Tab content */}
            <div className="mt-6">
              {activeTab === 'info' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-medium text-gray-800">About</h3>
                    <p className="mt-2 text-gray-600">
                      Fitness enthusiast focused on improving flexibility and strength. I'm passionate about yoga and using technology to improve my practice.
                    </p>
                  </div>
                  
                  <div>
                    <h3 className="text-lg font-medium text-gray-800">Personal Information</h3>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm text-gray-500">Email</div>
                        <div className="text-gray-800">{userData?.email || currentUser.email}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Location</div>
                        <div className="text-gray-800">Not specified</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Experience Level</div>
                        <div className="text-gray-800">Intermediate</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Focus Area</div>
                        <div className="text-gray-800">Flexibility, Balance</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {activeTab === 'stats' && (
                <div className="space-y-6">
                  <div className="text-center py-12 bg-gray-100 rounded-lg">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-gray-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    <p className="text-gray-600">Detailed statistics visualization will appear here</p>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-gray-100 p-4 rounded-lg">
                      <h4 className="font-medium text-gray-700">Weekly Progress</h4>
                      <div className="mt-2 h-32 flex items-center justify-center">
                        <p className="text-gray-500 text-sm">Progress chart placeholder</p>
                      </div>
                    </div>
                    <div className="bg-gray-100 p-4 rounded-lg">
                      <h4 className="font-medium text-gray-700">Pose Accuracy</h4>
                      <div className="mt-2 h-32 flex items-center justify-center">
                        <p className="text-gray-500 text-sm">Accuracy chart placeholder</p>
                      </div>
                    </div>
                    <div className="bg-gray-100 p-4 rounded-lg">
                      <h4 className="font-medium text-gray-700">Improvement Areas</h4>
                      <div className="mt-2 h-32 flex items-center justify-center">
                        <p className="text-gray-500 text-sm">Areas chart placeholder</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {activeTab === 'history' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-800">Recent Workouts</h3>
                  {userData?.workouts && userData.workouts.length > 0 ? (
                    userData.workouts.map((workout, index) => (
                      <div key={index} className="border rounded-lg p-4 flex justify-between items-center">
                        <div>
                          <div className="font-medium text-gray-800">{workout.name || `Workout ${index + 1}`}</div>
                          <div className="text-sm text-gray-600">
                            {workout.date ? new Date(workout.date.seconds * 1000).toLocaleDateString() : 'No date'} • 
                            {workout.duration || '25'} minutes
                          </div>
                        </div>
                        <div className="text-green-500 font-medium">{workout.accuracy || '85'}%</div>
                      </div>
                    ))
                  ) : (
                    <div className="border rounded-lg p-6 text-center text-gray-500">
                      <p>No workout history yet. Start a workout to track your progress!</p>
                      <Link href="/workouts" className="mt-4 inline-block text-blue-500 hover:text-blue-700 font-medium">
                        Go to Workouts
                      </Link>
                    </div>
                  )}
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