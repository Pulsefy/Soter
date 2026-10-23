export const normalizeWalletAddress = (address: string): string => address.trim();

export const maskWalletAddress = (address: string): string => {
  const normalized = normalizeWalletAddress(address);
  if (!normalized) return 'unknown';

  const withoutPrefix = normalized.startsWith('G') ? normalized.slice(1) : normalized;
  const prefix = withoutPrefix.slice(0, 4) || normalized.slice(0, 4);
  const suffix = withoutPrefix.slice(-4) || normalized.slice(-4);

  if (!prefix || !suffix || prefix === suffix) {
    return normalized.slice(0, 8);
  }

  return `${prefix}...${suffix}`;
};

export const shouldWarnAboutWalletSwap = (previousAddress?: string | null, nextAddress?: string | null): boolean => {
  const oldAddress = previousAddress?.trim();
  const newAddress = nextAddress?.trim();

  if (!oldAddress || !newAddress) {
    return false;
  }

  return oldAddress.toLowerCase() !== newAddress.toLowerCase();
};

type TranslationLike = (key: string, params?: Record<string, string>) => string;

export const formatWalletSwapWarning = (
  previousAddress?: string | null,
  nextAddress?: string | null,
  translate?: TranslationLike,
): string => {
  if (!shouldWarnAboutWalletSwap(previousAddress, nextAddress)) {
    return translate ? translate('wallet.sameWalletWarning') : 'This wallet matches the one already connected to this device.';
  }

  const oldMasked = maskWalletAddress(previousAddress ?? '');
  const newMasked = maskWalletAddress(nextAddress ?? '');

  if (translate) {
    return translate('wallet.differentWalletWarning', {
      previousAddress: oldMasked,
      newAddress: newMasked,
    });
  }

  return `This is a different wallet than before. You previously connected ${oldMasked}, but this session is trying to connect ${newMasked}. Continue only if you intend to switch wallets.`;
};
