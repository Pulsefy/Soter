export interface AidPackage {
  id: string;
  name: string;
  status: 'pending' | 'delivered' | 'cancelled';
}
