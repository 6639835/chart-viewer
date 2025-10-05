'use client';

import { useState, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, FileText, Maximize2, Menu } from 'lucide-react';
import { ChartData } from '@/types/chart';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Configure worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerProps {
  pdfUrl: string;
  chart: ChartData;
  onOpenSidebar?: () => void;
}

export default function PDFViewer({ pdfUrl, chart, onOpenSidebar }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [autoFit, setAutoFit] = useState<boolean>(true);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [containerHeight, setContainerHeight] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Measure container dimensions
  useEffect(() => {
    if (!containerRef.current) return;
    
    const updateDimensions = () => {
      if (containerRef.current) {
        // Account for padding: mobile (8px), tablet/desktop (16px)
        const paddingX = window.innerWidth < 640 ? 16 : 32; // 2 * (p-2 or p-4)
        const paddingY = window.innerWidth < 640 ? 16 : 32;
        setContainerWidth(containerRef.current.clientWidth - paddingX);
        setContainerHeight(containerRef.current.clientHeight - paddingY);
      }
    };
    
    updateDimensions();
    
    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(containerRef.current);
    
    return () => resizeObserver.disconnect();
  }, []);

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

  const changePage = (offset: number) => {
    setPageNumber(prevPageNumber => {
      const newPage = prevPageNumber + offset;
      return Math.min(Math.max(1, newPage), numPages);
    });
  };

  const zoomIn = () => {
    setAutoFit(false);
    setScale(prev => Math.min(prev + 0.2, 3.0));
  };
  
  const zoomOut = () => {
    setAutoFit(false);
    setScale(prev => Math.max(prev - 0.2, 0.5));
  };
  
  const toggleAutoFit = () => {
    setAutoFit(prev => !prev);
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-200 dark:bg-gray-900">
        <div className="text-center text-gray-400 dark:text-gray-400">
          <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p className="text-lg">{error}</p>
          <p className="text-sm mt-2">{chart.ChartName}</p>
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
              {chart.ChartName}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
              {chart.PAGE_NUMBER}
            </p>
          </div>
        </div>

        {/* Controls section */}
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          {/* Zoom Controls */}
          <div className="hidden sm:flex items-center gap-1">
            <button
              onClick={zoomOut}
              disabled={scale <= 0.5 || autoFit}
              className="p-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-gray-900 dark:text-white text-xs w-12 text-center">
              {autoFit ? 'Auto' : `${Math.round(scale * 100)}%`}
            </span>
            <button
              onClick={zoomIn}
              disabled={scale >= 3.0 || autoFit}
              className="p-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>

          {/* Auto Fit Button */}
          <button
            onClick={toggleAutoFit}
            className={`hidden sm:flex p-1.5 ml-2 rounded transition-colors ${
              autoFit
                ? 'bg-blue-500 text-white'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
            title="Fit to Window"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* PDF Content */}
      <div 
        ref={containerRef}
        className={`flex-1 overflow-auto flex justify-center p-2 sm:p-4 bg-gray-200 dark:bg-gray-900 ${
          autoFit ? 'items-center' : 'items-start'
        }`}
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
          <Page
            pageNumber={pageNumber}
            height={autoFit && containerHeight > 0 ? containerHeight : undefined}
            scale={autoFit ? undefined : scale}
            renderTextLayer={true}
            renderAnnotationLayer={true}
            className="shadow-2xl"
            devicePixelRatio={window.devicePixelRatio || 2}
          />
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

