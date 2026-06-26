/** @jest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { EnhancedVerificationFlow } from '../EnhancedVerificationFlow';
import * as networkGuard from '@/hooks/useNetworkGuard';

// Mocking the hooks that are used in EnhancedVerificationFlow to prevent errors
jest.mock('@/hooks/useNetworkGuard');
jest.mock('@/hooks/useActivity', () => ({
    useActivity: () => ({ trackJob: jest.fn() })
}));
jest.mock('@/lib/app-role', () => ({
    getAppUserRole: () => 'recipient',
    getSampleVerificationText: () => 'sample',
    isOperationsRole: () => false
}));

describe('EnhancedVerificationFlow UI Network Guard', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('disables submit button and shows mismatch banner when network is mismatched', () => {
        jest.spyOn(networkGuard, 'useNetworkGuard').mockReturnValue({
            isCorrectNetwork: false,
            isMismatch: true,
            walletNetwork: 'testnet',
            expectedNetwork: 'mainnet'
        });

        render(<EnhancedVerificationFlow />);

        // The banner should be rendered
        expect(screen.getByText(/Network mismatch/i)).toBeInTheDocument();
        
        // The submit button should be disabled
        const submitButton = screen.getByRole('button', { name: /Submit for Verification/i });
        expect(submitButton).toBeDisabled();
    });

    it('hides mismatch banner when network is correct', () => {
        jest.spyOn(networkGuard, 'useNetworkGuard').mockReturnValue({
            isCorrectNetwork: true,
            isMismatch: false,
            walletNetwork: 'mainnet',
            expectedNetwork: 'mainnet'
        });

        render(<EnhancedVerificationFlow />);

        // The banner should NOT be rendered
        expect(screen.queryByText(/Network mismatch/i)).not.toBeInTheDocument();
    });
});
