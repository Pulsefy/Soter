import { useState, useTransition } from 'react';

interface ReviewItem {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
}

export function useOptimisticReview(initialItems: ReviewItem[]) {
  const [items, setItems] = useState<ReviewItem[]>(initialItems);
  const [isPending, startTransition] = useTransition();
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const handleReviewAction = async (id: string, action: 'approve' | 'reject') => {
    const previousItems = [...items];
    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    // 1. Optimistic UI Update
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, status: newStatus } : item))
    );
    setErrorBanner(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/verification-review/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.message || 'Server rejected review action');
        }
      } catch (err) {
        // 2. Rollback on Failure & Surface Error
        setItems(previousItems);
        setErrorBanner(err instanceof Error ? err.message : 'Failed to synchronize review status.');
      }
    });
  };

  return { items, handleReviewAction, isPending, errorBanner };
}