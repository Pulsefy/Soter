export const getExplorerUrl = (type: 'tx' | 'tz' | 'address', value: string): string => {
  const segment = type === 'tz' ? 'tx' : type;
  return `https://stellar.expert/explorer/testnet/${segment}/${value}`;
export const getExplorerUrl = (type: 'tx' | 'address' | 'tz' | 'contract', value: string): string => {
  return `https://stellar.expert/explorer/testnet/${type}/${value}`;
};
