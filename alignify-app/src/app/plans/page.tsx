'use client';

export default function Plans() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Training Plans</h1>
      
      {/* Plans Grid */}
      <div className="grid grid-cols-3 gap-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow">
            <div className="h-40 bg-gray-200 rounded-md mb-4"></div>
            <h3 className="text-lg font-semibold mb-2">Yoga Plan {i}</h3>
            <p className="text-gray-600 mb-4">A comprehensive plan for improving flexibility and strength.</p>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">8 weeks</span>
              <button className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600">
                Start Plan
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
} 