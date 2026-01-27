import { PrismaClient, Decimal } from '@prisma/client';

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

  // Newly Added: Seed demo campaign 1 (active)
  const campaign1 = await prisma.campaign.upsert({
    where: { id: 'demo-campaign-1' },
    update: {},
    create: {
      id: 'demo-campaign-1',
      name: 'Emergency Relief Fund 2026',
      status: 'active',
      budget: new Decimal('50000.00'),
      metadata: {
        description: 'Disaster relief campaign for affected communities',
        region: 'West Africa',
      },
    },
  });

  // Newly Added: Seed demo campaign 2 (draft)
  const campaign2 = await prisma.campaign.upsert({
    where: { id: 'demo-campaign-2' },
    update: {},
    create: {
      id: 'demo-campaign-2',
      name: 'Medical Aid Initiative',
      status: 'draft',
      budget: new Decimal('75000.00'),
      metadata: {
        description: 'Healthcare access program for underserved areas',
        region: 'South Africa',
      },
    },
  });

  console.log('Seeded campaigns:', [campaign1.name, campaign2.name]);

  // Newly Added: Seed demo claims for campaign 1
  const claim1 = await prisma.claim.upsert({
    where: { id: 'demo-claim-1' },
    update: {},
    create: {
      id: 'demo-claim-1',
      campaignId: campaign1.id,
      status: 'approved',
      amount: new Decimal('5000.00'),
      description: 'Relief supplies for flood-affected families',
      metadata: {
        beneficiaries: 25,
        items: ['food', 'water', 'blankets'],
      },
    },
  });

  // Newly Added: Seed demo claims for campaign 1
  const claim2 = await prisma.claim.upsert({
    where: { id: 'demo-claim-2' },
    update: {},
    create: {
      id: 'demo-claim-2',
      campaignId: campaign1.id,
      status: 'pending',
      amount: new Decimal('3500.00'),
      description: 'Medical supplies and temporary shelter',
      metadata: {
        beneficiaries: 15,
        items: ['medicine', 'tents', 'first-aid-kits'],
      },
    },
  });

  // Newly Added: Seed demo claims for campaign 2
  const claim3 = await prisma.claim.upsert({
    where: { id: 'demo-claim-3' },
    update: {},
    create: {
      id: 'demo-claim-3',
      campaignId: campaign2.id,
      status: 'paid',
      amount: new Decimal('8000.00'),
      description: 'Mobile health clinic operations',
      metadata: {
        beneficiaries: 500,
        services: ['vaccinations', 'health-screening'],
      },
    },
  });

  console.log('Seeded claims for testing:', [claim1.id, claim2.id, claim3.id]);
}

main()
  .catch((error) => {
    console.error('❌ Seed error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
