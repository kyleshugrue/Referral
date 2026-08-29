import React from 'react';
import { Capacitor } from '@capacitor/core';
import { X } from 'lucide-react';

interface IOSActionSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

interface IOSActionButtonProps {
  onPress: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  variant?: 'default' | 'primary' | 'destructive';
}

export function IOSActionSheet({ isOpen, onClose, title, subtitle, children }: IOSActionSheetProps) {
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/30 z-50 transition-opacity"
        onClick={onClose}
      />
      
      {/* Action Sheet */}
      <div className={`fixed bottom-0 left-0 right-0 z-50 ${isNativeIOS ? 'ios-action-sheet' : ''}`}>
        <div className="bg-white rounded-t-[20px] p-4 max-h-[80vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 text-center">{title}</h3>
              {subtitle && (
                <p className="text-sm text-gray-600 text-center mt-1">{subtitle}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="absolute right-4 top-4 p-2 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              <X className="w-5 h-5 text-gray-600" />
            </button>
          </div>
          
          {/* Content */}
          <div className="space-y-3">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

export function IOSActionButton({ onPress, children, icon, variant = 'default' }: IOSActionButtonProps) {
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  
  const getButtonStyles = () => {
    const baseStyles = `w-full p-4 rounded-xl flex items-center gap-3 text-left transition-all ${isNativeIOS ? 'ios-action-button' : ''}`;
    
    switch (variant) {
      case 'primary':
        return `${baseStyles} bg-blue-500 text-white font-semibold hover:bg-blue-600 active:bg-blue-700`;
      case 'destructive':
        return `${baseStyles} bg-red-50 text-red-600 hover:bg-red-100 active:bg-red-200`;
      default:
        return `${baseStyles} bg-gray-50 text-gray-900 hover:bg-gray-100 active:bg-gray-200`;
    }
  };

  return (
    <button
      onClick={onPress}
      className={getButtonStyles()}
    >
      {icon && (
        <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
          {icon}
        </div>
      )}
      <span className="flex-1">{children}</span>
    </button>
  );
}