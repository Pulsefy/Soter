/**
 * Mock biometric authentication service.
 * This is an MVP implementation that uses mock responses only.
 * 
 * Designed to be easily replaceable with real biometric implementations:
 * - WebAuthn
 * - Face ID
 * - Touch ID
 * - Android Biometrics
 * - Secure hardware authentication
 */

export type BiometricStatus = 
  | 'available' 
  | 'unavailable' 
  | 'unknown';

export type BiometricAuthResult = 
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'error';

export interface BiometricCapabilities {
  /** Whether biometric authentication is available on this device */
  isAvailable: boolean;
  /** Type of biometric support (mock for now) */
  type: 'face_id' | 'touch_id' | 'webauthn' | 'none';
  /** Mock description for debugging */
  description: string;
}

/**
 * Checks if biometric authentication is available on the current device.
 * Mock implementation returns configurable response based on environment or random.
 */
export async function checkBiometricAvailability(): Promise<BiometricCapabilities> {
  // Mock: Simulate checking device capabilities
  // In a real implementation, this would check:
  // - WebAuthn API availability
  // - Platform authenticator availability
  // - OS-level biometric enrollment
  
  const mockAvailable = process.env.NEXT_PUBLIC_MOCK_BIOMETRIC_AVAILABLE !== 'false';
  
  if (mockAvailable) {
    return {
      isAvailable: true,
      type: 'webauthn', // Mock type
      description: 'Mock biometric authentication available (WebAuthn)'
    };
  } else {
    return {
      isAvailable: false,
      type: 'none',
      description: 'Biometric authentication not available on this device'
    };
  }
}

/**
 * Initiates biometric authentication.
 * Mock implementation simulates authentication flow.
 */
export async function authenticateBiometric(options?: {
  /** Optional reason to show to user */
  reason?: string;
  /** Timeout in milliseconds */
  timeout?: number;
}): Promise<BiometricAuthResult> {
  const { reason = 'Confirm your identity to continue', timeout = 30000 } = options || {};
  
  console.log(`[Biometric Mock] Starting authentication: ${reason}`);
  
  // Mock: Simulate biometric authentication
  // In a real implementation, this would:
  // - Show platform biometric prompt
  // - Handle WebAuthn authentication
  // - Return success/failure based on user interaction
  
  try {
    // Simulate network/device check
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Mock: Randomly simulate different outcomes for testing
    // In production, this would be replaced with real biometric API
    const mockOutcome = process.env.NEXT_PUBLIC_MOCK_BIOMETRIC_OUTCOME;
    
    if (mockOutcome === 'success') {
      return 'success';
    } else if (mockOutcome === 'failed') {
      return 'failed';
    } else if (mockOutcome === 'cancelled') {
      return 'cancelled';
    } else if (mockOutcome === 'error') {
      throw new Error('Mock biometric error');
    }
    
    // Default: simulate successful authentication 80% of the time for testing
    const random = Math.random();
    if (random < 0.8) {
      return 'success';
    } else if (random < 0.9) {
      return 'failed';
    } else {
      return 'cancelled';
    }
    
  } catch (error) {
    console.error('[Biometric Mock] Authentication error:', error);
    return 'error';
  }
}

/**
 * Checks biometric availability and returns a simple status.
 */
export async function getBiometricStatus(): Promise<BiometricStatus> {
  try {
    const capabilities = await checkBiometricAvailability();
    return capabilities.isAvailable ? 'available' : 'unavailable';
  } catch (error) {
    console.error('[Biometric Mock] Error checking biometric status:', error);
    return 'unknown';
  }
}

/**
 * Utility to simulate biometric prompt with loading states.
 * This is a higher-level wrapper that manages the authentication flow.
 */
export async function promptBiometricAuthentication(
  options?: {
    reason?: string;
    onProgress?: (step: 'checking' | 'prompting' | 'verifying') => void;
  }
): Promise<BiometricAuthResult> {
  const { reason = 'Confirm your identity', onProgress } = options || {};
  
  // Step 1: Check availability
  onProgress?.('checking');
  const capabilities = await checkBiometricAvailability();
  
  if (!capabilities.isAvailable) {
    console.log('[Biometric Mock] Biometrics not available');
    throw new Error('Biometric authentication not available');
  }
  
  // Step 2: Show prompt (simulated)
  onProgress?.('prompting');
  
  // Step 3: Authenticate
  onProgress?.('verifying');
  const result = await authenticateBiometric({ reason });
  
  return result;
}