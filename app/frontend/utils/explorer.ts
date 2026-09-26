export const getExplorerUrl = (type: 'tx' | 'address' | 'tz' | 'contract', value: string): string => {
  return `https://stellar.expert/explorer/testnet/${type}/${value}`;
};
