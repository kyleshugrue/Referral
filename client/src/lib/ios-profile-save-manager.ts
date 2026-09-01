/**
 * iOS Profile Save Manager
 * 
 * A singleton manager that persists beyond component lifecycle on iOS native.
 * This ensures profile saves complete even when the user navigates away from
 * the profile page during a save operation.
 * 
 * Key Features:
 * - Singleton pattern - survives component unmounts
 * - Queue-based saves - handles multiple concurrent save requests
 * - Automatic retry with exponential backoff
 * - Token refresh on 401 errors
 * - Optimistic cache updates that don't revert on navigation
 * - Status tracking for UI synchronization
 */

import { Capacitor } from '@capacitor/core';
import { config } from './config';
import { getCurrentAccessToken, refreshAccessToken, waitForTokensReady } from './token-manager';
import { queryClient } from './queryClient';
import { logger } from './logger';
import type { User } from '@shared/schema';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

export type IOSSaveStatus = 'idle' | 'saving' | 'retrying' | 'saved' | 'error';

interface SaveOperation {
  id: string;
  data: Partial<Omit<User, 'id' | 'password'>>;
  attempt: number;
  status: IOSSaveStatus;
  startTime: number;
  error?: string;
}

type StatusListener = (status: IOSSaveStatus, operation: SaveOperation | null) => void;

class IOSProfileSaveManager {
  private static instance: IOSProfileSaveManager | null = null;
  
  private currentOperation: SaveOperation | null = null;
  private pendingOperations: SaveOperation[] = [];
  private isProcessing: boolean = false;
  private statusListeners: Set<StatusListener> = new Set();
  private lastSaveTimestamp: number = 0;
  private lastSavedData: User | null = null;
  
  private constructor() {
    logger.debug('[IOSProfileSaveManager] Singleton instance created');
  }
  
  static getInstance(): IOSProfileSaveManager {
    if (!IOSProfileSaveManager.instance) {
      IOSProfileSaveManager.instance = new IOSProfileSaveManager();
    }
    return IOSProfileSaveManager.instance;
  }
  
  static isIOSNative(): boolean {
    return Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
  }
  
  addStatusListener(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    if (this.currentOperation) {
      listener(this.currentOperation.status, this.currentOperation);
    }
    return () => {
      this.statusListeners.delete(listener);
    };
  }
  
  private notifyListeners(status: IOSSaveStatus, operation: SaveOperation | null) {
    this.statusListeners.forEach(listener => {
      try {
        listener(status, operation);
      } catch (error) {
        logger.error('[IOSProfileSaveManager] Error in status listener:', error);
      }
    });
  }
  
  getStatus(): IOSSaveStatus {
    return this.currentOperation?.status || 'idle';
  }
  
  getLastSaveTimestamp(): number {
    return this.lastSaveTimestamp;
  }
  
  getLastSavedData(): User | null {
    return this.lastSavedData;
  }
  
  isOperationInProgress(): boolean {
    return this.isProcessing || this.currentOperation !== null || this.pendingOperations.length > 0;
  }
  
