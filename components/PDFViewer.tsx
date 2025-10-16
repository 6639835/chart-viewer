'use client';

import { useState, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, FileText, Maximize2, Menu, Bookmark } from 'lucide-react';
import { ChartData } from '@/types/chart';
import { useTheme } from 'next-themes';
import { getFormattedChartName } from '@/lib/chartFormatter';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Configure worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerProps {
  pdfUrl: string;
  chart: ChartData;
  onOpenSidebar?: () => void;
  bookmarkedCharts: ChartData[];
  onNavigateToBookmark: (direction: 'next' | 'prev') => void;
}

export default function PDFViewer({ pdfUrl, chart, onOpenSidebar, bookmarkedCharts, onNavigateToBookmark }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [renderScale, setRenderScale] = useState<number>(2.0); // High quality base render scale
  const [autoFitScale, setAutoFitScale] = useState<number>(1.0); // Calculated scale for auto-fit mode
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [autoFit, setAutoFit] = useState<boolean>(true);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [containerHeight, setContainerHeight] = useState<number>(0);
  const [pageWidth, setPageWidth] = useState<number>(0); // Original PDF page width at scale 1.0
  const [pageHeight, setPageHeight] = useState<number>(0); // Original PDF page height at scale 1.0
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [scrollStart, setScrollStart] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [isScrolling, setIsScrolling] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfWrapperRef = useRef<HTMLDivElement>(null);
  const rerenderTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { theme } = useTheme();
  
  // Determine if colors should be inverted based on theme
  const invertColors = theme === 'dark';

  // Measure container dimensions
  useEffect(() => {
    if (!containerRef.current) return;
    
    const updateDimensions = () => {
      if (containerRef.current) {
        // Account for padding: mobile (8px), tablet/desktop (16px)
        const paddingX = window.innerWidth < 640 ? 16 : 32; // 2 * (p-2 or p-4)
        const paddingY = window.innerWidth < 640 ? 16 : 32;
        const newWidth = containerRef.current.clientWidth - paddingX;
        const newHeight = containerRef.current.clientHeight - paddingY;
        setContainerWidth(newWidth);
        setContainerHeight(newHeight);
        
        // Recalculate autoFitScale when container size changes
        if (autoFit && pageHeight > 0 && newHeight > 0) {
          const fitScale = newHeight / pageHeight;
          setAutoFitScale(fitScale);
          
          // Update renderScale for better quality
          const optimalRenderScale = Math.min(Math.max(fitScale * 1.5, 2.0), 4.0);
          setRenderScale(optimalRenderScale);
        }
      }
    };
    
    updateDimensions();
    
    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(containerRef.current);
    
    return () => resizeObserver.disconnect();
  }, [autoFit, pageHeight]);

  // Mouse drag to pan
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const handleMouseDown = (e: MouseEvent) => {
      // Only enable dragging when not in autoFit mode and not clicking on interactive elements
      if (autoFit) return;
      
      // Ignore if clicking on buttons, links, or text selection
      const target = e.target as HTMLElement;
      if (target.tagName === 'BUTTON' || target.tagName === 'A') return;
      
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setScrollStart({ left: container.scrollLeft, top: container.scrollTop });
      e.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      
      e.preventDefault();
      
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      
      // Update scroll position (negative because we're moving the view opposite to mouse movement)
      container.scrollLeft = scrollStart.left - dx;
      container.scrollTop = scrollStart.top - dy;
    };

    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
      }
    };

    const handleMouseLeave = () => {
      if (isDragging) {
        setIsDragging(false);
      }
    };

    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [isDragging, dragStart, scrollStart, autoFit]);

  // Detect scrolling to show/hide scrollbar
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const handleScroll = () => {
      setIsScrolling(true);
      
      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      
      // Hide scrollbar after 1 second of no scrolling
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 1000);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Mouse wheel zoom (Ctrl/Cmd + scroll) with intelligent re-rendering
  useEffect(() => {
    if (!containerRef.current) return;

    const handleWheel = (e: WheelEvent) => {
      // Check if Ctrl (Windows/Linux) or Cmd (Mac) is pressed
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        
        // Disable auto-fit when manually zooming
        setAutoFit(false);
        
        // deltaY is positive when scrolling down, negative when scrolling up
        // Scroll down = zoom out, scroll up = zoom in
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        
        // Update scale directly - CSS transform handles the immediate visual scaling
        setScale(prevScale => {
          const newScale = Math.min(Math.max(prevScale + delta, 0.5), 3.0);
          
          // Clear existing re-render timeout
          if (rerenderTimeoutRef.current) {
            clearTimeout(rerenderTimeoutRef.current);
          }
          
          // Schedule intelligent re-rendering after user stops zooming
          rerenderTimeoutRef.current = setTimeout(() => {
            // If zoomed significantly beyond current render scale, re-render at higher quality
            // Or if zoomed below half the render scale, render at lower quality to save memory
            if (newScale > renderScale * 0.8 || newScale < renderScale * 0.3) {
              // Choose optimal render scale: 1.5x the target scale, clamped between 1.5 and 3.0
              const optimalRenderScale = Math.min(Math.max(newScale * 1.5, 1.5), 3.0);
              setRenderScale(optimalRenderScale);
            }
          }, 500);
          
          return newScale;
        });
      } else if (autoFit) {
        // In autoFit mode, prevent normal scrolling (without Ctrl/Cmd)
        e.preventDefault();
      }
    };

    const container = containerRef.current;
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
      if (rerenderTimeoutRef.current) {
        clearTimeout(rerenderTimeoutRef.current);
      }
    };
  }, [renderScale, autoFit]);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
    setLoading(false);
    setError(null);
  }

  function onDocumentLoadError(error: Error) {
    console.error('PDF load error:', error);
    setError('Failed to load PDF. File may not exist.');
    setLoading(false);
  }

  // Callback when a page finishes rendering - capture original dimensions
  function onPageLoadSuccess(page: any) {
    // Get viewport at scale 1.0 to get original dimensions
    const viewport = page.getViewport({ scale: 1.0 });
    setPageWidth(viewport.width);
    setPageHeight(viewport.height);
    
    // Calculate optimal scale for auto-fit mode
    if (autoFit && containerHeight > 0) {
      // Calculate scale to fit PDF height to container
      const fitScale = containerHeight / viewport.height;
      setAutoFitScale(fitScale);
      
      // Also update renderScale for auto-fit mode to ensure high quality
      // Use at least 1.5x the fit scale, clamped between 2.0 and 4.0 for best quality
      const optimalRenderScale = Math.min(Math.max(fitScale * 1.5, 2.0), 4.0);
      setRenderScale(optimalRenderScale);
    }
  }

  const changePage = (offset: number) => {
    setPageNumber(prevPageNumber => {
      const newPage = prevPageNumber + offset;
      // Reset page dimensions when changing pages so they'll be recalculated
      setPageWidth(0);
      setPageHeight(0);
      return Math.min(Math.max(1, newPage), numPages);
    });
  };

  const zoomIn = () => {
    setAutoFit(false);
    setScale(prev => {
      const newScale = Math.min(prev + 0.2, 3.0);
      // If zooming significantly, schedule a re-render for better quality
      if (rerenderTimeoutRef.current) {
        clearTimeout(rerenderTimeoutRef.current);
      }
      rerenderTimeoutRef.current = setTimeout(() => {
        if (newScale > renderScale * 0.8) {
          const optimalRenderScale = Math.min(Math.max(newScale * 1.5, 1.5), 3.0);
          setRenderScale(optimalRenderScale);
        }
      }, 500);
      return newScale;
    });
  };
  
  const zoomOut = () => {
    setAutoFit(false);
    setScale(prev => {
      const newScale = Math.max(prev - 0.2, 0.5);
      // If zooming significantly, schedule a re-render
      if (rerenderTimeoutRef.current) {
        clearTimeout(rerenderTimeoutRef.current);
      }
      rerenderTimeoutRef.current = setTimeout(() => {
        if (newScale < renderScale * 0.3) {
          const optimalRenderScale = Math.min(Math.max(newScale * 1.5, 1.5), 3.0);
          setRenderScale(optimalRenderScale);
        }
      }, 500);
      return newScale;
    });
  };
  
  const toggleAutoFit = () => {
    setAutoFit(prev => {
      const newAutoFit = !prev;
      if (newAutoFit) {
        // Switching to autoFit mode
        // Recalculate autoFitScale and renderScale
        if (pageHeight > 0 && containerHeight > 0) {
          const fitScale = containerHeight / pageHeight;
          setAutoFitScale(fitScale);
          const optimalRenderScale = Math.min(Math.max(fitScale * 1.5, 2.0), 4.0);
          setRenderScale(optimalRenderScale);
        }
      } else {
        // Switching to manual mode - reset to default values
        setScale(1.0);
        setRenderScale(2.0);
      }
      return newAutoFit;
    });
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-200 dark:bg-gray-900">
        <div className="text-center text-gray-400 dark:text-gray-400">
          <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p className="text-lg">{error}</p>
          <p className="text-sm mt-2">{getFormattedChartName(chart)}</p>
          <p className="text-xs mt-1 opacity-70">{chart.PAGE_NUMBER}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-100 dark:bg-gray-900">
      {/* Toolbar */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-2 sm:p-3 flex items-center justify-between gap-2">
        {/* Left section with menu button and title */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Mobile Menu Button */}
          {onOpenSidebar && (
            <button
              onClick={onOpenSidebar}
              className="lg:hidden p-2 text-gray-700 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700 rounded flex-shrink-0"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
          
          <div className="text-gray-900 dark:text-white min-w-0">
            <p className="font-semibold text-sm sm:text-base truncate">
              {getFormattedChartName(chart)}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
              {chart.PAGE_NUMBER}
            </p>
          </div>
        </div>

        {/* Controls section */}
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          {/* Zoom Controls - Show on all screens */}
          <div className="flex items-center gap-0.5 sm:gap-1">
            <button
              onClick={zoomOut}
              disabled={scale <= 0.5 || autoFit}
              className="p-1 sm:p-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
            <span 
              className="text-gray-900 dark:text-white text-[10px] sm:text-xs w-8 sm:w-12 text-center"
              title="Current zoom level"
            >
              {autoFit ? 'Auto' : `${Math.round(scale * 100)}%`}
            </span>
            <button
              onClick={zoomIn}
              disabled={scale >= 3.0 || autoFit}
              className="p-1 sm:p-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          </div>

          {/* Auto Fit Button - Show on all screens */}
          <button
            onClick={toggleAutoFit}
            className={`flex p-1 sm:p-1.5 ml-1 sm:ml-2 rounded transition-colors ${
              autoFit
                ? 'bg-blue-500 text-white'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
            title="Fit to Window"
          >
            <Maximize2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          {/* Bookmark Navigation - Show on tablets (iPad) and larger, hide on phones */}
          {bookmarkedCharts.length > 1 && (() => {
            const currentIndex = bookmarkedCharts.findIndex(c => c.ChartId === chart.ChartId);
            const displayIndex = currentIndex >= 0 ? currentIndex + 1 : 1;
            return (
              <div className="hidden md:flex items-center gap-1 ml-2 pl-2 border-l border-gray-300 dark:border-gray-600">
                <button
                  onClick={() => onNavigateToBookmark('prev')}
                  className="p-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                  title="Previous Bookmark"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-1 px-2">
                  <Bookmark className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-xs text-gray-900 dark:text-white font-medium whitespace-nowrap">
                    {displayIndex} / {bookmarkedCharts.length}
                  </span>
                </div>
                <button
                  onClick={() => onNavigateToBookmark('next')}
                  className="p-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                  title="Next Bookmark"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      {/* PDF Content */}
      <div 
        ref={containerRef}
        className={`flex-1 p-2 sm:p-4 bg-gray-200 dark:bg-gray-900 ${
          autoFit ? 'overflow-hidden flex items-center justify-center' : 'overflow-auto auto-hide-scrollbar'
        } ${isDragging ? 'select-none' : ''} ${isScrolling ? 'scrolling' : ''}`}
        style={{ 
          cursor: autoFit ? 'default' : (isDragging ? 'grabbing' : 'grab'),
          userSelect: isDragging ? 'none' : 'auto'
        }}
      >
        {loading && (
          <div className="text-gray-900 dark:text-white text-sm">Loading PDF...</div>
        )}
        <Document
          file={pdfUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading=""
        >
          {/* Outer container: defines the correct scroll area size based on user's scale */}
          <div
            style={{
              width: autoFit ? 'auto' : (!pageWidth ? 'auto' : `${Math.ceil(pageWidth * scale) + 16}px`),
              height: autoFit ? 'auto' : (!pageHeight ? 'auto' : `${Math.ceil(pageHeight * scale) + 16}px`),
              position: 'relative',
              display: autoFit ? 'flex' : 'block',
              justifyContent: autoFit ? 'center' : 'initial',
              alignItems: autoFit ? 'center' : 'initial',
              margin: autoFit ? 'auto' : '0 auto' // Center horizontally when smaller than viewport
            }}
          >
            {/* Inner container: applies transform to scale the high-res rendered PDF */}
            <div 
              ref={pdfWrapperRef}
              style={{ 
                filter: invertColors ? 'invert(1) hue-rotate(180deg)' : 'none',
                transform: autoFit 
                  ? `scale(${autoFitScale / renderScale})`  // Auto mode: scale from high-res to fit size
                  : `scale(${scale / renderScale})`,         // Manual mode: scale from high-res to user scale
                transformOrigin: autoFit ? 'center center' : 'top left',
                transition: 'transform 0.05s ease-out',
                willChange: 'transform',
                position: autoFit ? 'static' : 'absolute',
                top: 2,
                left: 2
              }}
              className="pdf-page-wrapper"
            >
              <Page
                pageNumber={pageNumber}
                scale={renderScale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
                className="shadow-lg"
                devicePixelRatio={Math.max(window.devicePixelRatio || 1, 2)}
                onLoadSuccess={onPageLoadSuccess}
              />
            </div>
          </div>
        </Document>
      </div>

      {/* Bottom Navigation Bar */}
      <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-2 sm:px-4 py-2 flex items-center justify-between">
        {/* Left - Previous */}
        <button
          onClick={() => changePage(-1)}
          disabled={pageNumber <= 1}
          className="px-2 sm:px-4 py-1.5 text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <span className="hidden sm:inline">&lt; PREV</span>
          <span className="sm:hidden">&lt;</span>
        </button>

        {/* Center - Current Chart Type */}
        <div className="text-center flex-1 px-2">
          <div className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-white truncate">
            {chart.ChartTypeEx_CH || 'TAXI'}
          </div>
          {!loading && (
            <div className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {pageNumber} / {numPages}
            </div>
          )}
        </div>

        {/* Right - Next */}
        <button
          onClick={() => changePage(1)}
          disabled={pageNumber >= numPages}
          className="px-2 sm:px-4 py-1.5 text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <span className="hidden sm:inline">NEXT &gt;</span>
          <span className="sm:hidden">&gt;</span>
        </button>
      </div>
    </div>
  );
}

