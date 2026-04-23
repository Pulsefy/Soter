import { PrismaClient, AppRole, Campaign } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const roles = ['admin', 'ngo', 'user'];

  for (const name of roles) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  console.log('Seeded roles:', roles);

  // Seed development API keys
  // WARNING: These are dev/test-only keys. In production, insert keys securely.
  const devApiKeys = [
    {
      key: 'dev-admin-key-000',
      role: AppRole.admin,
      description: 'Local development admin key',
    },
    {
      key: 'dev-operator-key-001',
      role: AppRole.operator,
      description: 'Local development operator key',
    },
    {
      key: 'dev-client-key-002',
      role: AppRole.client,
      description: 'Local development client key',
    },
    {
      key: 'dev-ngo-key-003',
      role: AppRole.ngo,
      description: 'Local development NGO key',
    },
  ];

  for (const data of devApiKeys) {
    await prisma.apiKey.upsert({
      where: { key: data.key },
      update: { role: data.role, description: data.description },
      create: data,
    });
  }

  console.log('Seeded API keys for development');

  // Seed demo campaigns and claims for local testing
  const campaigns = [
    {
      name: 'Emergency Relief Fund',
      budget: '10000.00',
      status: 'active' as const,
      description: 'Emergency response campaign for affected communities',
    },
    {
      name: 'Community Health Program',
      budget: '5000.00',
      status: 'active' as const,
      description: 'Healthcare support initiative for underserved regions',
    },
  ];

  const createdCampaigns: Campaign[] = [];

  for (const campaignData of campaigns) {
    const campaign = await prisma.campaign.upsert({
      where: { id: `demo-campaign-${campaigns.indexOf(campaignData)}` },
      update: {
        name: campaignData.name,
        budget: campaignData.budget,
        status: campaignData.status,
      },
      create: {
        id: `demo-campaign-${campaigns.indexOf(campaignData)}`,
        name: campaignData.name,
        budget: campaignData.budget,
        status: campaignData.status,
        metadata: {
          description: campaignData.description,
          demo: true,
        },
      },
    });
    createdCampaigns.push(campaign);
  }

  console.log(`Seeded ${createdCampaigns.length} demo campaigns`);

  // Seed demo claims for each campaign
  for (let i = 0; i < createdCampaigns.length; i++) {
    const campaign = createdCampaigns[i];
    const claims = [
      {
        amount: '500.00',
        status: 'verified' as const,
        recipientRef: `recipient-${i}-1`,
        evidenceRef: `evidence-${i}-1`,
      },
      {
        amount: '750.00',
        status: 'approved' as const,
        recipientRef: `recipient-${i}-2`,
        evidenceRef: `evidence-${i}-2`,
      },
    ];

    for (const claimData of claims) {
      await prisma.claim.upsert({
        where: {
          id: `demo-claim-${campaign.id}-${claims.indexOf(claimData)}`,
        },
        update: {
          amount: claimData.amount,
          status: claimData.status,
        },
        create: {
          id: `demo-claim-${campaign.id}-${claims.indexOf(claimData)}`,
          campaignId: campaign.id,
          amount: claimData.amount,
          status: claimData.status,
          recipientRef: claimData.recipientRef,
          evidenceRef: claimData.evidenceRef,
        },
      });
    }

    console.log(`Seeded 2 demo claims for campaign: ${campaign.name}`);
  }

  console.log('Demo data seeding completed successfully');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
