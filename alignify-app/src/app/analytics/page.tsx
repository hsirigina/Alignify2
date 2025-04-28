"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import AuthModal from "@/components/AuthModal";

interface PoseStat {
  name: string;
  averageAccuracy: number;
  attempts: number;
  improvement: number;
}

export default function AnalyticsPage() {
  const router = useRouter();
  const { currentUser, loading } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  
  const [poseStats, setPoseStats] = useState<PoseStat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'name' | 'attempts' | 'accuracy' | 'improvement'>('attempts');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  
  useEffect(() => {
    // Show auth modal if user is not authenticated (after loading completes)
    if (!loading && !currentUser) {
      setShowAuthModal(true);
      return;
    }
    
    if (currentUser) {
      fetchPoseStats();
    }
  }, [currentUser, loading]);
  
  const fetchPoseStats = async () => {
    if (!currentUser) return;
    
    try {
      setIsLoading(true);
      
      // Get workout history from Firestore
      const historyRef = db.collection('users')
        .doc(currentUser.uid)
        .collection('workoutHistory');
      
      const snapshot = await historyRef.get();
      
      if (snapshot.empty) {
        setPoseStats([]);
        setIsLoading(false);
        return;
      }
      
      // Process workout data to extract pose stats
      const poseMap = new Map<string, {
        accuracySum: number,
        count: number,
        firstAccuracy: number | null,
        lastAccuracy: number | null,
        firstDate: Date | null,
        lastDate: Date | null
      }>();
      
      // Process all workout history
      snapshot.docs.forEach(doc => {
        const workout = doc.data();
        const workoutDate = workout.timestamp ? new Date(workout.timestamp) : new Date();
        
        // Process each pose in the workout
        (workout.poseResults || []).forEach((result: any) => {
          if (!poseMap.has(result.name)) {
            poseMap.set(result.name, {
              accuracySum: 0,
              count: 0,
              firstAccuracy: null,
              lastAccuracy: null,
              firstDate: null,
              lastDate: null
            });
          }
          
          const poseData = poseMap.get(result.name)!;
          poseData.accuracySum += result.accuracy;
          poseData.count++;
          
          // Update first/last accuracy for improvement calculation
          if (!poseData.firstDate || workoutDate < poseData.firstDate) {
            poseData.firstDate = workoutDate;
            poseData.firstAccuracy = result.accuracy;
          }
          
          if (!poseData.lastDate || workoutDate > poseData.lastDate) {
            poseData.lastDate = workoutDate;
            poseData.lastAccuracy = result.accuracy;
          }
        });
      });
      
      // Convert map to array and calculate improvement
      const stats: PoseStat[] = [];
      
      poseMap.forEach((data, name) => {
        const averageAccuracy = Math.round(data.accuracySum / data.count);
        
        // Calculate improvement (if we have both first and last)
        let improvement = 0;
        if (data.firstAccuracy !== null && data.lastAccuracy !== null) {
          improvement = data.lastAccuracy - data.firstAccuracy;
        }
        
        stats.push({
          name,
          averageAccuracy,
          attempts: data.count,
          improvement
        });
      });
      
      // Sort the stats
      const sortedStats = sortStats(stats, sortBy, sortOrder);
      setPoseStats(sortedStats);
      setIsLoading(false);
    } catch (err: any) {
      console.error("Error fetching pose stats:", err);
      setError("Failed to load pose statistics. Please refresh and try again.");
      setIsLoading(false);
    }
  };
  
  const sortStats = (stats: PoseStat[], by: string, order: 'asc' | 'desc') => {
    return [...stats].sort((a, b) => {
      let comparison = 0;
      
      switch (by) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'attempts':
          comparison = a.attempts - b.attempts;
          break;
        case 'accuracy':
          comparison = a.averageAccuracy - b.averageAccuracy;
          break;
        case 'improvement':
          comparison = a.improvement - b.improvement;
          break;
        default:
          comparison = a.attempts - b.attempts;
      }
      
      return order === 'asc' ? comparison : -comparison;
    });
  };
  
  const handleSort = (by: 'name' | 'attempts' | 'accuracy' | 'improvement') => {
    if (sortBy === by) {
      // Toggle order if clicking the same column
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new sort column and default to descending 
      // (except for name which defaults to ascending)
      setSortBy(by);
      setSortOrder(by === 'name' ? 'asc' : 'desc');
    }
    
    // Apply the sort
    setPoseStats(sortStats(poseStats, by, sortOrder === 'asc' ? 'desc' : 'asc'));
  };
  
  const filteredPoses = poseStats.filter(pose => 
    pose.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const handleCloseModal = () => {
    // Only allow closing if authenticated
    if (currentUser) {
      setShowAuthModal(false);
    }
  };
  
  const getNoDataMessage = () => {
    if (isLoading) {
      return <p className="text-gray-500 text-center">Loading pose statistics...</p>;
    }
    
    if (error) {
      return <p className="text-red-500 text-center">{error}</p>;
    }
    
    return (
      <div className="text-center">
        <p className="text-gray-500 mb-4">You haven't completed any workouts yet.</p>
        <a href="/plans" className="text-blue-500 hover:underline">
          Start a workout now
        </a>
      </div>
    );
  };
  
  const getSortIcon = (column: string) => {
    if (sortBy !== column) return null;
    
    return sortOrder === 'asc' 
      ? <span className="ml-1">↑</span> 
      : <span className="ml-1">↓</span>;
  };
  
  return (
    <Layout>
      <div className="flex flex-col">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Pose Analytics</h1>
          <button 
            onClick={() => router.push('/dashboard')}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm"
          >
            Back to Dashboard
          </button>
        </div>
        
        {!currentUser || poseStats.length === 0 ? (
          <div className="bg-white p-6 rounded-lg shadow-md min-h-[400px] flex items-center justify-center">
            {getNoDataMessage()}
          </div>
        ) : (
          <>
            {/* Search and Filter */}
            <div className="bg-white p-4 rounded-lg shadow-md mb-6">
              <div className="flex flex-col md:flex-row justify-between gap-4">
                <div className="w-full md:w-1/3">
                  <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">
                    Search Poses
                  </label>
                  <input
                    type="text"
                    id="search"
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter pose name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                
                <div className="w-full md:w-1/3">
                  <p className="block text-sm font-medium text-gray-700 mb-1">
                    Total Poses: {poseStats.length}
                  </p>
                  <p className="text-sm text-gray-600">
                    Showing: {filteredPoses.length} poses
                  </p>
                </div>
              </div>
            </div>
            
            {/* Pose Stats Table */}
            <div className="bg-white p-4 rounded-lg shadow-md">
              <h2 className="text-lg font-semibold mb-4">All Poses</h2>
              
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                        onClick={() => handleSort('name')}
                      >
                        Pose Name {getSortIcon('name')}
                      </th>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                        onClick={() => handleSort('attempts')}
                      >
                        Attempts {getSortIcon('attempts')}
                      </th>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                        onClick={() => handleSort('accuracy')}
                      >
                        Avg. Accuracy {getSortIcon('accuracy')}
                      </th>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                        onClick={() => handleSort('improvement')}
                      >
                        Improvement {getSortIcon('improvement')}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredPoses.map((pose) => (
                      <tr key={pose.name}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{pose.name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{pose.attempts}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{pose.averageAccuracy}%</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className={`text-sm ${pose.improvement > 0 ? 'text-green-500' : pose.improvement < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                            {pose.improvement > 0 ? '+' : ''}{pose.improvement}%
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <a
                            href={`/analytics/${encodeURIComponent(pose.name)}`}
                            className="text-blue-600 hover:text-blue-900 text-sm"
                          >
                            View Details
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
      
      {/* Auth Modal */}
      <AuthModal isOpen={showAuthModal} onClose={handleCloseModal} />
    </Layout>
  );
} 