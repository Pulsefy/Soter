export const mockOpenAI = {
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  verified: true,
                  confidenceScore: 0.95,
                  humanitarianScore: 0.92,
                  verificationDetails: {
                    identityVerified: true,
                    locationVerified: true,
                    emergencyValidated: true,
                  },
                  notes: 'Claimant verified successfully',
                }),
              },
            },
          ],
        }),
      },
    },
  })),
};

export default mockOpenAI;
