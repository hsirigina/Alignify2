"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { getPoseAnalytics } from "@/lib/analyticsHelpers";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { format, parseISO } from "date-fns";

interface PoseResult {
  name: string;
  accuracy: number;
  holdTime?: number;
  attempts?: number;
  date: string;
  displayDate: string;
}

export default function PoseAnalyticsPage() {
  const router = useRouter();
  const params = useParams();
  const poseName = decodeURIComponent(params.poseName as string);
  const { currentUser, loading } = useAuth();
  
  const [poseData, setPoseData] = useState<PoseResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  
  useEffect(() => {
    if (!loading && !currentUser) {
      // Redirect to login if not authenticated
      router.push('/login');
      return;
    }
    
    if (currentUser && poseName) {
      fetchPoseData();
      fetchPoseAnalytics();
    }
  }, [currentUser, loading, poseName]);
  
  const fetchPoseData = async () => {
    if (!currentUser) return;
    
    try {
      setIsLoading(true);
      
      // Get all workout sessions with this pose
      const historyRef = db.collection('users')
        .doc(currentUser.uid)
        .collection('workoutHistory');
      
      const snapshot = await historyRef.orderBy('date', 'asc').get();
      
      if (snapshot.empty) {
        setPoseData([]);
        setIsLoading(false);
        return;
      }
      
      // Extract pose results
      const results: PoseResult[] = [];
      
      snapshot.docs.forEach(doc => {
        const sessionData = doc.data();
        const poseResults = sessionData.poseResults || [];
        const matchingPose = poseResults.find((p: any) => p.name === poseName);
        
        if (matchingPose) {
          const date = sessionData.timestamp || sessionData.date?.toDate()?.toISOString() || new Date().toISOString();
          const displayDate = format(new Date(date), 'MMM d, yyyy');
          
          results.push({
            ...matchingPose,
            date,
            displayDate
          });
        }
      });
      
      setPoseData(results);
      setIsLoading(false);
    } catch (err: any) {
      console.error("Error fetching pose data:", err);
      setError("Failed to load pose data. Please try again.");
      setIsLoading(false);
    }
  };
  
  const fetchPoseAnalytics = async () => {
    if (!currentUser) return;
    
    try {
      const analyticsData = await getPoseAnalytics(currentUser.uid, poseName);
      setAnalytics(analyticsData);
    } catch (err) {
      console.error("Error fetching pose analytics:", err);
    }
  };
  
  // Generate trend data for the chart
  const getTrendData = () => {
    return poseData.map(result => ({
      date: result.displayDate,
      accuracy: result.accuracy,
      holdTime: result.holdTime || 0
    }));
  };
  
  return (
    <Layout>
      <div className="flex flex-col">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Pose Analytics: {poseName}</h1>
          <button 
            onClick={() => router.back()}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm"
          >
            Back to Dashboard
          </button>
        </div>
        
        {isLoading ? (
          <div className="bg-white p-6 rounded-lg shadow-md flex items-center justify-center min-h-[200px]">
            <p>Loading pose data...</p>
          </div>
        ) : error ? (
          <div className="bg-white p-6 rounded-lg shadow-md">
            <p className="text-red-500">{error}</p>
          </div>
        ) : poseData.length === 0 ? (
          <div className="bg-white p-6 rounded-lg shadow-md">
            <p>No data available for this pose.</p>
          </div>
        ) : (
          <>
            {/* Pose Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-white p-4 rounded-lg shadow-md">
                <h3 className="text-sm text-gray-500 uppercase">Total Attempts</h3>
                <p className="text-3xl font-bold">{analytics?.attempts || 0}</p>
              </div>
              
              <div className="bg-white p-4 rounded-lg shadow-md">
                <h3 className="text-sm text-gray-500 uppercase">Average Accuracy</h3>
                <p className="text-3xl font-bold">{analytics?.averageAccuracy || 0}%</p>
              </div>
              
              <div className="bg-white p-4 rounded-lg shadow-md">
                <h3 className="text-sm text-gray-500 uppercase">Last Accuracy</h3>
                <p className="text-3xl font-bold">{analytics?.lastAccuracy || 0}%</p>
              </div>
              
              <div className="bg-white p-4 rounded-lg shadow-md">
                <h3 className="text-sm text-gray-500 uppercase">Improvement</h3>
                <p className={`text-3xl font-bold ${analytics?.improvement > 0 ? 'text-green-600' : analytics?.improvement < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                  {analytics?.improvement > 0 ? '+' : ''}{analytics?.improvement || 0}%
                </p>
              </div>
            </div>
            
            {/* Accuracy Trend Chart */}
            <div className="bg-white p-4 rounded-lg shadow-md mb-6">
              <h2 className="text-lg font-semibold mb-4">Accuracy Trend</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={getTrendData()}
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="accuracy" 
                      name="Accuracy (%)" 
                      stroke="#4C51BF" 
                      activeDot={{ r: 8 }} 
                    />
                    {poseData.some(p => p.holdTime) && (
                      <Line 
                        type="monotone" 
                        dataKey="holdTime" 
                        name="Hold Time (s)" 
                        stroke="#48BB78" 
                        yAxisId="right"
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            
            {/* Session History Table */}
            <div className="bg-white p-4 rounded-lg shadow-md">
              <h2 className="text-lg font-semibold mb-4">Session History</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Accuracy
                      </th>
                      {poseData.some(p => p.holdTime) && (
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Hold Time
                        </th>
                      )}
                      {poseData.some(p => p.attempts) && (
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Attempts
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {poseData.map((result, index) => (
                      <tr key={index}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{result.displayDate}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{result.accuracy}%</div>
                        </td>
                        {poseData.some(p => p.holdTime) && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{result.holdTime || 0}s</div>
                          </td>
                        )}
                        {poseData.some(p => p.attempts) && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{result.attempts || 1}</div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
} 