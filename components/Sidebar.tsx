'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown, Search, X, Settings } from 'lucide-react';
import { ChartCategory, CATEGORY_ORDER } from '@/types/chart';
import ThemeToggle from './ThemeToggle';

interface SidebarProps {
  airports: string[];
  selectedAirport: string;
  selectedCategory: ChartCategory | null;
  onAirportChange: (airport: string) => void;
  onCategoryChange: (category: ChartCategory) => void;
  categoryCounts: Record<ChartCategory, number>;
  onClose?: () => void;
  onOpenSettings?: () => void;
  onCloseCategory?: () => void;
}

// Category display names mapping
const CATEGORY_NAMES: Record<ChartCategory, string> = {
  'STAR': 'STAR',
  'APP': 'APP',
  'TAXI': 'TAXI',
  'SID': 'SID',
  'OTHER': 'OTHER',
  '细则': '细则'
};

export default function Sidebar({
  airports,
  selectedAirport,
  selectedCategory,
  onAirportChange,
  onCategoryChange,
  categoryCounts,
  onClose,
  onOpenSettings,
  onCloseCategory,
}: SidebarProps) {
  const [isAirportDropdownOpen, setIsAirportDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAirportScrolling, setIsAirportScrolling] = useState(false);
  const [isCategoryScrolling, setIsCategoryScrolling] = useState(false);
  const airportScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const categoryScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const airportListRef = useRef<HTMLDivElement>(null);
  const categoryListRef = useRef<HTMLDivElement>(null);

  const filteredAirports = useMemo(() => {
    if (!searchQuery.trim()) return airports;
    const query = searchQuery.toLowerCase();
    return airports.filter(airport => 
      airport.toLowerCase().includes(query)
    );
  }, [airports, searchQuery]);

  const handleAirportSelect = (airport: string) => {
    onAirportChange(airport);
    setIsAirportDropdownOpen(false);
    setSearchQuery('');
  };

  const handleCategorySelect = (category: ChartCategory) => {
    onCategoryChange(category);
    // Close sidebar on mobile after category selection
    if (onClose) {
      onClose();
    }
  };

  // Handle scroll for airport list
  useEffect(() => {
    // Only bind scroll listener when dropdown is open
    if (!isAirportDropdownOpen) return;
    
    const scrollContainer = airportListRef.current;
    if (!scrollContainer) return;
    
    const handleScroll = () => {
      setIsAirportScrolling(true);
      
      if (airportScrollTimeoutRef.current) {
        clearTimeout(airportScrollTimeoutRef.current);
      }
      
      airportScrollTimeoutRef.current = setTimeout(() => {
        setIsAirportScrolling(false);
      }, 1000);
    };
    
    scrollContainer.addEventListener('scroll', handleScroll);
    
    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
      if (airportScrollTimeoutRef.current) {
        clearTimeout(airportScrollTimeoutRef.current);
      }
    };
  }, [isAirportDropdownOpen]);

  // Handle scroll for category list
  useEffect(() => {
    const scrollContainer = categoryListRef.current;
    if (!scrollContainer) return;
    
    const handleScroll = () => {
      setIsCategoryScrolling(true);
      
      if (categoryScrollTimeoutRef.current) {
        clearTimeout(categoryScrollTimeoutRef.current);
      }
      
      categoryScrollTimeoutRef.current = setTimeout(() => {
        setIsCategoryScrolling(false);
      }, 1000);
    };
    
    scrollContainer.addEventListener('scroll', handleScroll);
    
    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
      if (categoryScrollTimeoutRef.current) {
        clearTimeout(categoryScrollTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="w-20 bg-gray-100 dark:bg-gray-900 border-r border-gray-300 dark:border-gray-800 flex flex-col h-screen">
      {/* Airport Selector */}
      <div className="p-2 border-b border-gray-300 dark:border-gray-800">
        <div className="relative">
          <button
            onClick={() => {
              // Close chart list if open before opening airport dropdown
              if (!isAirportDropdownOpen && selectedCategory && onCloseCategory) {
                onCloseCategory();
              }
              setIsAirportDropdownOpen(!isAirportDropdownOpen);
            }}
            className="w-full bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-2 rounded flex flex-col items-center justify-center hover:bg-gray-300 dark:hover:bg-gray-700 transition-colors group"
            title={selectedAirport}
          >
            <span className="font-bold text-xs">{selectedAirport}</span>
            <ChevronDown className={`w-3 h-3 mt-1 transition-transform ${isAirportDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Airport Dropdown */}
          {isAirportDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => {
                  setIsAirportDropdownOpen(false);
                  setSearchQuery('');
                }}
              />
              <div className="absolute left-full top-0 ml-2 w-64 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-xl z-20 flex flex-col" style={{ maxHeight: '24rem' }}>
                {/* Search Box */}
                <div className="p-3 border-b border-gray-300 dark:border-gray-700 flex-shrink-0">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search airport..."
                      className="w-full bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white pl-10 pr-4 py-2 rounded border border-gray-300 dark:border-gray-600 focus:border-blue-500 focus:outline-none"
                      autoFocus
                    />
                  </div>
                </div>
                
                {/* Airport List */}
                <div 
                  ref={airportListRef}
                  className={`flex-1 overflow-y-auto auto-hide-scrollbar ${isAirportScrolling ? 'scrolling' : ''}`}
                >
                  {filteredAirports.length > 0 ? (
                    filteredAirports.map(airport => (
                      <button
                        key={airport}
                        onClick={() => handleAirportSelect(airport)}
                        className={`w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                          airport === selectedAirport
                            ? 'bg-blue-500 text-white'
                            : 'text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {airport}
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                      No airports found
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Categories - Vertical compact buttons */}
      <div 
        ref={categoryListRef}
        className={`flex-1 overflow-y-auto py-2 auto-hide-scrollbar ${isCategoryScrolling ? 'scrolling' : ''}`}
      >
        <div className="space-y-1 px-2">
          {CATEGORY_ORDER.map(category => {
            const count = categoryCounts[category] || 0;
            const isDisabled = count === 0;
            const displayName = CATEGORY_NAMES[category];

            return (
              <button
                key={category}
                onClick={() => !isDisabled && handleCategorySelect(category)}
                disabled={isDisabled}
                title={`${category} (${count})`}
                className={`w-full py-3 rounded text-center font-bold transition-colors text-xs ${
                  selectedCategory === category
                    ? 'bg-blue-500 text-white shadow-lg'
                    : isDisabled
                    ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed bg-gray-200 dark:bg-gray-800 opacity-50'
                    : 'text-gray-900 dark:text-white bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                {displayName}
                {count > 0 && (
                  <div className="text-[10px] mt-1 opacity-80">
                    {count}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom icons/buttons */}
      <div className="p-2 border-t border-gray-300 dark:border-gray-800 space-y-2">
        {/* Theme Toggle */}
        <div className="w-full flex justify-center">
          <ThemeToggle />
        </div>
        
        {/* Settings button */}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="w-full p-2 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-800 rounded flex items-center justify-center transition-colors"
            aria-label="Settings"
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        )}
        
        {/* Mobile close button */}
        {onClose && (
          <button
            onClick={onClose}
            className="w-full p-2 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-800 rounded flex items-center justify-center"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}

