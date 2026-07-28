export const getExplorerUrl = (type: 'tz' | 'address', value: string): string => {
  return `https://stellar.expert/explorer/testnet/${type}/${value}`;
};
