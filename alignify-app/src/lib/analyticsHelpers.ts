import { db } from "@/lib/firebase";
import firebase from "firebase/compat/app";
import { format, getISOWeek } from "date-fns";

// Types for analytics
export interface PoseResult {
  name: string;
  accuracy: number;
  holdTime?: number;
  attempts?: number;
}

export interface WorkoutSession {
  date: any;
  planId: string;
  planName: string;
  completed: boolean;
  posesCompleted: number;
  totalPoses: number;
  averageAccuracy: number;
  duration: number;
  poseResults: PoseResult[];
  bodyFocusMode?: 'full' | 'upper' | 'lower';
  timestamp?: string;
}

export interface UserStats {
  workoutsCompleted: number;
  totalDuration: number;
  averageAccuracy: number;
  streakDays: number;
  lastWorkoutDate: firebase.firestore.Timestamp;
  favoriteWorkouts: string[];
  challengingPoses: string[];
  bodyFocusDistribution: {
    upper: number;
    lower: number;
    full: number;
  };
  weeklyActivity: {
    [weekNumber: string]: {
      workouts: number;
      duration: number;
      accuracy: number;
    }
  };
}

/**
 * Updates user's streak data
 */
export const updateWorkoutStreak = async (userId: string) => {
  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};
    const stats = userData.stats || {};
    
    const lastWorkoutDate = stats.lastWorkoutDate ? 
      stats.lastWorkoutDate.toDate() : null;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Initialize streak if it doesn't exist
    let currentStreak = stats.streakDays || 0;
    
    // If last workout was yesterday, increment streak
    if (lastWorkoutDate) {
      const lastWorkoutDay = new Date(lastWorkoutDate);
      lastWorkoutDay.setHours(0, 0, 0, 0);
      
      if (lastWorkoutDay.getTime() === yesterday.getTime()) {
        // Streak continues
        currentStreak += 1;
      } else if (lastWorkoutDay.getTime() === today.getTime()) {
        // Already worked out today, maintain streak
      } else {
        // Streak broken
        currentStreak = 1;
      }
    } else {
      // First workout
      currentStreak = 1;
    }
    
    // Update streak and last workout date
    await userRef.update({
      'stats.streakDays': currentStreak,
      'stats.lastWorkoutDate': firebase.firestore.FieldValue.serverTimestamp()
    });
    
    return currentStreak;
  } catch (error) {
    console.error("Error updating streak:", error);
    return 0;
  }
};

/**
 * Updates all user stats based on a completed workout session
 */
export const updateUserStats = async (userId: string, sessionData: WorkoutSession) => {
  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.error("User document not found");
      return;
    }
    
    const userData = userDoc.data() || {};
    const stats = userData.stats || {};
    
    // Update basic stats
    const workoutsCompleted = (stats.workoutsCompleted || 0) + 1;
    const totalDuration = (stats.totalDuration || 0) + sessionData.duration;
    
    // Calculate new average accuracy
    const currentTotalAccuracy = (stats.averageAccuracy || 0) * (stats.workoutsCompleted || 0);
    const newTotalAccuracy = currentTotalAccuracy + sessionData.averageAccuracy;
    const averageAccuracy = Math.round(newTotalAccuracy / workoutsCompleted);
    
    // Update body focus distribution
    const bodyFocusDistribution = stats.bodyFocusDistribution || { upper: 0, lower: 0, full: 0 };
    if (sessionData.bodyFocusMode === 'upper') {
      bodyFocusDistribution.upper += 1;
    } else if (sessionData.bodyFocusMode === 'lower') {
      bodyFocusDistribution.lower += 1;
    } else {
      bodyFocusDistribution.full += 1;
    }
    
    // Update favorite workouts (plans with 3+ sessions)
    const favoriteWorkouts = stats.favoriteWorkouts || [];
    const planRef = db.collection('users').doc(userId)
      .collection('workoutHistory')
      .where('planId', '==', sessionData.planId);
    
    const planWorkouts = await planRef.get();
    if (planWorkouts.size >= 3 && !favoriteWorkouts.includes(sessionData.planId)) {
      favoriteWorkouts.push(sessionData.planId);
    }
    
    // Update weekly activity
    const today = new Date();
    const weekNumber = getISOWeek(today);
    const yearWeek = `${today.getFullYear()}-W${weekNumber}`;
    
    const weeklyActivity = stats.weeklyActivity || {};
    const currentWeek = weeklyActivity[yearWeek] || { workouts: 0, duration: 0, accuracy: 0 };
    
    weeklyActivity[yearWeek] = {
      workouts: currentWeek.workouts + 1,
      duration: currentWeek.duration + sessionData.duration,
      accuracy: Math.round((currentWeek.accuracy * currentWeek.workouts + sessionData.averageAccuracy) / 
                    (currentWeek.workouts + 1))
    };
    
    // Update user stats in Firestore
    await userRef.update({
      'stats.workoutsCompleted': workoutsCompleted,
      'stats.totalDuration': totalDuration,
      'stats.averageAccuracy': averageAccuracy,
      'stats.bodyFocusDistribution': bodyFocusDistribution,
      'stats.favoriteWorkouts': favoriteWorkouts,
      'stats.weeklyActivity': weeklyActivity
    });
    
    // Update challenging poses
    await updateChallengingPoses(userId, sessionData);
    
    // Update streak
    await updateWorkoutStreak(userId);
    
  } catch (error) {
    console.error("Error updating user stats:", error);
  }
};

