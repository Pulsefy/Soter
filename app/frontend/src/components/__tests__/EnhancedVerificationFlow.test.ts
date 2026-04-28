import { parseEnhancedVerificationDraft } from '../EnhancedVerificationFlow';

describe('parseEnhancedVerificationDraft', () => {
    it('returns null when draft is missing', () => {
        expect(parseEnhancedVerificationDraft(null)).toBeNull();
    });

    it('returns null when JSON is malformed', () => {
        expect(parseEnhancedVerificationDraft('{oops')).toBeNull();
    });

    it('returns null when textInput is missing', () => {
        expect(
            parseEnhancedVerificationDraft(
                JSON.stringify({
                    includeLocation: true,
                }),
            ),
        ).toBeNull();
    });

    it('returns null when textInput is not a string', () => {
        expect(
            parseEnhancedVerificationDraft(
                JSON.stringify({
                    textInput: 42,
                }),
            ),
        ).toBeNull();
    });

    it('returns parsed draft when shape is valid', () => {
        expect(
            parseEnhancedVerificationDraft(
                JSON.stringify({
                    textInput: 'Need help with flood recovery documents.',
                }),
            ),
        ).toEqual({
            textInput: 'Need help with flood recovery documents.',
        });
    });
});
