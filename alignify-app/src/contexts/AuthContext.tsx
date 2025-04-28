'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import firebase from 'firebase/compat/app';
import { auth, db } from '@/lib/firebase';

interface AuthContextProps {
  currentUser: firebase.User | null;
  loading: boolean;
  error: string | null;
  signup: (email: string, password: string, displayName: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  googleSignIn: () => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateUserProfile: (displayName: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextProps | undefined>(undefined);

export function useAuth(): AuthContextProps {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [currentUser, setCurrentUser] = useState<firebase.User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setCurrentUser(user);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Create a new user
  async function signup(email: string, password: string, displayName: string) {
    try {
      setError(null);
      const userCredential = await auth.createUserWithEmailAndPassword(email, password);
      const user = userCredential.user;
      
      // Update the user's display name
      if (user) {
        await user.updateProfile({ displayName });
        
        // Create a user document in Firestore with enhanced stats
        await db.collection('users').doc(user.uid).set({
          uid: user.uid,
          email,
          displayName,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          workouts: [],
          plans: [],
          stats: {
            workoutsCompleted: 0,
            plansCompleted: 0,
            totalDuration: 0,
            averageAccuracy: 0,
            streakDays: 0,
            lastWorkoutDate: null,
            favoriteWorkouts: [],
            challengingPoses: [],
            bodyFocusDistribution: {
              upper: 0,
              lower: 0,
              full: 0
            },
            weeklyActivity: {}
          },
        });
      }
      
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  // Login user
  async function login(email: string, password: string) {
    try {
      setError(null);
      await auth.signInWithEmailAndPassword(email, password);
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  // Google Sign In
  async function googleSignIn() {
    try {
      setError(null);
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await auth.signInWithPopup(provider);
      const user = result.user;
      
      if (user) {
        // Check if this is a new user
        const userDoc = await db.collection('users').doc(user.uid).get();
        
        if (!userDoc.exists) {
          // Create a user document in Firestore for new Google users with enhanced stats
          await db.collection('users').doc(user.uid).set({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            workouts: [],
            plans: [],
            stats: {
              workoutsCompleted: 0,
              plansCompleted: 0,
              totalDuration: 0,
              averageAccuracy: 0,
              streakDays: 0,
              lastWorkoutDate: null,
              favoriteWorkouts: [],
              challengingPoses: [],
              bodyFocusDistribution: {
                upper: 0,
                lower: 0,
                full: 0
              },
              weeklyActivity: {}
            },
          });
        }
      }
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  // Logout user
  async function logout() {
    try {
      setError(null);
      await auth.signOut();
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  // Reset password
  async function resetPassword(email: string) {
    try {
      setError(null);
      await auth.sendPasswordResetEmail(email);
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  // Update user profile
  async function updateUserProfile(displayName: string) {
    try {
      if (!currentUser) throw new Error('No user signed in');
      
      setError(null);
      await currentUser.updateProfile({ displayName });
      
      // Update the user document in Firestore
      await db.collection('users').doc(currentUser.uid).update({ displayName });
      
      // Force refresh the currentUser object
      setCurrentUser({ ...currentUser });
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  const value = {
    currentUser,
    loading,
    error,
    signup,
    login,
    googleSignIn,
    logout,
    resetPassword,
    updateUserProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
} 