/**
 * Updates the list of challenging poses for a user
 */
export const updateChallengingPoses = async (userId: string, sessionData: WorkoutSession) => {
  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};
    const stats = userData.stats || {};
    
    // Threshold for challenging poses (below 60% accuracy)
    const challengingThreshold = 60;
    
    // Find poses below threshold
    const challengingPoses = sessionData.poseResults
      .filter(pose => pose.accuracy < challengingThreshold)
      .map(pose => pose.name);
    
    if (challengingPoses.length > 0) {
      // Get current challenging poses
      const currentChallengingPoses = stats.challengingPoses || [];
      
      // Add new challenging poses
      const updatedChallengingPoses = [...new Set([...currentChallengingPoses, ...challengingPoses])];
      
      // Update in Firestore
      await userRef.update({
        'stats.challengingPoses': updatedChallengingPoses
      });
    }
  } catch (error) {
    console.error("Error updating challenging poses:", error);
  }
};

/**
 * Gets analytics data for a specific pose
 */
export const getPoseAnalytics = async (userId: string, poseName: string) => {
  try {
    // Get all workout history containing this pose
    const historyRef = db.collection('users').doc(userId)
      .collection('workoutHistory');
    
    const snapshot = await historyRef.get();
    const poseData = {
      attempts: 0,
      accuracySum: 0,
      firstAccuracy: null as number | null,
      lastAccuracy: null as number | null,
      firstDate: null as Date | null,
      lastDate: null as Date | null,
    };
    
    snapshot.docs.forEach(doc => {
      const workout = doc.data();
      const poseResult = workout.poseResults?.find((p: any) => p.name === poseName);
      
      if (poseResult) {
        poseData.attempts += 1;
        poseData.accuracySum += poseResult.accuracy;
        
        const workoutDate = workout.timestamp ? new Date(workout.timestamp) : new Date();
        
        if (!poseData.firstDate || workoutDate < poseData.firstDate) {
          poseData.firstDate = workoutDate;
          poseData.firstAccuracy = poseResult.accuracy;
        }
        
        if (!poseData.lastDate || workoutDate > poseData.lastDate) {
          poseData.lastDate = workoutDate;
          poseData.lastAccuracy = poseResult.accuracy;
        }
      }
    });
    
    // Calculate average and improvement
    const averageAccuracy = poseData.attempts > 0 ? 
      Math.round(poseData.accuracySum / poseData.attempts) : 0;
    
    let improvement = 0;
    if (poseData.firstAccuracy !== null && poseData.lastAccuracy !== null) {
      improvement = poseData.lastAccuracy - poseData.firstAccuracy;
    }
    
    return {
      attempts: poseData.attempts,
      averageAccuracy,
      improvement,
      firstAccuracy: poseData.firstAccuracy,
      lastAccuracy: poseData.lastAccuracy
    };
  } catch (error) {
    console.error("Error getting pose analytics:", error);
    return null;
  }
}; 