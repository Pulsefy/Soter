import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest'; // Fixed module call signature pattern
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Deployment Metadata (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const adminToken = 'dev-admin-key-000'; // From seed data

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    // Clean up deployment metadata created during tests
    await prisma.deploymentMetadata.deleteMany({
      where: {
        contractName: {
          contains: 'Test',
        },
      },
    });
    await app.close();
  });

  describe('POST /deployment-metadata (Create)', () => {
    it('should create a new deployment metadata record', () => {
      const createDto = {
        contractName: 'TestContract',
        network: 'testnet',
        contractId: 'CTEST123456789ABCDEF',
        wasmHash: 'testhash123456789',
        deployedAt: new Date('2026-06-03T12:00:00Z').toISOString(),
        commitSha: 'testsha123',
        deployer: 'GTESTDEPLOYER123456',
        transactionHash: 'testtx123',
      };

      return request(app.getHttpServer())
        .post('/deployment-metadata')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(createDto)
        .expect(201)
        .expect(res => {
          expect(res.body).toHaveProperty('id');
          expect(res.body.contractName).toBe('TestContract');
          expect(res.body.network).toBe('testnet');
          expect(res.body.contractId).toBe('CTEST123456789ABCDEF');
          expect(res.body.wasmHash).toBe('testhash123456789');
          expect(res.body.deployer).toBe('GTESTDEPLOYER123456');
        });
    });

    it('should fail when missing required fields', () => {
      const invalidDto = {
        contractName: 'TestContract',
        network: 'testnet',
        // Missing required fields
      };

      return request(app.getHttpServer())
        .post('/deployment-metadata')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidDto)
        .expect(400);
    });

    it('should prevent duplicate network+contractName combinations', async () => {
      const createDto = {
        contractName: 'TestDuplicate',
        network: 'testnet',
        contractId: 'CDUP123456789',
        wasmHash: 'duplhash123',
        deployedAt: new Date().toISOString(),
      };

      // Create the first one
      await request(app.getHttpServer())
        .post('/deployment-metadata')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(createDto)
        .expect(201);

      // Try to create a duplicate
      return request(app.getHttpServer())
        .post('/deployment-metadata')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(createDto)
        .expect(400);
    });
  });

  describe('GET /deployment-metadata (List All)', () => {
    it('should list all deployment metadata', async () => {
      return request(app.getHttpServer())
        .get('/deployment-metadata')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect(res => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });
  });

  describe('GET /deployment-metadata/by-network/:network', () => {
    it('should return metadata for a specific network', async () => {
      return request(app.getHttpServer())
        .get('/deployment-metadata/by-network/testnet')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect(res => {
          expect(Array.isArray(res.body)).toBe(true);
          // Should contain the seeded testnet AidEscrow contract
          if (res.body.length > 0) {
            expect(res.body.some((m: any) => m.network === 'testnet')).toBe(
              true,
            );
          }
        });
    });

    it('should return empty array for non-existent network', async () => {
      return request(app.getHttpServer())
        .get('/deployment-metadata/by-network/nonexistent')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect(res => {
          expect(res.body).toEqual([]);
        });
    });
  });

  describe('GET /deployment-metadata/by-contract/:network/:contractName', () => {
    it('should return metadata for AidEscrow on testnet', async () => {
      return request(app.getHttpServer())
        .get('/deployment-metadata/by-contract/testnet/AidEscrow')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect(res => {
          expect(res.body).toHaveProperty('contractName', 'AidEscrow');
          expect(res.body).toHaveProperty('network', 'testnet');
          expect(res.body).toHaveProperty(
            'contractId',
            'CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
          );
        });
    });

    it('should return 404-like response for non-existent contract', async () => {
      return request(app.getHttpServer())
        .get('/deployment-metadata/by-contract/testnet/NonExistent')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect(res => {
          expect(res.body).toHaveProperty('message');
        });
    });
  });

  describe('GET /deployment-metadata/by-contract-id/:contractId', () => {
    it('should return metadata by contract ID', async () => {
      return request(app.getHttpServer())
        .get(
          '/deployment-metadata/by-contract-id/CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
        )
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect(res => {
          expect(res.body).toHaveProperty(
            'contractId',
            'CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
          );
          expect(res.body).toHaveProperty('contractName', 'AidEscrow');
        });
    });
  });

  describe('PUT /deployment-metadata/:id (Update)', () => {
    let testId: string;

    beforeAll(async () => {
      // Create a test record to update
      const createDto = {
        contractName: 'TestUpdate',
        network: 'testnet',
        contractId: 'CUPDATE123',
        wasmHash: 'updatehash',
        deployedAt: new Date().toISOString(),
      };

      const response = await request(app.getHttpServer())
        .post('/deployment-metadata')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(createDto);

      testId = response.body.id;
    });

    it('should update deployment metadata', () => {
      const updateDto = {
        commitSha: 'updated-commit-sha',
      };

      return request(app.getHttpServer())
        .put(`/deployment-metadata/${testId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateDto)
        .expect(200)
        .expect(res => {
          expect(res.body.commitSha).toBe('updated-commit-sha');
        });
    });
  });

  describe('DELETE /deployment-metadata/:id', () => {
    let testId: string;

    beforeAll(async () => {
      // Create a test record to delete
      const createDto = {
        contractName: 'TestDelete',
        network: 'testnet',
        contractId: 'CDELETE123',
        wasmHash: 'deletehash',
        deployedAt: new Date().toISOString(),
      };

      const response = await request(app.getHttpServer())
        .post('/deployment-metadata')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(createDto);

      testId = response.body.id;
    });

    it('should delete deployment metadata', () => {
      return request(app.getHttpServer())
        .delete(`/deployment-metadata/${testId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);
    });
  });

  describe('Tenant Safety', () => {
    it('should keep deployments from different networks isolated', async () => {
      // Create metadata for testnet
      const testnetDto = {
        contractName: 'IsolationTest',
        network: 'testnet',
        contractId: 'CISO-TESTNET',
        wasmHash: 'iso-testnet-hash',
        deployedAt: new Date().toISOString(),
      };

      await request(app.getHttpServer())
        .post('/deployment-metadata')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(testnetDto)
        .expect(201);

      // Create metadata for mainnet with same contract name
      const mainnetDto = {
        contractName: 'IsolationTest',
        network: 'mainnet',
        contractId: 'CISO-MAINNET',
        wasmHash: 'iso-mainnet-hash',
        deployedAt: new Date().toISOString(),
      };

      await request(app.getHttpServer())
        .post('/deployment-metadata')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(mainnetDto)
        .expect(201);

      // Verify testnet query returns only testnet metadata
      const testnetResult = await request(app.getHttpServer())
        .get('/deployment-metadata/by-network/testnet')
        .set('Authorization', `Bearer ${adminToken}`);

      const testnetIsolation = testnetResult.body.find(
        (m: any) => m.contractName === 'IsolationTest',
      );
      expect(testnetIsolation.network).toBe('testnet');
      expect(testnetIsolation.contractId).toBe('CISO-TESTNET');
    });
  });

  describe('Authorization', () => {
    it('should reject requests without admin role', () => {
      const clientToken = 'dev-client-key-002'; // From seed data

      return request(app.getHttpServer())
        .get('/deployment-metadata')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);
    });
  });
});
