export const getExplorerUrl = (type: 'tx' | 'address', value: string): string => {
  return `https://stellar.expert/explorer/testnet/${type}/${value}`;
};