  private generateOperationId(): string {
    return `ios_op_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }
  
  private async buildHeaders(): Promise<Record<string, string>> {
    await waitForTokensReady();
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Platform': 'ios-native',
      'X-Capacitor-Platform': 'ios',
    };
    
    const accessToken = getCurrentAccessToken();
    if (accessToken && accessToken !== 'PENDING_REFRESH') {
      headers['Authorization'] = `Bearer ${accessToken}`;
      logger.debug('[IOSProfileSaveManager] JWT token available for authentication');
    } else {
      logger.warn('[IOSProfileSaveManager] No JWT token available');
    }
    
    return headers;
  }
  
  private cleanData(data: Partial<Omit<User, 'id' | 'password'>>): Record<string, unknown> {
    const enumFields = ['educationLevel', 'industry', 'genderIdentity', 'pronouns'];
    return Object.fromEntries(
      Object.entries(data)
        .filter(([key, v]) => {
          if (v === undefined) return false;
          if (enumFields.includes(key) && v === '') return false;
          return true;
        })
    );
  }
  
  async saveProfile(data: Partial<Omit<User, 'id' | 'password'>>): Promise<{ success: boolean; savedData: User | null }> {
    if (!IOSProfileSaveManager.isIOSNative()) {
      logger.debug('[IOSProfileSaveManager] Not iOS native; skipping singleton manager');
      return { success: false, savedData: null };
    }
    
    const cleanedData = this.cleanData(data);
    
    if (Object.keys(cleanedData).length === 0) {
      logger.debug('[IOSProfileSaveManager] No data to save after cleaning');
      return { success: true, savedData: this.lastSavedData };
    }
    
    const operation: SaveOperation = {
      id: this.generateOperationId(),
      data: cleanedData as Partial<Omit<User, 'id' | 'password'>>,
      attempt: 0,
      status: 'saving',
      startTime: Date.now(),
    };
    
    logger.debug(`[IOSProfileSaveManager][${operation.id}] New save operation queued`);
    
    if (this.isProcessing) {
      logger.debug(`[IOSProfileSaveManager][${operation.id}] Another save in progress, adding to queue`);
      this.pendingOperations.push(operation);
      return this.waitForOperation(operation);
    }
    
    return this.executeOperation(operation);
  }
  
  private async waitForOperation(operation: SaveOperation): Promise<{ success: boolean; savedData: User | null }> {
    return new Promise((resolve) => {
      const checkComplete = () => {
        if (operation.status === 'saved') {
          resolve({ success: true, savedData: this.lastSavedData });
        } else if (operation.status === 'error') {
          resolve({ success: false, savedData: null });
        } else {
          setTimeout(checkComplete, 100);
        }
      };
      checkComplete();
    });
  }
  
  private async executeOperation(operation: SaveOperation): Promise<{ success: boolean; savedData: User | null }> {
    this.isProcessing = true;
    this.currentOperation = operation;
    
    logger.debug(`[IOSProfileSaveManager][${operation.id}] Starting save operation, attempt ${operation.attempt + 1}`);
    
    this.notifyListeners(operation.status, operation);
    
    const currentCache = queryClient.getQueryData<User>(["/api/user"]);
    if (currentCache) {
      logger.debug(`[IOSProfileSaveManager][${operation.id}] Applying optimistic update to cache`);
      queryClient.setQueryData(["/api/user"], {
        ...currentCache,
        ...operation.data
      });
    }
    
    const result = await this.performSaveWithRetry(operation);
    
    this.isProcessing = false;
    this.currentOperation = null;
    
    if (this.pendingOperations.length > 0) {
      const nextOp = this.pendingOperations.shift()!;
      logger.debug(`[IOSProfileSaveManager][${nextOp.id}] Processing next queued operation`);
      this.executeOperation(nextOp);
    }
    
    return result;
  }
  
  private async performSaveWithRetry(operation: SaveOperation): Promise<{ success: boolean; savedData: User | null }> {
    const requestUrl = `${config.apiBaseUrl}/api/user`;
    
    while (operation.attempt <= MAX_RETRIES) {
      try {
        logger.debug(`[IOSProfileSaveManager][${operation.id}] PATCH request attempt ${operation.attempt + 1}`);
        
        let headers = await this.buildHeaders();
        
        headers['X-Operation-ID'] = operation.id;
        
        let response = await fetch(requestUrl, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(operation.data),
          credentials: 'include',
        });
        
        logger.debug(`[IOSProfileSaveManager][${operation.id}] Response status: ${response.status}`);
        
        if (response.status === 401) {
          logger.debug(`[IOSProfileSaveManager][${operation.id}] Got 401, attempting token refresh`);
          const newToken = await refreshAccessToken();
          
          if (newToken) {
            headers = await this.buildHeaders();
            headers['X-Operation-ID'] = operation.id;
            
            response = await fetch(requestUrl, {
              method: 'PATCH',
              headers,
              body: JSON.stringify(operation.data),
              credentials: 'include',
            });
            
            logger.debug(`[IOSProfileSaveManager][${operation.id}] Retry after token refresh status: ${response.status}`);
          }
        }
        
        if (response.ok) {
          const savedUser = await response.json() as User;
          
          logger.info(`[IOSProfileSaveManager][${operation.id}] Save successful`);
          
          this.lastSaveTimestamp = Date.now();
          this.lastSavedData = savedUser;
          operation.status = 'saved';
          
          queryClient.setQueryData(["/api/user"], savedUser);
          
          this.notifyListeners('saved', operation);
          
          setTimeout(() => {
            if (this.currentOperation === null) {
              this.notifyListeners('idle', null);
            }
          }, 2000);
          
          return { success: true, savedData: savedUser };
        }
        
        if (response.status >= 400 && response.status < 500) {
          let errorMessage = 'Save failed';
          try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
           } catch {
             // The response may not contain JSON; retain the generic save-error fallback.
           }
          
          logger.error(`[IOSProfileSaveManager][${operation.id}] Client error ${response.status}: ${errorMessage}`);
          
          operation.status = 'error';
          operation.error = errorMessage;
          this.notifyListeners('error', operation);
          
          return { success: false, savedData: null };
        }
        
        throw new Error(`Server error: ${response.status}`);
        
      } catch (error) {
        logger.error(`[IOSProfileSaveManager][${operation.id}] Network/fetch error:`, error);
        
        operation.attempt++;
        
        if (operation.attempt > MAX_RETRIES) {
          logger.error(`[IOSProfileSaveManager][${operation.id}] Max retries exceeded`);
          
          operation.status = 'error';
          operation.error = 'Network error after retries';
          this.notifyListeners('error', operation);
          
          return { success: false, savedData: null };
        }
        
        operation.status = 'retrying';
        this.notifyListeners('retrying', operation);
        
        const delay = RETRY_DELAYS[Math.min(operation.attempt - 1, RETRY_DELAYS.length - 1)];
        logger.debug(`[IOSProfileSaveManager][${operation.id}] Retrying in ${delay}ms...`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    operation.status = 'error';
    operation.error = 'Exhausted retries';
    this.notifyListeners('error', operation);
    return { success: false, savedData: null };
  }
  
  cancelPendingOperations(): void {
    logger.debug('[IOSProfileSaveManager] Cancelling pending operations');
    this.pendingOperations = [];
  }
}

export const iosProfileSaveManager = IOSProfileSaveManager.getInstance();
export { IOSProfileSaveManager };
