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
      budget: 10000.00,
      status: 'active' as const,
      description: 'Emergency response campaign for affected communities',
    },
    {
      name: 'Community Health Program',
      budget: 5000.00,
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
        amount: 500.00,
        status: 'verified' as const,
        recipientRef: `recipient-${i}-1`,
        evidenceRef: `evidence-${i}-1`,
      },
      {
        amount: 750.00,
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

  // Seed deployment metadata for the Aid Escrow contract
  const deploymentMetadata = [
    {
      contractName: 'AidEscrow',
      network: 'testnet',
      contractId: 'CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
      wasmHash: '24328e15b7c11c7ff07caeaf0328da591b3b63e84af57fa03623c10126eabc8d',
      deployedAt: new Date('2026-06-03T12:00:00Z'),
      commitSha: 'abc123def456',
      deployer: 'GA5TBSBGERHVMEFBJGEM3KYMRLWO73Y2QRAV6P66GPEBOJ5ZMJUT7LLY',
      transactionHash: '292bf42f063310028456890e88861cd1650149ef0d4e66ba2a22ea5769964e64',
      metadata: {
        uploadTxHash: 'f61ca00143125d29f9932b5b50e499d9ab5dde8f2a849637a64d84cd1dcb9103',
        stellarExplorerUrl: 'https://stellar.expert/explorer/testnet/tx/292bf42f063310028456890e88861cd1650149ef0d4e66ba2a22ea5769964e64',
        contractUrl: 'https://lab.stellar.org/r/testnet/contract/CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
        version: '1.0.0',
      },
    },
  ];

  for (const metadata of deploymentMetadata) {
    await prisma.deploymentMetadata.upsert({
      where: {
        network_contractName: {
          network: metadata.network,
          contractName: metadata.contractName,
        },
      },
      update: {
        contractId: metadata.contractId,
        wasmHash: metadata.wasmHash,
        deployedAt: metadata.deployedAt,
        commitSha: metadata.commitSha,
        deployer: metadata.deployer,
        transactionHash: metadata.transactionHash,
        metadata: metadata.metadata,
      },
      create: metadata,
    });
  }

  console.log(`Seeded ${deploymentMetadata.length} deployment metadata records`);

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
