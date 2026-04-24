import { ImportRecipientsWizard } from '@/components/import-wizard/ImportRecipientsWizard';

interface ImportRecipientsPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function ImportRecipientsPage({ params }: ImportRecipientsPageProps) {
  const { id } = await params;

  return <ImportRecipientsWizard campaignId={id} />;
}
