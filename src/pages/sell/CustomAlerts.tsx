"use client";

import { useState, useEffect } from "react";
import { CheckCircle, XCircle, X } from "lucide-react";

interface AlertProps {
  message: string;
  type: "success" | "error";
  isOpen: boolean;
  onClose: () => void;
  duration?: number;
}

const CustomAlert = ({ 
  message, 
  type, 
  isOpen, 
  onClose, 
  duration = 3000 
}: AlertProps) => {
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [isOpen, onClose, duration]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-start justify-center z-50 pointer-events-none pt-4">
      <div 
        className={`
          animate-in fade-in slide-in-from-top-2
          pointer-events-auto
          flex items-center gap-2 rounded-lg p-4 shadow-lg
          ${type === "success" 
            ? "bg-green-100 text-green-800 border border-green-200" 
            : "bg-red-100 text-red-800 border border-red-200"
          }
        `}
      >
        {type === "success" ? (
          <CheckCircle className="h-5 w-5 shrink-0" />
        ) : (
          <XCircle className="h-5 w-5 shrink-0" />
        )}
        
        <p className="text-sm font-medium max-w-sm">{message}</p>
        
        <button
          onClick={onClose}
          className={`
            ml-4 p-1 rounded-full hover:bg-opacity-20
            ${type === "success" 
              ? "hover:bg-green-800" 
              : "hover:bg-red-800"
            }
          `}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </button>
      </div>
    </div>
  );
};

// Example usage in other components:
// const [alert, setAlert] = useState({ isOpen: false, message: "", type: "success" as const });
// <CustomAlert
//   message={alert.message}
//   type={alert.type}
//   isOpen={alert.isOpen}
//   onClose={() => setAlert(prev => ({ ...prev, isOpen: false }))}
// />

export default CustomAlert;