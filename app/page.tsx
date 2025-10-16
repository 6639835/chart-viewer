'use client';

import { useEffect, useState } from 'react';

// Force dynamic rendering - this page requires runtime data
export const dynamic = 'force-dynamic';
import Sidebar from '@/components/Sidebar';
import ChartList from '@/components/ChartList';
import PDFViewer from '@/components/PDFViewer';
import SettingsModal from '@/components/SettingsModal';
import { ChartData, ChartCategory, GroupedCharts, CATEGORY_ORDER } from '@/types/chart';
import { getPDFFileName } from '@/lib/chartParser';
import { Loader2 } from 'lucide-react';

export default function Home() {
  const [groupedCharts, setGroupedCharts] = useState<GroupedCharts>({});
  const [airports, setAirports] = useState<string[]>([]);
  const [selectedAirport, setSelectedAirport] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<ChartCategory | null>(null);
  const [selectedChart, setSelectedChart] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const loadCharts = () => {
    setLoading(true);
    fetch('/api/charts')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setGroupedCharts(data.data);
          const airportList = Object.keys(data.data).sort();
          setAirports(airportList);
          if (airportList.length > 0) {
            setSelectedAirport(airportList[0]);
          }
        }
        setLoading(false);
      })
      .catch(error => {
        console.error('Error loading charts:', error);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadCharts();
  }, []);

  const handleAirportChange = (airport: string) => {
    setSelectedAirport(airport);
    setSelectedCategory(null);
    setSelectedChart(null);
  };

  const handleCategoryChange = (category: ChartCategory) => {
    // Toggle: if already selected, deselect; otherwise select
    if (selectedCategory === category) {
      setSelectedCategory(null);
    } else {
      setSelectedCategory(category);
    }
    setSelectedChart(null);
  };

  const handleCloseCategory = () => {
    setSelectedCategory(null);
  };

  const handleChartSelect = (chart: ChartData) => {
    setSelectedChart(chart);
    setSelectedCategory(null); // Close the chart list after selection
  };

  const handleSettingsSaved = () => {
    // Reload charts after settings are saved
    setSelectedChart(null);
    setSelectedCategory(null);
    loadCharts();
  };

  const currentCharts = selectedAirport && selectedCategory
    ? groupedCharts[selectedAirport]?.[selectedCategory] || []
    : [];

  const categoryCounts: Record<ChartCategory, number> = CATEGORY_ORDER.reduce(
    (acc, category) => {
      acc[category] = groupedCharts[selectedAirport]?.[category]?.length || 0;
      return acc;
    },
    {} as Record<ChartCategory, number>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-white dark:bg-gray-900">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-900 dark:text-white text-lg">Loading Chart Data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile/Tablet Sidebar Overlay */}
      <div className="lg:hidden">
        {isSidebarOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/50 z-30 transition-opacity"
              onClick={() => setIsSidebarOpen(false)}
            />
            {/* Sliding Sidebar */}
            <div className="fixed left-0 top-0 bottom-0 w-20 z-40 transform transition-transform">
              <Sidebar
                airports={airports}
                selectedAirport={selectedAirport}
                selectedCategory={selectedCategory}
                onAirportChange={handleAirportChange}
                onCategoryChange={handleCategoryChange}
                categoryCounts={categoryCounts}
                onClose={() => setIsSidebarOpen(false)}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onCloseCategory={handleCloseCategory}
              />
            </div>
          </>
        )}
      </div>

      {/* Desktop Sidebar */}
      <div className="hidden lg:block">
        <Sidebar
          airports={airports}
          selectedAirport={selectedAirport}
          selectedCategory={selectedCategory}
          onAirportChange={handleAirportChange}
          onCategoryChange={handleCategoryChange}
          categoryCounts={categoryCounts}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onCloseCategory={handleCloseCategory}
        />
      </div>

      <div className="flex-1 relative overflow-hidden">
        {/* Chart List Panel - Slides in from left when category selected */}
        {selectedCategory && (
          <>
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/50 z-10 transition-opacity"
              onClick={() => setSelectedCategory(null)}
            />
            
            {/* Sliding Panel - Responsive width */}
            <div className="absolute left-0 top-0 bottom-0 w-full sm:w-96 md:w-[28rem] lg:w-96 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 overflow-hidden z-20 shadow-2xl">
              <ChartList
                charts={currentCharts}
                selectedChart={selectedChart}
                onChartSelect={handleChartSelect}
                category={selectedCategory}
              />
            </div>
          </>
        )}

        {/* PDF Viewer Panel - Full width */}
        <div className="w-full h-full overflow-hidden">
          {selectedChart ? (
            <PDFViewer
              pdfUrl={`/api/pdf/${encodeURIComponent(getPDFFileName(selectedChart))}`}
              chart={selectedChart}
              onOpenSidebar={() => setIsSidebarOpen(true)}
            />
          ) : (
            <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900 text-gray-400 dark:text-gray-500">
              <div className="text-center px-4">
                <p className="text-lg">No chart selected</p>
                <p className="text-sm mt-2">
                  <span className="lg:hidden">Tap the menu to select a category and chart</span>
                  <span className="hidden lg:inline">Select a category and chart to view</span>
                </p>
                {/* Mobile menu button */}
                <button
                  onClick={() => setIsSidebarOpen(true)}
                  className="lg:hidden mt-4 px-6 py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
                >
                  Open Menu
                </button>
                
                {/* Copyright Footer */}
                <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-600">
                  <p>Chart Viewer - EFB © 2025 Justin</p>
                  <button
                    onClick={() => {
                      const url = "https://github.com/6639835/chart-viewer";
                      if (typeof window !== 'undefined' && window.electronAPI) {
                        window.electronAPI.openExternal(url);
                      } else {
                        window.open(url, '_blank', 'noopener,noreferrer');
                      }
                    }}
                    className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 inline-block mt-1 cursor-pointer"
                  >
                    GitHub Repository
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSettingsSaved}
      />
    </div>
  );
}

